import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Calendar,
  Copy,
  Download,
  Eye,
  MapPin,
  Pencil,
  Star,
  Trash2,
  FileText,
  Search,
  PlusCircle,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { mergeProfileRecords, normalizeVenue, readLocalVenues } from "../lib/venues";
import { loadProfileValue, profileKeys, readCurrentProjectSessionId, writeCurrentProjectSessionId } from "../lib/profileState";
import { downloadCsv } from "../lib/csv";

const titleDatePatterns = [
  /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/,
  /\b(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})\b/,
];

const normalizeYear = (year) => {
  const parsed = Number(year);
  if (parsed < 100) return parsed >= 70 ? 1900 + parsed : 2000 + parsed;
  return parsed;
};

const parseDateParts = (month, day, year) => {
  const date = new Date(normalizeYear(year), Number(month) - 1, Number(day));
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date;
};

const getSessionTitle = (session) => session.name || session.session_name || "Untitled Session";

// is_past only means "this session has already been hosted" -- it flips to
// true for a session someone built and ran live in Quiz Crafter, same as a
// genuinely CSV/PDF-imported one, so it can't be used to tell them apart.
// source_type is set at creation time (import-questions.js vs BuildSession.jsx)
// and is the actual origin.
const isImportedSession = (session) => session?.source_type === "imported";

