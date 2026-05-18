const { createClient } = require("@supabase/supabase-js");

const TABLES_WITH_USER_ID = [
  "questions",
  "sessions",
  "game_history",
  "game_sessions",
  "live_games",
  "games",
  "players",
  "game_players",
  "player_answers",
  "game_answers",
  "category_preferences",
  "categories",
  "disliked_categories",
  "rejected_categories",
];

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl) throw new Error("Missing Supabase URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  if (!anonKey) throw new Error("Missing Supabase anon key");

  return { supabaseUrl, serviceRoleKey, anonKey };
}

async function deleteIfExists(supabase, table, buildQuery, results) {
  try {
    const query = buildQuery(supabase.from(table).delete());
    const { error } = await query;
    if (error) throw error;
    results.deleted.push(table);
  } catch (error) {
    const message = error?.message || "Delete failed";
    if (/does not exist|schema cache|Could not find/i.test(message)) {
      results.skipped.push(table);
      return;
    }
    results.errors.push(`${table}: ${message}`);
  }
}

async function fetchIds(supabase, table, column, value) {
  try {
    const { data, error } = await supabase.from(table).select("id").eq(column, value);
    if (error) throw error;
    return { ids: (data || []).map((row) => row.id).filter(Boolean), error: null };
  } catch (error) {
    return { ids: [], error };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { confirmation } = req.body || {};
    if (confirmation !== "DELETE") {
      return res.status(400).json({ error: "Type DELETE to confirm reset" });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing login token" });

    const { supabaseUrl, serviceRoleKey, anonKey } = getSupabaseConfig();
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return res.status(401).json({ error: "Could not verify logged-in user" });
    }

    const userId = authData.user.id;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const results = { deleted: [], skipped: [], errors: [] };

    const { ids: sessionIds } = await fetchIds(admin, "sessions", "user_id", userId);
    const { ids: gameIds } = await fetchIds(admin, "game_sessions", "user_id", userId);
    const { ids: liveGameIds } = await fetchIds(admin, "live_games", "user_id", userId);

    let roundIds = [];
    if (sessionIds.length) {
      const { data, error } = await admin.from("session_rounds").select("id").in("session_id", sessionIds);
      if (!error) roundIds = (data || []).map((row) => row.id).filter(Boolean);
    }

    if (roundIds.length) {
      await deleteIfExists(admin, "session_questions", (query) => query.in("session_round_id", roundIds), results);
    }
    if (sessionIds.length) {
      await deleteIfExists(admin, "session_rounds", (query) => query.in("session_id", sessionIds), results);
    }
    if (gameIds.length) {
      await deleteIfExists(admin, "game_answers", (query) => query.in("game_id", gameIds), results);
      await deleteIfExists(admin, "game_players", (query) => query.in("game_id", gameIds), results);
    }
    if (liveGameIds.length) {
      await deleteIfExists(admin, "player_answers", (query) => query.in("game_id", liveGameIds), results);
      await deleteIfExists(admin, "players", (query) => query.in("game_id", liveGameIds), results);
    }

    for (const table of TABLES_WITH_USER_ID) {
      await deleteIfExists(admin, table, (query) => query.eq("user_id", userId), results);
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (error) {
    console.error("reset-trivia-data error:", error);
    return res.status(500).json({ error: error.message || "Failed to reset trivia data" });
  }
};