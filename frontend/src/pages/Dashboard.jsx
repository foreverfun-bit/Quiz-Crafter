import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle,
  ClipboardList,
  Clock,
  FileText,
  FolderOpen,
  Image,
  Library,
  List,
  MapPin,
  MessageSquare,
  PencilLine,
  PlusCircle,
  Radio,
  Settings,
  Sparkles,
  ThumbsDown,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { readActiveVenueId, readLocalTemplates, readLocalVenues, writeTemplateBuildDraft, writeVenueBuildDraft } from "../lib/venues";

const BUILD_STORAGE_KEYS = [
  "trivia-flex-round-builder-state-v5",
  "trivia-flex-round-builder-state-v4",
  "trivia-flex-round-builder-state-v3",
  "trivia-flex-round-builder-state-v2",
];

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

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(emptyStats);
  const [recentSessions, setRecentSessions] = useState([]);
  const [savedBuild, setSavedBuild] = useState(null);
  const [venues, setVenues] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeVenueId, setActiveVenueId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSavedBuild(readSavedBuild());
    setVenues(readLocalVenues());
    setTemplates(readLocalTemplates());
    setActiveVenueId(readActiveVenueId());
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      if (!user?.id) return;

      try {
        setLoading(true);
        const [questionsResult, sessionsResult, categoryState] = await Promise.all([
          supabase.from("questions").select("*").eq("user_id", user.id),
          supabase.from("sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
          fetchCategoryState(),
        ]);

        if (questionsResult.error) throw questionsResult.error;
        if (sessionsResult.error) throw sessionsResult.error;

        const questions = Array.isArray(questionsResult.data) ? questionsResult.data : [];
        const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
        setStats(buildStats(questions, sessions, categoryState));
        setRecentSessions(sessions.slice(0, 5));
      } catch (error) {
        console.error("Dashboard stats error:", error);
        toast.error("Failed to load dashboard stats");
        setStats(emptyStats);
        setRecentSessions([]);
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

  const handleNewBuild = () => {
    clearSavedBuild();
    setSavedBuild(null);
    navigate("/build");
  };

  const approvedCategories = stats.approved_categories || [];
  const rejectedCategories = stats.rejected_categories || [];
  const unusedCount = Math.max(0, (stats.total_questions || 0) - (stats.used_count || 0));
  const manualCount = Math.max(0, (stats.total_questions || 0) - (stats.ai_generated_count || 0) - (stats.imported_count || 0));
  const activeVenue = venues.find((venue) => venue.id === activeVenueId) || venues[0] || null;
  const starterTemplate = templates[0] || null;
  const nextSession = recentSessions.find((session) => !session.is_past) || null;

  const startFromVenue = () => {
    if (!activeVenue) return navigate("/venues");
    writeVenueBuildDraft(activeVenue);
    navigate("/build");
  };

  const startFromTemplate = () => {
    if (!starterTemplate) return navigate("/show-templates");
    writeTemplateBuildDraft(starterTemplate, activeVenue);
    navigate("/build");
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
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">Ready room for {firstName}</h1>
          <p className="text-zinc-500 mt-2 max-w-3xl">
            Prep your next set, keep repeats out, and jump back into the hosting flow without hunting through menus.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => navigate("/build")} className="gradient-btn" data-testid="dashboard-build-btn">
            <PlusCircle className="mr-2" size={18} />
            Build Session
          </Button>
          <Button onClick={() => navigate("/generate")} className="bg-[#AEB2EF] hover:bg-[#C6C9FF] text-zinc-950 font-bold">
            <Sparkles className="mr-2" size={18} />
            Generate
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-5 mb-5">
        <CommandCenter
          nextSession={nextSession}
          activeVenue={activeVenue}
          starterTemplate={starterTemplate}
          savedBuild={savedBuild}
          onContinue={() => navigate("/build")}
          onNew={handleNewBuild}
          onHost={() => nextSession && navigate(`/host-session/${nextSession.id}`)}
          onOpenSession={() => nextSession && navigate(`/session/${nextSession.id}`)}
          onStartVenue={startFromVenue}
          onStartTemplate={startFromTemplate}
          onHostTools={() => navigate("/host-tools")}
        />

        <Card className="glass-card">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 gap-3">
              <PrimaryAction icon={PencilLine} label="Create Questions" detail="Generate, write, or ask the assistant" onClick={() => navigate("/generate")} />
              <PrimaryAction icon={ClipboardList} label="Use Show Template" detail={starterTemplate ? starterTemplate.name : "Create reusable formats"} onClick={startFromTemplate} />
              <PrimaryAction icon={MapPin} label="Venue Setup" detail={activeVenue ? activeVenue.name : "Add recurring trivia nights"} onClick={() => navigate("/venues")} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <QuickAction icon={Sparkles} label="AI Host Assistant" detail="Review, rewrite, replace" onClick={() => navigate("/host-tools")} />
        <QuickAction icon={Radio} label="Live Hosting" detail={nextSession ? nextSession.name || nextSession.session_name || "Open session" : "Build a session first"} onClick={() => nextSession ? navigate(`/host-session/${nextSession.id}`) : navigate("/build")} />
        <QuickAction icon={MessageSquare} label="Feedback Hub" detail="Likes, dislikes, ideas" onClick={() => navigate("/host-tools")} />
        <QuickAction icon={Settings} label="Templates" detail={`${templates.length || 0} reusable formats`} onClick={() => navigate("/show-templates")} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <MetricCard label="Library" value={stats.total_questions} sub={`${unusedCount} unused`} icon={Library} tone="cyan" onClick={() => navigate("/library")} />
        <MetricCard label="Used" value={stats.used_count} sub="blocked from builder" icon={CheckCircle} tone="green" />
        <MetricCard label="Venues" value={venues.length} sub={activeVenue ? activeVenue.name : "no default"} icon={MapPin} tone="purple" onClick={() => navigate("/venues")} />
        <MetricCard label="Media" value={stats.media_count} sub="questions with images" icon={Image} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-5">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-white text-lg">Recent Sessions</CardTitle>
              <Button variant="outline" size="sm" onClick={() => navigate("/past-sessions")} className="border-white/20 text-white hover:bg-zinc-800">
                View All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentSessions.length === 0 ? (
              <EmptyPanel icon={Calendar} title="No sessions yet" text="Build a session or import a set to start your archive." action="Start Building" onClick={() => navigate("/build")} />
            ) : (
              recentSessions.map((session) => (
                <SessionRow key={session.id} session={session} onOpen={() => navigate(`/session/${session.id}`)} onHost={() => navigate(`/host-session/${session.id}`)} />
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <PrepCard activeVenue={activeVenue} starterTemplate={starterTemplate} savedBuild={savedBuild} unusedCount={unusedCount} rejectedCount={rejectedCategories.length} onVenue={() => navigate("/venues")} onTemplate={() => navigate("/show-templates")} onLibrary={() => navigate("/library")} onBuild={() => navigate("/build")} onCategories={() => navigate("/categories")} />

          <BreakdownCard title="Question Mix" items={[
            { icon: CheckCircle, label: "True/False", value: stats.by_type?.true_false || 0, color: "text-[#71E0DC]" },
            { icon: List, label: "Multiple Choice", value: stats.by_type?.multiple_choice || 0, color: "text-[#AEB2EF]" },
            { icon: MessageSquare, label: "Written", value: stats.by_type?.written || 0, color: "text-emerald-400" },
            { icon: Image, label: "Picture", value: stats.by_type?.picture || 0, color: "text-amber-400" },
          ]} />

          <BreakdownCard title="Source Mix" items={[
            { icon: Bot, label: "AI Generated", value: stats.ai_generated_count || 0, color: "text-[#71E0DC]" },
            { icon: Upload, label: "Imported", value: stats.imported_count || 0, color: "text-[#AEB2EF]" },
            { icon: FileText, label: "Manual", value: manualCount, color: "text-zinc-300" },
            { icon: ThumbsDown, label: "Disliked", value: stats.disliked_count || 0, color: "text-red-400" },
          ]} />
        </div>
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

      {stats.total_questions === 0 && (
        <Card className="glass-card mt-5 border-[#71E0DC]/30">
          <CardContent className="p-8 text-center">
            <Sparkles className="text-[#71E0DC] mx-auto mb-4" size={36} />
            <h3 className="text-xl font-bold text-white mb-2">Build your first usable set</h3>
            <p className="text-zinc-500 mb-6 max-w-md mx-auto">
              Generate fresh host-grade questions or import the sets you already have.
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button className="gradient-btn" onClick={() => navigate("/generate")} data-testid="cta-generate-btn">
                <Sparkles className="mr-2" size={18} />
                Generate Questions
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

const PrimaryAction = ({ icon: Icon, label, detail, onClick }) => (
  <button type="button" onClick={onClick} className="group rounded-lg border border-white/10 bg-zinc-950/40 p-4 text-left hover:border-[#71E0DC]/40 hover:bg-zinc-900 transition-colors">
    <div className="flex items-center justify-between gap-3">
      <Icon className="text-[#71E0DC]" size={22} />
      <ArrowRight className="text-zinc-600 group-hover:text-[#71E0DC]" size={18} />
    </div>
    <div className="text-white font-semibold mt-4">{label}</div>
    <div className="text-zinc-500 text-sm mt-1">{detail}</div>
  </button>
);

const CommandCenter = ({ nextSession, activeVenue, starterTemplate, savedBuild, onContinue, onNew, onHost, onOpenSession, onStartVenue, onStartTemplate, onHostTools }) => (
  <Card className="glass-card border-[#71E0DC]/25">
    <CardContent className="p-5 lg:p-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[#71E0DC] font-bold uppercase tracking-[0.16em] text-xs">
            <Radio size={16} />
            Host Command Center
          </div>
          <h2 className="mt-3 text-2xl lg:text-3xl font-black text-white">
            {nextSession ? nextSession.name || nextSession.session_name || "Next Session" : savedBuild ? "Draft in progress" : "Set up your next trivia night"}
          </h2>
          <p className="mt-2 text-zinc-500">
            {nextSession ? `${compactDate(nextSession.created_at)} / ${questionCount(nextSession)} questions ready` : savedBuild ? `${savedBuild.questionCount} questions selected locally` : "Start with a venue, a show template, or a fresh build."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {activeVenue && <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20"><MapPin size={13} className="mr-1" />{activeVenue.name}</Badge>}
            {starterTemplate && <Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF] border border-[#AEB2EF]/20"><ClipboardList size={13} className="mr-1" />{starterTemplate.name}</Badge>}
            {savedBuild && <Badge className="bg-amber-500/15 text-amber-200 border border-amber-500/20"><Clock size={13} className="mr-1" />Saved draft</Badge>}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:w-[360px] gap-2">
          <Button onClick={nextSession ? onHost : savedBuild ? onContinue : onStartVenue} className="gradient-btn">{nextSession ? "Go Live" : savedBuild ? "Continue Build" : "Build From Venue"}</Button>
          <Button variant="outline" onClick={nextSession ? onOpenSession : onStartTemplate} className="border-white/20 text-white hover:bg-zinc-800">{nextSession ? "Open Session" : "Use Template"}</Button>
          <Button variant="outline" onClick={onHostTools} className="border-white/20 text-white hover:bg-zinc-800">Host Tools</Button>
          <Button variant="outline" onClick={onNew} className="border-white/20 text-white hover:bg-zinc-800">New Build</Button>
        </div>
      </div>
    </CardContent>
  </Card>
);

const QuickAction = ({ icon: Icon, label, detail, onClick }) => (
  <button type="button" onClick={onClick} className="rounded-xl border border-white/10 bg-zinc-950/45 p-4 text-left hover:border-[#71E0DC]/35 hover:bg-zinc-900 transition-colors">
    <div className="flex items-center justify-between gap-3">
      <Icon className="text-[#71E0DC]" size={20} />
      <ArrowRight className="text-zinc-600" size={16} />
    </div>
    <p className="mt-3 font-bold text-white">{label}</p>
    <p className="mt-1 text-sm text-zinc-500 line-clamp-1">{detail}</p>
  </button>
);

const PrepCard = ({ activeVenue, starterTemplate, savedBuild, unusedCount, rejectedCount, onVenue, onTemplate, onLibrary, onBuild, onCategories }) => {
  const items = [
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
        <div className="text-zinc-500 text-sm mt-1">{compactDate(session.created_at)} · {questionCount(session)} questions</div>
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
  for (const key of BUILD_STORAGE_KEYS) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if (!parsed) continue;
      const rounds = Array.isArray(parsed.rounds) ? parsed.rounds : [];
      return {
        sessionName: parsed.sessionName || "",
        questionCount: rounds.reduce((sum, round) => sum + safeArray(round.questionIds).length, 0),
      };
    } catch {
      // Try the next storage key.
    }
  }
  return null;
}

function clearSavedBuild() {
  BUILD_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}

function buildStats(questions, sessions, categoryState) {
  const byType = {};
  const approvedCategories = new Set(categoryState.approved);
  const rejectedCategories = new Set(categoryState.rejected);
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
