import { supabase, supabaseTable } from "./supabase";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeGameCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

const mostRecentLiveGame = async (sessionId) => {
  const { data, error } = await supabaseTable("live_games")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
};

// Read-only lookup for players/presentation screens: they can't create a
// live_games row (RLS only allows the host to insert), so they wait for one
// to exist.
export const findLiveGame = async (sessionId) => {
  const existing = await mostRecentLiveGame(sessionId);
  return existing && existing.status !== "finished" ? existing : null;
};

// Host-only: reuses the session's current live game if one exists, so a
// host reload doesn't orphan the roster from a fresh row.
export const ensureLiveGame = async (sessionId, { sessionName } = {}) => {
  const existing = await mostRecentLiveGame(sessionId);
  if (existing && existing.status !== "finished") return existing;

  const { data: userData } = await supabase.auth.getUser();
  const { data: created, error: createError } = await supabaseTable("live_games")
    .insert({
      session_id: sessionId,
      host_user_id: userData?.user?.id,
      session_name: sessionName || "Trivia Night",
      code: makeGameCode(),
    })
    .select("*")
    .single();
  if (createError) throw createError;
  return created;
};

export const fetchLivePlayers = async (gameId) => {
  const { data, error } = await supabaseTable("live_game_players")
    .select("*")
    .eq("game_id", gameId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return data || [];
};

// Omits `score` unless explicitly passed, so joining/renaming never resets
// a player's existing score back to 0 on conflict (PostgREST upsert only
// overwrites columns present in the payload).
export const upsertLivePlayer = async (gameId, player) => {
  const payload = { id: player.id, game_id: gameId, name: player.name };
  if (player.score !== undefined) payload.score = Number(player.score || 0);
  const { error } = await supabaseTable("live_game_players").upsert(payload);
  if (error) throw error;
};

export const setLivePlayerName = async (playerId, name) => {
  const { error } = await supabaseTable("live_game_players").update({ name }).eq("id", playerId);
  if (error) throw error;
};

export const setLivePlayerScore = async (playerId, score) => {
  const { error } = await supabaseTable("live_game_players").update({ score: Number(score || 0) }).eq("id", playerId);
  if (error) throw error;
};

export const removeLivePlayer = async (playerId) => {
  const { error } = await supabaseTable("live_game_players").delete().eq("id", playerId);
  if (error) throw error;
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
