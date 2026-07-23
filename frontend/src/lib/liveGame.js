import { supabase } from "./supabase";

// live_games / live_game_players used to be read and written directly from
// the browser to Supabase (via supabaseTable, bypassing /api/supabase-data)
// because anonymous players joining via QR code aren't signed-in Supabase
// users. That direct browser-to-Supabase path proved unreliable in
// production (CORS/connectivity failures that had nothing to do with auth
// or RLS -- both were verified correct server-side). Routed through this
// same-origin endpoint instead, which sidesteps that path entirely.
// Realtime (broadcast, postgres_changes) stays on the direct WebSocket
// connection below -- only the REST/fetch path was affected.
const LIVE_GAME_ENDPOINT = "/api/live-game";

const callLiveGame = async (action, params = {}) => {
  const response = await fetch(LIVE_GAME_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || `Live game request failed (${response.status})`);
  return result.data;
};

const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
};

// Read-only lookup for players/presentation screens: they can't create a
// live_games row (host-only), so they wait for one to exist.
export const findLiveGame = (sessionId) => callLiveGame("findLiveGame", { sessionId });

// Host-only: reuses the session's current live game if one exists, so a
// host reload doesn't orphan the roster from a fresh row.
export const ensureLiveGame = async (sessionId, { sessionName } = {}) => {
  const authToken = await getAuthToken();
  return callLiveGame("ensureLiveGame", { sessionId, sessionName, authToken });
};

export const fetchLivePlayers = (gameId) => callLiveGame("fetchLivePlayers", { gameId });

// Omits `score` unless explicitly passed, so joining/renaming never resets
// a player's existing score back to 0 on conflict.
export const upsertLivePlayer = (gameId, player) => callLiveGame("upsertPlayer", { gameId, player });

export const setLivePlayerName = (playerId, name) => callLiveGame("setPlayerName", { playerId, name });

export const removeLivePlayer = async (playerId) => {
  const authToken = await getAuthToken();
  return callLiveGame("removeLivePlayer", { playerId, authToken });
};

// Roster/leaderboard changes ride their own realtime subscription on
// live_game_players instead of the host_state broadcast, so a player
// joining or a score changing no longer forces a full question-object
// rebroadcast to every connected player.
export const subscribeLivePlayers = (gameId, onChange) => {
  const channel = supabase
    .channel(`live-game-players-${gameId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "live_game_players", filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
};
