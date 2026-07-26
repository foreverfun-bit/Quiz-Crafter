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

// Returns { user, error } instead of just null on failure -- a bare null
// gave no way to tell "no token sent" apart from "token rejected by
// Supabase" apart from "Supabase itself unreachable", which made a
// recurring 401 impossible to diagnose from the client side alone.
//
// Confirmed live: this call intermittently comes back as a Cloudflare 520
// (an HTML error page, not JSON) in front of Supabase's auth service --
// happening on this server-to-server call specifically while the same
// project's browser-direct logins/refreshes succeed fine, so it's not a
// bad token. A 4xx means Supabase itself actively rejected the token (no
// point retrying, it won't change); a 5xx/network failure means the auth
// service glitched, which is usually transient, so it gets a couple of
// quick retries before giving up.
const verifyUser = async (supabaseUrl, anonKey, token) => {
  if (!token) return { user: null, error: "No auth token was sent with the request" };
  let lastError = "Auth check failed for an unknown reason";
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, authorization: `Bearer ${token}` },
      });
    } catch (fetchError) {
      lastError = `Auth check request failed: ${fetchError.message}`;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      continue;
    }
    if (response.ok) {
      const user = await response.json().catch(() => null);
      return user?.id ? { user, error: null } : { user: null, error: "Auth check succeeded but returned no user" };
    }
    if (response.status < 500) {
      const detail = await response.text().catch(() => "");
      return { user: null, error: `Supabase auth check returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }
    lastError = `Supabase auth check returned ${response.status} (their auth service, not your sign-in)`;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  return { user: null, error: lastError };
};

module.exports = async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // Temporary read-only diagnostic (GET, no auth needed) for chasing the
  // recurring 520 on /auth/v1/user from this function -- reports which env
  // var supplied the URL and what a direct, unauthenticated probe of that
  // same endpoint gets back, so we can tell a bad/mismatched URL apart from
  // Supabase's auth service actually erroring for this server. Returns no
  // secrets (host only, no keys). Remove once that's root-caused.
  if (req.method === "GET" && req.query?.action === "debugConfig") {
    let urlHost = "";
    try { urlHost = supabaseUrl ? new URL(supabaseUrl).host : ""; } catch { /* leave blank if unparsable */ }
    const urlSource = process.env.SUPABASE_URL ? "SUPABASE_URL" : process.env.NEXT_PUBLIC_SUPABASE_URL ? "NEXT_PUBLIC_SUPABASE_URL" : process.env.REACT_APP_SUPABASE_URL ? "REACT_APP_SUPABASE_URL" : "none set";
    let probe;
    try {
      const probeResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey } });
      const bodyPreview = await probeResponse.text().catch(() => "");
      probe = { status: probeResponse.status, bodyPreview: bodyPreview.slice(0, 300) };
    } catch (probeError) {
      probe = { fetchError: probeError.message };
    }
    res.status(200).json({ urlHost, urlSource, hasAnonKey: Boolean(anonKey), hasServiceRoleKey: Boolean(serviceRoleKey), probe });
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
      const { user, error: authError } = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) {
        console.error("ensureLiveGame auth failed:", authError);
        return res.status(401).json({ error: authError || "You must be signed in to host" });
      }

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
      const { user, error: authError } = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) {
        console.error("resetTestGame auth failed:", authError);
        return res.status(401).json({ error: authError || "You must be signed in to host" });
      }

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
      const { user, error: authError } = await verifyUser(supabaseUrl, anonKey, getBearerToken(req, body));
      if (!user?.id) {
        console.error("removeLivePlayer auth failed:", authError);
        return res.status(401).json({ error: authError || "You must be signed in" });
      }

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
