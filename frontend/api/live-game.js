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

const getBearerToken = (req, body = {}) => {
  if (body.authToken) return String(body.authToken);
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
};

const verifyUser = async (supabaseUrl, anonKey, token) => {
  if (!token) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
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
      if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
      const user = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) return res.status(401).json({ error: "You must be signed in to host" });

      const { data: existingRows, error: lookupError } = await supabase.from("live_games").select("id, status").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(1);
      if (lookupError) throw lookupError;
      const existing = existingRows?.[0];
      if (existing && existing.status !== "finished") {
        res.status(200).json({ data: existing });
        return;
      }

      const { data: created, error: createError } = await supabase.from("live_games").insert({
        session_id: sessionId,
        host_user_id: user.id,
        session_name: sessionName,
        code: makeGameCode(),
      }).select("id, status").single();
      if (createError) throw createError;
      res.status(200).json({ data: created });
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
      const user = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) return res.status(401).json({ error: "You must be signed in" });

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
