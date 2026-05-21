import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Bot, Copy, ExternalLink, Mail, MessageSquare, Send, Share2, Sparkles, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { toast } from "sonner";

const SOCIAL_STORAGE_KEY = "quiz-crafter-social-links";

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
};

const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const sessionStorageKey = (sessionId, name) => `quiz-crafter-host-tools-${sessionId}-${name}`;

const flattenSessionQuestions = (session) => [
  ...(Array.isArray(session?.true_false_questions) ? session.true_false_questions : []),
  ...(Array.isArray(session?.multiple_choice_questions) ? session.multiple_choice_questions : []),
  ...(Array.isArray(session?.written_questions) ? session.written_questions : []),
  ...(Array.isArray(session?.picture_questions) ? session.picture_questions : []),
];

const HostTools = () => {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [players, setPlayers] = useState([]);
  const [message, setMessage] = useState("");
  const [socialPost, setSocialPost] = useState("");
  const [feedback, setFeedback] = useState([]);
  const [categoryFeedback, setCategoryFeedback] = useState([]);
  const [socialLinks, setSocialLinks] = useState(() => readJson(SOCIAL_STORAGE_KEY, { facebook: "", instagram: "", x: "" }));
  const [aiDirection, setAiDirection] = useState("Make it playful, punny, and useful without giving away answers.");
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef(null);

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedSessionId) || null, [sessions, selectedSessionId]);
  const emailPlayers = useMemo(() => players.filter((player) => player.updatePreference === "email" && player.updateContact), [players]);
  const questionFeedback = useMemo(() => summarizeFeedback(feedback, "questionText"), [feedback]);
  const categoryRows = useMemo(() => summarizeFeedback(categoryFeedback, "category"), [categoryFeedback]);

  useEffect(() => {
    const loadSessions = async () => {
      const { data, error } = await supabase.from("sessions").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) {
        toast.error("Could not load sessions");
        return;
      }
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

    const channel = supabase.channel(`quiz-crafter-live-${selectedSessionId}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "player_join" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayers((current) => persistUniquePlayer(selectedSessionId, current, payload));
      })
      .on("broadcast", { event: "feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setFeedback((current) => persistVote(selectedSessionId, "feedback", current, payload, (item) => `${item.playerId}-${item.questionIndex}`));
      })
      .on("broadcast", { event: "category_feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || !payload.category) return;
        setCategoryFeedback((current) => persistVote(selectedSessionId, "category-feedback", current, payload, (item) => `${item.playerId}-${item.roundName}-${item.category}`));
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
    if (network === "x") window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "noopener,noreferrer");
    if (network === "facebook") window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`, "_blank", "noopener,noreferrer");
    if (network === "instagram") {
      copySocialPost();
      if (socialLinks.instagram) window.open(socialLinks.instagram, "_blank", "noopener,noreferrer");
    }
  };

  const generateClues = async () => {
    if (!selectedSession) return toast.error("Choose a session first");
    setGenerating(true);
    try {
      const questions = flattenSessionQuestions(selectedSession).slice(0, 40).map((question) => ({
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
        <div className="flex items-center gap-2">
          <Badge className={connected ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{connected ? "Listening live" : "Choose a session"}</Badge>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
          <label className="text-sm text-zinc-400">Session
            <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)} className="mt-1 w-full h-11 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.name || session.session_name || "Untitled Session"}</option>)}
            </select>
          </label>
          <Badge className="h-10 justify-center bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20"><Users size={15} className="mr-1" />{emailPlayers.length} email opt-ins</Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-6">
        <section className="space-y-6">
          <Card className="glass-card">
            <CardHeader><CardTitle className="text-white flex items-center gap-2"><MessageSquare className="text-[#AEB2EF]" /> Updates</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a clue, cancellation, schedule change, or player update..." className="min-h-32 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Button onClick={sendUpdate} className="gradient-btn"><Send size={16} className="mr-2" />Send In-App</Button>
                <Button onClick={openEmailDraft} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Mail size={16} className="mr-2" />Email Draft</Button>
                <Button onClick={copyEmails} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Emails</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader><CardTitle className="text-white flex items-center gap-2"><Bot className="text-[#71E0DC]" /> AI Clue Assistant</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <textarea value={aiDirection} onChange={(event) => setAiDirection(event.target.value)} className="min-h-20 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" />
              <Button onClick={generateClues} disabled={generating || !selectedSession} className="gradient-btn">{generating ? <Sparkles className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}Draft Punny Clues</Button>
              <p className="text-xs text-zinc-500">AI studies the selected session questions and drafts a clue/update plus a social post without revealing answers.</p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader><CardTitle className="text-white flex items-center gap-2"><Share2 className="text-[#71E0DC]" /> Social Media</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <textarea value={socialPost} onChange={(event) => setSocialPost(event.target.value)} placeholder="Social post text..." className="min-h-28 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Button onClick={copySocialPost} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><Copy size={16} className="mr-2" />Copy Post</Button>
                <Button onClick={() => openSocialComposer("facebook")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Facebook</Button>
                <Button onClick={() => openSocialComposer("x")} variant="outline" className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />X/Twitter</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <input value={socialLinks.facebook} onChange={(event) => updateSocialLink("facebook", event.target.value)} placeholder="Facebook page link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" />
                <input value={socialLinks.instagram} onChange={(event) => updateSocialLink("instagram", event.target.value)} placeholder="Instagram profile link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" />
                <input value={socialLinks.x} onChange={(event) => updateSocialLink("x", event.target.value)} placeholder="X/Twitter profile link" className="h-10 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none" />
              </div>
              <p className="text-xs text-zinc-500">For now this opens/copies posts. Fully automatic posting will need connected social accounts and permissions.</p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-6">
          <FeedbackCard title="Player Feedback" rows={questionFeedback} empty="Question likes and dislikes will appear here while this page is listening." />
          <FeedbackCard title="Category Feedback" rows={categoryRows} empty="Category likes and dislikes come from the released Round Info screen." />
        </section>
      </div>
    </div>
  );
};

const persistUniquePlayer = (sessionId, current, payload) => {
  const nextPlayer = { id: payload.playerId, name: payload.playerName || "Team", updatePreference: payload.updatePreference || "none", updateContact: payload.updateContact || "", joinedAt: payload.joinedAt };
  const next = current.some((player) => player.id === payload.playerId) ? current.map((player) => player.id === payload.playerId ? { ...player, ...nextPlayer } : player) : [...current, nextPlayer];
  writeJson(sessionStorageKey(sessionId, "players"), next);
  return next;
};

const persistVote = (sessionId, key, current, payload, makeKey) => {
  const filtered = current.filter((item) => makeKey(item) !== makeKey(payload));
  const next = [...filtered, payload];
  writeJson(sessionStorageKey(sessionId, key), next);
  return next;
};

const summarizeFeedback = (items, labelKey) => Object.values(items.reduce((groups, item) => {
  const label = item[labelKey] || "Unlabeled";
  if (!groups[label]) groups[label] = { label, likes: 0, dislikes: 0 };
  if (item.sentiment === "like") groups[label].likes += 1;
  if (item.sentiment === "dislike") groups[label].dislikes += 1;
  return groups;
}, {})).sort((a, b) => (b.likes + b.dislikes) - (a.likes + a.dislikes));

const FeedbackCard = ({ title, rows, empty }) => (
  <Card className="glass-card">
    <CardHeader><CardTitle className="text-white flex items-center gap-2"><Sparkles className="text-[#71E0DC]" />{title}</CardTitle></CardHeader>
    <CardContent className="space-y-2 max-h-[520px] overflow-y-auto">
      {rows.map((row) => <div key={row.label} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-sm font-semibold text-zinc-200 mb-2 line-clamp-2">{row.label}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 text-center"><ThumbsUp className="mx-auto text-emerald-300 mb-1" size={16} /><p className="text-xl font-black text-emerald-300">{row.likes}</p></div><div className="rounded-md bg-red-500/10 border border-red-500/20 p-2 text-center"><ThumbsDown className="mx-auto text-red-300 mb-1" size={16} /><p className="text-xl font-black text-red-300">{row.dislikes}</p></div></div></div>)}
      {!rows.length && <p className="text-sm text-zinc-500 text-center py-8">{empty}</p>}
    </CardContent>
  </Card>
);

export default HostTools;
