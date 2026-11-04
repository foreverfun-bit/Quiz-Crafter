import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { listHostRoster } from "../lib/liveGame";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Users, Trophy, Mail, ThumbsUp, ThumbsDown, Search } from "lucide-react";

// A "team" has no account of its own -- players just type a name each time
// they join. This is the only identity we have to recognize a regular
// across sessions, so two teams are "the same" when their names match once
// trimmed/collapsed/lowercased. A rename (or a typo) shows up as a new
// team; there's no way to tell those apart from the data we have.
const normalizeTeamName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();

const formatDate = (value) => {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
};

const topEntries = (map, limit = 5) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

const bumpCount = (map, key) => map.set(key, (map.get(key) || 0) + 1);

const Teams = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState([]);
  const [sessionsById, setSessionsById] = useState(new Map());
  const [categoryFeedback, setCategoryFeedback] = useState([]);
  const [questionFeedback, setQuestionFeedback] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [games, sessionsResult] = await Promise.all([
          listHostRoster(),
          supabase.from("sessions").select("id, session_name, created_at, attendance"),
        ]);
        if (sessionsResult.error) throw sessionsResult.error;
        const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
        const sessionIds = sessions.map((session) => session.id).filter(Boolean);

        // session_question_feedback/session_category_feedback aren't scoped
        // to the signed-in user by the proxy itself (they have no user_id
        // column -- feedback is anonymous player data tied to a session, not
        // an account), so this explicitly limits the lookup to session ids
        // the sessions query above already proved belong to this host.
        const [categoryResult, questionResult] = sessionIds.length
          ? await Promise.all([
              supabase.from("session_category_feedback").select("player_name, sentiment, category, session_id").in("session_id", sessionIds),
              supabase.from("session_question_feedback").select("player_name, sentiment, category, question_text, session_id").in("session_id", sessionIds),
            ])
          : [{ data: [] }, { data: [] }];
        if (categoryResult.error) throw categoryResult.error;
        if (questionResult.error) throw questionResult.error;

        if (cancelled) return;
        setRoster(Array.isArray(games) ? games : []);
        setSessionsById(new Map(sessions.map((session) => [session.id, session])));
        setCategoryFeedback(Array.isArray(categoryResult.data) ? categoryResult.data : []);
        setQuestionFeedback(Array.isArray(questionResult.data) ? questionResult.data : []);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Could not load team history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const feedbackByTeam = useMemo(() => {
    const map = new Map();
    const bucketFor = (name) => {
      const key = normalizeTeamName(name);
      if (!key) return null;
      if (!map.has(key)) map.set(key, { liked: new Map(), disliked: new Map() });
      return map.get(key);
    };
    categoryFeedback.forEach((row) => {
      const bucket = bucketFor(row.player_name);
      if (!bucket || !row.category) return;
      if (row.sentiment === "like") bumpCount(bucket.liked, row.category);
      else if (row.sentiment === "dislike") bumpCount(bucket.disliked, row.category);
    });
    questionFeedback.forEach((row) => {
      const bucket = bucketFor(row.player_name);
      const category = row.category || "Uncategorized";
      if (!bucket) return;
      if (row.sentiment === "like") bumpCount(bucket.liked, category);
      else if (row.sentiment === "dislike") bumpCount(bucket.disliked, category);
    });
    return map;
  }, [categoryFeedback, questionFeedback]);

  const teams = useMemo(() => {
    const map = new Map();
    roster.forEach((game) => {
      if (game.is_test) return;
      const session = sessionsById.get(game.session_id);
      const playedAt = game.created_at;
      (game.players || []).forEach((player) => {
        const key = normalizeTeamName(player.name);
        if (!key) return;
        if (!map.has(key)) {
          map.set(key, { key, displayName: player.name, gamesPlayed: 0, lastPlayedAt: "", contactEmail: "", headcounts: [] });
        }
        const team = map.get(key);
        team.gamesPlayed += 1;
        if (!team.lastPlayedAt || playedAt > team.lastPlayedAt) {
          team.lastPlayedAt = playedAt;
          team.displayName = player.name || team.displayName;
        }
        if (player.update_preference === "email" && player.update_contact) team.contactEmail = player.update_contact;
        const headcount = session?.attendance?.teamHeadcounts?.[player.id];
        const adults = Number(headcount?.adults) || 0;
        const kids = Number(headcount?.kids) || 0;
        if (adults || kids) team.headcounts.push({ sessionName: game.session_name, adults, kids });
      });
    });
    return [...map.values()]
      .map((team) => {
        const feedback = feedbackByTeam.get(team.key);
        const avgHeadcount = team.headcounts.length
          ? Math.round((team.headcounts.reduce((sum, hc) => sum + hc.adults + hc.kids, 0) / team.headcounts.length) * 10) / 10
          : null;
        return {
          ...team,
          avgHeadcount,
          topLiked: feedback ? topEntries(feedback.liked) : [],
          topDisliked: feedback ? topEntries(feedback.disliked) : [],
        };
      })
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed || (b.lastPlayedAt || "").localeCompare(a.lastPlayedAt || ""));
  }, [roster, sessionsById, feedbackByTeam]);

  const visibleTeams = useMemo(() => {
    const query = normalizeTeamName(search);
    if (!query) return teams;
    return teams.filter((team) => normalizeTeamName(team.displayName).includes(query));
  }, [teams, search]);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in" data-testid="teams-page">
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Teams</h1>
        <p className="text-zinc-500">Regulars tracked automatically from every live game you've hosted -- games played, headcount, and the categories they tend to like or skip.</p>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search teams..."
          className="h-10 w-full rounded-md bg-zinc-950 border border-white/10 pl-9 pr-3 text-white outline-none focus:border-[#71E0DC]/60"
        />
      </div>

      {loading && <p className="text-zinc-500">Loading team history...</p>}
      {!loading && error && <p className="text-red-400">{error}</p>}
      {!loading && !error && !teams.length && (
        <Card className="glass-card"><CardContent className="py-10 text-center text-zinc-500">No teams have joined a live game yet. Once people join from a QR code, they'll show up here.</CardContent></Card>
      )}

      {!loading && !error && teams.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleTeams.map((team) => <TeamCard key={team.key} team={team} />)}
        </div>
      )}
    </div>
  );
};

