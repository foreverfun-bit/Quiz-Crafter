import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Copy, ExternalLink, Image, Mail, MessageSquare, Palette, Save, Send, Sparkles, Upload, Users } from "lucide-react";
import { toast } from "sonner";

const SOCIAL_STORAGE_KEY = "quiz-crafter-social-links";
const HOST_DEFAULT_BRANDING_KEY = "quiz-crafter-host-branding-defaults";
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
  { key: "feedback", label: "Feedback", icon: MessageSquare },
  { key: "updates", label: "Updates", icon: Mail },
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
  const [message, setMessage] = useState("");
  const [socialPost, setSocialPost] = useState("");
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
    setPlayers(readJson(sessionStorageKey(selectedSessionId, "players"), []));
    setFeedback(readJson(sessionStorageKey(selectedSessionId, "feedback"), []));
    setCategoryFeedback(readJson(sessionStorageKey(selectedSessionId, "category-feedback"), []));
    setPlayerIdeas(readJson(sessionStorageKey(selectedSessionId, "ideas"), []));

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
  };
  const saveDefaultBranding = (nextBranding) => {
    const cleanBranding = normalizeBranding(nextBranding);
    setBranding(cleanBranding);
    writeDefaultBranding(cleanBranding);
    toast.success("Default host branding saved");
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

      {activeTab === "feedback" && <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-6"><FeedbackCard title="Question Feedback" rows={questionFeedback} empty="Question likes and dislikes will appear here after players tap the thumbs during a live session." /><FeedbackCard title="Category Feedback" rows={categoryRows} empty="Category likes and dislikes come from the released Round Info screen." /><IdeasFeedbackCard ideas={playerIdeas} /></div>}

      {activeTab === "updates" && <section className="space-y-6 max-w-5xl"><Panel title="Email and Player Updates" icon={MessageSquare}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a clue, cancellation, schedule change, or player update..." className="min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={sendUpdate} className="gradient-btn"><Send size={16} className="mr-2" />Send In-App</Button><Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email Draft</Button><Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Emails</Button></div></Panel><Panel title="AI Clue Assistant" icon={Sparkles}><textarea value={aiDirection} onChange={(event) => setAiDirection(event.target.value)} className="min-h-20 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><Button onClick={generateClues} disabled={generating || !selectedSession} className="gradient-btn">{generating ? <Sparkles className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}Draft Punny Clues</Button><p className="text-xs text-zinc-500">AI studies the selected session and drafts an update plus a social post without revealing answers.</p></Panel><Panel title="Social Media" icon={ExternalLink}><textarea value={socialPost} onChange={(event) => setSocialPost(event.target.value)} placeholder="Social post text..." className="min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /><div className="grid grid-cols-1 md:grid-cols-3 gap-2"><Button onClick={copySocialPost} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Post</Button><Button onClick={() => openSocialComposer("facebook")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Facebook</Button><Button onClick={() => openSocialComposer("x")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />X/Twitter</Button></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2"><input value={socialLinks.facebook} onChange={(event) => updateSocialLink("facebook", event.target.value)} placeholder="Facebook page link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.instagram} onChange={(event) => updateSocialLink("instagram", event.target.value)} placeholder="Instagram profile link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /><input value={socialLinks.x} onChange={(event) => updateSocialLink("x", event.target.value)} placeholder="X/Twitter profile link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" /></div><p className="text-xs text-zinc-500">For now this opens/copies posts. Fully automatic posting will need connected social accounts and permissions.</p></Panel></section>}

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

const persistPlayer = (sessionId, current, payload) => {
  const nextPlayer = { id: payload.playerId, name: payload.playerName || "Team", updatePreference: payload.updatePreference || "none", updateContact: payload.updateContact || "", joinedAt: payload.joinedAt };
  const next = current.some((player) => player.id === payload.playerId) ? current.map((player) => player.id === payload.playerId ? { ...player, ...nextPlayer } : player) : [...current, nextPlayer];
  writeJson(sessionStorageKey(sessionId, "players"), next);
  return next;
};

const persistVote = (sessionId, key, current, payload, makeKey) => {
  const next = [...current.filter((item) => makeKey(item) !== makeKey(payload)), payload];
  writeJson(sessionStorageKey(sessionId, key), next);
  return next;
};

const persistIdea = (sessionId, current, payload) => {
  const next = [payload, ...current.filter((item) => !(item.playerId === payload.playerId && item.submittedAt === payload.submittedAt))].slice(0, 200);
  writeJson(sessionStorageKey(sessionId, "ideas"), next);
  return next;
};

const summarize = (items, labelKey) => Object.values(items.reduce((groups, item) => {
  const label = item[labelKey] || "Unlabeled";
  if (!groups[label]) groups[label] = { label, likes: 0, dislikes: 0 };
  if (item.sentiment === "like") groups[label].likes += 1;
  if (item.sentiment === "dislike") groups[label].dislikes += 1;
  return groups;
}, {})).sort((a, b) => (b.likes + b.dislikes) - (a.likes + a.dislikes));

const FeedbackCard = ({ title, rows, empty }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Sparkles className="text-[#71E0DC]" />{title}</CardTitle></CardHeader><CardContent className="space-y-2 max-h-[520px] overflow-y-auto">{rows.map((row) => <div key={row.label} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-sm font-semibold text-zinc-200 mb-2 line-clamp-2">{row.label}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 text-center"><p className="text-xs text-zinc-500">Likes</p><p className="text-xl font-black text-emerald-300">{row.likes}</p></div><div className="rounded-md bg-red-500/10 border border-red-500/20 p-2 text-center"><p className="text-xs text-zinc-500">Dislikes</p><p className="text-xl font-black text-red-300">{row.dislikes}</p></div></div></div>)}{!rows.length && <p className="text-sm text-zinc-500 text-center py-8">{empty}</p>}</CardContent></Card>;

const IdeasFeedbackCard = ({ ideas }) => <Card className="glass-card xl:col-span-2"><CardHeader><CardTitle className="text-white flex items-center gap-2"><MessageSquare className="text-[#71E0DC]" />End-of-Session Ideas</CardTitle></CardHeader><CardContent className="space-y-3 max-h-[520px] overflow-y-auto">{ideas.map((idea, index) => <div key={`${idea.playerId}-${idea.submittedAt}-${index}`} className="rounded-lg border border-white/10 bg-zinc-950/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2 mb-3"><p className="font-bold text-white">{idea.playerName || "Team"}</p><p className="text-xs text-zinc-500">{formatDateTime(idea.submittedAt)}</p></div>{idea.category && <p className="text-sm text-zinc-300"><span className="text-[#71E0DC] font-semibold">Category idea:</span> {idea.category}</p>}{idea.question && <p className="text-sm text-zinc-300 mt-2"><span className="text-[#AEB2EF] font-semibold">Question idea:</span> {idea.question}</p>}</div>)}{!ideas.length && <p className="text-sm text-zinc-500 text-center py-8">Player category and question ideas from the post-game feedback screen will appear here.</p>}</CardContent></Card>;

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

export default HostTools;
