import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { BarChart3, Copy, ExternalLink, Image, Lightbulb, Mail, MessageSquare, Palette, Save, Send, Sparkles, ThumbsDown, ThumbsUp, TrendingUp, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { readActiveVenueId, readLocalTemplates, readLocalVenues } from "../lib/venues";
import { loadHostToolsSessionState, profileKeys, saveHostToolsSessionState, saveProfileValue, syncProfileJson } from "../lib/profileState";

const SOCIAL_STORAGE_KEY = "quiz-crafter-social-links";
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
const readDefaultBranding = () => normalizeBranding({ ...DEFAULT_BRANDING, ...readJson(HOST_DEFAULT_BRANDING_KEY, {}) });
const writeDefaultBranding = (branding) => writeJson(HOST_DEFAULT_BRANDING_KEY, normalizeBranding(branding));
const sessionStorageKey = (sessionId, name) => `quiz-crafter-host-tools-${sessionId}-${name}`;
const sessionQuestions = (session) => [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions].flatMap((value) => Array.isArray(value) ? value : []);
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
const hostToolTabs = [
  { key: "live", label: "Live Hosting", icon: ExternalLink },
  { key: "insights", label: "Insights", icon: BarChart3 },
  { key: "outreach", label: "Outreach", icon: Mail },
  { key: "branding", label: "Branding", icon: Palette },
];

const HostTools = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [activeTab, setActiveTab] = useState("live");
  const [players, setPlayers] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [categoryFeedback, setCategoryFeedback] = useState([]);
  const [playerIdeas, setPlayerIdeas] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [message, setMessage] = useState("");
  const [socialPost, setSocialPost] = useState("");
  const [assistantRequest, setAssistantRequest] = useState("Look at this session and tell me what feels too easy, too hard, repetitive, or missing for my regular trivia crowd.");
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [aiDirection, setAiDirection] = useState("Make it playful, punny, and useful without giving away answers.");
  const [socialLinks, setSocialLinks] = useState(() => readJson(SOCIAL_STORAGE_KEY, { facebook: "", instagram: "", x: "" }));
  const [branding, setBranding] = useState(readDefaultBranding);
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef(null);

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const emailPlayers = useMemo(() => players.filter((player) => player.updatePreference === "email" && player.updateContact), [players]);
  const questionFeedback = useMemo(() => summarize(feedback, "questionText"), [feedback]);
  const categoryRows = useMemo(() => summarize(categoryFeedback, "category"), [categoryFeedback]);
  const analytics = useMemo(() => buildAnalytics({ selectedSession, players, feedback, categoryFeedback, playerIdeas, answers, activity, emailPlayers }), [selectedSession, players, feedback, categoryFeedback, playerIdeas, answers, activity, emailPlayers]);

  useEffect(() => {
    const loadHostBranding = async () => {
      const localBranding = readDefaultBranding();
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const remoteBranding = data?.user?.user_metadata?.[metadataBrandingKey];
        if (remoteBranding && typeof remoteBranding === "object") {
          const cleanBranding = normalizeBranding(remoteBranding);
          setBranding(cleanBranding);
          writeDefaultBranding(cleanBranding);
        } else if (localBranding.logoUrl || localBranding.name !== DEFAULT_BRANDING.name) {
          await supabase.auth.updateUser({ data: { [metadataBrandingKey]: localBranding } });
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
    const loadStoredHostTools = async () => {
      const localState = {
        players: readJson(sessionStorageKey(selectedSessionId, "players"), []),
        feedback: readJson(sessionStorageKey(selectedSessionId, "feedback"), []),
        categoryFeedback: readJson(sessionStorageKey(selectedSessionId, "category-feedback"), []),
        ideas: readJson(sessionStorageKey(selectedSessionId, "ideas"), []),
        answers: readJson(sessionStorageKey(selectedSessionId, "answers"), []),
        activity: readJson(sessionStorageKey(selectedSessionId, "activity"), []),
      };
      try {
        const profileState = await loadHostToolsSessionState(selectedSessionId);
        const nextState = {
          players: mergeByKey(profileState.players, localState.players, (item) => item.id),
          feedback: mergeByKey(profileState.feedback, localState.feedback, (item) => `${item.playerId}-${item.questionIndex}`),
          categoryFeedback: mergeByKey(profileState.categoryFeedback, localState.categoryFeedback, (item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`),
          ideas: mergeByKey(profileState.ideas, localState.ideas, (item) => `${item.playerId}-${item.submittedAt}`),
          answers: mergeByKey(profileState.answers, localState.answers, (item) => `${item.playerId}-${item.questionIndex}`),
          activity: [...(Array.isArray(profileState.activity) ? profileState.activity : []), ...(Array.isArray(localState.activity) ? localState.activity : [])].slice(-800),
        };
        setPlayers(nextState.players);
        setFeedback(nextState.feedback);
        setCategoryFeedback(nextState.categoryFeedback);
        setPlayerIdeas(nextState.ideas);
        setAnswers(nextState.answers);
        setActivity(nextState.activity);
        Object.entries(nextState).forEach(([key, value]) => writeJson(sessionStorageKey(selectedSessionId, key === "categoryFeedback" ? "category-feedback" : key), value));
        saveHostToolsSessionState(selectedSessionId, nextState).catch((error) => console.warn("Host tools profile save unavailable:", error));
      } catch (error) {
        console.warn("Host tools profile sync unavailable:", error);
        setPlayers(localState.players);
        setFeedback(localState.feedback);
        setCategoryFeedback(localState.categoryFeedback);
        setPlayerIdeas(localState.ideas);
        setAnswers(localState.answers);
        setActivity(localState.activity);
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
      const { error } = await supabase.auth.updateUser({ data: { [metadataBrandingKey]: cleanBranding } });
      if (error) throw error;
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
    if (!emailPlayers.length) return toast.error("No email opt-ins yet");
    await navigator.clipboard.writeText(emailPlayers.map((player) => player.updateContact).join(", "));
    toast.success("Email list copied");
  };

  const openEmailDraft = () => {
    if (!emailPlayers.length) return toast.error("No email opt-ins yet");
    const subject = encodeURIComponent(selectedSession?.name || selectedSession?.session_name || "Trivia update");
    const body = encodeURIComponent(message || socialPost || "");
    const bcc = encodeURIComponent(emailPlayers.map((player) => player.updateContact).join(","));
    window.location.href = `mailto:?bcc=${bcc}&subject=${subject}&body=${body}`;
  };

  const copySocialPost = async () => {
    const text = socialPost.trim() || message.trim();
    if (!text) return toast.error("Write or generate a post first");
    await navigator.clipboard.writeText(text);
    toast.success("Social post copied");
  };

  const openSocialComposer = (network) => {
    const text = encodeURIComponent(socialPost.trim() || message.trim() || "Trivia update");
    const url = encodeURIComponent(window.location.origin);
    if (network === "facebook") window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`, "_blank", "noopener,noreferrer");
    if (network === "x") window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "noopener,noreferrer");
  };

  const generateClues = async () => {
    if (!selectedSession) return toast.error("Choose a session first");
    setGenerating(true);
    try {
      const questions = sessionQuestions(selectedSession).slice(0, 40).map((question) => ({
        category: question.category || "",
        question: question.question_text || question.question || "",
        answer: question.correct_answer || question.answer || "",
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

  const askHostAssistant = async () => {
    const request = assistantRequest.trim();
    if (!request) return toast.error("Ask the assistant for something first");
    setAssistantLoading(true);
    try {
      const venues = readLocalVenues();
      const templates = readLocalTemplates();
      const activeVenueId = readActiveVenueId();
      const activeVenue = venues.find((venue) => venue.id === activeVenueId) || venues[0] || null;
      const questions = sessionQuestions(selectedSession).slice(0, 40).map((question) => ({ category: question.category || "", question: question.question_text || question.question || "", answer: question.correct_answer || question.answer || "", fun_fact: question.fun_fact || "" }));
      const response = await fetch("/api/host-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, context: { session: selectedSession, venue: activeVenue, template: templates[0] || null, questions, feedback, ideas: playerIdeas } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Could not run host assistant");
      setAssistantAnswer(data.answer || "");
      toast.success("Assistant response ready");
    } catch (error) {
      toast.error(error.message || "Could not run host assistant");
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="host-tools-page">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Host Tools</h1>
          <p className="text-zinc-500">Player updates, email opt-ins, social posts, and feedback live outside the hosting controls.</p>
        </div>
        <Badge className={connected ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{connected ? "Listening live" : "Choose a session"}</Badge>
      </div>

      <Card className="glass-card mb-6"><CardContent className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end"><label className="text-sm text-zinc-400">Session<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} className="mt-1 w-full h-11 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{sessions.map((session) => <option key={session.id} value={session.id}>{session.name || session.session_name || "Untitled Session"}</option>)}</select></label><Badge className="h-10 justify-center bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20"><Users size={15} className="mr-1" />{emailPlayers.length} email opt-ins</Badge></CardContent></Card>

      <Card className="glass-card mb-6"><CardContent className="p-2 grid grid-cols-2 lg:grid-cols-4 gap-2">{hostToolTabs.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-12 rounded-lg border px-3 font-semibold flex items-center justify-center gap-2 transition ${activeTab === key ? "bg-[#71E0DC]/20 border-[#71E0DC]/45 text-white shadow-[0_0_24px_rgba(113,224,220,.12)]" : "bg-zinc-950/50 border-white/10 text-zinc-400 hover:text-white hover:border-white/20"}`}><Icon size={17} />{label}</button>)}</CardContent></Card>

      {activeTab === "live" && <LiveHostingPanel selectedSessionId={selectedSessionId} selectedSession={selectedSession} players={players} connected={connected} />}

      {activeTab === "insights" && <InsightsPanel analytics={analytics} questionFeedback={questionFeedback} categoryRows={categoryRows} playerIdeas={playerIdeas} assistantRequest={assistantRequest} setAssistantRequest={setAssistantRequest} askHostAssistant={askHostAssistant} assistantLoading={assistantLoading} assistantAnswer={assistantAnswer} />}

      {activeTab === "outreach" && <OutreachPanel message={message} setMessage={setMessage} sendUpdate={sendUpdate} openEmailDraft={openEmailDraft} copyEmails={copyEmails} aiDirection={aiDirection} setAiDirection={setAiDirection} generateClues={generateClues} generating={generating} selectedSession={selectedSession} socialPost={socialPost} setSocialPost={setSocialPost} copySocialPost={copySocialPost} openSocialComposer={openSocialComposer} socialLinks={socialLinks} updateSocialLink={updateSocialLink} />}

      {activeTab === "branding" && <section className="max-w-5xl"><BrandingPanel branding={branding} setBranding={setBranding} onSave={saveDefaultBranding} /></section>}
    </div>
  );
};

const Panel = ({ title, icon: Icon, children }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Icon className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-4">{children}</CardContent></Card>;

const LiveHostingPanel = ({ selectedSessionId, selectedSession, players, connected }) => {
  const sessionName = selectedSession?.name || selectedSession?.session_name || "Choose a session";
  const openScreen = (path) => {
    if (!selectedSessionId) return toast.error("Choose a session first");
    window.open(path, "_blank", "noopener,noreferrer");
  };
  return <section className="max-w-5xl"><Panel title="Live Hosting" icon={ExternalLink}><div className="rounded-xl border border-white/10 bg-zinc-950/70 p-5"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-zinc-500">Selected session</p><h2 className="text-2xl font-black text-white">{sessionName}</h2><p className="text-sm text-zinc-500 mt-1">{players.length} player{players.length === 1 ? "" : "s"} seen in Host Tools</p></div><Badge className={connected ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{connected ? "Listening live" : "Not connected"}</Badge></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Button onClick={() => openScreen(`/host-session/${selectedSessionId}`)} disabled={!selectedSessionId} className="gradient-btn h-12"><ExternalLink size={17} className="mr-2" />Open Live Hosting Screen</Button><Button onClick={() => openScreen(`/present-session/${selectedSessionId}`)} disabled={!selectedSessionId} variant="outline" className="h-12 border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={17} className="mr-2" />Open Presentation Screen</Button></div></Panel></section>;
};

const InsightsPanel = ({ analytics, questionFeedback, categoryRows, playerIdeas, assistantRequest, setAssistantRequest, askHostAssistant, assistantLoading, assistantAnswer }) => <section className="space-y-6"><AnalyticsPanel analytics={analytics} /><div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><FeedbackCard title="Question Feedback" rows={questionFeedback} empty="Question likes and dislikes will appear here after players tap the thumbs during a live session." /><FeedbackCard title="Category Feedback" rows={categoryRows} empty="Category likes and dislikes come from the released Round Info screen." /><IdeasFeedbackCard ideas={playerIdeas} /></div><section className="max-w-5xl"><Panel title="AI Host Assistant" icon={Sparkles}><textarea value={assistantRequest} onChange={(event) => setAssistantRequest(event.target.value)} placeholder="Ask for a replacement question, round balance advice, clue rewrite, pacing help, or a plan for this venue..." className="min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="flex flex-wrap gap-2"><Button onClick={askHostAssistant} disabled={assistantLoading} className="gradient-btn">{assistantLoading ? <Sparkles className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}Ask Assistant</Button><Button variant="outline" onClick={() => setAssistantRequest("Look at this session and tell me what feels too easy, too hard, repetitive, or missing for my regular trivia crowd.")} className="border-white/10 text-zinc-300 hover:text-white">Review Session</Button><Button variant="outline" onClick={() => setAssistantRequest("Draft a fresh replacement question for the current session that avoids common bar trivia repeats. Include answer and fun fact.")} className="border-white/10 text-zinc-300 hover:text-white">Replacement</Button><Button variant="outline" onClick={() => setAssistantRequest("Help me turn harder questions into fair written-answer questions instead of true/false or multiple choice.")} className="border-white/10 text-zinc-300 hover:text-white">Written Help</Button></div>{assistantAnswer && <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-4 text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap">{assistantAnswer}</div>}<p className="text-xs text-zinc-500">Uses the selected session plus saved venue/template memory and player feedback stored on this device.</p></Panel></section></section>;

const OutreachPanel = ({ message, setMessage, sendUpdate, openEmailDraft, copyEmails, aiDirection, setAiDirection, generateClues, generating, selectedSession, socialPost, setSocialPost, copySocialPost, openSocialComposer, socialLinks, updateSocialLink }) => <section className="space-y-6 max-w-5xl"><Panel title="Email and Player Updates" icon={MessageSquare}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a clue, cancellation, schedule change, or player update..." className="min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={sendUpdate} className="gradient-btn"><Send size={16} className="mr-2" />Send In-App</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email Draft</Button><Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Emails</Button></div></Panel><Panel title="AI Clue Assistant" icon={Sparkles}><textarea value={aiDirection} onChange={(event) => setAiDirection(event.target.value)} className="min-h-20 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><Button onClick={generateClues} disabled={generating || !selectedSession} className="gradient-btn">{generating ? <Sparkles className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}Draft Punny Clues</Button><p className="text-xs text-zinc-500">AI studies the selected session and drafts an update plus a social post without revealing answers.</p></Panel><Panel title="Social Media" icon={ExternalLink}><textarea value={socialPost} onChange={(event) => setSocialPost(event.target.value)} placeholder="Social post text..." className="min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={copySocialPost} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Post</Button><Button onClick={() => openSocialComposer("facebook")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Facebook</Button><Button onClick={() => openSocialComposer("x")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />X/Twitter</Button></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2"><input value={socialLinks.facebook} onChange={(event) => updateSocialLink("facebook", event.target.value)} placeholder="Facebook page link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.instagram} onChange={(event) => updateSocialLink("instagram", event.target.value)} placeholder="Instagram profile link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.x} onChange={(event) => updateSocialLink("x", event.target.value)} placeholder="X/Twitter profile link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /></div><p className="text-xs text-zinc-500">For now this opens/copies posts. Fully automatic posting will need connected social accounts and permissions.</p></Panel></section>;

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
  if (!groups[label]) groups[label] = { label, likes: 0, dislikes: 0 };
  if (item.sentiment === "like") groups[label].likes += 1;
  if (item.sentiment === "dislike") groups[label].dislikes += 1;
  return groups;
}, {})).sort((a, b) => (b.likes + b.dislikes) - (a.likes + a.dislikes));

const getQuestionText = (question) => question?.question_text || question?.question || "";
const getQuestionType = (question) => question?.question_type || (question?.incorrect_answers ? "multiple_choice" : "written");
const getQuestionCategory = (question) => question?.category || "Uncategorized";
const getQuestionKey = (question, index) => String(question?.id || `${index}-${getQuestionText(question)}`);
const percent = (value, total) => total > 0 ? Math.round((value / total) * 100) : 0;
const compactLabel = (value, fallback = "Unknown") => String(value || fallback).replace(/\s+/g, " ").trim();
const sortByTotal = (rows) => [...rows].sort((a, b) => (b.total || 0) - (a.total || 0));
const scoreRows = (rows) => [...rows].map((row) => ({ ...row, score: Number(row.likes || 0) - Number(row.dislikes || 0), total: Number(row.likes || 0) + Number(row.dislikes || 0) }));

const buildAnalytics = ({ selectedSession, players, feedback, categoryFeedback, playerIdeas, answers, activity, emailPlayers }) => {
  const questions = sessionQuestions(selectedSession);
  const questionRows = questions.map((question, index) => {
    const text = compactLabel(getQuestionText(question), `Question ${index + 1}`);
    const votes = feedback.filter((item) => Number(item.questionIndex) === index || item.questionText === text);
    const responses = answers.filter((answer) => Number(answer.questionIndex) === index);
    return {
      key: getQuestionKey(question, index),
      label: text,
      category: getQuestionCategory(question),
      type: getQuestionType(question),
      likes: votes.filter((item) => item.sentiment === "like").length,
      dislikes: votes.filter((item) => item.sentiment === "dislike").length,
      responses: responses.length,
      responseRate: percent(responses.length, players.length),
    };
  });

  const categoryRows = scoreRows(summarize(categoryFeedback, "category"));
  const questionVoteRows = scoreRows(questionRows);
  const answeredQuestionIndexes = new Set(answers.map((answer) => Number(answer.questionIndex)));
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
    },
    topQuestions: questionVoteRows.filter((row) => row.total > 0).sort((a, b) => b.score - a.score || b.total - a.total).slice(0, 5),
    needsReview: questionVoteRows.filter((row) => row.total > 0 || row.responses > 0).sort((a, b) => a.score - b.score || b.dislikes - a.dislikes).slice(0, 5),
    categoryRows,
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

const FeedbackCard = ({ title, rows, empty }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Sparkles className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-2 max-h-[520px] overflow-y-auto">{rows.map((row) => <div key={row.label} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-sm font-semibold text-zinc-200 mb-2 line-clamp-2">{row.label}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 text-center"><p className="text-xs text-zinc-500">Likes</p><p className="text-xl font-black text-emerald-300">{row.likes}</p></div><div className="rounded-md bg-red-500/10 border border-red-500/20 p-2 text-center"><p className="text-xs text-zinc-500">Dislikes</p><p className="text-xl font-black text-red-300">{row.dislikes}</p></div></div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">{empty}</p>}</CardContent></Card>;

const IdeasFeedbackCard = ({ ideas }) => <Card className="glass-card xl:col-span-2"><CardHeader><CardTitle className="text-white flex items-center gap-2"><MessageSquare className="text-[#71E0DC]" />End-of-Session Ideas</CardTitle></CardHeader><CardContent className="space-y-3 max-h-[520px] overflow-y-auto">{ideas.map((idea, index) => <div key={`${idea.playerId}-${idea.submittedAt}-${index}`} className="rounded-lg border border-white/10 bg-zinc-950/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><p className="font-bold text-white">{idea.playerName || "Team"}</p><p className="text-xs text-zinc-500">{formatDateTime(idea.submittedAt)}</p></div>{idea.category && <p className="text-sm text-zinc-300"><span className="text-[#71E0DC] font-semibold">Category idea:</span> {idea.category}</p>}{idea.question && <p className="text-sm text-zinc-300 mt-2"><span className="text-[#AEB2EF] font-semibold">Question idea:</span> {idea.question}</p>}</div>)}{!ideas.length && <p className="text-sm text-zinc-500 text-center py-8">Player category and question ideas from the post-game feedback screen will appear here.</p>}</CardContent></Card>;

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

export default HostTools;