const getHostDate = (session) => {
  const explicitDate = session.hosted_at || session.session_date || session.event_date || session.host_date || session.date;
  if (explicitDate) {
    const parsed = new Date(explicitDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const title = getSessionTitle(session);
  for (const pattern of titleDatePatterns) {
    const match = title.match(pattern);
    if (match) {
      const parsed = parseDateParts(match[1], match[2], match[3]);
      if (parsed) return parsed;
    }
  }
  return null;
};

const formatHostDate = (session) => {
  const hostDate = getHostDate(session);
  return hostDate ? hostDate.toLocaleDateString() : "No host date";
};

const normalizeHeadcount = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return { adults: Number(value.adults) || 0, kids: Number(value.kids) || 0 };
  if (value === undefined || value === null || value === "") return { adults: 0, kids: 0 };
  return { adults: Number(value) || 0, kids: 0 };
};

// Everything here reads straight off the already-fetched session row (the
// stored final leaderboard and attendance) instead of re-querying per
// session, so selecting a lot of sessions to export stays a single,
// instant, client-side pass rather than a burst of network calls.
const getSessionLeaderboard = (session) => {
  const leaderboard = session?.hosted_results?.liveState?.leaderboard;
  return Array.isArray(leaderboard) ? leaderboard.filter((team) => team && team.name) : [];
};

const buildSessionSummaryRow = (session) => {
  const leaderboard = getSessionLeaderboard(session);
  const scores = leaderboard.map((team) => Number(team.score) || 0);
  const topTeam = leaderboard.length ? [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] : null;
  const averageScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : "";
  const teamHeadcounts = session?.attendance?.teamHeadcounts || {};
  const nonPlayers = normalizeHeadcount(session?.attendance?.nonPlayers);
  const playingTotals = Object.values(teamHeadcounts).reduce((sum, value) => {
    const hc = normalizeHeadcount(value);
    return { adults: sum.adults + hc.adults, kids: sum.kids + hc.kids };
  }, { adults: 0, kids: 0 });
  const barAdults = playingTotals.adults + nonPlayers.adults;
  const barKids = playingTotals.kids + nonPlayers.kids;
  return [
    getSessionTitle(session),
    formatHostDate(session),
    session.venue || session.venue_name || "",
    isImportedSession(session) ? "Imported" : "Built",
    getTotalQuestions(session),
    leaderboard.length,
    topTeam?.name || "",
    topTeam ? Number(topTeam.score) || 0 : "",
    averageScore,
    barAdults || barKids ? barAdults + barKids : "",
  ];
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const getTotalQuestions = (session) => (
  safeArray(session.true_false_questions).length +
  safeArray(session.multiple_choice_questions).length +
  safeArray(session.written_questions).length +
  safeArray(session.picture_questions).length
);

const PastSessions = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [allSessions, setAllSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [sortMode, setSortMode] = useState("host_desc");
  const [dateFilter, setDateFilter] = useState("all");
  const [venues, setVenues] = useState([]);
  const [savingVenueId, setSavingVenueId] = useState(null);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    const localVenues = readLocalVenues();
    setVenues(localVenues);
    loadProfileValue(profileKeys.venues)
      .then((remote) => {
        const remoteVenues = Array.isArray(remote) ? remote.map(normalizeVenue) : [];
        const merged = mergeProfileRecords(remoteVenues, localVenues, normalizeVenue);
        if (merged.length) setVenues(merged);
      })
      .catch((error) => console.warn("Venue list sync unavailable:", error));
    const cachedCurrentProject = readCurrentProjectSessionId();
    if (cachedCurrentProject !== undefined) setCurrentProjectId(cachedCurrentProject || null);
    loadProfileValue(profileKeys.currentProjectSessionId)
      .then((current) => { if (cachedCurrentProject === undefined) setCurrentProjectId(current || null); })
      .catch((error) => console.warn("Current project marker unavailable:", error));
  }, []);

  const handleToggleCurrentProject = (sessionId, event) => {
    event.stopPropagation();
    const nextValue = currentProjectId && String(currentProjectId) === String(sessionId) ? null : sessionId;
    writeCurrentProjectSessionId(nextValue);
    setCurrentProjectId(nextValue);
    toast.success(nextValue ? "Marked as current project" : "Removed as current project");
  };

  const handleVenueChange = async (sessionId, venueId, event) => {
    event.stopPropagation();
    const venue = venues.find((item) => item.id === venueId);
    const venueName = venue?.name || venue?.nightName || "";
    setSavingVenueId(sessionId);
    try {
      if (venueId && venueName && user?.id) {
        const { error: venueError } = await supabase.from("venues").upsert({ id: venueId, user_id: user.id, name: venueName }, { onConflict: "id" });
        if (venueError) throw venueError;
      }
      const { error } = await supabase
        .from("sessions")
        .update({ venue_id: venueId || null, venue: venueName || null })
        .eq("id", sessionId);
      if (error) throw error;
      setAllSessions((prev) => prev.map((session) => session.id === sessionId ? { ...session, venue_id: venueId || null, venue: venueName || null } : session));
      toast.success(venueId ? `Linked to ${venueName}` : "Venue link removed");
    } catch (error) {
      console.error("Session venue update error:", error);
      toast.error("Failed to update venue");
    } finally {
      setSavingVenueId(null);
    }
  };

  const fetchSessions = useCallback(async (authUserId = user?.id) => {
    try {
      setLoading(true);

      const userId = authUserId;
      if (!userId) {
        setAllSessions([]);
        return;
      }

      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setAllSessions(data || []);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      toast.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) fetchSessions(user.id);
  }, [fetchSessions, user?.id]);

  const handleDelete = async (sessionId, e) => {
    e.stopPropagation();

    if (!window.confirm("Are you sure you want to delete this session?")) return;

    try {
      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", sessionId);

      if (error) throw error;

      setAllSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast.success("Session deleted");
    } catch (error) {
      console.error("Delete session error:", error);
      toast.error("Failed to delete session");
    }
  };

  const handleDuplicate = async (session, e) => {
    e.stopPropagation();
    try {
      const { id, created_at, updated_at, ...rest } = session;
      const payload = {
        ...rest,
        user_id: user?.id,
        name: `${session.name || session.session_name || "Untitled Session"} (Copy)`,
        session_name: session.session_name ? `${session.session_name} (Copy)` : session.session_name,
        // A duplicate is a fresh, unplayed session -- it shouldn't inherit
        // the source session's hosting history.
        is_past: false,
        hosted_results: null,
        hosted_at: null,
      };
      const { data, error } = await supabase.from("sessions").insert(payload).select("*").single();
      if (error) throw error;

      setAllSessions((prev) => [data, ...prev]);
      toast.success("Session duplicated");
    } catch (error) {
      console.error("Duplicate session error:", error);
      toast.error("Failed to duplicate session");
    }
  };

  // Whether a session was actually imported can't always be inferred
  // perfectly (e.g. historical sessions created before source_type existed,
  // or a filename that happened to match the auto-generated import name) --
  // this lets a host correct the label directly instead of being stuck with
  // a wrong classification.
  const handleToggleSourceType = async (session, e) => {
    e.stopPropagation();
    const nextSourceType = isImportedSession(session) ? "built" : "imported";
    try {
      const { error } = await supabase.from("sessions").update({ source_type: nextSourceType }).eq("id", session.id);
      if (error) throw error;
      setAllSessions((prev) => prev.map((item) => (item.id === session.id ? { ...item, source_type: nextSourceType } : item)));
      toast.success(`Marked as ${nextSourceType === "imported" ? "Imported" : "Built"}`);
    } catch (error) {
      console.error("Toggle session source error:", error);
      toast.error("Failed to update session");
    }
  };

  const toggleSessionSelected = (sessionId, event) => {
    event.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const handleExportSelected = () => {
    const selected = allSessions.filter((session) => selectedIds.has(session.id));
    if (!selected.length) return;
    const sorted = [...selected].sort((a, b) => (getHostDate(b)?.getTime() || 0) - (getHostDate(a)?.getTime() || 0));
    downloadCsv(`trivia-sessions-summary-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Session", "Host Date", "Venue", "Source", "Total Questions", "Teams", "Top Team", "Top Score", "Average Score", "Bar Total"],
      ...sorted.map(buildSessionSummaryRow),
    ]);
    toast.success(`Exported ${selected.length} session${selected.length === 1 ? "" : "s"}`);
  };

  const builtCount = useMemo(
    () => allSessions.filter((s) => !isImportedSession(s)).length,
    [allSessions]
  );

  const importedCount = useMemo(
    () => allSessions.filter((s) => isImportedSession(s)).length,
    [allSessions]
  );

  const filteredSessions = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const lastYearEnd = new Date(now.getFullYear(), 0, 1);

    const filtered = allSessions.filter((session) => {
      if (activeTab === "built" && isImportedSession(session)) return false;
      if (activeTab === "imported" && !isImportedSession(session)) return false;

      const hostDate = getHostDate(session);
      if (dateFilter === "with_date" && !hostDate) return false;
      if (dateFilter === "missing_date" && hostDate) return false;
      if (dateFilter === "this_year" && (!hostDate || hostDate < yearStart)) return false;
      if (dateFilter === "last_year" && (!hostDate || hostDate < lastYearStart || hostDate >= lastYearEnd)) return false;

      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      return (
        getSessionTitle(session).toLowerCase().includes(query) ||
        String(session.venue || session.venue_name || "").toLowerCase().includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      const aHost = getHostDate(a)?.getTime() || 0;
      const bHost = getHostDate(b)?.getTime() || 0;
      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (sortMode === "host_asc") return (aHost || Number.MAX_SAFE_INTEGER) - (bHost || Number.MAX_SAFE_INTEGER);
      if (sortMode === "created_desc") return bCreated - aCreated;
      if (sortMode === "created_asc") return aCreated - bCreated;
      if (sortMode === "name_asc") return getSessionTitle(a).localeCompare(getSessionTitle(b));
      if (sortMode === "name_desc") return getSessionTitle(b).localeCompare(getSessionTitle(a));
      return bHost - aHost || bCreated - aCreated;
    });
  }, [allSessions, activeTab, searchQuery, sortMode, dateFilter]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="past-sessions-page">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            <span className="gradient-text">Sessions</span>
          </h1>
          <p className="text-zinc-500">
            Continue builds, review past games, or reopen imported sessions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && <>
            <Button
              onClick={handleExportSelected}
              variant="outline"
              className="border-white/20 text-white hover:bg-zinc-800"
              data-testid="export-selected-sessions-btn"
            >
              <Download size={16} className="mr-2" />
              Export {selectedIds.size} Session{selectedIds.size === 1 ? "" : "s"}
            </Button>
            <Button
              onClick={() => setSelectedIds(new Set())}
              variant="ghost"
              className="text-zinc-400 hover:text-white"
            >
              Clear
            </Button>
          </>}
          <Button
            onClick={() => navigate("/build")}
            className="gradient-btn"
            data-testid="new-session-btn"
          >
            <PlusCircle size={18} className="mr-2" />
            New Session
          </Button>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col xl:flex-row gap-4 items-center">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
              <TabsList className="bg-zinc-800/50">
                <TabsTrigger value="all" className="data-[state=active]:bg-zinc-700">
                  All ({allSessions.length})
                </TabsTrigger>
                <TabsTrigger value="built" className="data-[state=active]:bg-zinc-700">
                  Built ({builtCount})
                </TabsTrigger>
                <TabsTrigger value="imported" className="data-[state=active]:bg-zinc-700">
                  Imported ({importedCount})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sessions..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                data-testid="search-sessions-input"
              />
            </div>

            <div className="flex w-full md:w-auto gap-2">
              <label className="relative flex-1 md:flex-none">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value)}
                  className="h-10 w-full md:w-[190px] rounded-md bg-zinc-950/50 border border-white/10 pl-9 pr-3 text-sm text-white outline-none focus:border-[#71E0DC]/60"
                  aria-label="Sort sessions"
                >
                  <option value="host_desc">Host date newest</option>
                  <option value="host_asc">Host date oldest</option>
                  <option value="created_desc">Created newest</option>
                  <option value="created_asc">Created oldest</option>
                  <option value="name_asc">Name A-Z</option>
                  <option value="name_desc">Name Z-A</option>
                </select>
              </label>
              <label className="relative flex-1 md:flex-none">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <select
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  className="h-10 w-full md:w-[160px] rounded-md bg-zinc-950/50 border border-white/10 pl-9 pr-3 text-sm text-white outline-none focus:border-[#71E0DC]/60"
                  aria-label="Filter by host date"
                >
                  <option value="all">All dates</option>
                  <option value="this_year">This year</option>
                  <option value="last_year">Last year</option>
                  <option value="with_date">Has host date</option>
                  <option value="missing_date">Missing host date</option>
                </select>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {allSessions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Calendar className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No sessions yet</p>
            <p className="text-zinc-600 text-sm mb-6">
              Build a new session or import a CSV to create one
            </p>
            <div className="flex gap-4 justify-center">
              <Button onClick={() => navigate("/build")} className="gradient-btn">
                Build Session
              </Button>
              <Button
                onClick={() => navigate("/import")}
                variant="outline"
                className="border-white/20 text-white hover:bg-zinc-800"
              >
                Import CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : filteredSessions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Search className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No sessions match your search</p>
            <p className="text-zinc-600 text-sm">
              Try a different search term or filter
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSessions.map((session, index) => (
            <Card
              key={session.id}
              className={`glass-card cursor-pointer transition-all hover:scale-[1.02] ${selectedIds.has(session.id) ? "ring-2 ring-[#71E0DC]/60" : ""}`}
              onClick={() => navigate(`/session/${session.id}`)}
              data-testid={`session-${index}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(session.id)}
                          onChange={(e) => toggleSessionSelected(session.id, e)}
                          onClick={(e) => e.stopPropagation()}
                          title="Select for export"
                          aria-label={`Select ${getSessionTitle(session)} for export`}
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-[#71E0DC]"
                          data-testid={`select-session-${index}`}
                        />
                        <h3 className="text-white font-semibold line-clamp-2">
                          {getSessionTitle(session)}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleToggleCurrentProject(session.id, e)}
                        title={currentProjectId && String(currentProjectId) === String(session.id) ? "Remove as current project" : "Mark as current project"}
                        className={`flex-shrink-0 rounded-md p-1 ${currentProjectId && String(currentProjectId) === String(session.id) ? "text-amber-300" : "text-zinc-600 hover:text-amber-300"}`}
                        data-testid={`current-project-toggle-${index}`}
                      >
                        <Star size={16} className={currentProjectId && String(currentProjectId) === String(session.id) ? "fill-amber-300" : ""} />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(e) => handleToggleSourceType(session, e)}
                        title="Click to switch between Built and Imported"
                        data-testid={`source-type-toggle-${index}`}
                      >
                        <Badge
                          className={
                            isImportedSession(session)
                              ? "bg-[#AEB2EF]/20 text-[#AEB2EF] border-[#AEB2EF]/30 hover:bg-[#AEB2EF]/30 cursor-pointer"
                              : "bg-[#71E0DC]/20 text-[#71E0DC] border-[#71E0DC]/30 hover:bg-[#71E0DC]/30 cursor-pointer"
                          }
                        >
                          {isImportedSession(session) ? "Imported" : "Built"}
                        </Badge>
                      </button>

                      <Badge className="bg-zinc-800 text-zinc-300">
                        <FileText size={12} className="mr-1" />
                        {getTotalQuestions(session)} questions
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <MapPin size={13} className="text-zinc-500 flex-shrink-0" />
                  <select
                    value={session.venue_id || ""}
                    onChange={(e) => handleVenueChange(session.id, e.target.value, e)}
                    disabled={savingVenueId === session.id}
                    className="h-8 flex-1 min-w-0 rounded-md border border-white/10 bg-zinc-950/50 px-2 text-xs text-zinc-300 outline-none focus:border-[#71E0DC]/60 disabled:opacity-60"
                    data-testid={`session-venue-select-${index}`}
                  >
                    <option value="">No venue linked</option>
                    {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name || venue.nightName || "Untitled venue"}</option>)}
                  </select>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">T/F:</span>
                    <span className="text-white">{safeArray(session.true_false_questions).length}</span>
                    <span className="text-zinc-500">MC:</span>
                    <span className="text-white">{safeArray(session.multiple_choice_questions).length}</span>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">Written:</span>
                    <span className="text-white">{safeArray(session.written_questions).length}</span>
                    <span className="text-zinc-500">Picture:</span>
                    <span className="text-white">{safeArray(session.picture_questions).length}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-zinc-600 text-xs">
                    Host: {formatHostDate(session)}
                  </span>

                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 px-2"
                      onClick={(e) => handleDelete(session.id, e)}
                      data-testid={`delete-session-${index}`}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-400 hover:text-white hover:bg-zinc-800 px-2"
                      onClick={(e) => handleDuplicate(session, e)}
                      data-testid={`duplicate-session-${index}`}
                      title="Duplicate"
                    >
                      <Copy size={14} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-400 hover:text-white hover:bg-zinc-800 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/session/${session.id}`);
                      }}
                      data-testid={`view-session-${index}`}
                      title="View"
                    >
                      <Eye size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#71E0DC] hover:text-white hover:bg-[#71E0DC]/10 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/build/${session.id}`);
                      }}
                      data-testid={`build-session-${index}`}
                      title="Open in Builder"
                    >
                      <Pencil size={14} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default PastSessions;
