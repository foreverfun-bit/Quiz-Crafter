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

const getAccessToken = async () => {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (sessionData?.session?.access_token) return sessionData.session.access_token;
  const { data: refreshed } = await supabaseClient.auth.refreshSession();
  return refreshed?.session?.access_token || "";
};

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
      let accessToken = await getAccessToken();

      const runRequest = (authToken) => fetch(DATA_PROXY_PATH, {
        method: "POST",
        headers,
        body: JSON.stringify({
          authToken,
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
        const { data: refreshed } = await supabaseClient.auth.refreshSession();
        accessToken = refreshed?.session?.access_token || "";
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

supabaseClient.from = (table) => new ProxyQueryBuilder(table);

export const supabase = supabaseClient;
