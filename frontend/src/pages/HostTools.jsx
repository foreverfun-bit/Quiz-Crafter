import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { BarChart3, CheckCircle, Copy, ExternalLink, Image, Lightbulb, Mail, MessageSquare, Palette, Save, Send, Sparkles, ThumbsDown, ThumbsUp, TrendingUp, Upload, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { loadHostSetupSettings, loadHostToolsSessionState, profileKeys, saveHostSetupSettings, saveHostToolsSessionState, saveProfileValue, syncProfileJson, updateUserMetadata } from "../lib/profileState";

const SOCIAL_STORAGE_KEY = "quiz-crafter-social-links";
const OUTREACH_CONTACTS_STORAGE_KEY = "quiz-crafter-outreach-contacts-v1";
const HOST_DEFAULT_BRANDING_KEY = "quiz-crafter-host-branding-defaults";
const metadataBrandingKey = "quiz_crafter_host_branding_defaults_v1";
const DEFAULT_BRANDING = { name: "Forever Fun Events", logoUrl: "/quiz-crafter-logo.svg", primaryColor: "#71E0DC", accentColor: "#AEB2EF" };
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep tools usable if browser storage is full. */ } };
const sanitizeHexColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
const normalizeBranding = (branding = {}) => {
  const source = branding && typeof branding === "object" ? branding : {};
  const logoUrl = String(source.logoUrl || "").trim();
  return { name: String(source.name || "").trim() || DEFAULT_BRANDING.name, logoUrl: logoUrl === "/forever-fun-logo.png" ? DEFAULT_BRANDING.logoUrl : logoUrl, primaryColor: sanitizeHexColor(source.primaryColor, DEFAULT_BRANDING.primaryColor), accentColor: sanitizeHexColor(source.accentColor, DEFAULT_BRANDING.accentColor) };
};
const readSavedDefaultBranding = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOST_DEFAULT_BRANDING_KEY) || "null");
    return parsed && typeof parsed === "object" ? normalizeBranding(parsed) : null;
  } catch {
    return null;
  }
};
const readDefaultBranding = () => normalizeBranding({ ...DEFAULT_BRANDING, ...readJson(HOST_DEFAULT_BRANDING_KEY, {}) });
const writeDefaultBranding = (branding) => writeJson(HOST_DEFAULT_BRANDING_KEY, normalizeBranding(branding));
const brandingChanged = (left, right) => JSON.stringify(normalizeBranding(left || {})) !== JSON.stringify(normalizeBranding(right || {}));
const sessionStorageKey = (sessionId, name) => `quiz-crafter-host-tools-${sessionId}-${name}`;
const sessionQuestions = (session) => [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions].flatMap((value) => Array.isArray(value) ? value : []);
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
const hostToolTabs = [
  { key: "feedback", label: "Feedback", icon: ThumbsUp },
  { key: "game", label: "Game Data", icon: BarChart3 },
  { key: "outreach", label: "Outreach", icon: Mail },
  { key: "clues", label: "Clues", icon: Sparkles },
  { key: "branding", label: "Branding", icon: Palette },
];

