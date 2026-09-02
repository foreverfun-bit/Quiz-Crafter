const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const USER_SCOPED_TABLES = new Set([
  "questions",
  "sessions",
  "categories",
  "disliked_categories",
  "rejected_categories",
  "category_preferences",
  "venues",
]);

const PUBLIC_SESSION_READ_TABLES = new Set(["sessions"]);
const ALLOWED_TABLES = new Set([
  ...USER_SCOPED_TABLES,
  "session_rounds",
  "session_questions",
  "session_question_feedback",
  "session_category_feedback",
  "session_player_ideas",
]);

const getBearerToken = (req, body = {}) => {
  if (body.authToken) return String(body.authToken);
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

// This proxy is the single chokepoint for every Supabase query the app
// makes, so verifying auth here used to mean an unbounded network round
// trip to Supabase's `/auth/v1/user` on every single request -- when that
// endpoint degraded project-wide (Cloudflare 520s, the origin never
// finishing the request), every query through here hung waiting on a
// doomed fetch with no timeout, then fell back to the client-provided
// clientUserId anyway. Under normal light usage that just meant extra
// silent latency per query; during a live hosted session, when player
// join/leave activity multiplies how many of these queries fire at once,
// the pile-up of hung requests was enough to make the whole app feel
// crashed.
// Verifying the JWT signature locally (same approach already used for
// host-only live-game actions) avoids that network call for the vast
// majority of requests. The `/auth/v1/user` fallback stays for token
// shapes this can't verify locally, but now with a short timeout so a
// broken auth service fails this one check fast instead of blocking
// every query behind it.
const JWKS_TTL_MS = 10 * 60 * 1000;
const ASYMMETRIC_ALGS = new Set(["ES256", "RS256"]);
let jwksCache = { url: "", expiresAt: 0, keys: [] };

const getJwtSecret = () => process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_AUTH_JWT_SECRET || process.env.JWT_SECRET || "";
const normalizeSupabaseUrl = (supabaseUrl) => String(supabaseUrl || "").replace(/\/$/, "");
const base64UrlDecode = (value) => Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const base64UrlEncode = (buffer) => Buffer.from(buffer).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const userFromJwtPayload = (payload) => ({
  id: payload.sub,
  email: payload.email || null,
  role: payload.role || null,
  aud: payload.aud || null,
  app_metadata: payload.app_metadata || {},
  user_metadata: payload.user_metadata || {},
});

const validateJwtPayload = (payload, supabaseUrl) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) <= nowSeconds) return "Auth token expired";
  if (!payload.sub) return "Auth token is missing a user id";
  const expectedIssuer = `${normalizeSupabaseUrl(supabaseUrl)}/auth/v1`;
  if (payload.iss && payload.iss !== expectedIssuer) return "Auth token issuer does not match this Supabase project";
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
  if (aud.length && !aud.includes("authenticated")) return "Auth token audience is not authenticated";
  return null;
};

const fetchJwks = async (supabaseUrl, force = false) => {
  const jwksUrl = `${normalizeSupabaseUrl(supabaseUrl)}/auth/v1/.well-known/jwks.json`;
  if (!force && jwksCache.url === jwksUrl && jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(jwksUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`JWKS endpoint returned ${response.status}`);
    const jwks = await response.json();
    const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
    jwksCache = { url: jwksUrl, expiresAt: Date.now() + JWKS_TTL_MS, keys };
    return keys;
  } finally {
    clearTimeout(timeout);
  }
};

const verifyJwtWithJwks = async (supabaseUrl, token, header, payload, parts) => {
  if (!ASYMMETRIC_ALGS.has(header.alg)) return { user: null, skipped: true };
  if (validateJwtPayload(payload, supabaseUrl)) return { user: null, skipped: false };

  const findKey = (keys) => keys.find((key) => (!header.kid || key.kid === header.kid) && (!key.alg || key.alg === header.alg));
  let keys = await fetchJwks(supabaseUrl).catch(() => []);
  let jwk = findKey(keys);
  if (!jwk) {
    keys = await fetchJwks(supabaseUrl, true).catch(() => []);
    jwk = findKey(keys);
  }
  if (!jwk) return { user: null, skipped: true };

  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]);
    const verified = header.alg === "ES256"
      ? crypto.verify("sha256", signedData, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)
      : crypto.verify("RSA-SHA256", signedData, publicKey, signature);
    return verified ? { user: userFromJwtPayload(payload), skipped: false } : { user: null, skipped: false };
  } catch {
    return { user: null, skipped: true };
  }
};

