const { createClient } = require("@supabase/supabase-js");

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
  const user = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));

  if (!user?.id) {
    res.status(401).json({ error: "You must be signed in" });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [questions, sessions, categories, dislikedCategories, rejectedCategories, categoryPreferences] = await Promise.all([
      supabase.from("questions").select("*").eq("user_id", user.id),
      supabase.from("sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("categories").select("*").eq("user_id", user.id),
      supabase.from("disliked_categories").select("*").eq("user_id", user.id),
      supabase.from("rejected_categories").select("*").eq("user_id", user.id),
      supabase.from("category_preferences").select("*").eq("user_id", user.id),
    ]);

    const errors = [questions, sessions, categories, dislikedCategories, rejectedCategories, categoryPreferences]
      .map((result) => result.error?.message)
      .filter(Boolean);

    if (questions.error || sessions.error) {
      res.status(400).json({ error: errors[0] || "Dashboard data unavailable", errors });
      return;
    }

    res.status(200).json({
      userId: user.id,
      questions: questions.data || [],
      sessions: sessions.data || [],
      categoryRows: {
        categories: categories.data || [],
        disliked_categories: dislikedCategories.data || [],
        rejected_categories: rejectedCategories.data || [],
        category_preferences: categoryPreferences.data || [],
      },
      warnings: errors,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Dashboard data unavailable" });
  }
};