const HostTools = () => {
  const [searchParams] = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [activeTab, setActiveTab] = useState(() => hostToolTabs.some((tab) => tab.key === searchParams.get("tab")) ? searchParams.get("tab") : "feedback");
  const [players, setPlayers] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [categoryFeedback, setCategoryFeedback] = useState([]);
  const [playerIdeas, setPlayerIdeas] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [gradedAnswers, setGradedAnswers] = useState({});
  const [message, setMessage] = useState("");
  const [socialPost, setSocialPost] = useState("");
  const [aiDirection, setAiDirection] = useState("Make it playful, punny, and useful without giving away answers.");
  const [selectedClueKeys, setSelectedClueKeys] = useState([]);
  const [socialLinks, setSocialLinks] = useState(() => readJson(SOCIAL_STORAGE_KEY, { facebook: "", instagram: "", x: "" }));
  const [outreachContacts, setOutreachContacts] = useState(() => readJson(OUTREACH_CONTACTS_STORAGE_KEY, []));
  const [branding, setBranding] = useState(readDefaultBranding);
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef(null);
  const loadedDraftSessionRef = useRef("");

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const emailPlayers = useMemo(() => players.filter((player) => player.updatePreference === "email" && player.updateContact), [players]);
  const allEmailContacts = useMemo(() => mergeContacts(outreachContacts, contactRowsFromPlayers(emailPlayers, selectedSession)), [outreachContacts, emailPlayers, selectedSession]);
  const questionFeedback = useMemo(() => summarize(feedback, "questionText"), [feedback]);
  const categoryRows = useMemo(() => summarize(categoryFeedback, "category"), [categoryFeedback]);
  const analytics = useMemo(() => buildAnalytics({ selectedSession, players, feedback, categoryFeedback, playerIdeas, answers, activity, emailPlayers, leaderboard, gradedAnswers }), [selectedSession, players, feedback, categoryFeedback, playerIdeas, answers, activity, emailPlayers, leaderboard, gradedAnswers]);
  const clueQuestionRows = useMemo(() => sessionQuestions(selectedSession).map((question, index) => ({
    key: `${index}-${getQuestionText(question)}`,
    index,
    category: getQuestionCategory(question),
    question: getQuestionText(question),
    answer: getQuestionAnswer(question),
    fun_fact: question.fun_fact || question.funFact || "",
  })).filter((question) => question.question && question.answer), [selectedSession]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (hostToolTabs.some((item) => item.key === tab)) setActiveTab(tab);
  }, [searchParams]);

  useEffect(() => {
    const loadHostBranding = async () => {
      const savedLocalBranding = readSavedDefaultBranding();
      const localBranding = savedLocalBranding || readDefaultBranding();
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupBranding = setupSettings.branding && typeof setupSettings.branding === "object" ? normalizeBranding(setupSettings.branding) : null;
        const remoteBranding = data?.user?.user_metadata?.[metadataBrandingKey];
        if (setupBranding || (remoteBranding && typeof remoteBranding === "object")) {
          const cleanBranding = normalizeBranding(setupBranding || remoteBranding);
          setBranding(cleanBranding);
          writeDefaultBranding(cleanBranding);
          if (!setupBranding) await saveHostSetupSettings({ branding: cleanBranding });
        } else if (savedLocalBranding && brandingChanged(savedLocalBranding, DEFAULT_BRANDING)) {
          await updateUserMetadata({ [metadataBrandingKey]: localBranding });
          await saveHostSetupSettings({ branding: localBranding });
        }
      } catch (error) {
        console.warn("Host branding profile sync unavailable:", error);
      }
    };
    loadHostBranding();
  }, []);

  useEffect(() => {
    const syncSocialLinks = async () => {
      try {
        const links = await syncProfileJson({ localKey: SOCIAL_STORAGE_KEY, profileKey: profileKeys.socialLinks, fallback: { facebook: "", instagram: "", x: "" }, merge: "object" });
        setSocialLinks({ facebook: links.facebook || "", instagram: links.instagram || "", x: links.x || "" });
      } catch (error) {
        console.warn("Social links profile sync unavailable:", error);
      }
    };
    syncSocialLinks();
  }, []);

  useEffect(() => {
    const syncOutreachContacts = async () => {
      try {
        const contacts = await syncProfileJson({ localKey: OUTREACH_CONTACTS_STORAGE_KEY, profileKey: profileKeys.outreachContacts, fallback: [], merge: "array" });
        setOutreachContacts(normalizeContacts(contacts));
      } catch (error) {
        console.warn("Outreach contacts profile sync unavailable:", error);
      }
    };
    syncOutreachContacts();
  }, []);

  useEffect(() => {
    const loadSessions = async () => {
      const { data, error } = await supabase.from("sessions").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) return toast.error("Could not load sessions");
      const rows = Array.isArray(data) ? data : [];
      setSessions(rows);
      setSelectedSessionId((current) => current || rows[0]?.id || "");
    };
    loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return undefined;
    loadedDraftSessionRef.current = "";
    const loadStoredHostTools = async () => {
      const localDrafts = readJson(sessionStorageKey(selectedSessionId, "drafts"), {});
      const localState = {
        players: readJson(sessionStorageKey(selectedSessionId, "players"), []),
        feedback: readJson(sessionStorageKey(selectedSessionId, "feedback"), []),
        categoryFeedback: readJson(sessionStorageKey(selectedSessionId, "category-feedback"), []),
        ideas: readJson(sessionStorageKey(selectedSessionId, "ideas"), []),
        answers: readJson(sessionStorageKey(selectedSessionId, "answers"), []),
        activity: readJson(sessionStorageKey(selectedSessionId, "activity"), []),
        leaderboard: readJson(sessionStorageKey(selectedSessionId, "leaderboard"), []),
        gradedAnswers: readJson(sessionStorageKey(selectedSessionId, "graded-answers"), {}),
      };
      try {
        const profileState = await loadHostToolsSessionState(selectedSessionId);
        const snapshot = profileState.results && typeof profileState.results === "object" ? { ...profileState, ...profileState.results } : profileState;
        const drafts = { ...localDrafts, ...(profileState.drafts && typeof profileState.drafts === "object" ? profileState.drafts : {}) };
        const nextState = {
          players: mergeByKey(snapshot.players, localState.players, (item) => item.id),
          feedback: mergeByKey(snapshot.feedback, localState.feedback, (item) => `${item.playerId}-${item.questionIndex}`),
          categoryFeedback: mergeByKey(snapshot.categoryFeedback, localState.categoryFeedback, (item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`),
          ideas: mergeByKey(snapshot.ideas, localState.ideas, (item) => `${item.playerId}-${item.submittedAt}`),
          answers: mergeByKey(snapshot.answers, localState.answers, (item) => `${item.playerId}-${item.questionIndex}`),
          activity: [...(Array.isArray(snapshot.activity) ? snapshot.activity : []), ...(Array.isArray(localState.activity) ? localState.activity : [])].slice(-800),
          leaderboard: mergeByKey(snapshot.leaderboard, localState.leaderboard, (item) => item.id),
          gradedAnswers: { ...(snapshot.gradedAnswers && typeof snapshot.gradedAnswers === "object" ? snapshot.gradedAnswers : {}), ...(localState.gradedAnswers && typeof localState.gradedAnswers === "object" ? localState.gradedAnswers : {}) },
        };
        setPlayers(nextState.players);
        setFeedback(nextState.feedback);
        setCategoryFeedback(nextState.categoryFeedback);
        setPlayerIdeas(nextState.ideas);
        setAnswers(nextState.answers);
        setActivity(nextState.activity);
        setLeaderboard(nextState.leaderboard);
        setGradedAnswers(nextState.gradedAnswers);
        setMessage(drafts.message || "");
        setSocialPost(drafts.socialPost || "");
        setAiDirection(drafts.aiDirection || "Make it playful, punny, and useful without giving away answers.");
        Object.entries(nextState).forEach(([key, value]) => writeJson(sessionStorageKey(selectedSessionId, key === "categoryFeedback" ? "category-feedback" : key === "gradedAnswers" ? "graded-answers" : key), value));
        writeJson(sessionStorageKey(selectedSessionId, "drafts"), drafts);
        loadedDraftSessionRef.current = selectedSessionId;
        saveHostToolsSessionState(selectedSessionId, nextState).catch((error) => console.warn("Host tools profile save unavailable:", error));
      } catch (error) {
        console.warn("Host tools profile sync unavailable:", error);
        setPlayers(localState.players);
        setFeedback(localState.feedback);
        setCategoryFeedback(localState.categoryFeedback);
        setPlayerIdeas(localState.ideas);
        setAnswers(localState.answers);
        setActivity(localState.activity);
        setLeaderboard(localState.leaderboard);
        setGradedAnswers(localState.gradedAnswers);
        setMessage(localDrafts.message || "");
        setSocialPost(localDrafts.socialPost || "");
        setAiDirection(localDrafts.aiDirection || "Make it playful, punny, and useful without giving away answers.");
        loadedDraftSessionRef.current = selectedSessionId;
      }
    };
    loadStoredHostTools();

    const channel = supabase.channel(`quiz-crafter-live-${selectedSessionId}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "player_join" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayers((current) => persistPlayer(selectedSessionId, current, payload));
      })
      .on("broadcast", { event: "feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setFeedback((current) => persistVote(selectedSessionId, "feedback", current, payload, (item) => `${item.playerId}-${item.questionIndex}`));
      })
      .on("broadcast", { event: "category_feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || !payload.category) return;
        setCategoryFeedback((current) => persistVote(selectedSessionId, "category-feedback", current, payload, (item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`));
      })
      .on("broadcast", { event: "idea_submit" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayerIdeas((current) => persistIdea(selectedSessionId, current, payload));
      })
      .on("broadcast", { event: "answer_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setAnswers((current) => persistAnswer(selectedSessionId, current, payload));
      })
      .on("broadcast", { event: "player_activity" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setActivity((current) => persistActivity(selectedSessionId, current, payload));
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setConnected(false);
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || loadedDraftSessionRef.current !== selectedSessionId) return undefined;
    const drafts = { message, socialPost, aiDirection };
    const timeout = window.setTimeout(() => {
      writeJson(sessionStorageKey(selectedSessionId, "drafts"), drafts);
      saveHostToolsSessionState(selectedSessionId, { drafts }).catch((error) => console.warn("Host tools draft save unavailable:", error));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [selectedSessionId, message, socialPost, aiDirection]);

  useEffect(() => {
    if (!emailPlayers.length) return;
    const nextContacts = mergeContacts(outreachContacts, contactRowsFromPlayers(emailPlayers, selectedSession));
    if (JSON.stringify(nextContacts) === JSON.stringify(outreachContacts)) return;
    setOutreachContacts(nextContacts);
    writeJson(OUTREACH_CONTACTS_STORAGE_KEY, nextContacts);
    saveProfileValue(profileKeys.outreachContacts, nextContacts).catch((error) => console.warn("Outreach contacts profile save unavailable:", error));
  }, [emailPlayers, outreachContacts, selectedSession]);

  const updateSocialLink = (key, value) => {
    const next = { ...socialLinks, [key]: value };
    setSocialLinks(next);
    writeJson(SOCIAL_STORAGE_KEY, next);
    saveProfileValue(profileKeys.socialLinks, next).catch((error) => console.warn("Social links profile save unavailable:", error));
  };
  const saveDefaultBranding = async (nextBranding) => {
    const cleanBranding = normalizeBranding(nextBranding);
    setBranding(cleanBranding);
    writeDefaultBranding(cleanBranding);
    try {
      await updateUserMetadata({ [metadataBrandingKey]: cleanBranding });
      await saveHostSetupSettings({ branding: cleanBranding });
      toast.success("Default host branding saved to your profile");
    } catch (error) {
      console.warn("Host branding profile save unavailable:", error);
      toast.success("Default host branding saved on this device");
    }
  };

  const sendUpdate = () => {
    const body = message.trim();
    if (!selectedSessionId) return toast.error("Choose a session first");
    if (!body) return toast.error("Write an update first");
    channelRef.current?.send({ type: "broadcast", event: "host_update", payload: { message: body, sentAt: new Date().toISOString() } });
    toast.success("Update sent to connected players");
  };

  const copyEmails = async () => {
    if (!allEmailContacts.length) return toast.error("No email opt-ins yet");
    await navigator.clipboard.writeText(allEmailContacts.map((contact) => contact.email).join(", "));
    toast.success("Email list copied");
  };

  const openEmailDraft = () => {
    if (!allEmailContacts.length) return toast.error("No email opt-ins yet");
    const subject = encodeURIComponent(selectedSession?.name || selectedSession?.session_name || "Trivia update");
    const body = encodeURIComponent(message || socialPost || "");
    const bcc = encodeURIComponent(allEmailContacts.map((contact) => contact.email).join(","));
    window.location.href = `mailto:?bcc=${bcc}&subject=${subject}&body=${body}`;
  };

  const copySocialPost = async () => {
    const text = socialPost.trim() || message.trim();
    if (!text) return toast.error("Write or generate a post first");
    await navigator.clipboard.writeText(text);
    toast.success("Social post copied");
  };

  const openSocialComposer = async (network) => {
    const rawText = socialPost.trim() || message.trim() || "Trivia update";
    const text = encodeURIComponent(rawText);
    const url = encodeURIComponent(window.location.origin);
    if (network === "facebook") {
      if (rawText && rawText !== "Trivia update") {
        await navigator.clipboard.writeText(rawText);
        toast.success("Post copied. Paste it into Facebook.");
      }
      const pageUrl = String(socialLinks.facebook || "").trim();
      window.open(pageUrl || `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`, "_blank", "noopener,noreferrer");
    }
    if (network === "x") window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "noopener,noreferrer");
  };
  const exportResults = () => {
    const rows = [["Team", "Score", "Answered", "Correct"], ...analytics.teamStats.map((team) => [team.name, team.score, team.answered, team.correct])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(selectedSession?.name || selectedSession?.session_name || "trivia-results").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-results.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const buildNextSession = () => { window.location.href = "/build"; };
  const scheduleNextShow = () => { window.location.href = "/manage"; };

  const generateClues = async (questionsToDraft = []) => {
    if (!selectedSession) return toast.error("Choose a session first");
    if (!questionsToDraft.length) return toast.error("Select at least one question for the clue");
    setGenerating(true);
    try {
      const questions = questionsToDraft.slice(0, 12).map((question) => ({
        category: question.category || "",
        question: question.question || question.question_text || "",
        answer: question.answer || question.correct_answer || "",
        fun_fact: question.fun_fact || "",
      }));
      const response = await fetch("/api/generate-host-clues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionName: selectedSession.name || selectedSession.session_name, direction: aiDirection, questions }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Could not generate clues");
      setMessage(data.update || "");
      setSocialPost(data.social_post || "");
      toast.success("AI drafted a clue and social post");
    } catch (error) {
      toast.error(error.message || "Could not generate clues");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="host-tools-page">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Host Hub</h1>
          <p className="text-zinc-500">How did tonight go, and what should you do before the next show?</p>
        </div>
        <Badge className={connected ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{connected ? "Listening live" : "Choose a session"}</Badge>
      </div>

      <Card className="glass-card mb-6"><CardContent className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end"><label className="text-sm text-zinc-400">Session<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} className="mt-1 w-full h-11 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{sessions.map((session) => <option key={session.id} value={session.id}>{session.name || session.session_name || "Untitled Session"}</option>)}</select></label><Badge className="h-10 justify-center bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20"><Users size={15} className="mr-1" />{emailPlayers.length} this session</Badge><Badge className="h-10 justify-center bg-[#AEB2EF]/15 text-[#AEB2EF] border border-[#AEB2EF]/20"><Mail size={15} className="mr-1" />{allEmailContacts.length} total opt-ins</Badge></CardContent></Card>

      <HostReviewWorkspace analytics={analytics} questionFeedback={questionFeedback} categoryRows={categoryRows} playerIdeas={playerIdeas} message={message} setMessage={setMessage} sendUpdate={sendUpdate} openEmailDraft={openEmailDraft} copyEmails={copyEmails} contacts={allEmailContacts} exportResults={exportResults} scheduleNextShow={scheduleNextShow} buildNextSession={buildNextSession} />
    </div>
  );
};

const Panel = ({ title, icon: Icon, children }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Icon className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;

const HostReviewWorkspace = ({ analytics, questionFeedback, categoryRows, playerIdeas, message, setMessage, sendUpdate, openEmailDraft, copyEmails, contacts, exportResults, scheduleNextShow, buildNextSession }) => {
  const summary = analytics.summary || {};
  const performance = analytics.performance || {};
  return <section className="space-y-6"><Panel title="Session Summary" icon={BarChart3}><div className="grid grid-cols-2 lg:grid-cols-6 gap-3"><ReviewMetric label="Attendance" value={analytics.totals.players} sub={`${analytics.totals.emailOptIns} email opt-ins`} /><ReviewMetric label="Average Score" value={analytics.totals.averageScore} sub="across ranked teams" /><ReviewMetric label="Duration" value={analytics.totals.sessionDuration || "Not tracked"} sub="first to last signal" /><ReviewMetric label="Hardest" value={summary.hardestQuestion ? `${summary.hardestQuestion.correctPercent}%` : "-"} sub={summary.hardestQuestion?.category || "No answers yet"} /><ReviewMetric label="Easiest" value={summary.easiestQuestion ? `${summary.easiestQuestion.correctPercent}%` : "-"} sub={summary.easiestQuestion?.category || "No answers yet"} /><ReviewMetric label="Top Category" value={summary.highestRatedCategory?.label || "-"} sub={summary.highestRatedCategory ? `${summary.highestRatedCategory.likes} likes` : "No category votes"} /></div></Panel><Panel title="Question Performance" icon={TrendingUp}><div className="grid grid-cols-1 xl:grid-cols-2 gap-4"><PerformanceBlock title="Best Performing" rows={performance.bestPerforming} empty="Balanced, well-received questions will appear here." tone="good" /><PerformanceBlock title="Weak Questions" rows={performance.weakQuestions} empty="Low-rated, skipped, or poor-performing questions will appear here." tone="bad" /><PerformanceBlock title="Too Easy" rows={performance.tooEasy} empty="Questions with very high correct rates will appear here." /><PerformanceBlock title="Too Difficult" rows={performance.tooDifficult} empty="Questions with very low correct rates will appear here." /><PerformanceBlock title="Most Skipped" rows={performance.mostSkipped} empty="Skipped or low-response questions will appear here." /><PerformanceBlock title="Most Liked" rows={performance.mostLiked} empty="Player-liked questions will appear here." tone="good" /></div></Panel><Panel title="Quiz Crafter Review" icon={Sparkles}><div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5"><div className="space-y-3">{analytics.reviewNotes.map((note) => <div key={note.title} className="rounded-xl border border-white/10 bg-zinc-950/60 p-4"><p className="font-black text-white">{note.title}</p><p className="mt-1 text-sm text-zinc-400">{note.body}</p></div>)}</div><div className="space-y-2"><Button onClick={() => toast.info("Rewrite workflow will open from selected weak questions next.")} className="w-full gradient-btn">Rewrite Weak Questions</Button><Button onClick={buildNextSession} variant="outline" className="w-full border-white/10 text-zinc-300 hover:text-white">Build Similar Questions</Button><Button onClick={() => toast.success("Marked for review. Retire controls will connect to Question Bank next.")} variant="outline" className="w-full border-white/10 text-zinc-300 hover:text-white">Retire Weak Questions</Button></div></div></Panel><Panel title="Player Feedback" icon={ThumbsUp}><div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><FeedbackCard title="Question Likes & Dislikes" rows={questionFeedback} empty="Question thumbs will appear here after players rate live questions." /><FeedbackCard title="Category Likes & Dislikes" rows={categoryRows} empty="Category reactions appear after players rate round intros." /><IdeasFeedbackCard ideas={playerIdeas} /></div></Panel><Panel title="Follow-Up" icon={CheckCircle}><div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5"><div><p className="text-sm text-zinc-400">Turn tonight into the next prep move. Outreach now lives here as a task, not a separate destination.</p><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Thank-you note, schedule reminder, or next-show teaser..." className="mt-4 min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><p className="mt-2 text-xs text-zinc-500">{contacts.length} total email opt-ins saved.</p></div><div className="grid gap-2"><Button onClick={exportResults} className="gradient-btn"><Copy size={16} className="mr-2" />Export Results</Button><Button onClick={scheduleNextShow} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Schedule Next Show</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Thank Players</Button><Button onClick={sendUpdate} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Send size={16} className="mr-2" />Send In-App Update</Button><Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Copy Email List</Button><Button onClick={buildNextSession} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Build Next Session</Button></div></div></Panel></section>;
};

const ReviewMetric = ({ label, value, sub }) => <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-2 truncate text-2xl font-black text-white">{value}</p><p className="mt-1 truncate text-xs text-zinc-500">{sub}</p></div>;

const PerformanceBlock = ({ title, rows = [], empty, tone }) => <div className="rounded-xl border border-white/10 bg-zinc-950/45 p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-black text-white">{title}</h3><Badge className={tone === "good" ? "bg-emerald-500/15 text-emerald-300" : tone === "bad" ? "bg-red-500/15 text-red-300" : "bg-zinc-800 text-zinc-300"}>{rows.length}</Badge></div><div className="space-y-2">{rows.slice(0, 4).map((row) => <div key={row.key || row.label} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3"><p className="line-clamp-2 text-sm font-semibold text-zinc-200">{row.label}</p><div className="mt-2 flex flex-wrap gap-2"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">{row.category}</Badge><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{row.correctPercent}% correct</Badge><Badge className="bg-zinc-800 text-zinc-300">{row.responses} answers</Badge>{Number(row.likes || 0) > 0 && <Badge className="bg-emerald-500/15 text-emerald-300">{row.likes} likes</Badge>}{Number(row.dislikes || 0) > 0 && <Badge className="bg-red-500/15 text-red-300">{row.dislikes} dislikes</Badge>}</div></div>)}{!rows.length && <p className="rounded-lg border border-white/10 bg-zinc-950/60 p-4 text-center text-sm text-zinc-500">{empty}</p>}</div></div>;

const FeedbackInsightsPanel = ({ analytics, questionFeedback, categoryRows, playerIdeas }) => {
  const totalVotes = analytics.totals.questionVotes + analytics.totals.categoryVotes;
  return <section className="space-y-6"><div className="grid grid-cols-1 md:grid-cols-3 gap-3"><AnalyticsMetric icon={ThumbsUp} label="Question Votes" value={analytics.totals.questionVotes} sub="thumbs on individual questions" /><AnalyticsMetric icon={BarChart3} label="Category Votes" value={analytics.totals.categoryVotes} sub="round intro category reactions" /><AnalyticsMetric icon={Lightbulb} label="Player Ideas" value={analytics.totals.ideas} sub={`${totalVotes} total likes/dislikes`} /></div><div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><FeedbackCard title="Question Likes & Dislikes" rows={questionFeedback} empty="Question likes and dislikes will appear here after players tap the thumbs during a live session." /><FeedbackCard title="Category Likes & Dislikes" rows={categoryRows} empty="Category likes and dislikes come from the released Round Info screen." /><AnalyticsList title="Questions Players Liked" icon={ThumbsUp} rows={analytics.topQuestions} empty="Question likes will appear here after players rate live questions." render={(row) => <FeedbackAnalyticsRow row={row} />} /><AnalyticsList title="Needs Review" icon={ThumbsDown} rows={analytics.needsReview} empty="Questions with dislikes or low feedback scores will appear here." render={(row) => <FeedbackAnalyticsRow row={row} showResponses />} /><IdeasFeedbackCard ideas={playerIdeas} /></div></section>;
};

const GameDataPanel = ({ analytics }) => <section className="space-y-6"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><AnalyticsMetric icon={Users} label="Players" value={analytics.totals.players} sub={`${analytics.totals.emailOptIns} email opt-in${analytics.totals.emailOptIns === 1 ? "" : "s"}`} /><AnalyticsMetric icon={TrendingUp} label="Answers" value={analytics.totals.answers} sub={`${analytics.totals.answerCoverage}% question coverage`} /><AnalyticsMetric icon={BarChart3} label="Questions" value={analytics.totals.questions} sub="in selected session" /><AnalyticsMetric icon={Users} label="Fair Play" value={analytics.totals.screenExits} sub="screen exit flags" /></div><TeamRankingsCard rows={analytics.teamStats} totalQuestions={analytics.totals.questions} /><QuestionBreakdownCard rows={analytics.questionRows} players={analytics.totals.players} /><CrowdActivityCard rows={analytics.answerRows} /><div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><AnalyticsList title="Fair Play Signals" icon={Users} rows={analytics.exitCounts} empty="Screen-exit signals will appear here when phone play is live." render={(row) => <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/60 p-3"><span className="font-semibold text-zinc-200 truncate">{row.label}</span><Badge className="bg-amber-500/15 text-amber-200">{row.total} exits</Badge></div>} /><AnalyticsList title="Question Type Mix" icon={BarChart3} rows={analytics.typeMix} empty="No session questions found." render={(row) => <ProgressRow row={row} total={analytics.totals.questions} />} /></div></section>;

const TeamRankingsCard = ({ rows, totalQuestions }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Users className="text-[#71E0DC]" />Team Rankings</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map((team, index) => <div key={team.id || team.name} className="grid grid-cols-[44px_1fr_auto] gap-3 rounded-lg border border-white/10 bg-zinc-950/60 p-3 items-center"><div className="text-center"><p className="text-xs text-zinc-500">Rank</p><p className="text-lg font-black text-white">{index + 1}</p></div><div className="min-w-0"><p className="font-bold text-white truncate">{team.name}</p><div className="mt-2 flex items-center gap-2 text-xs text-zinc-400"><span>Answered <strong className="text-white">{team.correct}</strong> of <strong className="text-white">{totalQuestions || team.answered}</strong> correctly</span><span className="text-zinc-600">/</span><span>{team.answered} submitted</span></div><div className="mt-2 h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full bg-[#AEB2EF]" style={{ width: `${team.correctPercent}%` }} /></div></div><div className="text-right"><p className="text-xs text-zinc-500">Points</p><p className="text-2xl font-black text-[#71E0DC]">{team.score}</p></div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">Team rankings will appear after players join or scores are saved.</p>}</CardContent></Card>;

const QuestionBreakdownCard = ({ rows, players }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><BarChart3 className="text-[#71E0DC]" />Question Answer Breakdown</CardTitle></CardHeader><CardContent className="space-y-4 max-h-[680px] overflow-y-auto">{rows.map((row) => <div key={row.key} className="rounded-lg border border-white/10 bg-zinc-950/60 p-4"><div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 mb-2"><Badge className="bg-zinc-800 text-zinc-300">Q{row.index + 1}</Badge><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">{row.responses}/{players || 0} answers</Badge><Badge className={row.correctPercent >= 70 ? "bg-emerald-500/15 text-emerald-300" : row.correctPercent > 0 ? "bg-amber-500/15 text-amber-200" : "bg-zinc-800 text-zinc-300"}>{row.correctPercent}% correct</Badge></div><p className="font-bold text-white line-clamp-2">{row.label}</p><p className="mt-1 text-xs text-zinc-500">{row.category} / {String(row.type || "").replace("_", "/")}</p></div><p className="shrink-0 text-sm font-bold text-emerald-300">Answer: {row.answer || "Not set"}</p></div><div className="mt-4 space-y-2">{row.optionRows.map((option) => <div key={option.label} className={`rounded-md px-3 py-2 ${option.correct ? "bg-emerald-500/10 border border-emerald-500/25" : "bg-zinc-900/80 border border-white/5"}`}><div className="grid grid-cols-[minmax(120px,240px)_1fr_auto] gap-3 items-center"><div className="flex items-center gap-2 min-w-0"><span className="truncate text-sm font-semibold text-zinc-200">{option.label}</span>{option.correct && <Badge className="bg-emerald-500/20 text-emerald-300"><CheckCircle size={12} className="mr-1" />Correct</Badge>}</div><div className="h-3 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full rounded-full ${option.correct ? "bg-emerald-400" : "bg-[#AEB2EF]"}`} style={{ width: `${option.percent}%` }} /></div><span className="text-xs font-bold text-zinc-300">{option.percent}% / {option.total}</span></div></div>)}</div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">Question results will appear after answers are submitted.</p>}</CardContent></Card>;

const CrowdActivityCard = ({ rows }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><TrendingUp className="text-[#71E0DC]" />Crowd Activity</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Q#</th><th className="py-2 pr-3">Question</th><th className="py-2 pr-3">Team</th><th className="py-2 pr-3">Answer</th><th className="py-2 pr-3">Correct?</th><th className="py-2 pr-3">Points</th><th className="py-2 pr-3">Wager</th><th className="py-2 pr-3">Time</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-b border-white/5 text-zinc-300"><td className="py-3 pr-3 font-mono text-zinc-500">{row.questionIndex + 1}</td><td className="py-3 pr-3 max-w-[260px] truncate">{row.question}</td><td className="py-3 pr-3 font-semibold text-white">{row.team}</td><td className="py-3 pr-3 max-w-[220px] truncate">{row.answer}</td><td className="py-3 pr-3"><CorrectBadge status={row.correct} /></td><td className="py-3 pr-3 font-bold">{row.points > 0 ? `+${row.points}` : row.points}</td><td className="py-3 pr-3">{row.wager === null ? "-" : row.wager}</td><td className="py-3 pr-3 text-zinc-500">{formatAnswerTime(row)}</td></tr>)}</tbody></table></div>{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">Every submitted answer will appear here once phone play starts.</p>}</CardContent></Card>;

const CorrectBadge = ({ status }) => status === "correct" ? <Badge className="bg-emerald-500/15 text-emerald-300"><CheckCircle size={12} className="mr-1" />Yes</Badge> : status === "incorrect" ? <Badge className="bg-red-500/15 text-red-300"><XCircle size={12} className="mr-1" />No</Badge> : <Badge className="bg-zinc-800 text-zinc-300">Pending</Badge>;

const CluesPanel = ({ aiDirection, setAiDirection, generateClues, generating, selectedSession, clueQuestionRows, selectedClueKeys, setSelectedClueKeys, message, setMessage, socialPost, setSocialPost, copySocialPost, openSocialComposer, socialLinks }) => {
  const selectedQuestions = clueQuestionRows.filter((question) => selectedClueKeys.includes(question.key));
  const toggleQuestion = (key) => setSelectedClueKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const selectAll = () => setSelectedClueKeys(clueQuestionRows.map((question) => question.key));
  const selectNone = () => setSelectedClueKeys([]);

  return <section className="space-y-6 max-w-6xl"><Panel title="Clue Builder" icon={Sparkles}><div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5"><div className="space-y-4"><div><p className="text-sm font-bold text-white">Select the questions the clue should hint at</p><p className="text-xs text-zinc-500 mt-1">Only selected questions are sent to AI. Answers are included for context, but the prompt blocks answer reveals.</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={selectAll} className="border-white/10 text-zinc-300 hover:text-white">Select All</Button><Button type="button" size="sm" variant="outline" onClick={selectNone} className="border-white/10 text-zinc-300 hover:text-white">Clear</Button><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{selectedQuestions.length} selected</Badge></div><div className="max-h-[520px] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950/50 p-2 space-y-2">{clueQuestionRows.map((question) => <button key={question.key} type="button" onClick={() => toggleQuestion(question.key)} className={`w-full rounded-lg border p-3 text-left transition ${selectedClueKeys.includes(question.key) ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/50 hover:border-white/20"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${selectedClueKeys.includes(question.key) ? "border-[#71E0DC] bg-[#71E0DC] text-zinc-950" : "border-white/20 text-transparent"}`}>{selectedClueKeys.includes(question.key) ? <CheckCircle size={14} /> : null}</span><div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><Badge className="bg-zinc-800 text-zinc-300">Q{question.index + 1}</Badge><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{question.category}</Badge></div><p className="text-sm font-semibold text-white line-clamp-2">{question.question}</p><p className="mt-1 text-xs text-[#71E0DC]">Answer: {question.answer}</p></div></div></button>)}{!clueQuestionRows.length && <p className="p-6 text-center text-sm text-zinc-500">Choose a session with questions first.</p>}</div></div><div className="space-y-4"><label className="block text-sm font-bold text-white">Direction<textarea value={aiDirection} onChange={(event) => setAiDirection(event.target.value)} className="mt-2 min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" /></label><Button onClick={() => generateClues(selectedQuestions)} disabled={generating || !selectedSession || !selectedQuestions.length} className="w-full gradient-btn">{generating ? <Sparkles className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}Draft From Selected</Button><p className="text-xs text-zinc-500">Tip: pick 3-6 questions for the most natural Facebook-style teaser.</p></div></div></Panel><Panel title="Drafted Update and Social Post" icon={MessageSquare}><div className="grid grid-cols-1 xl:grid-cols-2 gap-4"><label className="text-sm font-bold text-white">In-game update<textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Short player update..." className="mt-2 min-h-36 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="text-sm font-bold text-white">Social post<textarea value={socialPost} onChange={(event) => setSocialPost(event.target.value)} placeholder="Facebook/social post..." className="mt-2 min-h-36 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={copySocialPost} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Post</Button><Button onClick={() => openSocialComposer("facebook")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />{socialLinks.facebook ? "Open Facebook Page" : "Open Facebook"}</Button><Button onClick={() => openSocialComposer("x")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />X/Twitter</Button></div></Panel></section>;
};

const OutreachPanel = ({ message, setMessage, sendUpdate, openEmailDraft, copyEmails, contacts, sessionEmailCount, socialLinks, updateSocialLink }) => <section className="space-y-6 max-w-6xl"><Panel title="Opt-In Email List" icon={Mail}><div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4"><div className="rounded-xl border border-[#71E0DC]/25 bg-[#71E0DC]/10 p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#71E0DC]">Stored Contacts</p><p className="mt-2 text-4xl font-black text-white">{contacts.length}</p><p className="mt-1 text-sm text-zinc-400">{sessionEmailCount} from this selected session</p><div className="mt-4 grid gap-2"><Button onClick={copyEmails} className="gradient-btn"><Copy size={16} className="mr-2" />Copy All Emails</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email All</Button></div></div><div className="rounded-xl border border-white/10 bg-zinc-950/60 overflow-hidden"><div className="grid grid-cols-[1fr_1fr_140px] gap-3 border-b border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-500"><span>Team</span><span>Email</span><span>Source</span></div><div className="max-h-72 overflow-y-auto">{contacts.map((contact) => <div key={contact.email} className="grid grid-cols-[1fr_1fr_140px] gap-3 border-b border-white/5 px-3 py-3 text-sm"><span className="font-semibold text-white truncate">{contact.name || "Team"}</span><span className="text-[#71E0DC] truncate">{contact.email}</span><span className="text-zinc-500 truncate">{contact.sessionName || "Trivia"}</span></div>)}{!contacts.length && <p className="p-6 text-center text-sm text-zinc-500">When players choose Email me on the join screen, they will be stored here across sessions.</p>}</div></div></div></Panel><Panel title="Email and Player Updates" icon={MessageSquare}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a clue, cancellation, schedule change, or player update..." className="min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={sendUpdate} className="gradient-btn"><Send size={16} className="mr-2" />Send In-App</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email Draft</Button><Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Emails</Button></div></Panel><Panel title="Connected Pages" icon={ExternalLink}><div className="grid grid-cols-1 md:grid-cols-3 gap-3"><input value={socialLinks.facebook} onChange={(event) => updateSocialLink("facebook", event.target.value)} placeholder="Facebook page URL" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.instagram} onChange={(event) => updateSocialLink("instagram", event.target.value)} placeholder="Instagram profile URL" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.x} onChange={(event) => updateSocialLink("x", event.target.value)} placeholder="X/Twitter profile URL" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /></div><p className="text-xs text-zinc-500">Facebook posts can be copied and opened from the Clues tab. One-click publishing will require a Meta account connection.</p></Panel></section>;

const BrandingPanel = ({ branding, setBranding, onSave }) => {
  const safeBranding = normalizeBranding(branding);
  const update = (key, value) => setBranding((current) => ({ ...normalizeBranding(current), [key]: value }));
  const uploadLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file for the logo");
    update("logoUrl", await fileToDataUrl(file));
  };
  return <Panel title="Host Branding" icon={Palette}><div className="grid grid-cols-1 lg:grid-cols-[160px_1fr] gap-4"><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 flex flex-col items-center justify-center min-h-36">{safeBranding.logoUrl ? <img src={safeBranding.logoUrl} alt="Host logo preview" className="max-h-24 max-w-full rounded-md bg-white object-contain p-2" /> : <div className="h-24 w-24 rounded-md border border-white/10 bg-zinc-900 flex items-center justify-center text-zinc-500"><Image size={28} /></div>}<p className="mt-3 text-sm font-bold text-white text-center">{safeBranding.name || "Host Name"}</p></div><div className="space-y-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="text-xs text-zinc-400">Default host name<input value={safeBranding.name || ""} onChange={(event) => update("name", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="text-xs text-zinc-400">Default logo URL<input value={safeBranding.logoUrl || ""} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://..." className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"><label className="text-xs text-zinc-400">Upload logo<span className="mt-1 h-10 rounded-md border border-white/10 bg-zinc-950 px-3 text-zinc-200 flex items-center gap-2 cursor-pointer hover:border-[#71E0DC]/50"><Upload size={15} />Choose file<input type="file" accept="image/*" onChange={uploadLogo} className="hidden" /></span></label><ColorField label="Primary color" value={safeBranding.primaryColor} onChange={(value) => update("primaryColor", value)} /><ColorField label="Accent color" value={safeBranding.accentColor} onChange={(value) => update("accentColor", value)} /></div><div className="flex justify-end gap-2 flex-wrap"><Button variant="outline" onClick={() => setBranding(DEFAULT_BRANDING)} className="border-white/10 text-zinc-300 hover:text-white">Reset</Button><Button onClick={() => onSave(safeBranding)} className="text-zinc-950 font-semibold hover:opacity-90" style={{ background: `linear-gradient(90deg, ${safeBranding.primaryColor}, ${safeBranding.accentColor})` }}><Save size={16} className="mr-2" />Save Default Branding</Button></div><p className="text-xs text-zinc-500">This becomes the default for future live host screens. You can still override branding inside a specific session.</p></div></div></Panel>;
};

const ColorField = ({ label, value, onChange }) => { const safeValue = sanitizeHexColor(value, DEFAULT_BRANDING.primaryColor); return <label className="text-xs text-zinc-400">{label}<div className="mt-1 flex h-10 rounded-md border border-white/10 bg-zinc-950 overflow-hidden focus-within:border-[#71E0DC]/60"><input type="color" value={safeValue} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 border-0 bg-transparent p-1" /><input value={value || ""} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-white outline-none" /></div></label>; };

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeContacts = (contacts) => mergeContacts([], contacts);
const contactRowsFromPlayers = (players, session) => {
  const sessionName = session?.name || session?.session_name || "Trivia";
  return (Array.isArray(players) ? players : [])
    .filter((player) => player.updatePreference === "email" && normalizeEmail(player.updateContact))
    .map((player) => ({ name: player.name || "Team", email: normalizeEmail(player.updateContact), sessionName, joinedAt: player.joinedAt || new Date().toISOString() }));
};
const mergeContacts = (...lists) => {
  const map = new Map();
  lists.flatMap((list) => Array.isArray(list) ? list : []).forEach((contact) => {
    const email = normalizeEmail(contact?.email || contact?.updateContact);
    if (!email) return;
    const existing = map.get(email) || {};
    map.set(email, {
      ...existing,
      ...contact,
      email,
      name: contact?.name || contact?.playerName || existing.name || "Team",
      sessionName: contact?.sessionName || existing.sessionName || "Trivia",
      joinedAt: contact?.joinedAt || existing.joinedAt || "",
    });
  });
  return [...map.values()].sort((a, b) => String(b.joinedAt || "").localeCompare(String(a.joinedAt || "")) || a.email.localeCompare(b.email));
};

const mergeByKey = (remote, local, makeKey) => {
  const map = new Map();
  [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])].forEach((item) => {
    const key = makeKey(item);
    if (key) map.set(key, { ...(map.get(key) || {}), ...item });
  });
  return [...map.values()];
};

const persistPlayer = (sessionId, current, payload) => {
  const nextPlayer = { id: payload.playerId, name: payload.playerName || "Team", updatePreference: payload.updatePreference || "none", updateContact: payload.updateContact || "", joinedAt: payload.joinedAt };
  const next = current.some((player) => player.id === payload.playerId) ? current.map((player) => player.id === payload.playerId ? { ...player, ...nextPlayer } : player) : [...current, nextPlayer];
  writeJson(sessionStorageKey(sessionId, "players"), next);
  saveHostToolsSessionState(sessionId, { players: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};

const persistVote = (sessionId, key, current, payload, makeKey) => {
  const next = [...current.filter((item) => makeKey(item) !== makeKey(payload)), payload];
  writeJson(sessionStorageKey(sessionId, key), next);
  saveHostToolsSessionState(sessionId, { [key === "category-feedback" ? "categoryFeedback" : key]: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};

const persistIdea = (sessionId, current, payload) => {
  const next = [payload, ...current.filter((item) => !(item.playerId === payload.playerId && item.submittedAt === payload.submittedAt))].slice(0, 200);
  writeJson(sessionStorageKey(sessionId, "ideas"), next);
  saveHostToolsSessionState(sessionId, { ideas: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};

const persistAnswer = (sessionId, current, payload) => {
  const next = [...current.filter((answer) => !(answer.playerId === payload.playerId && Number(answer.questionIndex) === Number(payload.questionIndex))), payload].slice(-800);
  writeJson(sessionStorageKey(sessionId, "answers"), next);
  saveHostToolsSessionState(sessionId, { answers: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};

const persistActivity = (sessionId, current, payload) => {
  const next = [...current, payload].slice(-800);
  writeJson(sessionStorageKey(sessionId, "activity"), next);
  saveHostToolsSessionState(sessionId, { activity: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};

const summarize = (items, labelKey) => Object.values(items.reduce((groups, item) => {
  const label = item[labelKey] || "Unlabeled";
  if (!groups[label]) groups[label] = { label, likes: 0, dislikes: 0, votes: [] };
  if (item.sentiment === "like") groups[label].likes += 1;
  if (item.sentiment === "dislike") groups[label].dislikes += 1;
  groups[label].votes.push({
    playerId: item.playerId || "",
    playerName: item.playerName || "Team",
    sentiment: item.sentiment,
    submittedAt: item.submittedAt || "",
  });
  return groups;
}, {})).sort((a, b) => (b.likes + b.dislikes) - (a.likes + a.dislikes));

const getQuestionText = (question) => question?.question_text || question?.question || "";
const getQuestionType = (question) => question?.question_type || (question?.incorrect_answers ? "multiple_choice" : "written");
const getQuestionCategory = (question) => question?.category || "Uncategorized";
const getQuestionKey = (question, index) => String(question?.id || `${index}-${getQuestionText(question)}`);
const getQuestionAnswer = (question) => question?.correct_answer || question?.answer || "";
const getQuestionOptions = (question) => {
  const rawOptions = Array.isArray(question?.options) ? question.options : Array.isArray(question?.incorrect_answers) ? [...question.incorrect_answers, getQuestionAnswer(question)] : [];
  if (getQuestionType(question) === "true_false") return ["True", "False"];
  return [...new Set(rawOptions.map((option) => String(option || "").trim()).filter(Boolean))];
};
const answerKey = (answer) => `${answer.playerId}-${answer.questionIndex}`;
const percent = (value, total) => total > 0 ? Math.round((value / total) * 100) : 0;
const compactLabel = (value, fallback = "Unknown") => String(value || fallback).replace(/\s+/g, " ").trim();
const sortByTotal = (rows) => [...rows].sort((a, b) => (b.total || 0) - (a.total || 0));
const scoreRows = (rows) => [...rows].map((row) => ({ ...row, score: Number(row.likes || 0) - Number(row.dislikes || 0), total: Number(row.likes || 0) + Number(row.dislikes || 0) }));
const estimateSessionDuration = (activity, answers) => {
  const times = [...(Array.isArray(activity) ? activity : []), ...(Array.isArray(answers) ? answers : [])]
    .map((item) => new Date(item.submittedAt || item.sentAt || item.joinedAt || item.at || item.createdAt || "").getTime())
    .filter((time) => Number.isFinite(time));
  if (times.length < 2) return "";
  const minutes = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const makeReviewNotes = ({ categoryRows, weakQuestions, tooEasy, tooDifficult, highestRatedCategory, easiestQuestion, hardestQuestion, teamStats }) => {
  const likedCategories = categoryRows.filter((row) => row.score > 0).slice(0, 3).map((row) => row.label);
  const strugglingCategories = categoryRows.filter((row) => row.score < 0).slice(0, 3).map((row) => row.label);
  const spread = teamStats.length > 1 ? Number(teamStats[0]?.score || 0) - Number(teamStats[teamStats.length - 1]?.score || 0) : 0;
  return [
    { title: "Categories players enjoyed", body: likedCategories.length ? `${likedCategories.join(", ")} got the strongest positive signals. Bring one of these vibes back, but rotate the exact category wording.` : highestRatedCategory ? `${highestRatedCategory.label} had the best category score.` : "No category winner yet. Use next show to collect round-intro feedback." },
    { title: "Categories that struggled", body: strugglingCategories.length ? `${strugglingCategories.join(", ")} drew more negative feedback. Reframe these, make them more general, or pair them with easier clueing.` : "No category clearly struggled from feedback." },
    { title: "Questions to rewrite", body: weakQuestions.length ? `${weakQuestions.length} question${weakQuestions.length === 1 ? "" : "s"} need review based on dislikes, low response rate, or difficulty.` : "No obvious weak questions from the saved signals." },
    { title: "Balance suggestion", body: tooEasy.length && tooDifficult.length ? "You had both softballs and stumpers. Keep that range, but avoid stacking the hardest questions in the same round." : tooDifficult.length ? `The hardest question landed at ${hardestQuestion?.correctPercent ?? 0}% correct. Add more footholds or switch a few written questions to multiple choice.` : tooEasy.length ? `The easiest question landed at ${easiestQuestion?.correctPercent ?? 0}% correct. Add a twist or save these as warm-up material.` : "Difficulty looks fairly balanced from the available answer data." },
    { title: "Next show recommendation", body: spread > 600 ? "Scores had a wide spread. Add more mid-level questions next week so more teams stay in range longer." : "Scores look close enough to keep the room engaged. Build next week with a similar mix and fresh categories from your approved list." },
  ];
};

const buildAnalytics = ({ selectedSession, players, feedback, categoryFeedback, playerIdeas, answers, activity, emailPlayers, leaderboard, gradedAnswers }) => {
  const questions = sessionQuestions(selectedSession);
  const questionRows = questions.map((question, index) => {
    const text = compactLabel(getQuestionText(question), `Question ${index + 1}`);
    const votes = feedback.filter((item) => Number(item.questionIndex) === index || item.questionText === text);
    const responses = answers.filter((answer) => Number(answer.questionIndex) === index);
    const correctResponses = responses.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct").length;
    const options = getQuestionOptions(question);
    const answerGroups = Object.values(responses.reduce((groups, answer) => {
      const label = compactLabel(answer.answer, "Blank");
      if (!groups[label]) groups[label] = { label, total: 0, correct: false };
      groups[label].total += 1;
      if (gradedAnswers[answerKey(answer)]?.status === "correct" || label.toLowerCase() === compactLabel(getQuestionAnswer(question)).toLowerCase()) groups[label].correct = true;
      return groups;
    }, {}));
    const optionRows = (options.length ? options : answerGroups.map((row) => row.label)).map((option) => {
      const match = answerGroups.find((row) => row.label === option);
      return { label: option, total: match?.total || 0, correct: match?.correct || compactLabel(option).toLowerCase() === compactLabel(getQuestionAnswer(question)).toLowerCase(), percent: percent(match?.total || 0, responses.length) };
    });
    const extraRows = answerGroups.filter((row) => !optionRows.some((option) => option.label === row.label)).map((row) => ({ ...row, percent: percent(row.total, responses.length) }));
    return {
      key: getQuestionKey(question, index),
      label: text,
      index,
      category: getQuestionCategory(question),
      type: getQuestionType(question),
      answer: getQuestionAnswer(question),
      likes: votes.filter((item) => item.sentiment === "like").length,
      dislikes: votes.filter((item) => item.sentiment === "dislike").length,
      responses: responses.length,
      correct: correctResponses,
      correctPercent: percent(correctResponses, responses.length),
      responseRate: percent(responses.length, players.length),
      optionRows: [...optionRows, ...extraRows].sort((a, b) => b.total - a.total),
    };
  });

  const categoryRows = scoreRows(summarize(categoryFeedback, "category"));
  const questionVoteRows = scoreRows(questionRows);
  const answeredQuestionIndexes = new Set(answers.map((answer) => Number(answer.questionIndex)));
  const answerRows = answers.map((answer) => {
    const questionIndex = Number(answer.questionIndex);
    const question = questions[questionIndex] || {};
    const grade = gradedAnswers[answerKey(answer)] || {};
    return {
      key: `${answer.playerId}-${answer.questionIndex}-${answer.submittedAt || ""}`,
      questionIndex,
      question: compactLabel(getQuestionText(question) || answer.questionText, `Question ${questionIndex + 1}`),
      team: answer.playerName || players.find((player) => player.id === answer.playerId)?.name || "Team",
      answer: compactLabel(answer.answer, "Blank"),
      correct: grade.status || "ungraded",
      points: Number(grade.points || 0),
      wager: answer.wagerMode ? Number(answer.wagerAmount || 0) : null,
      seconds: answer.responseSeconds ?? answer.secondsToSubmit ?? answer.elapsedSeconds ?? null,
      submittedAt: answer.submittedAt || "",
    };
  }).sort((a, b) => a.questionIndex - b.questionIndex || String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const rankingSource = Array.isArray(leaderboard) && leaderboard.length ? leaderboard : players;
  const teamStats = rankingSource.map((team) => {
    const teamAnswers = answers.filter((answer) => answer.playerId === team.id);
    const correct = teamAnswers.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct").length;
    return { id: team.id, name: team.name || "Team", score: Number(team.score || 0), answered: teamAnswers.length, correct, correctPercent: percent(correct, questions.length) };
  }).sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name));
  const typeMix = sortByTotal(Object.values(questions.reduce((groups, question) => {
    const label = getQuestionType(question).replace("_", "/");
    if (!groups[label]) groups[label] = { label, total: 0 };
    groups[label].total += 1;
    return groups;
  }, {})));
  const categoryMix = sortByTotal(Object.values(questions.reduce((groups, question) => {
    const label = getQuestionCategory(question);
    if (!groups[label]) groups[label] = { label, total: 0 };
    groups[label].total += 1;
    return groups;
  }, {}))).slice(0, 8);
  const exitCounts = Object.values(activity.filter((item) => item.eventType === "left_screen").reduce((groups, item) => {
    const label = item.playerName || item.playerId || "Team";
    if (!groups[label]) groups[label] = { label, total: 0 };
    groups[label].total += 1;
    return groups;
  }, {})).sort((a, b) => b.total - a.total);
  const averageScore = teamStats.length ? Math.round(teamStats.reduce((sum, team) => sum + Number(team.score || 0), 0) / teamStats.length) : 0;
  const completedRows = questionRows.filter((row) => row.responses > 0);
  const easiestQuestion = [...completedRows].sort((a, b) => b.correctPercent - a.correctPercent || b.responses - a.responses)[0] || null;
  const hardestQuestion = [...completedRows].sort((a, b) => a.correctPercent - b.correctPercent || b.responses - a.responses)[0] || null;
  const mostSkipped = [...questionRows].sort((a, b) => a.responseRate - b.responseRate || b.responses - a.responses).slice(0, 5);
  const tooEasy = completedRows.filter((row) => row.correctPercent >= 85).sort((a, b) => b.correctPercent - a.correctPercent).slice(0, 5);
  const tooDifficult = completedRows.filter((row) => row.correctPercent > 0 && row.correctPercent <= 35).sort((a, b) => a.correctPercent - b.correctPercent).slice(0, 5);
  const weakQuestions = questionRows.filter((row) => row.dislikes > row.likes || (row.responses > 0 && row.correctPercent <= 35) || row.responseRate < 50).sort((a, b) => b.dislikes - a.dislikes || a.correctPercent - b.correctPercent).slice(0, 6);
  const bestPerforming = completedRows.filter((row) => row.correctPercent >= 45 && row.correctPercent <= 80).sort((a, b) => b.likes - a.likes || b.responses - a.responses).slice(0, 5);
  const mostLiked = questionVoteRows.filter((row) => row.likes > 0).sort((a, b) => b.likes - a.likes || b.score - a.score).slice(0, 5);
  const highestRatedCategory = [...categoryRows].sort((a, b) => b.score - a.score || b.likes - a.likes)[0] || null;
  const sessionDuration = estimateSessionDuration(activity, answers);
  const reviewNotes = makeReviewNotes({ categoryRows, weakQuestions, tooEasy, tooDifficult, highestRatedCategory, easiestQuestion, hardestQuestion, teamStats });

  return {
    totals: {
      players: players.length,
      emailOptIns: emailPlayers.length,
      questions: questions.length,
      answers: answers.length,
      answerCoverage: percent(answeredQuestionIndexes.size, questions.length),
      questionVotes: feedback.length,
      categoryVotes: categoryFeedback.length,
      ideas: playerIdeas.length,
      screenExits: activity.filter((item) => item.eventType === "left_screen").length,
      averageScore,
      sessionDuration,
    },
    summary: { easiestQuestion, hardestQuestion, highestRatedCategory },
    performance: { bestPerforming, weakQuestions, tooEasy, tooDifficult, mostSkipped, mostLiked },
    reviewNotes,
    topQuestions: questionVoteRows.filter((row) => row.total > 0).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, 5),
    needsReview: questionVoteRows.filter((row) => row.total > 0 || row.responses > 0).sort((a, b) => a.score - b.score || b.dislikes - a.dislikes).slice(0, 5),
    categoryRows,
    questionRows,
    answerRows,
    teamStats,
    typeMix,
    categoryMix,
    responseRows: questionRows.filter((row) => row.responses > 0).sort((a, b) => b.responses - a.responses).slice(0, 6),
    exitCounts: exitCounts.slice(0, 5),
  };
};

const AnalyticsPanel = ({ analytics }) => {
  const totalVotes = analytics.totals.questionVotes + analytics.totals.categoryVotes;
  return <section className="space-y-6"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><AnalyticsMetric icon={Users} label="Players" value={analytics.totals.players} sub={`${analytics.totals.emailOptIns} email opt-in${analytics.totals.emailOptIns === 1 ? "" : "s"}`} /><AnalyticsMetric icon={MessageSquare} label="Feedback" value={totalVotes} sub={`${analytics.totals.questionVotes} question / ${analytics.totals.categoryVotes} category`} /><AnalyticsMetric icon={TrendingUp} label="Answers" value={analytics.totals.answers} sub={`${analytics.totals.answerCoverage}% question coverage`} /><AnalyticsMetric icon={Lightbulb} label="Ideas" value={analytics.totals.ideas} sub={`${analytics.totals.screenExits} screen exit flag${analytics.totals.screenExits === 1 ? "" : "s"}`} /></div><div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><AnalyticsList title="Questions Players Liked" icon={ThumbsUp} rows={analytics.topQuestions} empty="Question likes will appear here after players rate live questions." render={(row) => <FeedbackAnalyticsRow row={row} />} /><AnalyticsList title="Needs Review" icon={ThumbsDown} rows={analytics.needsReview} empty="Questions with dislikes, low response, or poor feedback will appear here." render={(row) => <FeedbackAnalyticsRow row={row} showResponses />} /><AnalyticsList title="Category Pulse" icon={BarChart3} rows={analytics.categoryRows.slice(0, 8)} empty="Category feedback appears after players rate round info." render={(row) => <SimpleScoreRow row={row} />} /><AnalyticsList title="Answer Volume" icon={TrendingUp} rows={analytics.responseRows} empty="Submitted answer counts will appear during live phone play." render={(row) => <ResponseRow row={row} players={analytics.totals.players} />} /></div><div className="grid grid-cols-1 xl:grid-cols-3 gap-6"><AnalyticsList title="Question Type Mix" icon={BarChart3} rows={analytics.typeMix} empty="No session questions found." render={(row) => <ProgressRow row={row} total={analytics.totals.questions} />} /><AnalyticsList title="Category Mix" icon={MessageSquare} rows={analytics.categoryMix} empty="No categories found in this session." render={(row) => <ProgressRow row={row} total={analytics.totals.questions} />} /><AnalyticsList title="Fair Play Signals" icon={Users} rows={analytics.exitCounts} empty="Screen-exit signals will appear here when phone play is live." render={(row) => <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/60 p-3"><span className="font-semibold text-zinc-200 truncate">{row.label}</span><Badge className="bg-amber-500/15 text-amber-200">{row.total} exits</Badge></div>} /></div></section>;
};

const AnalyticsMetric = ({ icon: Icon, label, value, sub }) => <Card className="glass-card"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-zinc-500 font-bold">{label}</p><p className="mt-2 text-3xl font-black text-white">{value}</p><p className="mt-1 text-xs text-zinc-500">{sub}</p></div><Icon className="text-[#71E0DC]" size={24} /></div></CardContent></Card>;
const AnalyticsList = ({ title, icon: Icon, rows, empty, render }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Icon className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-3 max-h-[460px] overflow-y-auto">{rows.map((row, index) => <div key={`${row.label}-${index}`}>{render(row)}</div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">{empty}</p>}</CardContent></Card>;
const FeedbackAnalyticsRow = ({ row, showResponses = false }) => <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-sm font-semibold text-zinc-200 line-clamp-2">{row.label}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">{row.category}</Badge><Badge className="bg-zinc-800 text-zinc-300">{row.type?.replace("_", "/")}</Badge>{showResponses && <Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{row.responses} answers</Badge>}</div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><MiniStat label="Likes" value={row.likes} tone="like" /><MiniStat label="Dislikes" value={row.dislikes} tone="dislike" /><MiniStat label="Score" value={row.score} /></div></div>;
const SimpleScoreRow = ({ row }) => <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-200 truncate">{row.label}</p><Badge className={row.score >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}>{row.score >= 0 ? "+" : ""}{row.score}</Badge></div><div className="mt-3 grid grid-cols-2 gap-2 text-center"><MiniStat label="Likes" value={row.likes} tone="like" /><MiniStat label="Dislikes" value={row.dislikes} tone="dislike" /></div></div>;
const ResponseRow = ({ row, players }) => <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-zinc-200 line-clamp-2">{row.label}</p><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF] shrink-0">{row.responses}/{players || 0}</Badge></div><div className="mt-3 h-2 rounded-full bg-zinc-900 overflow-hidden"><div className="h-full rounded-full bg-[#AEB2EF]" style={{ width: `${players ? Math.min(100, (row.responses / players) * 100) : 0}%` }} /></div></div>;
const ProgressRow = ({ row, total }) => <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-zinc-200 truncate capitalize">{row.label}</p><span className="text-sm font-black text-white">{row.total}</span></div><div className="mt-3 h-2 rounded-full bg-zinc-900 overflow-hidden"><div className="h-full rounded-full bg-[#71E0DC]" style={{ width: `${total ? Math.min(100, (row.total / total) * 100) : 0}%` }} /></div></div>;
const MiniStat = ({ label, value, tone }) => <div className={`rounded-md border p-2 ${tone === "like" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : tone === "dislike" ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-white/10 bg-zinc-900 text-zinc-200"}`}><p className="text-[11px] text-zinc-500">{label}</p><p className="text-lg font-black">{value}</p></div>;

const FeedbackCard = ({ title, rows, empty }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Sparkles className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-2 max-h-[560px] overflow-y-auto">{rows.map((row) => <div key={row.label} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-sm font-semibold text-zinc-200 mb-2 line-clamp-2">{row.label}</p><div className="grid grid-cols-1 gap-2"><FeedbackVoteList row={row} sentiment="like" label="Likes" count={row.likes} /><FeedbackVoteList row={row} sentiment="dislike" label="Dislikes" count={row.dislikes} /></div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">{empty}</p>}</CardContent></Card>;

const FeedbackVoteList = ({ row, sentiment, label, count }) => {
  const votes = (row.votes || []).filter((vote) => vote.sentiment === sentiment).sort((a, b) => String(a.submittedAt || "").localeCompare(String(b.submittedAt || "")));
  const tone = sentiment === "like" ? "emerald" : "red";
  const badgeClass = tone === "emerald" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-red-500/15 text-red-300 border border-red-500/20";
  const shellClass = tone === "emerald" ? "border-emerald-500/20 bg-emerald-500/10" : "border-red-500/20 bg-red-500/10";
  return <div className={`rounded-md border p-2 ${shellClass}`}><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p><Badge className={badgeClass}>{count}</Badge></div>{votes.length ? <div className="flex flex-wrap gap-1.5">{votes.map((vote, index) => <span key={`${vote.playerId || vote.playerName}-${vote.submittedAt || index}`} title={formatDateTime(vote.submittedAt)} className="rounded-full border border-white/10 bg-zinc-950/70 px-2 py-1 text-xs font-semibold text-zinc-200">{vote.playerName || "Team"}</span>)}</div> : <p className="text-xs text-zinc-600">No teams</p>}</div>;
};

const IdeasFeedbackCard = ({ ideas }) => <Card className="glass-card xl:col-span-2"><CardHeader><CardTitle className="text-white flex items-center gap-2"><MessageSquare className="text-[#71E0DC]" />End-of-Session Ideas</CardTitle></CardHeader><CardContent className="space-y-3 max-h-[520px] overflow-y-auto">{ideas.map((idea, index) => <div key={`${idea.playerId}-${idea.submittedAt}-${index}`} className="rounded-lg border border-white/10 bg-zinc-950/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><p className="font-bold text-white">{idea.playerName || "Team"}</p><p className="text-xs text-zinc-500">{formatDateTime(idea.submittedAt)}</p></div>{idea.category && <p className="text-sm text-zinc-300"><span className="text-[#71E0DC] font-semibold">Category idea:</span> {idea.category}</p>}{idea.question && <p className="text-sm text-zinc-300 mt-2"><span className="text-[#AEB2EF] font-semibold">Question idea:</span> {idea.question}</p>}</div>)}{!ideas.length && <p className="text-sm text-zinc-500 text-center py-8">Player category and question ideas from the post-game feedback screen will appear here.</p>}</CardContent></Card>;

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const formatAnswerTime = (row) => {
  if (row.seconds !== null && row.seconds !== undefined && row.seconds !== "") return `${Number(row.seconds).toFixed(1)}s`;
  if (!row.submittedAt) return "-";
  const date = new Date(row.submittedAt);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export default HostTools;
