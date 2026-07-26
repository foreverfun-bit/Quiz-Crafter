const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// live_games / live_game_players are read and written directly from the
// browser to Supabase (bypassing /api/supabase-data) because anonymous
// players joining via QR code aren't signed-in Supabase users, and that
// proxy only supports authenticated, user-owned data. That direct
// browser-to-Supabase REST path has been unreliable in production
// (CORS/connectivity failures unrelated to auth or RLS correctness --
// both were verified fine server-side). This endpoint is same-origin, so
// it sidesteps that path entirely. Permissions here intentionally mirror
// the existing RLS policies on these tables:
//   - live_games: select public; insert/delete host-only (host_user_id
//     must match the verified caller); update is intentionally left to
//     the host's normal session flow (not exposed here yet).
//   - live_game_players: select public; insert/update open to anyone
//     (matches the current "anyone in a non-finished game" RLS -- this
//     is a party-trivia roster, not sensitive data); delete host-only.
// Realtime (channel broadcast, postgres_changes subscriptions) stays on
// the direct WebSocket connection -- that path has kept working
// throughout today's incidents, only the REST/fetch path is affected.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeGameCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const AUTH_RETRY_DELAYS_MS = [250, 500, 900, 1400, 2200, 3200];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * 120);
const getJwtSecret = () => process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_AUTH_JWT_SECRET || process.env.JWT_SECRET || "";

const base64UrlDecode = (value) => Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const base64UrlEncode = (buffer) => Buffer.from(buffer).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getBearerToken = (req, body = {}) => {
  if (body.authToken) return String(body.authToken);
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

const verifyJwtLocally = (token) => {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) return { user: null, error: "No JWT secret configured for local verification", skipped: true };

  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { user: null, error: "Malformed auth token" };

  const header = safeJsonParse(base64UrlDecode(parts[0]).toString("utf8"));
  const payload = safeJsonParse(base64UrlDecode(parts[1]).toString("utf8"));
  if (!header || !payload) return { user: null, error: "Malformed auth token payload" };
  if (header.alg !== "HS256") return { user: null, error: `Unsupported auth token algorithm: ${header.alg || "unknown"}` };

  const expected = base64UrlEncode(crypto.createHmac("sha256", jwtSecret).update(`${parts[0]}.${parts[1]}`).digest());
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(parts[2]);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { user: null, error: "Invalid auth token signature" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) <= nowSeconds) return { user: null, error: "Auth token expired" };
  if (!payload.sub) return { user: null, error: "Auth token is missing a user id" };

  return {
    user: {
      id: payload.sub,
      email: payload.email || null,
      role: payload.role || null,
      aud: payload.aud || null,
      app_metadata: payload.app_metadata || {},
      user_metadata: payload.user_metadata || {},
    },
    error: null,
  };
};

const fetchAuthUser = async (supabaseUrl, anonKey, token) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    return await fetch(`${supabaseUrl}/auth/v1/user`, {
      signal: controller.signal,
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
  } finally {
    clearTimeout(timeout);
  }
};

// Returns { user, error, status } instead of just null on failure. Host-only
// actions should return status 401 when the caller is actually unauthenticated
// and 503 when Supabase's auth endpoint is temporarily unavailable. The latter
// should be retried by the browser instead of telling the host to sign in again.
const verifyUser = async (supabaseUrl, anonKey, token) => {
  if (!token) return { user: null, error: "No auth token was sent with the request", status: 401 };

  const localResult = verifyJwtLocally(token);
  if (localResult.user?.id) return { user: localResult.user, error: null, status: 200, source: "local-jwt" };
  if (!localResult.skipped) return { user: null, error: localResult.error || "Invalid auth token", status: 401 };

  let lastError = "Auth check failed for an unknown reason";
  for (let attempt = 0; attempt <= AUTH_RETRY_DELAYS_MS.length; attempt++) {
    let response;
    try {
      response = await fetchAuthUser(supabaseUrl, anonKey, token);
    } catch (fetchError) {
      lastError = `Auth check request failed: ${fetchError.name === "AbortError" ? "timed out" : fetchError.message}`;
      if (attempt < AUTH_RETRY_DELAYS_MS.length) await sleep(jitter(AUTH_RETRY_DELAYS_MS[attempt]));
      continue;
    }

    if (response.ok) {
      const user = await response.json().catch(() => null);
      return user?.id
        ? { user, error: null, status: 200, source: "supabase-auth" }
        : { user: null, error: "Auth check succeeded but returned no user", status: 401 };
    }

    const detail = await response.text().catch(() => "");
    if (response.status < 500) {
      return { user: null, error: `Supabase auth check returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`, status: 401 };
    }

    lastError = `Supabase auth check returned ${response.status} (their auth service, not your sign-in)`;
    if (attempt < AUTH_RETRY_DELAYS_MS.length) await sleep(jitter(AUTH_RETRY_DELAYS_MS[attempt]));
  }

  return { user: null, error: lastError, status: 503, transient: true };
};

const rejectAuthFailure = (res, action, authError, authStatus) => {
  console.error(`${action} auth failed:`, authError);
  const status = authStatus === 503 ? 503 : 401;
  const fallback = status === 503 ? "Supabase auth is temporarily unavailable. Please try again." : "You must be signed in to host";
  return res.status(status).json({ error: authError || fallback, retryable: status === 503 });
};

