import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Bot,
  Calendar,
  CheckCircle,
  FileText,
  FolderOpen,
  Image,
  Library,
  List,
  MapPin,
  MessageSquare,
  MonitorPlay,
  PlusCircle,
  Radio,
  Save,
  Sparkles,
  ThumbsDown,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PROFILE_ACTIVE_VENUE_KEY, PROFILE_SHOW_TEMPLATES_KEY, PROFILE_VENUES_KEY, mergeProfileRecords, normalizeTemplate, normalizeVenue, readActiveVenueId, readLocalTemplates, readLocalVenues, recordsChanged, writeActiveVenueId, writeLocalTemplates, writeLocalVenues } from "../lib/venues";
import { HOST_SETUP_CATEGORY, loadHostSetupSettings, loadProfileValue, saveHostSetupSettings, saveProfileValue, updateUserMetadata } from "../lib/profileState";

const BUILD_STORAGE_KEYS = [
  "trivia-flex-round-builder-state-v5",
  "trivia-flex-round-builder-state-v4",
  "trivia-flex-round-builder-state-v3",
  "trivia-flex-round-builder-state-v2",
];
const activeBuildProfileKey = "quiz_crafter_active_build_v1";
const buildClearedProfileKey = "quiz_crafter_active_build_cleared_at_v1";
const buildDraftArchiveKey = "quiz_crafter_build_draft_archive_v1";
const todoStorageKey = "quiz-crafter-dashboard-todos-v1";
const todoProfileKey = "quiz_crafter_dashboard_todos_v1";

const emptyStats = {
  total_questions: 0,
  used_count: 0,
  media_count: 0,
  liked_count: 0,
  disliked_count: 0,
  categories_count: 0,
  sessions_count: 0,
  built_sessions_count: 0,
  imported_sessions_count: 0,
  ai_generated_count: 0,
  imported_count: 0,
  by_type: {},
  approved_categories: [],
  rejected_categories: [],
  liked_categories: [],
};

const rejectedValues = new Set(["rejected", "reject", "hidden", "hide", "disliked", "dislike", "bad"]);
const approvedValues = new Set(["approved", "approve", "active", "accepted", "accept", "good"]);

