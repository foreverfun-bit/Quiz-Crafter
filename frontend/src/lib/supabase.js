import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY

const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

const DATA_PROXY_PATH = "/api/supabase-data";

const makeProxyError = (message, details = null) => ({
  message: message || "Supabase data request failed",
  details,
});

let cachedSessionContext = null;
let sessionContextPromise = null;

const resolveSessionContext = async () => {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (sessionData?.session?.access_token) {
    return {
      accessToken: sessionData.session.access_token,
      clientUserId: sessionData.session.user?.id || "",
      expiresAt: Number(sessionData.session.expires_at || 0) * 1000,
    };
  }
  const { data: refreshed } = await supabaseClient.auth.refreshSession();
  return {
    accessToken: refreshed?.session?.access_token || "",
    clientUserId: refreshed?.session?.user?.id || "",
    expiresAt: Number(refreshed?.session?.expires_at || 0) * 1000,
  };
};

// Every proxy query used to call getSession() (and fall back to a network
// refreshSession() call whenever the session looked momentarily empty) fresh --
// with several queries firing concurrently on a single page load, each one
// independently triggered its own refresh, multiplying auth traffic and eating
// into the project's egress quota. Cache the resolved context in memory and
// dedupe concurrent lookups instead of re-fetching on every single query.
const getSessionContext = async (forceRefresh = false) => {
  if (!forceRefresh && cachedSessionContext?.accessToken && cachedSessionContext.expiresAt - Date.now() > 10000) {
    return cachedSessionContext;
  }
  if (!sessionContextPromise) {
    sessionContextPromise = resolveSessionContext().finally(() => { sessionContextPromise = null; });
  }
  cachedSessionContext = await sessionContextPromise;
  return cachedSessionContext;
};

supabaseClient.auth.onAuthStateChange(() => { cachedSessionContext = null; });

class ProxyQueryBuilder {
  constructor(table) {
    this.table = table;
    this.action = "select";
    this.columns = "*";
    this.payload = undefined;
    this.filters = [];
    this.orders = [];
    this.limitValue = undefined;
    this.singleResult = false;
  }

  select(columns = "*") {
    if (!this.action) this.action = "select";
    this.columns = columns;
    return this;
  }

  insert(payload) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload) {
    this.action = "upsert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column, value) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  in(column, value) {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  order(column, options = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  async execute() {
    try {
      const headers = { "content-type": "application/json" };
      let { accessToken, clientUserId } = await getSessionContext();

      const runRequest = (authToken) => fetch(DATA_PROXY_PATH, {
        method: "POST",
        headers,
        body: JSON.stringify({
          authToken,
          clientUserId,
          table: this.table,
          action: this.action,
          columns: this.columns,
          payload: this.payload,
          filters: this.filters,
          orders: this.orders,
          limit: this.limitValue,
          single: this.singleResult,
        }),
      });

      let response = await runRequest(accessToken);
      if (response.status === 401) {
        const refreshed = await getSessionContext(true);
        accessToken = refreshed.accessToken;
        clientUserId = refreshed.clientUserId || clientUserId;
        if (accessToken) response = await runRequest(accessToken);
      }

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { data: null, error: makeProxyError(result.error || response.statusText, result.details) };
      }
      return { data: result.data ?? null, error: result.error ?? null };
    } catch (error) {
      return { data: null, error: makeProxyError(error.message) };
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

const nativeFrom = supabaseClient.from.bind(supabaseClient);
supabaseClient.from = (table) => new ProxyQueryBuilder(table);

export const supabase = supabaseClient;

// Bypasses the /api/supabase-data proxy for tables whose access is governed
// by Postgres RLS directly rather than the proxy's signed-in-user-scoping
// model (e.g. live_game_* tables, which anonymous players read/write under
// row-level policies). Shares the same auth session as `supabase`.
export const supabaseTable = (table) => nativeFrom(table);

// Exposes the same cached, auto-refreshing session lookup the data proxy
// uses (falls back to a real refreshSession() call when the local session
// looks empty, instead of just reading whatever's cached and giving up) so
// other same-origin proxy callers (e.g. the live-game endpoint) get the
// same reliability instead of a plain, non-refreshing auth.getSession().
export const getAccessToken = async (forceRefresh = false) => {
  const context = await getSessionContext(forceRefresh);
  return context?.accessToken || "";
};