module.exports = async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // Temporary read-only diagnostic (GET, no auth needed, no secrets
  // returned) for confirming SUPABASE_JWT_SECRET is actually visible to
  // THIS deployment -- env vars added/rescoped in Vercel only apply to
  // deployments built after the change, so this is the fast way to check
  // whether a given deployment has it versus guessing from timestamps.
  // Remove once local JWT verification is confirmed working end to end.
  if (req.method === "GET" && req.query?.action === "debugJwt") {
    res.status(200).json({ hasJwtSecret: Boolean(getJwtSecret()) });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(500).json({ error: "Missing Supabase server configuration" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = String(body.action || "");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (action === "findLiveGame") {
      const sessionId = String(body.sessionId || "");
      if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
      const { data, error } = await supabase.from("live_games").select("id, status").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      const existing = data?.[0] || null;
      res.status(200).json({ data: existing && existing.status !== "finished" ? existing : null });
      return;
    }

    if (action === "ensureLiveGame") {
      const sessionId = String(body.sessionId || "");
      const sessionName = String(body.sessionName || "Trivia Night");
      const isTest = Boolean(body.isTest);
      if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
      const { user, error: authError, status: authStatus } = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) return rejectAuthFailure(res, "ensureLiveGame", authError, authStatus);

      const { data: existingRows, error: lookupError } = await supabase.from("live_games").select("id, status").eq("session_id", sessionId).eq("is_test", isTest).order("created_at", { ascending: false }).limit(1);
      if (lookupError) throw lookupError;
      const existing = existingRows?.[0];
      if (existing && existing.status !== "finished") {
        res.status(200).json({ data: existing });
        return;
      }

      // Starting a fresh real game: clear out any leftover, unfinished test
      // run for this session so practice teams/scores/answers (they cascade
      // off live_games.id) never carry into the real event.
      if (!isTest) {
        const { data: staleTestRows, error: staleError } = await supabase.from("live_games").select("id").eq("session_id", sessionId).eq("is_test", true);
        if (staleError) throw staleError;
        if (staleTestRows?.length) {
          const { error: cleanupError } = await supabase.from("live_games").delete().in("id", staleTestRows.map((row) => row.id));
          if (cleanupError) throw cleanupError;
        }
      }

      const { data: created, error: createError } = await supabase.from("live_games").insert({
        session_id: sessionId,
        host_user_id: user.id,
        session_name: sessionName,
        code: makeGameCode(),
        is_test: isTest,
      }).select("id, status").single();
      if (createError) throw createError;
      res.status(200).json({ data: created });
      return;
    }

    if (action === "resetTestGame") {
      // Called once, explicitly, when the host clicks "Test Run" -- not
      // folded into ensureLiveGame's automatic reuse-or-create, because
      // that runs on every host-page render where session/id change and
      // would otherwise wipe an in-progress test roster out from under the
      // host mid-rehearsal.
      const sessionId = String(body.sessionId || "");
      if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
      const { user, error: authError, status: authStatus } = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) return rejectAuthFailure(res, "resetTestGame", authError, authStatus);

      const { data: testRows, error: lookupError } = await supabase.from("live_games").select("id").eq("session_id", sessionId).eq("is_test", true);
      if (lookupError) throw lookupError;
      if (testRows?.length) {
        const { error: deleteError } = await supabase.from("live_games").delete().in("id", testRows.map((row) => row.id));
        if (deleteError) throw deleteError;
      }
      res.status(200).json({ data: true });
      return;
    }

    if (action === "fetchLivePlayers") {
      const gameId = String(body.gameId || "");
      if (!gameId) return res.status(400).json({ error: "Missing gameId" });
      const { data, error } = await supabase.from("live_game_players").select("id, name, score, joined_at").eq("game_id", gameId).order("joined_at", { ascending: true });
      if (error) throw error;
      res.status(200).json({ data: data || [] });
      return;
    }

    if (action === "upsertPlayer") {
      const gameId = String(body.gameId || "");
      const player = body.player || {};
      if (!gameId || !player.id) return res.status(400).json({ error: "Missing gameId or player.id" });
      const { data: gameRows, error: gameError } = await supabase.from("live_games").select("id, status").eq("id", gameId).limit(1);
      if (gameError) throw gameError;
      if (!gameRows?.[0] || gameRows[0].status === "finished") return res.status(400).json({ error: "Game is not active" });

      const payload = { id: player.id, game_id: gameId, name: player.name };
      if (player.score !== undefined) payload.score = Number(player.score || 0);
      const { error } = await supabase.from("live_game_players").upsert(payload);
      if (error) throw error;
      res.status(200).json({ data: true });
      return;
    }

    if (action === "setPlayerName") {
      const playerId = String(body.playerId || "");
      const name = String(body.name || "");
      if (!playerId || !name) return res.status(400).json({ error: "Missing playerId or name" });
      const { error } = await supabase.from("live_game_players").update({ name }).eq("id", playerId);
      if (error) throw error;
      res.status(200).json({ data: true });
      return;
    }

    if (action === "removeLivePlayer") {
      const playerId = String(body.playerId || "");
      if (!playerId) return res.status(400).json({ error: "Missing playerId" });
      const { user, error: authError, status: authStatus } = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) return rejectAuthFailure(res, "removeLivePlayer", authError, authStatus);

      const { data: playerRows, error: playerError } = await supabase.from("live_game_players").select("game_id").eq("id", playerId).limit(1);
      if (playerError) throw playerError;
      const gameId = playerRows?.[0]?.game_id;
      if (gameId) {
        const { data: gameRows } = await supabase.from("live_games").select("host_user_id").eq("id", gameId).limit(1);
        if (gameRows?.[0]?.host_user_id !== user.id) return res.status(403).json({ error: "Not the host of this game" });
      }
      const { error } = await supabase.from("live_game_players").delete().eq("id", playerId);
      if (error) throw error;
      res.status(200).json({ data: true });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (error) {
    console.error("live-game proxy error:", error);
    res.status(500).json({ error: error.message || "Live game request failed" });
  }
};