const safeArray = (value) => (Array.isArray(value) ? value : []);
const sessionQuestionArrays = (session) => [
  session?.true_false_questions,
  session?.multiple_choice_questions,
  session?.written_questions,
  session?.picture_questions,
];
const collectSessionQuestions = (session) => sessionQuestionArrays(session).flatMap(safeArray);
const questionCount = (session) => collectSessionQuestions(session).length;
const compactDate = (value) => {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const venueMetadataKey = PROFILE_VENUES_KEY;
const templateMetadataKey = PROFILE_SHOW_TEMPLATES_KEY;
const activeVenueMetadataKey = PROFILE_ACTIVE_VENUE_KEY;
const dayIndex = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const weekIndex = { first: 1, second: 2, third: 3, fourth: 4 };
const formatScheduleTime = (time, timeZone) => {
  if (!time) return "Time TBD";
  const [hours, minutes = "00"] = String(time).split(":");
  const date = new Date();
  date.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0);
  const zone = String(timeZone || "America/Chicago").split("/").pop()?.replace("_", " ") || "Local";
  return `${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${zone}`;
};
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const nextWeeklyDate = (venue, fromDate) => {
  const target = dayIndex[venue.dayOfWeek];
  if (target === undefined) return null;
  const from = startOfDay(fromDate);
  const offset = (target - from.getDay() + 7) % 7;
  return addDays(from, offset);
};
const monthlyOccurrence = (year, month, dayName, monthlyWeek) => {
  const target = dayIndex[dayName];
  if (target === undefined) return null;
  if (monthlyWeek === "last") {
    const date = new Date(year, month + 1, 0);
    date.setDate(date.getDate() - ((date.getDay() - target + 7) % 7));
    return startOfDay(date);
  }
  const occurrence = weekIndex[monthlyWeek] || 1;
  const first = new Date(year, month, 1);
  const offset = (target - first.getDay() + 7) % 7;
  return startOfDay(new Date(year, month, 1 + offset + ((occurrence - 1) * 7)));
};
const nextMonthlyDate = (venue, fromDate) => {
  const from = startOfDay(fromDate);
  for (let offset = 0; offset < 12; offset += 1) {
    const monthDate = new Date(from.getFullYear(), from.getMonth() + offset, 1);
    const candidate = monthlyOccurrence(monthDate.getFullYear(), monthDate.getMonth(), venue.dayOfWeek, venue.monthlyWeek);
    if (candidate && candidate >= from) return candidate;
  }
  return null;
};
const nextVenueDate = (venue, fromDate = new Date()) => {
  if (venue.frequency === "monthly") return nextMonthlyDate(venue, fromDate);
  const weekly = nextWeeklyDate(venue, fromDate);
  if (!weekly) return null;
  if (venue.frequency !== "bi_weekly") return weekly;
  const updated = venue.updatedAt ? new Date(venue.updatedAt) : fromDate;
  const anchor = Number.isNaN(updated.getTime()) ? fromDate : updated;
  const weeks = Math.floor((weekly - startOfDay(anchor)) / (7 * 24 * 60 * 60 * 1000));
  return weeks % 2 === 0 ? weekly : addDays(weekly, 7);
};
const buildVenueSchedule = (venues) => venues
  .map((venue) => ({ venue, date: nextVenueDate(venue) }))
  .filter((item) => item.date)
  .sort((a, b) => a.date - b.date)
  .slice(0, 6);

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(emptyStats);
  const [recentSessions, setRecentSessions] = useState([]);
  const [savedBuild, setSavedBuild] = useState(null);
  const [venues, setVenues] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeVenueId, setActiveVenueId] = useState("");
  const [todos, setTodos] = useState([]);
  const [todoText, setTodoText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHostSetup = async () => {
      setSavedBuild(readSavedBuild());
      setTodos(readTodos());
      const localVenues = readLocalVenues();
      const localTemplates = readLocalTemplates();
      setVenues(localVenues);
      setTemplates(localTemplates);
      setActiveVenueId(readActiveVenueId());

      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const metadata = data?.user?.user_metadata || {};
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupVenues = Array.isArray(setupSettings.venues) ? setupSettings.venues.map(normalizeVenue) : [];
        const setupTemplates = Array.isArray(setupSettings.templates) ? setupSettings.templates.map(normalizeTemplate) : [];
        const remoteVenues = Array.isArray(metadata[venueMetadataKey]) ? metadata[venueMetadataKey].map(normalizeVenue) : [];
        const remoteTemplates = Array.isArray(metadata[templateMetadataKey]) ? metadata[templateMetadataKey].map(normalizeTemplate) : [];
        const mergedVenues = mergeProfileRecords([...setupVenues, ...remoteVenues], localVenues, normalizeVenue);
        const mergedTemplates = mergeProfileRecords([...setupTemplates, ...remoteTemplates], localTemplates, normalizeTemplate);
        if (mergedVenues.length) {
          setVenues(mergedVenues);
          writeLocalVenues(mergedVenues);
        }
        if (mergedTemplates.length) {
          setTemplates(mergedTemplates);
          writeLocalTemplates(mergedTemplates);
        }
        const nextActiveVenueId = mergedVenues.some((venue) => venue.id === metadata[activeVenueMetadataKey])
          ? metadata[activeVenueMetadataKey]
          : mergedVenues.some((venue) => venue.id === readActiveVenueId())
            ? readActiveVenueId()
            : mergedVenues[0]?.id || "";
        setActiveVenueId(nextActiveVenueId);
        writeActiveVenueId(nextActiveVenueId);
        const setupPatch = {};
        if (mergedVenues.length && recordsChanged(remoteVenues, mergedVenues)) setupPatch[venueMetadataKey] = mergedVenues;
        if (mergedTemplates.length && recordsChanged(remoteTemplates, mergedTemplates)) setupPatch[templateMetadataKey] = mergedTemplates;
        if (nextActiveVenueId !== metadata[activeVenueMetadataKey]) setupPatch[activeVenueMetadataKey] = nextActiveVenueId;
        if (Object.keys(setupPatch).length) await updateUserMetadata(setupPatch);
        if ((mergedVenues.length && recordsChanged(setupVenues, mergedVenues)) || (mergedTemplates.length && recordsChanged(setupTemplates, mergedTemplates))) {
          await saveHostSetupSettings({ venues: mergedVenues, templates: mergedTemplates, activeVenueId: nextActiveVenueId });
        }
        const remoteTodos = Array.isArray(metadata[todoProfileKey]) ? metadata[todoProfileKey] : null;
        if (remoteTodos) {
          setTodos(remoteTodos);
          writeTodos(remoteTodos);
        }
      } catch (error) {
        console.warn("Dashboard host setup sync unavailable:", error);
      }
    };
    loadHostSetup();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      if (!user?.id) return;

      try {
        setLoading(true);
        const [questionsSettled, sessionsSettled, categorySettled] = await Promise.allSettled([
          supabase.from("questions").select("*").eq("user_id", user.id),
          supabase.from("sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
          fetchCategoryState(),
        ]);

        const questionsResult = questionsSettled.status === "fulfilled" ? questionsSettled.value : { data: [], error: questionsSettled.reason };
        const sessionsResult = sessionsSettled.status === "fulfilled" ? sessionsSettled.value : { data: [], error: sessionsSettled.reason };
        const categoryState = categorySettled.status === "fulfilled" ? categorySettled.value : { approved: new Set(), rejected: new Set() };

        if (questionsResult.error) console.warn("Dashboard questions unavailable:", questionsResult.error);
        if (sessionsResult.error) console.warn("Dashboard sessions unavailable:", sessionsResult.error);

        const questions = questionsResult.error ? [] : Array.isArray(questionsResult.data) ? questionsResult.data : [];
        const sessions = sessionsResult.error ? [] : Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
        setStats(buildStats(questions, sessions, categoryState));
        setRecentSessions(sessions.slice(0, 5));
        if (questionsResult.error && sessionsResult.error) throw questionsResult.error;
      } catch (error) {
        console.error("Dashboard stats error:", error);
        toast.error("Failed to load dashboard stats");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [user?.id]);

  const firstName = useMemo(() => {
    const name = user?.name || user?.email || "Host";
    return String(name).split(/[ @]/)[0] || "Host";
  }, [user]);

  const approvedCategories = stats.approved_categories || [];
  const rejectedCategories = stats.rejected_categories || [];
  const unusedCount = Math.max(0, (stats.total_questions || 0) - (stats.used_count || 0));
  const manualCount = Math.max(0, (stats.total_questions || 0) - (stats.ai_generated_count || 0) - (stats.imported_count || 0));
  const activeVenue = venues.find((venue) => venue.id === activeVenueId) || venues[0] || null;
  const starterTemplate = templates[0] || null;
  const nextSession = recentSessions.find((session) => !session.is_past) || null;
  const liveSession = nextSession || recentSessions[0] || null;
  const upcomingSchedule = useMemo(() => buildVenueSchedule(venues), [venues]);
  const likedCategories = stats.liked_categories || [];
  const nextShow = upcomingSchedule[0] || null;
  const buildProgress = getBuildProgress(savedBuild, starterTemplate);
  const nextPrep = getNextPrep(buildProgress, starterTemplate, savedBuild, unusedCount);

  const persistTodos = (nextTodos) => {
    setTodos(nextTodos);
    writeTodos(nextTodos);
    saveProfileValue(todoProfileKey, nextTodos).catch((error) => console.warn("Dashboard todo profile save unavailable:", error));
  };

  const addTodo = () => {
    const text = todoText.trim();
    if (!text) return;
    persistTodos([{ id: `todo-${Date.now()}`, text, done: false }, ...todos].slice(0, 20));
    setTodoText("");
  };

  const toggleTodo = (id) => persistTodos(todos.map((todo) => todo.id === id ? { ...todo, done: !todo.done } : todo));
  const removeTodo = (id) => persistTodos(todos.filter((todo) => todo.id !== id));

  const handleContinueBuild = () => navigate("/build");
  const handleNewBlankBuild = async () => {
    try {
      const draft = readSavedBuildState();
      if (draft) {
        const archive = await readDraftArchive();
        const nextArchive = [
          { ...draft, archivedAt: new Date().toISOString(), draftName: draft.sessionName || "Untitled draft" },
          ...archive.filter((item) => item?.sessionName !== draft.sessionName || item?.updatedAt !== draft.updatedAt),
        ].slice(0, 10);
        writeDraftArchive(nextArchive);
        await saveProfileValue(buildDraftArchiveKey, nextArchive);
      }
      clearSavedBuild();
      await Promise.allSettled([
        saveProfileValue(activeBuildProfileKey, null),
        saveProfileValue(buildClearedProfileKey, new Date().toISOString()),
      ]);
      setSavedBuild(null);
      toast.success(draft ? "Current build saved as a draft. Starting blank." : "Starting a blank build.");
      navigate("/build");
    } catch (error) {
      console.error("New blank build error:", error);
      toast.error("Could not start a blank build");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto animate-fade-in" data-testid="dashboard-page">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Host Dashboard</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">What should I work on next?</h1>
          <p className="text-zinc-500 mt-2 max-w-3xl">
            Your home base for the next show: what is coming up, what needs attention, and the fastest way back in.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => liveSession ? navigate(`/host-session/${liveSession.id}`) : navigate("/past-sessions")}
            variant="outline"
            className="border-[#71E0DC]/35 bg-[#71E0DC]/10 text-[#71E0DC] hover:bg-[#71E0DC]/15 hover:text-white"
            data-testid="dashboard-live-hosting-btn"
          >
            <MonitorPlay className="mr-2" size={18} />
            Open Live Hosting
          </Button>
          <Button onClick={handleContinueBuild} variant="outline" className="border-white/20 text-white hover:bg-zinc-800" data-testid="dashboard-continue-build-btn">
            <Save className="mr-2" size={18} />
            Continue Build
          </Button>
          <Button onClick={handleNewBlankBuild} className="gradient-btn" data-testid="dashboard-build-btn">
            <PlusCircle className="mr-2" size={18} />
            New Build
          </Button>
        </div>
      </div>

      <NextShowHero
        nextShow={nextShow}
        savedBuild={savedBuild}
        progress={buildProgress}
        nextPrep={nextPrep}
        nextSession={nextSession}
        onBuild={() => navigate("/build")}
        onHostSession={() => nextSession && navigate(`/host-session/${nextSession.id}`)}
        onVenues={() => navigate("/venues")}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.8fr] gap-5 mb-5">
        <AssistantBriefing
          firstName={firstName}
          nextShow={nextShow}
          savedBuild={savedBuild}
          progress={buildProgress}
          nextPrep={nextPrep}
          onBuild={() => navigate("/build")}
          onImport={() => navigate("/import")}
          onNewBuild={handleNewBlankBuild}
          onHostSession={() => nextSession && navigate(`/host-session/${nextSession.id}`)}
          canHost={Boolean(nextSession)}
        />
        <TodoCard todos={todos} todoText={todoText} setTodoText={setTodoText} onAdd={addTodo} onToggle={toggleTodo} onRemove={removeTodo} />
      </div>

      <div className="mb-5">
        <ScheduleCard schedule={upcomingSchedule} nextSession={nextSession} savedBuild={savedBuild} progress={buildProgress} onBuild={() => navigate("/build")} onVenues={() => navigate("/venues")} onHostSession={() => nextSession && navigate(`/host-session/${nextSession.id}`)} />
      </div>

      <div className="mb-5">
        <LikedCategoriesCard categories={likedCategories} onCategories={() => navigate("/categories")} />
      </div>

      <Card className="glass-card mt-5" data-testid="dashboard-categories-section">
        <CardContent className="p-5">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="lg:w-72">
              <div className="flex items-center gap-2 text-white font-semibold">
                <FolderOpen className="text-[#AEB2EF]" size={20} />
                Category Controls
              </div>
              <p className="text-zinc-500 text-sm mt-2">
                These guide the generator and help keep your sets aligned with what works for your room.
              </p>
              <Button variant="outline" onClick={() => navigate("/categories")} className="border-white/20 text-white hover:bg-zinc-800 mt-4">
                Manage Categories
              </Button>
            </div>
            <CategoryPreview title="Approved" categories={approvedCategories} tone="approved" emptyText="No approved categories yet" />
            <CategoryPreview title="Rejected" categories={rejectedCategories} tone="rejected" emptyText="No rejected categories yet" />
          </div>
        </CardContent>
      </Card>

      <section className="mt-5">
        <div className="mb-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Insights</p>
          <h2 className="text-xl font-bold text-white mt-1">Background signals</h2>
          <p className="text-sm text-zinc-500 mt-1">Useful when you are tuning the system, but secondary to preparing the next night.</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <MetricCard label="Questions" value={stats.total_questions} sub={`${unusedCount} unused`} icon={Library} tone="cyan" onClick={() => navigate("/library")} />
          <MetricCard label="Sessions" value={stats.sessions_count} sub={`${stats.imported_sessions_count} past`} icon={Calendar} tone="purple" onClick={() => navigate("/past-sessions")} />
          <MetricCard label="Venues" value={venues.length} sub={activeVenue ? activeVenue.name : "set one up"} icon={MapPin} tone="green" onClick={() => navigate("/venues")} />
          <MetricCard label="Categories" value={approvedCategories.length} sub={`${rejectedCategories.length} rejected`} icon={FolderOpen} tone="amber" onClick={() => navigate("/categories")} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <BreakdownCard title="Question Mix" items={[
            { icon: CheckCircle, label: "True/False", value: stats.by_type?.true_false || 0, color: "text-[#71E0DC]" },
            { icon: List, label: "Multiple Choice", value: stats.by_type?.multiple_choice || 0, color: "text-[#AEB2EF]" },
            { icon: MessageSquare, label: "Written", value: stats.by_type?.written || 0, color: "text-emerald-400" },
            { icon: Image, label: "Media", value: stats.media_count || 0, color: "text-amber-400" },
          ]} />
          <BreakdownCard title="Source Mix" items={[
            { icon: Bot, label: "AI Generated", value: stats.ai_generated_count || 0, color: "text-[#71E0DC]" },
            { icon: Upload, label: "Imported", value: stats.imported_count || 0, color: "text-[#AEB2EF]" },
            { icon: FileText, label: "Manual", value: manualCount, color: "text-zinc-300" },
            { icon: ThumbsDown, label: "Disliked", value: stats.disliked_count || 0, color: "text-red-400" },
          ]} />
        </div>
      </section>

      {stats.total_questions === 0 && (
        <Card className="glass-card mt-5 border-[#71E0DC]/30">
          <CardContent className="p-8 text-center">
            <Sparkles className="text-[#71E0DC] mx-auto mb-4" size={36} />
            <h3 className="text-xl font-bold text-white mb-2">Build your first usable set</h3>
            <p className="text-zinc-500 mb-6 max-w-md mx-auto">
              Create fresh host-grade questions in the builder or import the sets you already have.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button className="gradient-btn" onClick={() => navigate("/build")} data-testid="cta-generate-btn">
                <Sparkles className="mr-2" size={18} />
                Create & Build
              </Button>
              <Button variant="outline" className="border-white/20 text-white hover:bg-zinc-800" onClick={() => navigate("/import")} data-testid="cta-import-btn">
                <Upload className="mr-2" size={18} />
                Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const NextShowHero = ({ nextShow, savedBuild, progress, nextPrep, nextSession, onBuild, onHostSession, onVenues }) => {
  const venue = nextShow?.venue;
  const date = nextShow?.date;
  const ready = progress.complete && Boolean(savedBuild?.questionCount);
  return (
    <Card className="glass-card mb-5 border-[#71E0DC]/30 overflow-hidden">
      <CardContent className="p-5 md:p-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-5 items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge className="bg-[#71E0DC] text-zinc-950">Next show</Badge>
              <Badge className={ready ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}>{nextPrep.status}</Badge>
            </div>
            <h2 className="text-2xl md:text-4xl font-bold text-white">
              {venue ? (venue.nightName || venue.name) : savedBuild?.sessionName || "No upcoming show yet"}
            </h2>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400">
              <span className="flex items-center gap-2"><MapPin size={16} className="text-[#71E0DC]" />{venue?.name || venue?.nightName || "Set a venue"}</span>
              <span className="flex items-center gap-2"><Calendar size={16} className="text-[#AEB2EF]" />{date ? `${date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} at ${formatScheduleTime(venue.startTime, venue.timeZone)}` : "Date/time TBD"}</span>
              <span className="flex items-center gap-2"><CheckCircle size={16} className="text-emerald-400" />{progress.current}/{progress.goal || "?"} questions</span>
            </div>
            <p className="mt-4 text-lg text-zinc-200">{nextPrep.message}</p>
          </div>
          <div className="flex flex-wrap xl:flex-col gap-2 xl:min-w-48">
            <Button className="gradient-btn" onClick={onBuild}>{savedBuild ? "Continue Building" : "Start Building"}</Button>
            {nextSession && <Button variant="outline" onClick={onHostSession} className="border-[#71E0DC]/35 bg-[#71E0DC]/10 text-[#71E0DC] hover:bg-[#71E0DC]/15 hover:text-white"><MonitorPlay size={16} className="mr-2" />Open Host Mode</Button>}
            {!venue && <Button variant="outline" onClick={onVenues} className="border-white/20 text-white hover:bg-zinc-800">Set Up Venue</Button>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const AssistantBriefing = ({ firstName, nextShow, savedBuild, progress, nextPrep, onBuild, onImport, onNewBuild, onHostSession, canHost }) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const showName = nextShow?.venue?.nightName || nextShow?.venue?.name || savedBuild?.sessionName || "your next trivia night";
  const showDay = nextShow?.date ? nextShow.date.toLocaleDateString([], { weekday: "long" }) : "soon";
  return (
    <Card className="glass-card border-[#AEB2EF]/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-white flex items-center gap-2"><Sparkles className="text-[#71E0DC]" size={20} />Quiz Crafter briefing</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-white/10 bg-zinc-950/45 p-4">
          <p className="text-white font-semibold">{greeting}, {firstName}.</p>
          <p className="mt-2 text-zinc-300">You have {showName} on {showDay}.</p>
          <div className="mt-4 space-y-2 text-sm text-zinc-400">
            {progress.rounds.length ? progress.rounds.slice(0, 4).map((round) => (
              <div key={round.name} className="flex items-center justify-between gap-3">
                <span>{round.name}</span>
                <span className={round.remaining <= 0 ? "text-emerald-300" : "text-amber-200"}>{round.remaining <= 0 ? "complete" : `needs ${round.remaining}`}</span>
              </div>
            )) : <p>No active build yet.</p>}
          </div>
          <p className="mt-4 text-zinc-200">{nextPrep.question}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="gradient-btn" onClick={onBuild}>Continue Building</Button>
          <Button variant="outline" onClick={onBuild} className="border-white/20 text-white hover:bg-zinc-800">Finish with AI</Button>
          <Button variant="outline" onClick={onImport} className="border-white/20 text-white hover:bg-zinc-800">Import Questions</Button>
          <Button variant="outline" onClick={onNewBuild} className="border-white/20 text-white hover:bg-zinc-800">Start New Session</Button>
          {canHost && <Button variant="outline" onClick={onHostSession} className="border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10">Open Host Mode</Button>}
        </div>
      </CardContent>
    </Card>
  );
};

const ScheduleCard = ({ schedule, nextSession, savedBuild, progress, onBuild, onVenues, onHostSession }) => (
  <Card className="glass-card border-[#71E0DC]/25">
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle className="text-white text-xl">Upcoming Shows</CardTitle>
          <p className="text-zinc-500 text-sm mt-1">Each show shows the next prep action, not just the date.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onVenues} className="border-white/20 text-white hover:bg-zinc-800">
          Venues
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {schedule.length === 0 ? (
        <EmptyPanel icon={Calendar} title="No venue schedule yet" text="Add your regular trivia venues and this becomes your weekly hosting calendar." action="Set Up Venues" onClick={onVenues} />
      ) : (
        schedule.map(({ venue, date }, index) => {
          const prep = index === 0 ? getNextPrep(progress, null, savedBuild, 0) : { status: "Upcoming", message: "Schedule set. Build when ready." };
          return (
          <div key={`${venue.id}-${date.toISOString()}`} className={`rounded-lg border p-4 ${index === 0 ? "border-[#71E0DC]/35 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/45"}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge className={index === 0 ? "bg-[#71E0DC] text-zinc-950" : "bg-white/10 text-zinc-300"}>{index === 0 ? "Next" : date.toLocaleDateString([], { weekday: "short" })}</Badge>
                  <Badge className={prep.status === "Ready to host" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}>{prep.status}</Badge>
                  <p className="text-white font-bold truncate">{venue.nightName || venue.name}</p>
                </div>
                <p className="text-zinc-400 text-sm mt-2">
                  {date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} at {formatScheduleTime(venue.startTime, venue.timeZone)}
                </p>
                <p className="text-zinc-500 text-xs mt-1">{prep.message}</p>
                {venue.address && <p className="text-zinc-600 text-xs mt-1 truncate">{venue.address}</p>}
              </div>
              {index === 0 && (
                <div className="flex gap-2">
                  <Button size="sm" className="gradient-btn" onClick={onBuild}>{savedBuild ? "Continue Build" : "Build Set"}</Button>
                  {nextSession && <Button size="sm" variant="outline" onClick={onHostSession} className="border-white/20 text-white hover:bg-zinc-800">Go Live</Button>}
                </div>
              )}
            </div>
          </div>
        );})
      )}
    </CardContent>
  </Card>
);

const RecentSessionsCard = ({ recentSessions, onOpen, onHost, onAll, onBuild }) => (
  <Card className="glass-card">
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="text-white text-lg">Recent Sessions</CardTitle>
        <Button variant="outline" size="sm" onClick={onAll} className="border-white/20 text-white hover:bg-zinc-800">
          View All
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {recentSessions.length === 0 ? (
        <EmptyPanel icon={Calendar} title="No sessions yet" text="Build a session or import a set to start your archive." action="Start Building" onClick={onBuild} />
      ) : (
        recentSessions.slice(0, 4).map((session) => (
          <SessionRow key={session.id} session={session} onOpen={() => onOpen(session)} onHost={() => onHost(session)} />
        ))
      )}
    </CardContent>
  </Card>
);

const LikedCategoriesCard = ({ categories, onCategories }) => (
  <Card className="glass-card">
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle className="text-white text-lg">Most Liked Categories</CardTitle>
          <p className="text-zinc-500 text-sm mt-1">Based on liked questions and host feedback signals.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onCategories} className="border-white/20 text-white hover:bg-zinc-800">
          Manage
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {categories.length === 0 ? (
        <EmptyPanel icon={Sparkles} title="No liked categories yet" text="As you like questions, the strongest category signals will show up here." action="Manage Categories" onClick={onCategories} />
      ) : (
        categories.slice(0, 8).map((item, index) => (
          <div key={item.category} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/45 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#71E0DC]/15 text-sm font-black text-[#71E0DC]">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">{item.category}</p>
                <p className="text-zinc-500 text-xs">{item.count} liked question{item.count === 1 ? "" : "s"}</p>
              </div>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-300">Liked</Badge>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const TodoCard = ({ todos, todoText, setTodoText, onAdd, onToggle, onRemove }) => (
  <Card className="glass-card">
    <CardHeader className="pb-3">
      <CardTitle className="text-white text-lg">Host To-Do</CardTitle>
      <p className="text-zinc-500 text-sm mt-1">Quick reminders for prizes, clues, sponsors, and show prep.</p>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex gap-2">
        <input
          value={todoText}
          onChange={(event) => setTodoText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") onAdd(); }}
          placeholder="Add a reminder..."
          className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#71E0DC]/60"
        />
        <Button type="button" onClick={onAdd} className="gradient-btn">Add</Button>
      </div>
      {todos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-zinc-950/35 px-4 py-5 text-sm text-zinc-500">
          Nothing pending. Future-you is suspiciously organized.
        </div>
      ) : (
        <div className="space-y-2">
          {todos.slice(0, 8).map((todo) => (
            <div key={todo.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/45 px-3 py-2">
              <button
                type="button"
                onClick={() => onToggle(todo.id)}
                className={`h-5 w-5 rounded border flex-shrink-0 ${todo.done ? "border-[#71E0DC] bg-[#71E0DC]" : "border-white/20 bg-zinc-950"}`}
                aria-label={todo.done ? "Mark incomplete" : "Mark complete"}
              />
              <span className={`min-w-0 flex-1 text-sm ${todo.done ? "text-zinc-600 line-through" : "text-zinc-200"}`}>{todo.text}</span>
              <button type="button" onClick={() => onRemove(todo.id)} className="text-zinc-500 hover:text-white" aria-label="Remove reminder">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);

const PrepCard = ({ activeVenue, starterTemplate, savedBuild, unusedCount, rejectedCount, onVenue, onTemplate, onLibrary, onBuild, onCategories }) => {
  const items = [
    { label: "Create & build", value: "Generate, write, save, or select", ready: true, onClick: onBuild },
    { label: "Default venue", value: activeVenue ? activeVenue.name : "Needs setup", ready: Boolean(activeVenue), onClick: onVenue },
    { label: "Show template", value: starterTemplate ? starterTemplate.name : "Needs setup", ready: Boolean(starterTemplate), onClick: onTemplate },
    { label: "Unused library", value: `${unusedCount} available`, ready: unusedCount > 0, onClick: onLibrary },
    { label: "Saved build", value: savedBuild ? `${savedBuild.questionCount} selected` : "None", ready: Boolean(savedBuild), onClick: onBuild },
    { label: "Rejected categories", value: `${rejectedCount} blocked`, ready: true, onClick: onCategories },
  ];

  return <Card className="glass-card"><CardHeader className="pb-3"><CardTitle className="text-white text-lg">Prep Checklist</CardTitle></CardHeader><CardContent className="space-y-3">{items.map((item) => <button key={item.label} type="button" onClick={item.onClick} className="w-full flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/45 px-3 py-3 text-left hover:bg-zinc-900"><div className="min-w-0"><p className="text-sm font-semibold text-white">{item.label}</p><p className="text-xs text-zinc-500 truncate">{item.value}</p></div><Badge className={item.ready ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}>{item.ready ? "Ready" : "Set up"}</Badge></button>)}</CardContent></Card>;
};

const MetricCard = ({ label, value, sub, icon: Icon, tone, onClick }) => {
  const tones = {
    cyan: "text-[#71E0DC] bg-[#71E0DC]/15",
    green: "text-emerald-400 bg-emerald-500/15",
    purple: "text-[#AEB2EF] bg-[#AEB2EF]/15",
    amber: "text-amber-300 bg-amber-500/15",
  };

  const content = (
    <CardContent className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-zinc-500 text-sm">{label}</p>
          <p className="text-2xl md:text-3xl font-bold text-white mt-1">{value || 0}</p>
        </div>
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${tones[tone] || tones.cyan}`}>
          <Icon size={22} />
        </div>
      </div>
      <p className="text-zinc-600 text-xs mt-3">{sub}</p>
    </CardContent>
  );

  return onClick ? (
    <Card className="glass-card cursor-pointer hover:border-[#71E0DC]/40" onClick={onClick}>{content}</Card>
  ) : (
    <Card className="glass-card">{content}</Card>
  );
};

const SessionRow = ({ session, onOpen, onHost }) => (
  <div className="rounded-lg border border-white/10 bg-zinc-950/40 p-4">
    <div className="flex items-start justify-between gap-3">
      <button type="button" onClick={onOpen} className="text-left min-w-0">
        <div className="text-white font-semibold truncate">{session.name || session.session_name || "Untitled Session"}</div>
        <div className="text-zinc-500 text-sm mt-1">{compactDate(session.created_at)} / {questionCount(session)} questions</div>
      </button>
      <Badge className={session.is_past ? "bg-[#AEB2EF]/15 text-[#AEB2EF]" : "bg-[#71E0DC]/15 text-[#71E0DC]"}>
        {session.is_past ? "Past" : "Build"}
      </Badge>
    </div>
    <div className="flex gap-2 mt-3">
      <Button variant="outline" size="sm" onClick={onOpen} className="border-white/20 text-white hover:bg-zinc-800">
        Open
      </Button>
      <Button size="sm" onClick={onHost} className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/25 hover:bg-[#71E0DC]/20">
        <Radio className="mr-2" size={14} />
        Host
      </Button>
    </div>
  </div>
);

const BreakdownCard = ({ title, items }) => (
  <Card className="glass-card">
    <CardHeader className="pb-3">
      <CardTitle className="text-white text-lg">{title}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {items.map(({ icon: Icon, label, value, color }) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Icon className={color} size={20} />
            <span className="text-zinc-300 truncate">{label}</span>
          </div>
          <span className="text-white font-semibold">{value || 0}</span>
        </div>
      ))}
    </CardContent>
  </Card>
);

const EmptyPanel = ({ icon: Icon, title, text, action, onClick }) => (
  <div className="rounded-lg border border-white/10 bg-zinc-950/40 p-8 text-center">
    <Icon className="text-zinc-600 mx-auto mb-3" size={32} />
    <p className="text-white font-semibold">{title}</p>
    <p className="text-zinc-500 text-sm mt-1 mb-4">{text}</p>
    <Button className="gradient-btn" onClick={onClick}>{action}</Button>
  </div>
);

const CategoryPreview = ({ title, categories, tone, emptyText }) => {
  const visible = categories.slice(0, 16);
  const hidden = Math.max(0, categories.length - visible.length);
  const rejected = tone === "rejected";

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-white font-semibold">{title}</h3>
        <Badge className={rejected ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}>{categories.length}</Badge>
      </div>
      {visible.length === 0 ? (
        <p className="text-zinc-600 text-sm">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visible.map((category) => (
            <span key={category} className={`px-3 py-1 rounded-full border text-sm ${rejected ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"}`}>
              {category}
            </span>
          ))}
          {hidden > 0 && <span className="text-zinc-500 text-sm px-2 py-1">+{hidden}</span>}
        </div>
      )}
    </div>
  );
};

function readSavedBuild() {
  const parsed = readSavedBuildState();
  if (!parsed) return null;
  const rounds = Array.isArray(parsed.rounds) ? parsed.rounds : [];
  const questions = safeArray(parsed.questions);
  return {
    sessionName: parsed.sessionName || "",
    sessionDate: parsed.sessionDate || "",
    venueId: parsed.venueId || "",
    rounds,
    questions,
    questionCount: rounds.reduce((sum, round) => sum + safeArray(round.questionIds).length, 0),
  };
}

function getBuildProgress(savedBuild, template) {
  const rounds = safeArray(savedBuild?.rounds);
  const fallbackPerRound = Number(template?.questionsPerRound || 0) || 0;
  const templateRounds = Number(template?.roundCount || 0) || rounds.length || 0;
  const normalizedRounds = rounds.length
    ? rounds.map((round, index) => {
      const target = Number(round?.targetCount || round?.questionsPerRound || fallbackPerRound || 0) || 0;
      const count = safeArray(round?.questionIds).length;
      return { name: round?.name || `Round ${index + 1}`, count, target, remaining: Math.max(0, target - count) };
    })
    : Array.from({ length: templateRounds }, (_, index) => ({ name: `Round ${index + 1}`, count: 0, target: fallbackPerRound, remaining: fallbackPerRound }));
  const goal = normalizedRounds.reduce((sum, round) => sum + (round.target || 0), 0);
  const current = savedBuild?.questionCount || normalizedRounds.reduce((sum, round) => sum + round.count, 0);
  const firstNeeds = normalizedRounds.find((round) => round.remaining > 0);
  return {
    current,
    goal,
    rounds: normalizedRounds,
    firstNeeds,
    complete: Boolean(goal && current >= goal && !firstNeeds),
  };
}

function getNextPrep(progress, template, savedBuild, unusedCount) {
  if (!savedBuild) {
    return {
      status: template ? "Start build" : "Set up show",
      message: template ? "No active build yet. Start from your template or import a past set." : "Add a template or venue, then start the next session.",
      question: "What would you like to start with?",
    };
  }
  if (progress.complete) {
    return {
      status: "Ready to host",
      message: `Build has ${progress.current}/${progress.goal} questions and is ready for review or host mode.`,
      question: "Ready to review or open host mode?",
    };
  }
  if (progress.firstNeeds) {
    return {
      status: `Needs ${progress.firstNeeds.name}`,
      message: `${progress.firstNeeds.name} needs ${progress.firstNeeds.remaining} question${progress.firstNeeds.remaining === 1 ? "" : "s"}.`,
      question: `What would you like to do for ${progress.firstNeeds.name}?`,
    };
  }
  return {
    status: unusedCount > 0 ? "Ready for review" : "Needs questions",
    message: unusedCount > 0 ? "Review the set and pull from your unused library if needed." : "Build has started, but it still needs more questions.",
    question: "What would you like to work on next?",
  };
}

function readSavedBuildState() {
  for (const key of BUILD_STORAGE_KEYS) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (!parsed) continue;
      return parsed;
    } catch {
      // Try the next storage key.
    }
  }
  return null;
}

function clearSavedBuild() {
  BUILD_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}

function readTodos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(todoStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTodos(todos) {
  try {
    localStorage.setItem(todoStorageKey, JSON.stringify(Array.isArray(todos) ? todos : []));
  } catch {
    // To-dos are a convenience cache.
  }
}

async function readDraftArchive() {
  try {
    const remote = await loadProfileValue(buildDraftArchiveKey);
    if (Array.isArray(remote)) return remote;
  } catch {
    // Fall back to local archive below.
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(buildDraftArchiveKey) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDraftArchive(drafts) {
  try {
    localStorage.setItem(buildDraftArchiveKey, JSON.stringify(Array.isArray(drafts) ? drafts : []));
  } catch {
    // The active build is still cleared even if archive cache fails.
  }
}

function buildStats(questions, sessions, categoryState) {
  const byType = {};
  const approvedCategories = new Set(categoryState.approved);
  const rejectedCategories = new Set(categoryState.rejected);
  const likedCategoryCounts = new Map();
  const usedFingerprints = new Set();
  let likedCount = 0;
  let dislikedCount = 0;
  let aiGeneratedCount = 0;
  let importedCount = 0;
  let mediaCount = 0;

  sessions.forEach((session) => {
    collectSessionQuestions(session).forEach((question) => {
      const fingerprint = compactQuestion(question?.question_text || question?.question);
      if (fingerprint) usedFingerprints.add(fingerprint);
    });
  });

  questions.forEach((question) => {
    const type = question.question_type || (question.has_image ? "picture" : "written");
    byType[type] = (byType[type] || 0) + 1;

    if (question.image_url || question.correct_answer_image || question.media_url || question.has_image) mediaCount += 1;
    if (isQuestionMarkedUsed(question) || usedFingerprints.has(compactQuestion(question.question_text))) usedFingerprints.add(compactQuestion(question.question_text));
    if (isTruthy(question.is_liked) || approvedValues.has(normalizeStatus(question.rating))) likedCount += 1;
    if (isTruthy(question.is_disliked) || rejectedValues.has(normalizeStatus(question.rating))) dislikedCount += 1;

    if (normalizeStatus(question.source) === "ai" || isTruthy(question.ai_generated) || isTruthy(question.is_ai_generated)) aiGeneratedCount += 1;
    if (["import", "imported", "csv", "crowdpurr", "pdf"].includes(normalizeStatus(question.source))) importedCount += 1;

    const category = cleanCategory(question.category);
    if (!category) return;

    if (isTruthy(question.is_liked) || approvedValues.has(normalizeStatus(question.rating))) {
      likedCategoryCounts.set(category, (likedCategoryCounts.get(category) || 0) + 1);
    }

    if (isRejectedQuestionCategory(question)) {
      rejectedCategories.add(category);
      approvedCategories.delete(category);
    } else if (!rejectedCategories.has(category)) {
      approvedCategories.add(category);
    }
  });

  return {
    total_questions: questions.length,
    used_count: usedFingerprints.size,
    media_count: mediaCount,
    liked_count: likedCount,
    disliked_count: dislikedCount,
    categories_count: approvedCategories.size + rejectedCategories.size,
    sessions_count: sessions.length,
    built_sessions_count: sessions.filter((session) => !session.is_past).length,
    imported_sessions_count: sessions.filter((session) => !!session.is_past).length,
    ai_generated_count: aiGeneratedCount,
    imported_count: importedCount,
    by_type: byType,
    approved_categories: sortCategories([...approvedCategories]),
    rejected_categories: sortCategories([...rejectedCategories]),
    liked_categories: [...likedCategoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
  };
}

async function fetchCategoryState() {
  const approved = new Set();
  const rejected = new Set();

  const results = await Promise.allSettled([
    supabase.from("categories").select("*"),
    supabase.from("disliked_categories").select("*"),
    supabase.from("rejected_categories").select("*"),
    supabase.from("category_preferences").select("*"),
  ]);

  results.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error || !Array.isArray(result.value.data)) return;

    result.value.data.forEach((row) => {
      const category = cleanCategory(row.category || row.name || row.category_name || row.value);
      if (!category) return;
      if (category === HOST_SETUP_CATEGORY) return;

      const status = normalizeStatus(row.status || row.state || row.approval_status || row.preference || row.rating);
      const rejectedByFlag = isTruthy(row.rejected) || isTruthy(row.is_rejected) || isTruthy(row.hidden) || isTruthy(row.is_hidden) || isTruthy(row.disliked) || isTruthy(row.is_disliked);
      const approvedByFlag = isTruthy(row.approved) || isTruthy(row.is_approved) || isTruthy(row.active) || isTruthy(row.is_active);

      if (rejectedValues.has(status) || rejectedByFlag) {
        rejected.add(category);
        approved.delete(category);
      } else if (approvedValues.has(status) || approvedByFlag || !status) {
        if (!rejected.has(category)) approved.add(category);
      }
    });
  });

  return { approved, rejected };
}

function isQuestionMarkedUsed(question) {
  return question?.is_used === true || question?.used === true || Boolean(question?.used_at) || Number(question?.times_used || 0) > 0;
}

function isRejectedQuestionCategory(question) {
  const status = normalizeStatus(
    question.category_status || question.category_state || question.approval_status || question.status || question.rating
  );

  return (
    rejectedValues.has(status) ||
    isTruthy(question.rejected) ||
    isTruthy(question.is_rejected) ||
    isTruthy(question.category_rejected) ||
    isTruthy(question.hidden) ||
    isTruthy(question.is_hidden) ||
    isTruthy(question.disliked) ||
    isTruthy(question.is_disliked)
  );
}

function compactQuestion(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanCategory(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeStatus(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isTruthy(value) {
  return value === true || value === 1 || value === "1" || normalizeStatus(value) === "true";
}

function sortCategories(categories) {
  return categories.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export default Dashboard;
