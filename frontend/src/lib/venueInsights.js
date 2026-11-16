import { supabase } from "./supabase";

// Matches Teams.jsx's identical normalization -- a team has no account of
// its own, so name matching is the only way to recognize the same team
// across nights.
const normalizeRegularName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
// A team whose feedback spans at least this many different nights at a
// venue is a repeat visitor, not someone who only ever came once -- this
// is what distinguishes "this venue's regulars" from the anonymous
// venue-wide crowd tally below.
const REGULAR_MIN_SESSIONS = 2;

// Shared between BuildSession.jsx's venue panel and HostSession.jsx's
// merged-workspace equivalent, so the two don't drift out of sync the way
// the server-side copy in api/generate-session-candidates.js necessarily
// does (that one can't share a module with client code).
export const fetchVenueInsights = async (venueId) => {
  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id,name,session_name,session_date,event_date,created_at")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (sessionsError) throw sessionsError;
  if (!sessions?.length) return { sessionCount: 0 };

  const sessionIds = sessions.map((session) => session.id);
  const [questionFeedbackResult, categoryFeedbackResult, ideasResult] = await Promise.all([
    supabase.from("session_question_feedback").select("category,sentiment,question_text,player_name,session_id").in("session_id", sessionIds).limit(1000),
    supabase.from("session_category_feedback").select("category,sentiment,player_name,session_id").in("session_id", sessionIds).limit(1000),
    supabase.from("session_player_ideas").select("category,question,submitted_at").in("session_id", sessionIds).order("submitted_at", { ascending: false }).limit(20),
  ]);
  if (questionFeedbackResult.error) throw questionFeedbackResult.error;
  if (categoryFeedbackResult.error) throw categoryFeedbackResult.error;
  if (ideasResult.error) throw ideasResult.error;

  const teams = new Map();
  const teamEntry = (name) => {
    const key = normalizeRegularName(name);
    if (!key) return null;
    if (!teams.has(key)) teams.set(key, { sessionIds: new Set(), liked: new Map(), disliked: new Map() });
    return teams.get(key);
  };
  const bumpTeam = (name, sessionId, category, sentiment) => {
    const entry = teamEntry(name);
    const cleanCategory = (category || "").trim();
    if (!entry || !cleanCategory) return;
    if (sessionId) entry.sessionIds.add(sessionId);
    if (sentiment === "like") entry.liked.set(cleanCategory, (entry.liked.get(cleanCategory) || 0) + 1);
    else if (sentiment === "dislike") entry.disliked.set(cleanCategory, (entry.disliked.get(cleanCategory) || 0) + 1);
  };
  (categoryFeedbackResult.data || []).forEach((item) => bumpTeam(item.player_name, item.session_id, item.category, item.sentiment));
  (questionFeedbackResult.data || []).forEach((item) => bumpTeam(item.player_name, item.session_id, item.category, item.sentiment));

  const regularCategoryScores = new Map();
  let regularCount = 0;
  teams.forEach((entry) => {
    if (entry.sessionIds.size < REGULAR_MIN_SESSIONS) return;
    regularCount += 1;
    entry.liked.forEach((count, category) => {
      const score = regularCategoryScores.get(category) || { likes: 0, dislikes: 0 };
      score.likes += count;
      regularCategoryScores.set(category, score);
    });
    entry.disliked.forEach((count, category) => {
      const score = regularCategoryScores.get(category) || { likes: 0, dislikes: 0 };
      score.dislikes += count;
      regularCategoryScores.set(category, score);
    });
  });
  const regularRanked = [...regularCategoryScores.entries()].map(([category, { likes, dislikes }]) => ({ category, likes, dislikes, net: likes - dislikes })).sort((a, b) => b.net - a.net);

  const categoryScores = new Map();
  const bump = (category, sentiment) => {
    const key = (category || "").trim();
    if (!key) return;
    const entry = categoryScores.get(key) || { likes: 0, dislikes: 0 };
    if (sentiment === "like") entry.likes += 1;
    else if (sentiment === "dislike") entry.dislikes += 1;
    categoryScores.set(key, entry);
  };
  (categoryFeedbackResult.data || []).forEach((item) => bump(item.category, item.sentiment));
  (questionFeedbackResult.data || []).forEach((item) => bump(item.category, item.sentiment));
  const ranked = [...categoryScores.entries()].map(([category, { likes, dislikes }]) => ({ category, likes, dislikes, net: likes - dislikes })).sort((a, b) => b.net - a.net);

  return {
    sessionCount: sessions.length,
    mostRecentDate: sessions[0]?.session_date || sessions[0]?.event_date || sessions[0]?.created_at || "",
    pastNames: sessions.map((session) => session.name || session.session_name).filter(Boolean).slice(0, 6),
    loved: ranked.filter((row) => row.net > 0).slice(0, 8),
    struggled: ranked.filter((row) => row.net < 0).slice(-8).reverse(),
    likedQuestions: (questionFeedbackResult.data || []).filter((item) => item.sentiment === "like" && item.question_text).slice(0, 4),
    dislikedQuestions: (questionFeedbackResult.data || []).filter((item) => item.sentiment === "dislike" && item.question_text).slice(0, 4),
    ideas: (ideasResult.data || []).filter((idea) => idea.category || idea.question),
    regularCount,
    regularsLoved: regularRanked.filter((row) => row.net > 0).slice(0, 6),
    regularsStruggled: regularRanked.filter((row) => row.net < 0).slice(-6).reverse(),
  };
};