const CategoryTagList = ({ icon: Icon, tone, entries }) => {
  if (!entries.length) return null;
  const toneClass = tone === "like" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300";
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([category, count]) => (
        <span key={category} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${toneClass}`}>
          <Icon size={11} />{category} ({count})
        </span>
      ))}
    </div>
  );
};

const TeamCard = ({ team }) => (
  <Card className="glass-card" data-testid="team-card">
    <CardHeader>
      <CardTitle className="text-white flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0"><Users size={18} className="text-[#71E0DC] shrink-0" /><span className="truncate">{team.displayName}</span></span>
        <span className="flex items-center gap-1 text-sm font-normal text-zinc-400 shrink-0"><Trophy size={14} />{team.gamesPlayed} {team.gamesPlayed === 1 ? "game" : "games"}</span>
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
        <span>Last played: {formatDate(team.lastPlayedAt)}</span>
        {team.avgHeadcount !== null && <span>~{team.avgHeadcount} players/game</span>}
        {team.contactEmail && <span className="flex items-center gap-1 text-[#AEB2EF]"><Mail size={13} />{team.contactEmail}</span>}
      </div>
      {(team.topLiked.length > 0 || team.topDisliked.length > 0) && (
        <div className="space-y-2 pt-1 border-t border-white/10">
          <CategoryTagList icon={ThumbsUp} tone="like" entries={team.topLiked} />
          <CategoryTagList icon={ThumbsDown} tone="dislike" entries={team.topDisliked} />
        </div>
      )}
    </CardContent>
  </Card>
);

export default Teams;
