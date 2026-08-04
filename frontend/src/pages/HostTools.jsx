import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { BarChart3, CheckCircle, Clock, Copy, ExternalLink, Loader2, Mail, MessageSquare, Pencil, Send, Sparkles, ThumbsDown, ThumbsUp, Trash2, TrendingUp, Upload, Users, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { loadHostToolsSessionState, profileKeys, saveHostToolsSessionState, saveProfileValue, syncProfileJson } from "../lib/profileState";
import { buildClueStyleExamples, deleteCluePost, extractCluePostFromImage, logCluePost, readClueHistory, syncClueHistory, updateCluePostSession, updateCluePostText } from "../lib/clueHistory";
import { imageBlobToDataUrl } from "../lib/mediaUpload";
import { dedupeCategories } from "../lib/categories";
import { useCopilot } from "../context/CopilotContext";

const SOCIAL_STORAGE_KEY = "quiz-crafter-social-links";
const OUTREACH_CONTACTS_STORAGE_KEY = "quiz-crafter-outreach-contacts-v1";
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep tools usable if browser storage is full. */ } };
const sessionStorageKey = (sessionId, name) => `quiz-crafter-host-tools-${sessionId}-${name}`;
// Headcounts used to be a single number; treat an old plain number as the
// adults count so a session tracked before the adults/kids split isn't lost.
const normalizeHeadcount = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return { adults: value.adults ?? "", kids: value.kids ?? "" };
  if (value === undefined || value === null || value === "") return { adults: "", kids: "" };
  return { adults: value, kids: "" };
};
const sessionQuestions = (session) => [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions].flatMap((value) => Array.isArray(value) ? value : []);
const hostToolTabs = [
  { key: "feedback", label: "Session Review", icon: BarChart3 },
  { key: "game", label: "Game Data", icon: TrendingUp },
  { key: "communications", label: "Communications", icon: Mail },
  { key: "clues", label: "Clues", icon: Sparkles },
];