const verifyJwtLocally = async (supabaseUrl, token) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { user: null, skipped: false };

  const header = safeJsonParse(base64UrlDecode(parts[0]).toString("utf8"));
  const payload = safeJsonParse(base64UrlDecode(parts[1]).toString("utf8"));
  if (!header || !payload) return { user: null, skipped: false };

  if (header.alg !== "HS256") return verifyJwtWithJwks(supabaseUrl, token, header, payload, parts);

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) return { user: null, skipped: true };

  const expected = base64UrlEncode(crypto.createHmac("sha256", jwtSecret).update(`${parts[0]}.${parts[1]}`).digest());
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(parts[2]);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { user: null, skipped: false };
  }
  if (validateJwtPayload(payload, supabaseUrl)) return { user: null, skipped: false };

  return { user: userFromJwtPayload(payload), skipped: false };
};

const fetchAuthUserFallback = async (supabaseUrl, anonKey, token) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${normalizeSupabaseUrl(supabaseUrl)}/auth/v1/user`, {
      signal: controller.signal,
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const user = await response.json().catch(() => null);
    return user?.id ? user : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const verifyUser = async (supabaseUrl, anonKey, token) => {
  if (!token) return null;
  const local = await verifyJwtLocally(supabaseUrl, token);
  if (local.user?.id) return local.user;
  if (!local.skipped) return null;
  return fetchAuthUserFallback(supabaseUrl, anonKey, token);
};

const applyFilters = (query, filters = []) => {
  let next = query;
  filters.forEach((filter) => {
    if (!filter?.column) return;
    if (filter.op === "in") {
      next = next.in(filter.column, Array.isArray(filter.value) ? filter.value : []);
      return;
    }
    next = next.eq(filter.column, filter.value);
  });
  return next;
};

const safeFilters = (table, filters = [], hasVerifiedUser = false) => {
  if (!hasVerifiedUser || !USER_SCOPED_TABLES.has(table)) return filters;
  return filters.filter((filter) => filter?.column !== "user_id");
};

const applyOrders = (query, orders = []) => {
  let next = query;
  orders.forEach((order) => {
    if (!order?.column) return;
    next = next.order(order.column, { ascending: order.ascending !== false });
  });
  return next;
};

const withUserId = (payload, userId) => {
  if (Array.isArray(payload)) return payload.map((item) => ({ ...(item || {}), user_id: item?.user_id || userId }));
  return { ...(payload || {}), user_id: payload?.user_id || userId };
};

const getFilteredUserId = (filters = []) => {
  const userFilter = filters.find((filter) => filter?.column === "user_id" && filter?.op !== "in" && filter?.value);
  return userFilter ? String(userFilter.value) : "";
};

const getClientUserId = (body = {}) => {
  const value = String(body.clientUserId || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : "";
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(500).json({ error: "Missing Supabase server configuration" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const table = String(body.table || "");
  const action = String(body.action || "select");

  if (!ALLOWED_TABLES.has(table)) {
    res.status(400).json({ error: "Table is not available through this endpoint" });
    return;
  }

  const user = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
  const filteredUserId = getFilteredUserId(body.filters);
  const clientUserId = getClientUserId(body);
  const effectiveUserId = user?.id || filteredUserId || clientUserId;
  const isPublicSessionRead = action === "select" && PUBLIC_SESSION_READ_TABLES.has(table) && !user?.id;
  const isFilteredUserRead = action === "select" && USER_SCOPED_TABLES.has(table) && !!filteredUserId;

  if (!effectiveUserId && !isPublicSessionRead && !isFilteredUserRead) {
    res.status(401).json({ error: "You must be signed in" });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let query;
    const columns = body.columns || "*";
    const payload = USER_SCOPED_TABLES.has(table) && effectiveUserId && ["insert", "upsert"].includes(action)
      ? withUserId(body.payload, effectiveUserId)
      : body.payload;

    if (action === "insert") query = supabase.from(table).insert(payload);
    else if (action === "update") query = supabase.from(table).update(payload || {});
    else if (action === "upsert") query = supabase.from(table).upsert(payload);
    else if (action === "delete") query = supabase.from(table).delete();
    else query = supabase.from(table).select(columns);

    query = applyFilters(query, safeFilters(table, body.filters, !!effectiveUserId));

    if (USER_SCOPED_TABLES.has(table) && effectiveUserId && action !== "insert" && action !== "upsert") {
      query = query.eq("user_id", effectiveUserId);
    }

    if (action !== "delete") query = applyOrders(query, body.orders);
    if (Number.isFinite(Number(body.limit))) query = query.limit(Number(body.limit));
    if (action !== "select" && columns) query = query.select(columns);
    if (body.single) query = query.single();

    const { data, error } = await query;
    if (error) {
      res.status(400).json({ error: error.message, details: error.details || error.hint || null });
      return;
    }
    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: error.message || "Supabase data request failed" });
  }
};
