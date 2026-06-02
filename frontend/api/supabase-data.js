const { createClient } = require("@supabase/supabase-js");

const USER_SCOPED_TABLES = new Set([
  "questions",
  "sessions",
  "categories",
  "disliked_categories",
  "rejected_categories",
  "category_preferences",
]);

const PUBLIC_SESSION_READ_TABLES = new Set(["sessions"]);
const ALLOWED_TABLES = new Set([
  ...USER_SCOPED_TABLES,
  "session_rounds",
  "session_questions",
]);

const getBearerToken = (req, body = {}) => {
  if (body.authToken) return String(body.authToken);
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

const verifyUser = async (supabaseUrl, anonKey, token) => {
  if (!token) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
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
  const effectiveUserId = user?.id || filteredUserId;
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