const HostTools = () => {
  const { updatePageContext } = useCopilot();
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
  const [clueHistory, setClueHistory] = useState(() => readClueHistory());
  const [attendance, setAttendance] = useState({ nonPlayers: { adults: "", kids: "" }, teamHeadcounts: {} });
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef(null);
  const loadedDraftSessionRef = useRef("");
  const loadedAttendanceSessionRef = useRef("");

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

  // The FloatingCopilot chat had no idea what clue it had just drafted or
  // which questions it was based on -- it only ever saw a coarse, page-agnostic
  // build summary, never what's actually on screen. Push the live Clue Builder
  // state so a follow-up like "this is missing the Oktoberfest question" is
  // grounded in the real selection and draft instead of starting from nothing.
  useEffect(() => {
    const selectedClueQuestions = clueQuestionRows.filter((question) => selectedClueKeys.includes(question.key));
    updatePageContext({
      goal: "Help draft and refine the social post teaser for this trivia session",
      hostHub: {
        activeTab,
        sessionName: selectedSession?.name || selectedSession?.session_name || "",
        clueDirection: aiDirection,
        selectedClueQuestions: selectedClueQuestions.map((question) => ({ category: question.category, question: question.question, answer: question.answer })),
        draftedSocialPost: socialPost,
      },
    });
  }, [activeTab, aiDirection, clueQuestionRows, selectedClueKeys, selectedSession, socialPost, updatePageContext]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (hostToolTabs.some((item) => item.key === tab)) setActiveTab(tab);
  }, [searchParams]);

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
    const runSyncClueHistory = async () => {
      try {
        setClueHistory(await syncClueHistory());
      } catch (error) {
        console.warn("Clue history sync unavailable:", error);
      }
    };
    runSyncClueHistory();
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
        const hostedResults = getHostedResultsSnapshot(selectedSession);
        const snapshot = profileState.results && typeof profileState.results === "object" ? { ...profileState, ...profileState.results } : profileState;
        const drafts = { ...localDrafts, ...(profileState.drafts && typeof profileState.drafts === "object" ? profileState.drafts : {}) };
        const nextState = {
          players: mergeManyByKey((item) => item.id, hostedResults.players, snapshot.players, localState.players),
          feedback: mergeManyByKey((item) => `${item.playerId}-${item.questionIndex}`, hostedResults.feedback, snapshot.feedback, localState.feedback),
          categoryFeedback: mergeManyByKey((item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`, hostedResults.categoryFeedback, snapshot.categoryFeedback, localState.categoryFeedback),
          ideas: mergeManyByKey((item) => `${item.playerId}-${item.submittedAt}`, hostedResults.ideas, snapshot.ideas, localState.ideas),
          answers: mergeManyByKey((item) => `${item.playerId}-${item.questionIndex}`, hostedResults.answers, snapshot.answers, localState.answers),
          activity: [...(Array.isArray(hostedResults.activity) ? hostedResults.activity : []), ...(Array.isArray(snapshot.activity) ? snapshot.activity : []), ...(Array.isArray(localState.activity) ? localState.activity : [])].slice(-800),
          leaderboard: mergeManyByKey((item) => item.id, hostedResults.leaderboard, snapshot.leaderboard, localState.leaderboard),
          gradedAnswers: { ...(hostedResults.gradedAnswers && typeof hostedResults.gradedAnswers === "object" ? hostedResults.gradedAnswers : {}), ...(snapshot.gradedAnswers && typeof snapshot.gradedAnswers === "object" ? snapshot.gradedAnswers : {}), ...(localState.gradedAnswers && typeof localState.gradedAnswers === "object" ? localState.gradedAnswers : {}) },
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
        const hostedResults = getHostedResultsSnapshot(selectedSession);
        const fallbackState = {
          players: mergeManyByKey((item) => item.id, hostedResults.players, localState.players),
          feedback: mergeManyByKey((item) => `${item.playerId}-${item.questionIndex}`, hostedResults.feedback, localState.feedback),
          categoryFeedback: mergeManyByKey((item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`, hostedResults.categoryFeedback, localState.categoryFeedback),
          ideas: mergeManyByKey((item) => `${item.playerId}-${item.submittedAt}`, hostedResults.ideas, localState.ideas),
          answers: mergeManyByKey((item) => `${item.playerId}-${item.questionIndex}`, hostedResults.answers, localState.answers),
          activity: [...(Array.isArray(hostedResults.activity) ? hostedResults.activity : []), ...(Array.isArray(localState.activity) ? localState.activity : [])].slice(-800),
          leaderboard: mergeManyByKey((item) => item.id, hostedResults.leaderboard, localState.leaderboard),
          gradedAnswers: { ...(hostedResults.gradedAnswers && typeof hostedResults.gradedAnswers === "object" ? hostedResults.gradedAnswers : {}), ...(localState.gradedAnswers && typeof localState.gradedAnswers === "object" ? localState.gradedAnswers : {}) },
        };
        setPlayers(fallbackState.players);
        setFeedback(fallbackState.feedback);
        setCategoryFeedback(fallbackState.categoryFeedback);
        setPlayerIdeas(fallbackState.ideas);
        setAnswers(fallbackState.answers);
        setActivity(fallbackState.activity);
        setLeaderboard(fallbackState.leaderboard);
        setGradedAnswers(fallbackState.gradedAnswers);
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
  // Same feedback-loop hazard as the attendance effect below: this reloads
  // (and overwrites) message/socialPost/aiDirection and the players/feedback
  // state from storage, so it must only run when the host actually switches
  // sessions -- not on every incidental `selectedSession` reference change
  // (e.g. the attendance autosave writing back into `sessions`), or it can
  // clobber an AI-drafted clue that hasn't been persisted yet with the
  // previous (often empty) saved draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!selectedSessionId) return;
    const saved = selectedSession?.attendance && typeof selectedSession.attendance === "object" ? selectedSession.attendance : {};
    const savedTeamHeadcounts = saved.teamHeadcounts && typeof saved.teamHeadcounts === "object" ? saved.teamHeadcounts : {};
    loadedAttendanceSessionRef.current = "";
    // Bar headcount used to be one manually-entered number covering everyone
    // in the building; it's now derived (non-players + playing), so an old
    // session's value becomes the non-players starting point.
    setAttendance({
      nonPlayers: normalizeHeadcount(saved.nonPlayers ?? saved.barHeadcount),
      teamHeadcounts: Object.fromEntries(Object.entries(savedTeamHeadcounts).map(([teamId, value]) => [teamId, normalizeHeadcount(value)])),
    });
    loadedAttendanceSessionRef.current = selectedSessionId;
  // Depending on `selectedSession` itself (instead of just the id) used to
  // create a feedback loop: saving attendance below writes the result back
  // into `sessions` via setSessions, which gives `selectedSession` (derived
  // from `sessions`) a new object reference every time even though nothing
  // a host did changed -- which re-ran this effect, which reset `attendance`
  // to a new object, which re-triggered the save effect below, forever.
  // Every trip around that loop also re-ran the drafts/players/feedback load
  // effect above (same dependency mistake), silently overwriting a freshly
  // AI-drafted clue with whatever was last durably saved before it finished
  // saving. Keying this on the session id only breaks the loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || loadedAttendanceSessionRef.current !== selectedSessionId) return undefined;
    const timeout = window.setTimeout(() => {
      supabase.from("sessions").update({ attendance }).eq("id", selectedSessionId).then(({ error }) => {
        if (error) return console.warn("Attendance save unavailable:", error);
        setSessions((prev) => prev.map((session) => session.id === selectedSessionId ? { ...session, attendance } : session));
      });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [selectedSessionId, attendance]);

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

  // Logged here, not at draft time -- copying/opening a post is the host's
  // signal that this text (edits included) is the one they're actually
  // using, so the history (and the style future drafts learn from) reflects
  // real published posts rather than every rough first draft.
  const logCurrentClue = () => {
    const selectedQuestions = clueQuestionRows.filter((question) => selectedClueKeys.includes(question.key));
    logCluePost({
      sessionName: selectedSession?.name || selectedSession?.session_name || "",
      socialPost,
      categories: dedupeCategories(selectedQuestions.map((question) => question.category)),
    }).then(setClueHistory).catch((error) => console.warn("Clue history log unavailable:", error));
  };

  const copySocialPost = async () => {
    const text = socialPost.trim();
    if (!text) return toast.error("Write or generate a post first");
    await navigator.clipboard.writeText(text);
    toast.success("Social post copied");
    logCurrentClue();
  };

  const openSocialComposer = async (network) => {
    const rawText = socialPost.trim() || "Trivia update";
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
    logCurrentClue();
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
        body: JSON.stringify({ sessionName: selectedSession.name || selectedSession.session_name, direction: aiDirection, questions, pastPosts: buildClueStyleExamples(clueHistory) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Could not generate clues");
      setSocialPost(data.social_post || "");
      toast.success("AI drafted a social post");
    } catch (error) {
      toast.error(error.message || "Could not generate clues");
    } finally {
      setGenerating(false);
    }
  };

  const reassignCluePost = async (entryId, sessionName) => {
    setClueHistory(await updateCluePostSession(entryId, sessionName));
  };

  const editCluePost = async (entryId, socialPost) => {
    setClueHistory(await updateCluePostText(entryId, socialPost));
  };

  const removeCluePost = async (entryId) => {
    if (!window.confirm("Delete this past clue? This can't be undone.")) return;
    setClueHistory(await deleteCluePost(entryId));
  };

  // Archives a clue that was already posted (or posted before this feature
  // existed) straight into history from a screenshot, instead of only
  // logging clues drafted in-app -- so style-matching for future drafts can
  // learn from everything the host has actually published.
  const addManualCluePost = async ({ sessionName, text }) => {
    const next = await logCluePost({ sessionName, message: text, socialPost: text, categories: [] });
    setClueHistory(next);
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

      <div className="mb-6 flex flex-wrap gap-2">{hostToolTabs.map((tab) => { const TabIcon = tab.icon; return <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition ${activeTab === tab.key ? "border-[#71E0DC]/50 bg-[#71E0DC]/10 text-white" : "border-white/10 text-zinc-400 hover:text-white hover:border-white/20"}`}><TabIcon size={15} />{tab.label}</button>; })}</div>

      {activeTab === "feedback" && <HostReviewWorkspace selectedSession={selectedSession} analytics={analytics} questionFeedback={questionFeedback} categoryRows={categoryRows} playerIdeas={playerIdeas} exportResults={exportResults} attendance={attendance} setAttendance={setAttendance} />}
      {activeTab === "game" && <GameDataPanel analytics={analytics} />}
      {activeTab === "communications" && <div className="space-y-6 max-w-6xl"><FollowUpPanel message={message} setMessage={setMessage} sendUpdate={sendUpdate} openEmailDraft={openEmailDraft} copyEmails={copyEmails} contactsCount={allEmailContacts.length} scheduleNextShow={scheduleNextShow} buildNextSession={buildNextSession} /><OutreachPanel message={message} setMessage={setMessage} sendUpdate={sendUpdate} openEmailDraft={openEmailDraft} copyEmails={copyEmails} contacts={allEmailContacts} sessionEmailCount={emailPlayers.length} socialLinks={socialLinks} updateSocialLink={updateSocialLink} /></div>}
      {activeTab === "clues" && <CluesPanel aiDirection={aiDirection} setAiDirection={setAiDirection} generateClues={generateClues} generating={generating} selectedSession={selectedSession} clueQuestionRows={clueQuestionRows} selectedClueKeys={selectedClueKeys} setSelectedClueKeys={setSelectedClueKeys} socialPost={socialPost} setSocialPost={setSocialPost} copySocialPost={copySocialPost} openSocialComposer={openSocialComposer} socialLinks={socialLinks} clueHistory={clueHistory} sessions={sessions} reassignCluePost={reassignCluePost} addManualCluePost={addManualCluePost} editCluePost={editCluePost} removeCluePost={removeCluePost} />}
    </div>
  );
};

const Panel = ({ title, icon: Icon, children }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Icon className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;

const HostReviewWorkspace = ({ selectedSession, analytics, questionFeedback, categoryRows, playerIdeas, exportResults, attendance, setAttendance }) => {
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedQuestionKey, setSelectedQuestionKey] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [teamRoundFilter, setTeamRoundFilter] = useState("all");
  const [teamCategoryFilter, setTeamCategoryFilter] = useState("all");
  const summary = analytics.summary || {};
  const teams = analytics.teamStats || [];
  const questions = analytics.questionRows || [];
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || teams[0] || null;
  const selectedQuestion = questions.find((question) => question.key === selectedQuestionKey) || questions[0] || null;
  const roundOptions = [...new Set((selectedTeam?.answers || []).map((answer) => answer.roundName).filter(Boolean))];
  const categoryOptions = [...new Set((selectedTeam?.answers || []).map((answer) => answer.category).filter(Boolean))];
  const filteredTeamAnswers = (selectedTeam?.answers || []).filter((answer) => (teamFilter === "all" || answer.status === teamFilter) && (teamRoundFilter === "all" || answer.roundName === teamRoundFilter) && (teamCategoryFilter === "all" || answer.category === teamCategoryFilter));
  const sessionName = selectedSession?.name || selectedSession?.session_name || "Selected session";
  const venue = selectedSession?.venue_name || selectedSession?.venue || selectedSession?.venueName || "No venue saved";
  const sessionDate = formatSessionDate(selectedSession);
  const strongestTeam = [...teams].sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)[0];
  const difficultRound = mostDifficultRound(questions);
  const wrongPatterns = commonWrongAnswers(questions);
  const teamHeadcounts = attendance?.teamHeadcounts || {};
  const nonPlayers = normalizeHeadcount(attendance?.nonPlayers);
  const playingTotals = teams.reduce((sum, team) => { const hc = normalizeHeadcount(teamHeadcounts[team.id]); sum.adults += Number(hc.adults) || 0; sum.kids += Number(hc.kids) || 0; return sum; }, { adults: 0, kids: 0 });
  const totalPlaying = playingTotals.adults + playingTotals.kids;
  const headcountsEntered = teams.some((team) => { const hc = normalizeHeadcount(teamHeadcounts[team.id]); return Number(hc.adults) > 0 || Number(hc.kids) > 0; });
  const nonPlayersEntered = Number(nonPlayers.adults) > 0 || Number(nonPlayers.kids) > 0;
  const barTotals = { adults: playingTotals.adults + (Number(nonPlayers.adults) || 0), kids: playingTotals.kids + (Number(nonPlayers.kids) || 0) };
  const barTotalEntered = headcountsEntered || nonPlayersEntered;
  const updateTeamHeadcount = (teamId, field, value) => setAttendance((current) => ({ ...current, teamHeadcounts: { ...current.teamHeadcounts, [teamId]: { ...normalizeHeadcount(current.teamHeadcounts[teamId]), [field]: value } } }));
  const updateNonPlayers = (field, value) => setAttendance((current) => ({ ...current, nonPlayers: { ...normalizeHeadcount(current.nonPlayers), [field]: value } }));

  return <section className="space-y-6"><Panel title="Session Overview" icon={BarChart3}><div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4"><div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-[#71E0DC]">{venue}</p><h2 className="mt-1 text-2xl font-black text-white">{sessionName}</h2><p className="mt-1 text-sm text-zinc-500">{sessionDate}</p></div><Badge className="w-fit bg-zinc-800 text-zinc-300">{analytics.totals.sessionDuration || "Duration not tracked"}</Badge></div></div><div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><ReviewMetric label="Teams" value={analytics.totals.players} sub="participated" /><ReviewMetric label="Questions" value={analytics.totals.questions} sub="in session" /><ReviewMetric label="Average Score" value={analytics.totals.averageScore} sub="per team" /><ReviewMetric label="Session Accuracy" value={`${analytics.totals.overallAccuracy || 0}%`} sub="graded answers" /><ReviewMetric label="Highest Score" value={teams[0]?.name || "-"} sub={teams[0] ? `${teams[0].score} points` : "No scores"} /><ReviewMetric label="Hardest" value={summary.hardestQuestion ? `${summary.hardestQuestion.correctPercent}%` : "-"} sub={summary.hardestQuestion?.category || "No answers"} /><ReviewMetric label="Easiest" value={summary.easiestQuestion ? `${summary.easiestQuestion.correctPercent}%` : "-"} sub={summary.easiestQuestion?.category || "No answers"} /><ReviewMetric label="Most Accurate" value={strongestTeam?.name || "-"} sub={strongestTeam ? `${strongestTeam.accuracy}% correct` : "No graded answers"} /></div></Panel><Panel title="Attendance" icon={Users}><div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4"><div className="space-y-3"><div><p className="mb-1 text-xs text-zinc-400">Not playing (bar only)</p><div className="grid grid-cols-2 gap-2"><label className="block text-[11px] text-zinc-500">Adults<input type="number" min="0" value={nonPlayers.adults} onChange={(event) => updateNonPlayers("adults", event.target.value)} placeholder="0" className="mt-1 h-9 w-full rounded-md bg-zinc-950 border border-white/10 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="block text-[11px] text-zinc-500">Kids<input type="number" min="0" value={nonPlayers.kids} onChange={(event) => updateNonPlayers("kids", event.target.value)} placeholder="0" className="mt-1 h-9 w-full rounded-md bg-zinc-950 border border-white/10 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /></label></div></div><div className="grid grid-cols-2 gap-2"><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Playing</p><p className="mt-1 text-2xl font-black text-white">{headcountsEntered ? totalPlaying : "-"}</p><p className="mt-1 text-xs text-zinc-500">{headcountsEntered ? `${playingTotals.adults}A · ${playingTotals.kids}K · ` : ""}{teams.length} team{teams.length === 1 ? "" : "s"}</p></div><div className="rounded-lg border border-[#71E0DC]/20 bg-[#71E0DC]/5 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Bar Total</p><p className="mt-1 text-2xl font-black text-[#71E0DC]">{barTotalEntered ? barTotals.adults + barTotals.kids : "-"}</p><p className="mt-1 text-xs text-zinc-500">{barTotalEntered ? `${barTotals.adults} adults · ${barTotals.kids} kids` : "not playing + playing"}</p></div></div></div><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Per-team headcount</p><div className="space-y-2 max-h-64 overflow-y-auto pr-1">{teams.map((team) => { const hc = normalizeHeadcount(teamHeadcounts[team.id]); return <div key={team.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-zinc-950/60 px-3 py-2"><span className="text-sm font-semibold text-zinc-200 truncate">{team.name}</span><span className="flex shrink-0 items-center gap-1"><input type="number" min="0" value={hc.adults} onChange={(event) => updateTeamHeadcount(team.id, "adults", event.target.value)} placeholder="0" title="Adults" className="h-8 w-14 rounded-md bg-zinc-950 border border-white/10 px-2 text-right text-sm text-white outline-none focus:border-[#71E0DC]/60" /><span className="text-[10px] text-zinc-600">A</span><input type="number" min="0" value={hc.kids} onChange={(event) => updateTeamHeadcount(team.id, "kids", event.target.value)} placeholder="0" title="Kids" className="h-8 w-14 rounded-md bg-zinc-950 border border-white/10 px-2 text-right text-sm text-white outline-none focus:border-[#71E0DC]/60" /><span className="text-[10px] text-zinc-600">K</span></span></div>; })}{!teams.length && <p className="rounded-md border border-white/10 bg-zinc-950/60 p-4 text-center text-xs text-zinc-500">Teams will appear here once a session has players.</p>}</div></div></div></Panel><ResultsExportPanel selectedSession={selectedSession} analytics={analytics} exportResults={exportResults} teams={teams} attendance={{ nonPlayers, playingTotals, barTotals, teamHeadcounts }} /><Panel title="Teams" icon={Users}><TeamResultsTable teams={teams} selectedTeamId={selectedTeam?.id} onSelect={setSelectedTeamId} /><TeamDetail team={selectedTeam} answers={filteredTeamAnswers} filter={teamFilter} setFilter={setTeamFilter} roundFilter={teamRoundFilter} setRoundFilter={setTeamRoundFilter} categoryFilter={teamCategoryFilter} setCategoryFilter={setTeamCategoryFilter} roundOptions={roundOptions} categoryOptions={categoryOptions} /></Panel><Panel title="Questions" icon={MessageSquare}><QuestionResultsTable questions={questions} selectedQuestionKey={selectedQuestion?.key} onSelect={setSelectedQuestionKey} /><QuestionDetail question={selectedQuestion} /></Panel><Panel title="Answer Matrix" icon={CheckCircle}><AnswerMatrix teams={teams} questions={questions} /></Panel><Panel title="Accuracy and Insights" icon={TrendingUp}><div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><InsightCard title="Most accurate team" value={strongestTeam?.name || "-"} detail={strongestTeam ? `${strongestTeam.accuracy}% across ${strongestTeam.answered} answers` : "No graded answers yet"} /><InsightCard title="Most difficult round" value={difficultRound?.label || "-"} detail={difficultRound ? `${difficultRound.accuracy}% accuracy` : "No round data"} /><InsightCard title="Low accuracy questions" value={(analytics.performance?.tooDifficult || []).length} detail={(analytics.performance?.tooDifficult || []).map((row) => row.category).join(", ") || "None flagged"} /><InsightCard title="Common wrong answers" value={wrongPatterns.length} detail={wrongPatterns.slice(0, 3).map((row) => `${row.answer} (${row.total})`).join(", ") || "No repeated wrong answers"} /></div><div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/50 p-4"><p className="mb-3 text-sm font-black text-white">Secondary AI review</p><div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{analytics.reviewNotes.map((note) => <div key={note.title} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="font-bold text-white">{note.title}</p><p className="mt-1 text-sm text-zinc-400">{note.body}</p></div>)}</div></div></Panel><Panel title="Player Feedback" icon={ThumbsUp}><div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><FeedbackCard title="Question Likes & Dislikes" rows={questionFeedback} empty="Question thumbs will appear here after players rate live questions." /><FeedbackCard title="Category Likes & Dislikes" rows={categoryRows} empty="Category reactions appear after players rate round intros." /><IdeasFeedbackCard ideas={playerIdeas} /></div><div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4"><AnalyticsList title="Questions Players Liked" icon={ThumbsUp} rows={analytics.topQuestions} empty="Question likes will appear here after players rate live questions." render={(row) => <FeedbackAnalyticsRow row={row} />} /><AnalyticsList title="Needs Review" icon={ThumbsDown} rows={analytics.needsReview} empty="Questions with dislikes, low response, or poor feedback will appear here." render={(row) => <FeedbackAnalyticsRow row={row} showResponses />} /><AnalyticsList title="Category Pulse" icon={BarChart3} rows={analytics.categoryRows.slice(0, 8)} empty="Category feedback appears after players rate round info." render={(row) => <SimpleScoreRow row={row} />} /><AnalyticsList title="Answer Volume" icon={TrendingUp} rows={analytics.responseRows} empty="Submitted answer counts will appear during live phone play." render={(row) => <ResponseRow row={row} players={analytics.totals.players} />} /></div></Panel></section>;
};

const FollowUpPanel = ({ message, setMessage, sendUpdate, openEmailDraft, copyEmails, contactsCount, scheduleNextShow, buildNextSession }) => <Panel title="Follow-Up" icon={CheckCircle}><div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5"><div><p className="text-sm text-zinc-400">Turn tonight into the next prep move.</p><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Thank-you note, schedule reminder, or next-show teaser..." className="mt-4 min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><p className="mt-2 text-xs text-zinc-500">{contactsCount} total email opt-ins saved.</p></div><div className="grid gap-2"><Button onClick={scheduleNextShow} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Schedule Next Show</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Thank Players</Button><Button onClick={sendUpdate} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Send size={16} className="mr-2" />Send In-App Update</Button><Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Copy Email List</Button><Button onClick={buildNextSession} className="gradient-btn">Build Next Session</Button></div></div></Panel>;

const ReviewMetric = ({ label, value, sub }) => <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-2 truncate text-2xl font-black text-white">{value}</p><p className="mt-1 truncate text-xs text-zinc-500">{sub}</p></div>;

const ResultsExportPanel = ({ selectedSession, analytics, exportResults, teams, attendance }) => {
  const sessionSlug = (selectedSession?.name || selectedSession?.session_name || "trivia-results").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const exportTeamResults = () => downloadCsv(`${sessionSlug}-team-results.csv`, [["Placement", "Team", "Final Score", "Correct", "Incorrect", "Answered", "Accuracy"], ...analytics.teamStats.map((team) => [team.placement, team.name, team.score, team.correct, team.incorrect, team.answered, `${team.accuracy}%`])]);
  const exportQuestionPerformance = () => downloadCsv(`${sessionSlug}-question-performance.csv`, [["Question", "Round", "Category", "Question Text", "Correct Answer", "Answered", "Correct", "Incorrect", "Accuracy", "Avg Seconds", "Likes", "Dislikes"], ...analytics.questionRows.map((question) => [question.index + 1, question.roundName, question.category, question.label, question.answer, question.responses, question.correct, question.incorrect, `${question.correctPercent}%`, question.avgSeconds ?? "", question.likes, question.dislikes])]);
  const exportAnswerMatrix = () => downloadCsv(`${sessionSlug}-answer-matrix.csv`, [["Team", "Score", ...analytics.questionRows.map((question) => `Q${question.index + 1}`)], ...analytics.teamStats.map((team) => [team.name, team.score, ...analytics.questionRows.map((question) => answerSymbol(team.answers?.[question.index]?.status))])]);
  const exportAttendance = () => {
    const { nonPlayers, playingTotals, barTotals, teamHeadcounts } = attendance;
    downloadCsv(`${sessionSlug}-attendance.csv`, [
      ["Group", "Adults", "Kids", "Total"],
      ["Not Playing", Number(nonPlayers.adults) || 0, Number(nonPlayers.kids) || 0, (Number(nonPlayers.adults) || 0) + (Number(nonPlayers.kids) || 0)],
      ["Playing", playingTotals.adults, playingTotals.kids, playingTotals.adults + playingTotals.kids],
      ["Bar Total", barTotals.adults, barTotals.kids, barTotals.adults + barTotals.kids],
      [],
      ["Team", "Adults", "Kids", "Total"],
      ...teams.map((team) => { const hc = normalizeHeadcount(teamHeadcounts[team.id]); return [team.name, Number(hc.adults) || 0, Number(hc.kids) || 0, (Number(hc.adults) || 0) + (Number(hc.kids) || 0)]; }),
    ]);
  };
  return <Panel title="Export" icon={Copy}><div className="grid grid-cols-1 md:grid-cols-5 gap-2"><Button onClick={exportResults} className="gradient-btn">Full Results CSV</Button><Button onClick={exportTeamResults} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Team Results CSV</Button><Button onClick={exportQuestionPerformance} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Question CSV</Button><Button onClick={exportAnswerMatrix} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Matrix CSV</Button><Button onClick={exportAttendance} variant="outline" className="border-white/10 text-zinc-300 hover:text-white">Attendance CSV</Button></div></Panel>;
};

const TeamResultsTable = ({ teams, selectedTeamId, onSelect }) => <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[860px] text-sm"><thead><tr className="border-b border-white/10 bg-zinc-950/70 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="p-3">Place</th><th className="p-3">Team</th><th className="p-3">Final Score</th><th className="p-3">Correct</th><th className="p-3">Incorrect</th><th className="p-3">Answered</th><th className="p-3">Accuracy</th></tr></thead><tbody>{teams.map((team) => <tr key={team.id || team.name} onClick={() => onSelect(team.id)} className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${selectedTeamId === team.id ? "bg-[#71E0DC]/10" : ""}`}><td className="p-3 font-mono text-zinc-400">#{team.placement}</td><td className="p-3 font-bold text-white">{team.name}</td><td className="p-3 font-black text-[#71E0DC]">{team.score}</td><td className="p-3 text-emerald-300">{team.correct}</td><td className="p-3 text-red-300">{team.incorrect}</td><td className="p-3 text-zinc-300">{team.answered}</td><td className="p-3"><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{team.accuracy}%</Badge></td></tr>)}{!teams.length && <tr><td colSpan={7} className="p-8 text-center text-zinc-500">Team results will appear after a hosted session is saved.</td></tr>}</tbody></table></div>;

const TeamDetail = ({ team, answers, filter, setFilter, roundFilter, setRoundFilter, categoryFilter, setCategoryFilter, roundOptions, categoryOptions }) => <div className="rounded-xl border border-white/10 bg-zinc-950/45 p-4"><div className="mb-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Team Detail</p><h3 className="text-xl font-black text-white">{team?.name || "Select a team"}</h3></div><div className="flex flex-wrap gap-2"><SelectMini value={filter} onChange={setFilter} options={[["all", "All"], ["correct", "Correct only"], ["incorrect", "Incorrect only"], ["missing", "No answer"]]} /><SelectMini value={roundFilter} onChange={setRoundFilter} options={[["all", "All rounds"], ...roundOptions.map((round) => [round, round])]} /><SelectMini value={categoryFilter} onChange={setCategoryFilter} options={[["all", "All categories"], ...categoryOptions.map((category) => [category, category])]} /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Q#</th><th className="py-2 pr-3">Round</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Question</th><th className="py-2 pr-3">Team Answer</th><th className="py-2 pr-3">Correct Answer</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Points</th><th className="py-2 pr-3">Time</th></tr></thead><tbody>{answers.map((answer) => <tr key={answer.key} className="border-b border-white/5 text-zinc-300"><td className="py-3 pr-3 font-mono text-zinc-500">{answer.questionIndex + 1}</td><td className="py-3 pr-3">{answer.roundName}</td><td className="py-3 pr-3">{answer.category}</td><td className="py-3 pr-3">{String(answer.type).replace("_", "/")}</td><td className="py-3 pr-3 max-w-[260px] truncate">{answer.question}</td><td className="py-3 pr-3 max-w-[220px] truncate">{answer.answer || "-"}</td><td className="py-3 pr-3 max-w-[180px] truncate text-emerald-300">{answer.correctAnswer}</td><td className="py-3 pr-3"><CorrectBadge status={answer.status} /></td><td className="py-3 pr-3 font-bold">{answer.points > 0 ? `+${answer.points}` : answer.points}</td><td className="py-3 pr-3 text-zinc-500">{answer.seconds !== null && answer.seconds !== undefined && answer.seconds !== "" ? `${Number(answer.seconds).toFixed(1)}s` : "-"}</td></tr>)}</tbody></table></div>{team && !answers.length && <p className="py-6 text-center text-sm text-zinc-500">No answers match those filters.</p>}</div>;

const QuestionResultsTable = ({ questions, selectedQuestionKey, onSelect }) => <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[1080px] text-sm"><thead><tr className="border-b border-white/10 bg-zinc-950/70 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="p-3">Q#</th><th className="p-3">Round</th><th className="p-3">Category</th><th className="p-3">Question</th><th className="p-3">Answer</th><th className="p-3">Answered</th><th className="p-3">Correct</th><th className="p-3">Incorrect</th><th className="p-3">Accuracy</th><th className="p-3">Avg Time</th><th className="p-3">Feedback</th></tr></thead><tbody>{questions.map((question) => <tr key={question.key} onClick={() => onSelect(question.key)} className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${selectedQuestionKey === question.key ? "bg-[#71E0DC]/10" : ""}`}><td className="p-3 font-mono text-zinc-400">{question.index + 1}</td><td className="p-3">{question.roundName}</td><td className="p-3">{question.category}</td><td className="p-3 max-w-[280px] truncate font-semibold text-white">{question.label}</td><td className="p-3 max-w-[160px] truncate text-emerald-300">{question.answer}</td><td className="p-3">{question.responses}</td><td className="p-3 text-emerald-300">{question.correct}</td><td className="p-3 text-red-300">{question.incorrect}</td><td className="p-3"><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{question.correctPercent}%</Badge></td><td className="p-3">{question.avgSeconds === null ? "-" : `${question.avgSeconds}s`}</td><td className="p-3">{question.likes} / {question.dislikes}</td></tr>)}{!questions.length && <tr><td colSpan={11} className="p-8 text-center text-zinc-500">Question performance appears after a session is selected.</td></tr>}</tbody></table></div>;

const QuestionDetail = ({ question }) => <div className="rounded-xl border border-white/10 bg-zinc-950/45 p-4"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Question Detail</p><h3 className="line-clamp-2 text-lg font-black text-white">{question?.label || "Select a question"}</h3>{question && <p className="mt-1 text-sm text-zinc-500">{question.roundName} / {question.category} / {String(question.type).replace("_", "/")}</p>}</div>{question && <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Team</th><th className="py-2 pr-3">Answer</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Points</th><th className="py-2 pr-3">Time</th></tr></thead><tbody>{question.teamAnswers.map((answer) => <tr key={answer.playerId} className="border-b border-white/5 text-zinc-300"><td className="py-3 pr-3 font-bold text-white">{answer.team}</td><td className="py-3 pr-3 max-w-[260px] truncate">{answer.answer || "-"}</td><td className="py-3 pr-3"><CorrectBadge status={answer.status} /></td><td className="py-3 pr-3 font-bold">{answer.points > 0 ? `+${answer.points}` : answer.points}</td><td className="py-3 pr-3 text-zinc-500">{answer.seconds !== null && answer.seconds !== undefined && answer.seconds !== "" ? `${Number(answer.seconds).toFixed(1)}s` : "-"}</td></tr>)}</tbody></table></div><div className="space-y-3"><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Correct answer</p><p className="mt-1 font-bold text-emerald-300">{question.answer || "Not set"}</p></div><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Reactions</p><p className="mt-2 text-sm text-zinc-300">{question.likes} likes / {question.dislikes} dislikes</p><div className="mt-2 flex flex-wrap gap-1.5">{question.votes.map((vote, index) => <span key={`${vote.playerId}-${index}`} className={`rounded-full px-2 py-1 text-xs font-bold ${vote.sentiment === "like" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{vote.playerName || "Team"} {vote.sentiment === "like" ? "liked" : "disliked"}</span>)}</div></div></div></div>}</div>;

const AnswerMatrix = ({ teams, questions }) => <div className="overflow-auto rounded-xl border border-white/10 max-h-[560px]"><table className="min-w-max text-sm"><thead><tr className="bg-zinc-950"><th className="sticky left-0 top-0 z-20 min-w-48 border-b border-r border-white/10 bg-zinc-950 p-3 text-left text-xs uppercase tracking-wide text-zinc-500">Team</th>{questions.map((question) => <th key={question.key} className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950 p-2 text-center text-xs text-zinc-400" title={question.label}>Q{question.index + 1}</th>)}</tr></thead><tbody>{teams.map((team) => <tr key={team.id || team.name}><td className="sticky left-0 z-10 border-r border-white/10 bg-zinc-950 p-3 font-bold text-white">{team.name}</td>{questions.map((question) => { const answer = team.answers?.[question.index]; return <td key={`${team.id}-${question.key}`} title={`${team.name}\nAnswer: ${answer?.answer || "No answer"}\nCorrect: ${answer?.correctAnswer || question.answer}\nPoints: ${answer?.points || 0}\nTime: ${answer?.seconds ?? "-"}`} className={`min-w-14 border-b border-white/5 p-2 text-center font-black ${answer?.status === "correct" ? "bg-emerald-500/15 text-emerald-300" : answer?.status === "incorrect" ? "bg-red-500/15 text-red-300" : answer?.status === "missing" ? "bg-zinc-900 text-zinc-600" : "bg-amber-500/10 text-amber-200"}`}>{answerSymbol(answer?.status)}</td>; })}</tr>)}</tbody></table>{!teams.length && <p className="p-8 text-center text-sm text-zinc-500">The answer matrix appears after teams submit answers.</p>}</div>;

const SelectMini = ({ value, onChange, options }) => <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none focus:border-[#71E0DC]/60">{options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}</select>;
const InsightCard = ({ title, value, detail }) => <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{title}</p><p className="mt-2 text-xl font-black text-white">{value}</p><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>;

const PerformanceBlock = ({ title, rows = [], empty, tone }) => <div className="rounded-xl border border-white/10 bg-zinc-950/45 p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-black text-white">{title}</h3><Badge className={tone === "good" ? "bg-emerald-500/15 text-emerald-300" : tone === "bad" ? "bg-red-500/15 text-red-300" : "bg-zinc-800 text-zinc-300"}>{rows.length}</Badge></div><div className="space-y-2">{rows.slice(0, 4).map((row) => <div key={row.key || row.label} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3"><p className="line-clamp-2 text-sm font-semibold text-zinc-200">{row.label}</p><div className="mt-2 flex flex-wrap gap-2"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">{row.category}</Badge><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{row.correctPercent}% correct</Badge><Badge className="bg-zinc-800 text-zinc-300">{row.responses} answers</Badge>{Number(row.likes || 0) > 0 && <Badge className="bg-emerald-500/15 text-emerald-300">{row.likes} likes</Badge>}{Number(row.dislikes || 0) > 0 && <Badge className="bg-red-500/15 text-red-300">{row.dislikes} dislikes</Badge>}</div></div>)}{!rows.length && <p className="rounded-lg border border-white/10 bg-zinc-950/60 p-4 text-center text-sm text-zinc-500">{empty}</p>}</div></div>;

const GameDataPanel = ({ analytics }) => <section className="space-y-6"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><AnalyticsMetric icon={Users} label="Players" value={analytics.totals.players} sub={`${analytics.totals.emailOptIns} email opt-in${analytics.totals.emailOptIns === 1 ? "" : "s"}`} /><AnalyticsMetric icon={TrendingUp} label="Answers" value={analytics.totals.answers} sub={`${analytics.totals.answerCoverage}% question coverage`} /><AnalyticsMetric icon={BarChart3} label="Questions" value={analytics.totals.questions} sub="in selected session" /><AnalyticsMetric icon={MessageSquare} label="Feedback" value={analytics.totals.questionVotes + analytics.totals.categoryVotes} sub="question + category votes" /></div><TeamRankingsCard rows={analytics.teamStats} totalQuestions={analytics.totals.questions} /><QuestionBreakdownCard rows={analytics.questionRows} players={analytics.totals.players} /><CrowdActivityCard rows={analytics.answerRows} /><div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><AnalyticsList title="Question Type Mix" icon={BarChart3} rows={analytics.typeMix} empty="No session questions found." render={(row) => <ProgressRow row={row} total={analytics.totals.questions} />} /><AnalyticsList title="Category Mix" icon={MessageSquare} rows={analytics.categoryMix} empty="No categories found in this session." render={(row) => <ProgressRow row={row} total={analytics.totals.questions} />} /></div></section>;

const TeamRankingsCard = ({ rows, totalQuestions }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Users className="text-[#71E0DC]" />Team Rankings</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map((team, index) => <div key={team.id || team.name} className="grid grid-cols-[44px_1fr_auto] gap-3 rounded-lg border border-white/10 bg-zinc-950/60 p-3 items-center"><div className="text-center"><p className="text-xs text-zinc-500">Rank</p><p className="text-lg font-black text-white">{index + 1}</p></div><div className="min-w-0"><p className="font-bold text-white truncate">{team.name}</p><div className="mt-2 flex items-center gap-2 text-xs text-zinc-400"><span>Answered <strong className="text-white">{team.correct}</strong> of <strong className="text-white">{totalQuestions || team.answered}</strong> correctly</span><span className="text-zinc-600">/</span><span>{team.answered} submitted</span></div><div className="mt-2 h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full bg-[#AEB2EF]" style={{ width: `${team.correctPercent}%` }} /></div></div><div className="text-right"><p className="text-xs text-zinc-500">Points</p><p className="text-2xl font-black text-[#71E0DC]">{team.score}</p></div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">Team rankings will appear after players join or scores are saved.</p>}</CardContent></Card>;

const QuestionBreakdownCard = ({ rows, players }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><BarChart3 className="text-[#71E0DC]" />Question Answer Breakdown</CardTitle></CardHeader><CardContent className="space-y-4 max-h-[680px] overflow-y-auto">{rows.map((row) => <div key={row.key} className="rounded-lg border border-white/10 bg-zinc-950/60 p-4"><div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 mb-2"><Badge className="bg-zinc-800 text-zinc-300">Q{row.index + 1}</Badge><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">{row.responses}/{players || 0} answers</Badge><Badge className={row.correctPercent >= 70 ? "bg-emerald-500/15 text-emerald-300" : row.correctPercent > 0 ? "bg-amber-500/15 text-amber-200" : "bg-zinc-800 text-zinc-300"}>{row.correctPercent}% correct</Badge></div><p className="font-bold text-white line-clamp-2">{row.label}</p><p className="mt-1 text-xs text-zinc-500">{row.category} / {String(row.type || "").replace("_", "/")}</p></div><p className="shrink-0 text-sm font-bold text-emerald-300">Answer: {row.answer || "Not set"}</p></div><div className="mt-4 space-y-2">{row.optionRows.map((option) => <div key={option.label} className={`rounded-md px-3 py-2 ${option.correct ? "bg-emerald-500/10 border border-emerald-500/25" : "bg-zinc-900/80 border border-white/5"}`}><div className="grid grid-cols-[minmax(120px,240px)_1fr_auto] gap-3 items-center"><div className="flex items-center gap-2 min-w-0"><span className="truncate text-sm font-semibold text-zinc-200">{option.label}</span>{option.correct && <Badge className="bg-emerald-500/20 text-emerald-300"><CheckCircle size={12} className="mr-1" />Correct</Badge>}</div><div className="h-3 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full rounded-full ${option.correct ? "bg-emerald-400" : "bg-[#AEB2EF]"}`} style={{ width: `${option.percent}%` }} /></div><span className="text-xs font-bold text-zinc-300">{option.percent}% / {option.total}</span></div><TeamAnswerChips teams={option.teams} /></div>)}</div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">Question results will appear after answers are submitted.</p>}</CardContent></Card>;

const TeamAnswerChips = ({ teams = [] }) => teams.length ? <div className="mt-2 flex flex-wrap gap-1.5">{teams.map((team, index) => <span key={`${team.id || team.name}-${index}`} title={team.submittedAt ? `Submitted ${formatDateTime(team.submittedAt)}` : ""} className="rounded-full border border-white/10 bg-zinc-950/70 px-2 py-1 text-xs font-semibold text-zinc-200">{team.name}</span>)}</div> : <p className="mt-2 text-xs text-zinc-600">No teams chose this</p>;

const CrowdActivityCard = ({ rows }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><TrendingUp className="text-[#71E0DC]" />Crowd Activity</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="py-2 pr-3">Q#</th><th className="py-2 pr-3">Question</th><th className="py-2 pr-3">Team</th><th className="py-2 pr-3">Answer</th><th className="py-2 pr-3">Correct?</th><th className="py-2 pr-3">Points</th><th className="py-2 pr-3">Wager</th><th className="py-2 pr-3">Time</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-b border-white/5 text-zinc-300"><td className="py-3 pr-3 font-mono text-zinc-500">{row.questionIndex + 1}</td><td className="py-3 pr-3 max-w-[260px] truncate">{row.question}</td><td className="py-3 pr-3 font-semibold text-white">{row.team}</td><td className="py-3 pr-3 max-w-[220px] truncate">{row.answer}</td><td className="py-3 pr-3"><CorrectBadge status={row.correct} /></td><td className="py-3 pr-3 font-bold">{row.points > 0 ? `+${row.points}` : row.points}</td><td className="py-3 pr-3">{row.wager === null ? "-" : row.wager}</td><td className="py-3 pr-3 text-zinc-500">{formatAnswerTime(row)}</td></tr>)}</tbody></table></div>{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">Every submitted answer will appear here once phone play starts.</p>}</CardContent></Card>;

const CorrectBadge = ({ status }) => status === "correct" ? <Badge className="bg-emerald-500/15 text-emerald-300"><CheckCircle size={12} className="mr-1" />Yes</Badge> : status === "incorrect" ? <Badge className="bg-red-500/15 text-red-300"><XCircle size={12} className="mr-1" />No</Badge> : <Badge className="bg-zinc-800 text-zinc-300">Pending</Badge>;

const CluesPanel = ({ aiDirection, setAiDirection, generateClues, generating, selectedSession, clueQuestionRows, selectedClueKeys, setSelectedClueKeys, socialPost, setSocialPost, copySocialPost, openSocialComposer, socialLinks, clueHistory, sessions, reassignCluePost, addManualCluePost, editCluePost, removeCluePost }) => {
  const [addClueOpen, setAddClueOpen] = useState(false);
  const selectedQuestions = clueQuestionRows.filter((question) => selectedClueKeys.includes(question.key));
  const toggleQuestion = (key) => setSelectedClueKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const selectAll = () => setSelectedClueKeys(clueQuestionRows.map((question) => question.key));
  const selectNone = () => setSelectedClueKeys([]);
  const reusePastClue = (entry) => setSocialPost(entry.socialPost || entry.message);
  const sessionNameOptions = [...new Set(sessions.map((session) => session.name || session.session_name).filter(Boolean))];

  return <section className="space-y-6 max-w-6xl"><Panel title="Clue Builder" icon={Sparkles}><div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5"><div className="space-y-4"><div><p className="text-sm font-bold text-white">Select the questions the clue should hint at</p><p className="text-xs text-zinc-500 mt-1">Only selected questions are sent to AI. Answers are included for context, but the prompt blocks answer reveals.</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={selectAll} className="border-white/10 text-zinc-300 hover:text-white">Select All</Button><Button type="button" size="sm" variant="outline" onClick={selectNone} className="border-white/10 text-zinc-300 hover:text-white">Clear</Button><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{selectedQuestions.length} selected</Badge></div><div className="max-h-[520px] overflow-y-auto rounded-xl border border-white/10 bg-zinc-950/50 p-2 space-y-2">{clueQuestionRows.map((question) => <button key={question.key} type="button" onClick={() => toggleQuestion(question.key)} className={`w-full rounded-lg border p-3 text-left transition ${selectedClueKeys.includes(question.key) ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/50 hover:border-white/20"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${selectedClueKeys.includes(question.key) ? "border-[#71E0DC] bg-[#71E0DC] text-zinc-950" : "border-white/20 text-transparent"}`}>{selectedClueKeys.includes(question.key) ? <CheckCircle size={14} /> : null}</span><div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><Badge className="bg-zinc-800 text-zinc-300">Q{question.index + 1}</Badge><Badge className="bg-[#AEB2EF]/15 text-[#AEB2EF]">{question.category}</Badge></div><p className="text-sm font-semibold text-white line-clamp-2">{question.question}</p><p className="mt-1 text-xs text-[#71E0DC]">Answer: {question.answer}</p></div></div></button>)}{!clueQuestionRows.length && <p className="p-6 text-center text-sm text-zinc-500">Choose a session with questions first.</p>}</div></div><div className="space-y-4"><label className="block text-sm font-bold text-white">Direction<textarea value={aiDirection} onChange={(event) => setAiDirection(event.target.value)} className="mt-2 min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" /></label><Button onClick={() => generateClues(selectedQuestions)} disabled={generating || !selectedSession || !selectedQuestions.length} className="w-full gradient-btn">{generating ? <Sparkles className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}Draft From Selected</Button><p className="text-xs text-zinc-500">Tip: pick 3-6 questions for the most natural Facebook-style teaser.</p></div></div></Panel><Panel title="Drafted Social Post" icon={MessageSquare}><label className="text-sm font-bold text-white">Social post<textarea value={socialPost} onChange={(event) => setSocialPost(event.target.value)} placeholder="Facebook/social post..." className="mt-2 min-h-36 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={copySocialPost} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Post</Button><Button onClick={() => openSocialComposer("facebook")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />{socialLinks.facebook ? "Open Facebook Page" : "Open Facebook"}</Button><Button onClick={() => openSocialComposer("x")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />X/Twitter</Button></div></Panel><Panel title="Past Clues" icon={Clock}><div className="-mt-2 flex flex-wrap items-start justify-between gap-3"><p className="text-xs text-zinc-500">Logged whenever you copy or open a post to publish it, or add one from a screenshot. New drafts lean on your last few posts here to match your own voice once you've used a few.</p><Button type="button" size="sm" onClick={() => setAddClueOpen(true)} className="h-8 shrink-0 gradient-btn"><Upload size={14} className="mr-1.5" />Add Clue</Button></div><div className="space-y-2 max-h-[480px] overflow-y-auto">{clueHistory.map((entry) => <PastClueRow key={entry.id} entry={entry} sessionNameOptions={sessionNameOptions} onReassignSession={(sessionName) => reassignCluePost(entry.id, sessionName)} onReuse={() => reusePastClue(entry)} onEdit={(text) => editCluePost(entry.id, text)} onDelete={() => removeCluePost(entry.id)} />)}{!clueHistory.length && <p className="p-6 text-center text-sm text-zinc-500">Posts you copy or open from above will show up here.</p>}</div></Panel>{addClueOpen && <AddClueModal sessionNameOptions={sessionNameOptions} defaultSessionName={selectedSession?.name || selectedSession?.session_name || ""} onClose={() => setAddClueOpen(false)} onSaved={addManualCluePost} />}</section>;
};

const PastClueRow = ({ entry, sessionNameOptions, onReassignSession, onReuse, onEdit, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.socialPost || entry.message || "");
  const startEdit = () => {
    setDraft(entry.socialPost || entry.message || "");
    setEditing(true);
  };
  const saveEdit = () => {
    onEdit(draft.trim());
    setEditing(false);
  };
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <select value={entry.sessionName || ""} onChange={(event) => onReassignSession(event.target.value)} className="h-7 rounded-md border border-white/10 bg-zinc-900 px-2 text-xs font-semibold text-zinc-300 outline-none focus:border-[#71E0DC]/60">
            {!sessionNameOptions.includes(entry.sessionName) && <option value={entry.sessionName || ""}>{entry.sessionName || "Trivia Night"}</option>}
            {sessionNameOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="text-xs text-zinc-500">{formatDateTime(entry.createdAt)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && <Button type="button" size="sm" variant="outline" onClick={onReuse} className="h-7 border-white/10 text-zinc-300 hover:text-white">Reuse</Button>}
          {!editing && <Button type="button" size="sm" variant="outline" onClick={startEdit} className="h-7 w-7 p-0 border-white/10 text-zinc-300 hover:text-white" aria-label="Edit past clue"><Pencil size={13} /></Button>}
          <Button type="button" size="sm" variant="outline" onClick={onDelete} className="h-7 w-7 p-0 border-white/10 text-zinc-400 hover:border-red-500/40 hover:text-red-300" aria-label="Delete past clue"><Trash2 size={13} /></Button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-24 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-[#71E0DC]/60" />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)} className="h-7 border-white/10 text-zinc-300 hover:text-white">Cancel</Button>
            <Button type="button" size="sm" onClick={saveEdit} disabled={!draft.trim()} className="h-7 gradient-btn">Save</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-200 line-clamp-3">{entry.socialPost || entry.message}</p>
      )}
    </div>
  );
};

const AddClueModal = ({ sessionNameOptions, defaultSessionName, onClose, onSaved }) => {
  const [sessionName, setSessionName] = useState(defaultSessionName);
  const [preview, setPreview] = useState("");
  const [read, setRead] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > 15 * 1024 * 1024) return toast.error("That image is too large -- try a smaller screenshot");
    setReading(true);
    setRead(false);
    setExtractedText("");
    setPostedAt("");
    try {
      const compressed = await imageBlobToDataUrl(file);
      setPreview(compressed);
      const result = await extractCluePostFromImage(compressed);
      setExtractedText(result.text);
      setPostedAt(result.postedAt);
      setRead(true);
    } catch (error) {
      toast.error(error.message || "Could not read that screenshot");
    } finally {
      setReading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
  };

  const handleSave = async () => {
    const text = extractedText.trim();
    if (!text) return toast.error("Nothing to save yet");
    setSaving(true);
    try {
      await onSaved({ sessionName, text });
      toast.success("Clue added to history");
      onClose();
    } catch (error) {
      toast.error(error.message || "Could not save that clue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-8 md:pt-14 overflow-y-auto">
      <div className="w-full max-w-lg rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close add clue"><X size={18} /></button>
        <div className="mb-5">
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Upload size={19} className="text-[#71E0DC]" />Add Clue From Screenshot</h2>
          <p className="mt-1 text-sm text-zinc-500">Upload a screenshot of the post you actually published. Quiz Crafter reads the text and adds it to your history.</p>
        </div>
        <label className="block text-sm font-bold text-white mb-4">
          Session
          <select value={sessionName} onChange={(event) => setSessionName(event.target.value)} className="mt-2 h-11 w-full rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">
            {!sessionNameOptions.includes(sessionName) && sessionName && <option value={sessionName}>{sessionName}</option>}
            {sessionNameOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex h-40 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed transition-colors ${dragging ? "border-[#71E0DC] bg-[#71E0DC]/10" : "border-zinc-600 bg-zinc-950/20 hover:border-[#71E0DC]"}`}
        >
          {preview ? <img src={preview} alt="Screenshot preview" className="max-h-36 max-w-full rounded object-contain" /> : <><Upload className="mb-3 text-white" size={26} /><p className="text-sm font-medium text-white">Drag a screenshot or click to upload</p></>}
          <input type="file" accept="image/*" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
        </label>
        {reading && <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={14} className="animate-spin text-[#71E0DC]" />Reading the screenshot...</p>}
        {!reading && read && (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-bold text-white">
              Extracted post text
              <textarea value={extractedText} onChange={(event) => setExtractedText(event.target.value)} placeholder="Nothing extracted -- type it in manually" className="mt-2 min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" />
            </label>
            {postedAt && <p className="text-xs text-zinc-500">Posted label detected in screenshot: {postedAt}</p>}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="border-white/10 text-zinc-300 hover:text-white">Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={saving || reading || !extractedText.trim()} className="gradient-btn">{saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Upload size={16} className="mr-2" />}Save to Past Clues</Button>
        </div>
      </div>
    </div>
  );
};

const OutreachPanel = ({ message, setMessage, sendUpdate, openEmailDraft, copyEmails, contacts, sessionEmailCount, socialLinks, updateSocialLink }) => <section className="space-y-6 max-w-6xl"><Panel title="Opt-In Email List" icon={Mail}><div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4"><div className="rounded-xl border border-[#71E0DC]/25 bg-[#71E0DC]/10 p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#71E0DC]">Stored Contacts</p><p className="mt-2 text-4xl font-black text-white">{contacts.length}</p><p className="mt-1 text-sm text-zinc-400">{sessionEmailCount} from this selected session</p><div className="mt-4 grid gap-2"><Button onClick={copyEmails} className="gradient-btn"><Copy size={16} className="mr-2" />Copy All Emails</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email All</Button></div></div><div className="rounded-xl border border-white/10 bg-zinc-950/60 overflow-hidden"><div className="grid grid-cols-[1fr_1fr_140px] gap-3 border-b border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-500"><span>Team</span><span>Email</span><span>Source</span></div><div className="max-h-72 overflow-y-auto">{contacts.map((contact) => <div key={contact.email} className="grid grid-cols-[1fr_1fr_140px] gap-3 border-b border-white/5 px-3 py-3 text-sm"><span className="font-semibold text-white truncate">{contact.name || "Team"}</span><span className="text-[#71E0DC] truncate">{contact.email}</span><span className="text-zinc-500 truncate">{contact.sessionName || "Trivia"}</span></div>)}{!contacts.length && <p className="p-6 text-center text-sm text-zinc-500">When players choose Email me on the join screen, they will be stored here across sessions.</p>}</div></div></div></Panel><Panel title="Email and Player Updates" icon={MessageSquare}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a clue, cancellation, schedule change, or player update..." className="min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={sendUpdate} className="gradient-btn"><Send size={16} className="mr-2" />Send In-App</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email Draft</Button><Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Emails</Button></div></Panel><Panel title="Connected Pages" icon={ExternalLink}><div className="grid grid-cols-1 md:grid-cols-3 gap-3"><input value={socialLinks.facebook} onChange={(event) => updateSocialLink("facebook", event.target.value)} placeholder="Facebook page URL" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.instagram} onChange={(event) => updateSocialLink("instagram", event.target.value)} placeholder="Instagram profile URL" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.x} onChange={(event) => updateSocialLink("x", event.target.value)} placeholder="X/Twitter profile URL" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /></div><p className="text-xs text-zinc-500">Facebook posts can be copied and opened from the Clues tab. One-click publishing will require a Meta account connection.</p></Panel></section>;


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

const mergeManyByKey = (makeKey, ...lists) => {
  const map = new Map();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const key = makeKey(item);
      if (key) map.set(key, { ...(map.get(key) || {}), ...item });
    });
  });
  return [...map.values()];
};

const getHostedResultsSnapshot = (session) => {
  const results = session?.hosted_results;
  if (!results || typeof results !== "object" || Array.isArray(results)) return {};
  const nested = results.results && typeof results.results === "object" && !Array.isArray(results.results) ? results.results : {};
  return { ...results, ...nested };
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
const getQuestionRoundOrder = (question, index = 0) => Number(question?.round_order || question?.round_number || question?.round || Math.floor(index / 10) + 1) || 1;
const getQuestionRoundName = (question, index = 0) => question?.round_name || question?.round_title || `Round ${getQuestionRoundOrder(question, index)}`;
const getQuestionKey = (question, index) => String(question?.id || `${index}-${getQuestionText(question)}`);
const getQuestionAnswer = (question) => question?.correct_answer || question?.answer || "";
const getQuestionOptions = (question) => {
  const rawOptions = Array.isArray(question?.options) ? question.options : Array.isArray(question?.incorrect_answers) ? [...question.incorrect_answers, getQuestionAnswer(question)] : [];
  if (getQuestionType(question) === "true_false") return ["True", "False"];
  return [...new Set(rawOptions.map((option) => String(option || "").trim()).filter(Boolean))];
};
const answerKey = (answer) => `${answer.playerId}-${answer.questionIndex}`;
const percent = (value, total) => total > 0 ? Math.round((value / total) * 100) : 0;
const average = (values) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null;
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
  const participants = mergeManyByKey((item) => item.id, players, leaderboard).filter((item) => item.id);
  const questionRows = questions.map((question, index) => {
    const text = compactLabel(getQuestionText(question), `Question ${index + 1}`);
    const votes = feedback.filter((item) => Number(item.questionIndex) === index || item.questionText === text);
    const responses = answers.filter((answer) => Number(answer.questionIndex) === index);
    const correctResponses = responses.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct").length;
    const incorrectResponses = responses.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "incorrect").length;
    const options = getQuestionOptions(question);
    const answerGroups = Object.values(responses.reduce((groups, answer) => {
      const label = compactLabel(answer.answer, "Blank");
      if (!groups[label]) groups[label] = { label, total: 0, correct: false, teams: [] };
      groups[label].total += 1;
      groups[label].teams.push({
        id: answer.playerId || "",
        name: answer.playerName || players.find((player) => player.id === answer.playerId)?.name || "Team",
        submittedAt: answer.submittedAt || "",
      });
      if (gradedAnswers[answerKey(answer)]?.status === "correct" || label.toLowerCase() === compactLabel(getQuestionAnswer(question)).toLowerCase()) groups[label].correct = true;
      return groups;
    }, {}));
    const optionRows = (options.length ? options : answerGroups.map((row) => row.label)).map((option) => {
      const match = answerGroups.find((row) => row.label === option);
      return { label: option, total: match?.total || 0, correct: match?.correct || compactLabel(option).toLowerCase() === compactLabel(getQuestionAnswer(question)).toLowerCase(), percent: percent(match?.total || 0, responses.length), teams: match?.teams || [] };
    });
    const extraRows = answerGroups.filter((row) => !optionRows.some((option) => option.label === row.label)).map((row) => ({ ...row, percent: percent(row.total, responses.length) }));
    const teamAnswers = participants.map((player) => {
      const response = responses.find((answer) => answer.playerId === player.id);
      const grade = response ? gradedAnswers[answerKey(response)] || {} : {};
      const seconds = response?.responseSeconds ?? response?.secondsToSubmit ?? response?.elapsedSeconds ?? null;
      return {
        playerId: player.id,
        team: player.name || "Team",
        answer: response ? compactLabel(response.answer, "Blank") : "",
        correctAnswer: getQuestionAnswer(question),
        status: response ? grade.status || (compactLabel(response.answer).toLowerCase() === compactLabel(getQuestionAnswer(question)).toLowerCase() ? "correct" : "ungraded") : "missing",
        points: response ? Number(grade.points || 0) : 0,
        seconds,
        submittedAt: response?.submittedAt || "",
      };
    });
    const responseSeconds = responses.map((answer) => answer.responseSeconds ?? answer.secondsToSubmit ?? answer.elapsedSeconds).filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite);
    return {
      key: getQuestionKey(question, index),
      label: text,
      index,
      roundName: getQuestionRoundName(question, index),
      roundOrder: getQuestionRoundOrder(question, index),
      category: getQuestionCategory(question),
      type: getQuestionType(question),
      answer: getQuestionAnswer(question),
      likes: votes.filter((item) => item.sentiment === "like").length,
      dislikes: votes.filter((item) => item.sentiment === "dislike").length,
      responses: responses.length,
      correct: correctResponses,
      incorrect: incorrectResponses,
      correctPercent: percent(correctResponses, responses.length),
      responseRate: percent(responses.length, participants.length),
      avgSeconds: average(responseSeconds),
      votes,
      teamAnswers,
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
  const rankingSource = Array.isArray(leaderboard) && leaderboard.length ? leaderboard : participants;
  const teamStats = rankingSource.map((team) => {
    const teamAnswers = answers.filter((answer) => answer.playerId === team.id);
    const correct = teamAnswers.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct").length;
    const incorrect = teamAnswers.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "incorrect").length;
    const detailedAnswers = questions.map((question, questionIndex) => {
      const answer = teamAnswers.find((item) => Number(item.questionIndex) === questionIndex);
      const grade = answer ? gradedAnswers[answerKey(answer)] || {} : {};
      const seconds = answer?.responseSeconds ?? answer?.secondsToSubmit ?? answer?.elapsedSeconds ?? null;
      return {
        key: `${team.id}-${questionIndex}`,
        questionIndex,
        roundName: getQuestionRoundName(question, questionIndex),
        category: getQuestionCategory(question),
        type: getQuestionType(question),
        question: compactLabel(getQuestionText(question), `Question ${questionIndex + 1}`),
        answer: answer ? compactLabel(answer.answer, "Blank") : "",
        correctAnswer: getQuestionAnswer(question),
        status: answer ? grade.status || (compactLabel(answer.answer).toLowerCase() === compactLabel(getQuestionAnswer(question)).toLowerCase() ? "correct" : "ungraded") : "missing",
        points: answer ? Number(grade.points || 0) : 0,
        seconds,
      };
    });
    return { id: team.id, name: team.name || "Team", score: Number(team.score || 0), answered: teamAnswers.length, correct, incorrect, accuracy: percent(correct, teamAnswers.length), correctPercent: percent(correct, questions.length), answers: detailedAnswers };
  }).sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name)).map((team, index) => ({ ...team, placement: index + 1 }));
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
  const averageScore = teamStats.length ? Math.round(teamStats.reduce((sum, team) => sum + Number(team.score || 0), 0) / teamStats.length) : 0;
  const totalGraded = teamStats.reduce((sum, team) => sum + team.correct + team.incorrect, 0);
  const totalCorrect = teamStats.reduce((sum, team) => sum + team.correct, 0);
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
      players: participants.length,
      emailOptIns: emailPlayers.length,
      questions: questions.length,
      answers: answers.length,
      answerCoverage: percent(answeredQuestionIndexes.size, questions.length),
      questionVotes: feedback.length,
      categoryVotes: categoryFeedback.length,
      ideas: playerIdeas.length,
      averageScore,
      overallAccuracy: percent(totalCorrect, totalGraded),
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
  };
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

const answerSymbol = (status) => status === "correct" ? "✓" : status === "incorrect" ? "×" : status === "missing" ? "-" : "◐";

const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const formatSessionDate = (session) => {
  const raw = session?.session_date || session?.hosted_at || session?.date || session?.created_at;
  if (!raw) return "No date saved";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

const mostDifficultRound = (questions = []) => {
  const rounds = Object.values(questions.reduce((groups, question) => {
    const label = question.roundName || "Round";
    if (!groups[label]) groups[label] = { label, correct: 0, answered: 0 };
    groups[label].correct += Number(question.correct || 0);
    groups[label].answered += Number(question.responses || 0);
    return groups;
  }, {})).filter((round) => round.answered > 0).map((round) => ({ ...round, accuracy: percent(round.correct, round.answered) }));
  return rounds.sort((a, b) => a.accuracy - b.accuracy || b.answered - a.answered)[0] || null;
};

const commonWrongAnswers = (questions = []) => questions.flatMap((question) => (question.optionRows || []).filter((option) => !option.correct && option.total > 1).map((option) => ({ question: question.label, answer: option.label, total: option.total }))).sort((a, b) => b.total - a.total);

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
