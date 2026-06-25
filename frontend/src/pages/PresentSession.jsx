import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "../lib/supabase";
import { mergeNewerLiveState } from "../lib/liveState";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import {
  CheckCircle,
  Image,
  List,
  Loader2,
  MessageSquare,
  Sparkles,
  Tags,
  Trophy,
  Users,
} from "lucide-react";

const STORAGE_BASE = process.env.REACT_APP_SUPABASE_URL ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/` : "";
const DEFAULT_PUBLIC_SITE = "https://quizcrafter.fun";

const typeMeta = {
  true_false: { label: "True/False", short: "T/F", icon: CheckCircle, color: "text-[#71E0DC]" },
  multiple_choice: { label: "Multiple Choice", short: "MC", icon: List, color: "text-[#AEB2EF]" },
  written: { label: "Written", short: "Written", icon: MessageSquare, color: "text-emerald-400" },
};

const arrayConfig = [
  { key: "true_false_questions", type: "true_false" },
  { key: "multiple_choice_questions", type: "multiple_choice" },
  { key: "written_questions", type: "written" },
  { key: "picture_questions", type: "written" },
];

const getPublicOrigin = () => {
  if (process.env.REACT_APP_PUBLIC_SITE_URL) return process.env.REACT_APP_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (typeof window === "undefined") return "";
  if (window.location.hostname.endsWith("vercel.app")) return DEFAULT_PUBLIC_SITE;
  return window.location.origin;
};

const buildStorageUrl = (path) => {
  if (!path) return "";
  const value = String(path);
  if (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")) return value;
  if (!STORAGE_BASE) return value;
  return `${STORAGE_BASE}${value.replace(/^\/+/, "")}`;
};

const parseOptions = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : item?.text)).filter(Boolean);
  const raw = String(value).trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === "string" ? item : item?.text)).filter(Boolean);
    } catch {
      // Continue to semicolon parsing.
    }
  }

  return raw.split(";").map((item) => item.trim()).filter(Boolean);
};

const optionKey = (value) => String(value || "").trim().toLowerCase();
const seededSortValue = (seed, value) => {
  const text = `${seed}|${value}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
};
const buildAnswerOptions = (question, questionType) => {
  if (questionType === "true_false") return ["True", "False"];
  if (questionType !== "multiple_choice") return parseOptions(question.incorrect_answers || question.options);
  const answer = question.correct_answer || question.answer || "";
  const options = [answer, ...parseOptions(question.incorrect_answers || question.options)].filter(Boolean);
  const seen = new Set();
  const uniqueOptions = options.filter((option) => {
    const key = optionKey(option);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const seed = `${question.question_text || question.question || ""}|${answer}`;
  return uniqueOptions.sort((a, b) => seededSortValue(seed, a) - seededSortValue(seed, b));
};

const normalizeType = (question, fallbackType = "written") => {
  const type = question?.question_type || fallbackType;
  if (type === "true_false" || type === "multiple_choice" || type === "written") return type;
  return "written";
};

const getRoundOrder = (question, fallbackOrder = 1) => Number(question?.round_order || question?.round_number || question?.round || fallbackOrder) || fallbackOrder;
const getSourceOrder = (question, fallbackOrder = 1) => Number(question?.import_order || question?.source_order || question?.question_order || question?.order || fallbackOrder) || fallbackOrder;
const normalizeImageTiming = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (["after", "after_answer", "post", "reveal"].includes(normalized)) return "after_answer";
  return "initial";
};
const getRoundName = (question, fallbackOrder = 1) => {
  if (question?.round_name) return question.round_name;
  if (question?.round_title) return question.round_title;
  if (question?.round && Number.isNaN(Number(question.round))) return question.round;
  return `Round ${getRoundOrder(question, fallbackOrder)}`;
};

const getRoundMetadata = (session) => {
  const raw = session?.round_descriptions || session?.rounds_metadata || session?.rounds || [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
};

const getRoundDescription = (session, roundOrder, roundName) => {
  const metadata = getRoundMetadata(session);
  const match = metadata.find((round) => Number(round.order || round.round_order) === Number(roundOrder) || String(round.name || round.round_name || "").toLowerCase() === String(roundName || "").toLowerCase());
  return match?.description || match?.round_description || "";
};

const flattenSession = (session) => {
  const entries = arrayConfig.flatMap(({ key, type }) => {
    const questions = Array.isArray(session?.[key]) ? session[key] : [];
    return questions.map((question, index) => {
      const roundOrder = getRoundOrder(question, 1);
      const questionType = normalizeType(question, type);
      return {
        id: `${key}-${index}`,
        category: question.category || "General",
        questionText: question.question_text || question.question || "",
        answer: question.correct_answer || question.answer || "",
        funFact: question.fun_fact || "",
        imageUrl: question.image_url || "",
        imageTiming: normalizeImageTiming(question.image_timing || question.image_display_timing || question.media_timing || question.mediaTiming),
        options: buildAnswerOptions(question, questionType),
        type: questionType,
        roundName: getRoundName(question, roundOrder),
        roundOrder,
        sourceOrder: getSourceOrder(question, index + 1),
        roundDescription: question.round_description || getRoundDescription(session, roundOrder, getRoundName(question, roundOrder)),
      };
    });
  });

  return entries.sort((a, b) => {
    if (a.roundOrder !== b.roundOrder) return a.roundOrder - b.roundOrder;
    return a.sourceOrder - b.sourceOrder;
  });
};

const makeRounds = (questions) => {
  const groups = new Map();
  questions.forEach((question, index) => {
    const key = `${question.roundOrder}-${question.roundName}`;
    if (!groups.has(key)) groups.set(key, { key, name: question.roundName, description: question.roundDescription || "", order: question.roundOrder, startIndex: index, questions: [] });
    groups.get(key).questions.push(question);
  });
  return [...groups.values()];
};

const readPresentState = (sessionId) => {
  try {
    const raw = localStorage.getItem(`quiz-crafter-present-state-${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const getSessionLiveState = (session) => {
  const results = session?.hosted_results;
  return results && typeof results === "object" && !Array.isArray(results) && results.liveState && typeof results.liveState === "object" ? results.liveState : null;
};

const applyNewerState = (setPresentState, hasLiveStateRef, incoming) => {
  if (!incoming || typeof incoming !== "object") return;
  hasLiveStateRef.current = true;
  setPresentState((current) => mergeNewerLiveState(current, incoming));
};

const hasPresentationStarted = (presentState, currentIndex) => {
  if (presentState.gameStarted) return true;
  if (presentState.timerEndAt) return true;
  if (presentState.showAnswer || presentState.showFunFact) return true;
  return Number(currentIndex || 0) > 0;
};

const PresentSession = () => {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [presentState, setPresentState] = useState(() => readPresentState(id) || {});
  const hasLiveStateRef = useRef(false);

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true);
      const { data } = await supabase.from("sessions").select("*").eq("id", id).single();
      setSession(data || null);
      applyNewerState(setPresentState, hasLiveStateRef, getSessionLiveState(data));
      setLoading(false);
    };

    loadSession();
  }, [id]);

  useEffect(() => {
    const syncState = (event) => {
      if (hasLiveStateRef.current) return;
      if (event.key !== `quiz-crafter-present-state-${id}`) return;
      const nextState = readPresentState(id);
      if (nextState) setPresentState((current) => ({ ...current, ...nextState }));
    };

    const interval = window.setInterval(() => {
      if (hasLiveStateRef.current) return;
      const nextState = readPresentState(id);
      if (nextState) setPresentState((current) => ({ ...current, ...nextState }));
    }, 1200);
    window.addEventListener("storage", syncState);
    return () => {
      window.removeEventListener("storage", syncState);
      window.clearInterval(interval);
    };
  }, [id]);

  useEffect(() => {
    const channel = supabase.channel(`quiz-crafter-live-${id}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "host_state" }, ({ payload }) => {
        if (!payload || typeof payload !== "object") return;
        applyNewerState(setPresentState, hasLiveStateRef, payload);
        try {
          localStorage.setItem(`quiz-crafter-present-state-${id}`, JSON.stringify(payload));
        } catch {
          // The live broadcast still updates this screen if browser storage is unavailable.
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.send({ type: "broadcast", event: "present_ready", payload: { sessionId: id, requestedAt: new Date().toISOString() } });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    const loadDurableState = async () => {
      const { data } = await supabase.from("sessions").select("hosted_results").eq("id", id).single();
      applyNewerState(setPresentState, hasLiveStateRef, getSessionLiveState(data));
    };
    const interval = window.setInterval(loadDurableState, 1500);
    loadDurableState();
    return () => window.clearInterval(interval);
  }, [id]);

  const questions = useMemo(() => flattenSession(session), [session]);
  const rounds = useMemo(() => makeRounds(questions), [questions]);
  const currentIndex = Math.min(Math.max(Number(presentState.currentIndex || 0), 0), Math.max(questions.length - 1, 0));
  const savedQuestion = questions[currentIndex] || null;
  const liveQuestion = presentState.currentQuestion && Number(presentState.currentIndex || 0) === currentIndex ? presentState.currentQuestion : null;
  const currentQuestion = liveQuestion ? { ...savedQuestion, ...liveQuestion, answer: presentState.showAnswer ? (presentState.revealedAnswer || liveQuestion.answer || savedQuestion?.answer || "") : "" } : savedQuestion;
  const currentRound = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
  const mode = presentState.mode || "question";
  const introRound = mode === "categories" && presentState.introRound?.key ? (rounds.find((round) => round.key === presentState.introRound.key) || presentState.introRound) : currentRound;
  const displayRound = mode === "categories" ? introRound : currentRound;
  const sessionName = presentState.sessionName || session?.name || session?.session_name || "Trivia Session";
  const joinUrl = presentState.joinUrl || `${getPublicOrigin()}/join?session=${id}`;
  const playerCount = Number.isFinite(Number(presentState.playerCount)) ? Number(presentState.playerCount) : (presentState.players || []).length;
  const showLobby = mode === "qr" || !hasPresentationStarted(presentState, currentIndex);

  if (loading) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={42} /></div>;
  }

  if (showLobby && session) {
    return (
      <div className="min-h-screen bg-[#09090B] text-white overflow-hidden" data-testid="present-session-page">
        <LobbyView sessionName={sessionName} joinUrl={joinUrl} playerCount={playerCount} />
      </div>
    );
  }

  if (!session || !currentQuestion) {
    return (
      <div className="min-h-screen bg-[#09090B] text-white flex items-center justify-center text-center p-8">
        <div>
          <p className="text-4xl font-black mb-2">Presentation Not Ready</p>
          <p className="text-zinc-400">Open the host screen first, then choose what to show.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#09090B] text-white overflow-hidden" data-testid="present-session-page">
      <div className="h-screen flex flex-col p-3 lg:p-5">
        <header className="shrink-0 flex items-center justify-between gap-4 border-b border-white/10 pb-3">
          <div>
            <p className="text-[#71E0DC] font-semibold tracking-wide uppercase text-sm">{sessionName}</p>
            <h1 className="text-2xl lg:text-3xl font-black mt-0.5">{mode === "categories" ? "Round Intro" : mode === "leaderboard" ? "Leaderboard" : mode === "winners" ? "Winners" : mode === "feedback" ? "Feedback" : mode === "bonus_pause" ? "Bonus Coming Up" : currentRound?.name || "Question"}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-white/10 text-zinc-200 border border-white/10 text-base px-4 py-2">{displayRound?.name || "Round"}</Badge>
            {hasPresentationStarted(presentState, currentIndex) && mode !== "qr" && <HeaderJoinQr joinUrl={joinUrl} />}
          </div>
        </header>

        <main className="min-h-0 flex-1 flex items-center justify-center overflow-hidden py-3">
          {mode === "categories" && <CategoriesView round={introRound} rounds={rounds} />}
          {mode === "leaderboard" && <LeaderboardView leaderboard={presentState.leaderboard || []} />}
          {mode === "winners" && <WinnersView leaderboard={presentState.leaderboard || []} sessionName={sessionName} />}
          {mode === "feedback" && <FeedbackView />}
          {mode === "bonus_pause" && <BonusPauseView round={presentState.pendingBonusRound || currentRound} leaderboard={presentState.leaderboard || []} />}
          {mode === "qr" && <LobbyView sessionName={sessionName} joinUrl={joinUrl} playerCount={playerCount} compact={false} />}
          {mode !== "qr" && mode !== "categories" && mode !== "leaderboard" && mode !== "winners" && mode !== "feedback" && mode !== "bonus_pause" && (
            <QuestionView question={currentQuestion} index={currentIndex} total={questions.length} showAnswer={presentState.showAnswer} showFunFact={presentState.showFunFact} />
          )}
        </main>
      </div>
    </div>
  );
};

const LobbyView = ({ sessionName, joinUrl, playerCount = 0 }) => {
  return (
    <div className="h-full flex items-center justify-center p-4 text-center">
      <div className="w-full max-w-5xl">
        <p className="text-[#71E0DC] font-semibold tracking-wide uppercase text-sm mb-3">{sessionName}</p>
        <h1 className="text-4xl lg:text-6xl font-black leading-none mb-4">Join Trivia</h1>
        <div className="flex justify-center mb-4">
          <div className="rounded-2xl bg-white p-4 shadow-2xl shadow-[#71E0DC]/10">
            <QRCodeCanvas value={joinUrl} size={260} marginSize={2} level="M" className="h-52 w-52 lg:h-64 lg:w-64" />
          </div>
        </div>
        <p className="text-xl lg:text-2xl text-zinc-300 mb-3">Scan to play from your phone</p>
        <p className="mx-auto max-w-4xl break-all text-lg lg:text-2xl font-semibold text-[#71E0DC]">{joinUrl}</p>
        <div className="mt-4 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-zinc-200">
          <Users size={20} className="text-[#71E0DC]" />
          <span>{playerCount} {playerCount === 1 ? "team" : "teams"} joined</span>
          <span className="text-zinc-500">·</span>
          <span>Waiting for host to start</span>
        </div>
      </div>
    </div>
  );
};

const CategoriesView = ({ round }) => {
  const categories = round?.categories || [...new Set((round?.questions || []).map((question) => question.category).filter(Boolean))];

  return (
    <div className="h-full w-full max-w-6xl flex items-start">
        <Card className="glass-card w-full">
          <CardContent className="p-6 lg:p-8">
            <div className="flex items-center gap-4 mb-5">
              <Tags className="text-[#71E0DC]" size={38} />
              <div>
                <p className="text-lg text-zinc-400">Current round</p>
                <h2 className="text-4xl lg:text-5xl font-black">{round?.name || "Round"}</h2>
              </div>
            </div>
            {round?.description && <p className="text-2xl lg:text-3xl text-zinc-200 leading-snug mb-7">{round.description}</p>}
            <p className="text-zinc-400 uppercase tracking-wider text-base font-semibold mb-4">Round Categories</p>
            <div className="flex flex-wrap gap-4">
              {categories.map((category) => (
                <div key={category} className="rounded-lg border border-[#71E0DC]/30 bg-[#71E0DC]/10 px-5 py-3 text-2xl lg:text-3xl font-bold text-[#71E0DC]">{category}</div>
              ))}
              {!categories.length && <p className="text-zinc-400 text-2xl">No categories saved for this round yet.</p>}
            </div>
          </CardContent>
        </Card>
    </div>
  );
};

const LeaderboardView = ({ leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full">
        <CardContent className="flex h-full flex-col p-4 lg:p-5">
          <div className="flex shrink-0 items-center justify-center gap-3 mb-3">
            <Trophy className="text-amber-300" size={30} />
            <h2 className="text-3xl font-black">Leaderboard</h2>
          </div>
          <div className="min-h-0 flex-1 grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-2">
            {sorted.map((team, index) => (
              <div key={team.id || team.name} className="grid grid-cols-[64px_1fr_auto] items-center gap-4 rounded-lg border border-white/10 bg-zinc-950/70 px-5 py-4">
                <div className={`h-12 w-12 rounded-full flex items-center justify-center font-black text-xl ${index === 0 ? "bg-amber-300 text-zinc-950" : "bg-white/10 text-zinc-200"}`}>{index + 1}</div>
                <div className="text-3xl font-bold truncate">{team.name}</div>
                <div className="text-4xl font-black text-[#71E0DC]">{Number(team.score || 0)}</div>
              </div>
            ))}
            {!sorted.length && <p className="text-center text-zinc-400 text-2xl py-10">Leaderboard will appear here when teams are added on the host screen.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const HeaderJoinQr = ({ joinUrl }) => (
  <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/80 px-2 py-1.5 md:flex">
    <div className="rounded bg-white p-1">
      <QRCodeCanvas value={joinUrl} size={54} marginSize={1} level="M" />
    </div>
    <div className="pr-1 text-left">
      <p className="text-xs font-black uppercase tracking-wide text-[#71E0DC]">Late teams</p>
      <p className="text-[11px] text-zinc-400">Scan to join</p>
    </div>
  </div>
);

const WinnersView = ({ leaderboard, sessionName }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const winners = sorted.slice(0, 3);
  const first = winners[0];
  const runnersUp = winners.slice(1);

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full overflow-hidden">
        <CardContent className="flex h-full flex-col justify-center p-4 lg:p-6 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/15 shadow-2xl shadow-amber-300/10">
            <Trophy className="text-amber-300" size={32} />
          </div>
          <p className="text-[#71E0DC] text-xl font-black uppercase tracking-[0.3em]">{sessionName}</p>
          <h2 className="mt-1 text-4xl lg:text-5xl font-black leading-none text-white">Winners</h2>
          {first ? <div className="mx-auto mt-3 w-full max-w-3xl rounded-xl border-2 border-amber-300/60 bg-amber-300/15 p-4 text-center shadow-2xl shadow-amber-300/10"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-300 text-xl font-black text-zinc-950">1</div><p className="mt-2 text-sm font-black uppercase tracking-[0.2em] text-amber-200">Champion</p><p className="mt-1 truncate text-3xl font-black text-white lg:text-4xl">{first.name}</p><p className="mt-1 text-4xl font-black text-amber-200 lg:text-5xl">{Number(first.score || 0)}</p></div> : <p className="mt-4 rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-center text-xl text-zinc-400">Winners will appear once teams have scores.</p>}
          {runnersUp.length > 0 && <div className="mx-auto mt-3 grid w-full max-w-4xl grid-cols-2 gap-3 text-left">{runnersUp.map((team, index) => { const place = index + 2; return <div key={team.id || team.name} className={`rounded-xl border p-3 ${place === 2 ? "border-[#AEB2EF]/35 bg-[#AEB2EF]/10" : "border-[#71E0DC]/35 bg-[#71E0DC]/10"}`}><div className="flex items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-full font-black ${place === 2 ? "bg-[#AEB2EF] text-zinc-950" : "bg-[#71E0DC] text-zinc-950"}`}>{place}</span><p className="text-xs font-black uppercase tracking-wide text-zinc-400">{place === 2 ? "Second Place" : "Third Place"}</p></div><p className="mt-2 truncate text-2xl font-black text-white">{team.name}</p><p className="mt-1 text-3xl font-black" style={{ color: place === 2 ? "#AEB2EF" : "#71E0DC" }}>{Number(team.score || 0)}</p></div>; })}</div>}
          <p className="mt-3 text-xl font-black text-zinc-200">Thanks for playing!</p>
        </CardContent>
      </Card>
    </div>
  );
};

const FeedbackView = () => (
  <div className="h-full w-full max-w-5xl">
    <Card className="glass-card h-full overflow-hidden">
      <CardContent className="flex h-full flex-col justify-center p-5 lg:p-7 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/40 bg-[#71E0DC]/15 shadow-2xl shadow-[#71E0DC]/10">
          <Sparkles className="text-[#71E0DC]" size={36} />
        </div>
        <p className="text-[#71E0DC] text-xl font-black uppercase tracking-[0.3em]">One More Thing</p>
        <h2 className="mt-3 text-4xl lg:text-6xl font-black leading-none text-white">Send Us Ideas</h2>
        <p className="mx-auto mt-5 max-w-3xl text-2xl text-zinc-300">Use your phone to send category ideas, question ideas, or topics you want at a future trivia night.</p>
        <p className="mt-6 text-2xl font-black text-zinc-200">Thanks for playing!</p>
      </CardContent>
    </Card>
  </div>
);

const BonusPauseView = ({ round, leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full">
        <CardContent className="flex h-full flex-col p-4 lg:p-5 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10">
            <Loader2 className="animate-spin text-[#71E0DC]" size={28} />
          </div>
          <p className="text-[#71E0DC] font-bold uppercase tracking-wide mb-2">Bonus question next</p>
          <h2 className="text-3xl lg:text-5xl font-black leading-none mb-2">{round?.name || "Round"} Bonus</h2>
          <p className="text-xl text-zinc-300 mb-3">Current leaderboard</p>
          <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-2 text-left">
            {sorted.map((team, index) => (
              <div key={team.id || team.name} className="grid min-h-0 grid-cols-[42px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2">
                <div className={`h-9 w-9 rounded-full flex items-center justify-center font-black ${index === 0 ? "bg-amber-300 text-zinc-950" : "bg-white/10 text-zinc-200"}`}>{index + 1}</div>
                <div className="text-xl font-bold truncate">{team.name}</div>
                <div className="text-2xl font-black text-[#71E0DC]">{Number(team.score || 0)}</div>
              </div>
            ))}
            {!sorted.length && <p className="rounded-lg border border-white/10 bg-zinc-950/70 p-8 text-center text-2xl text-zinc-400">Leaderboard will appear once teams join or are added.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const funFactTextClass = (text = "") => {
  const length = String(text || "").length;
  if (length > 320) return "text-xl lg:text-2xl";
  if (length > 210) return "text-2xl lg:text-3xl";
  return "text-3xl lg:text-4xl";
};

const QuestionView = ({ question, index, total, showAnswer, showFunFact }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);
  const revealTiming = normalizeImageTiming(question.imageTiming || question.image_timing);
  const shouldShowImage = Boolean(imageUrl) && revealTiming !== "after_answer";
  const shouldShowFunFactImage = Boolean(imageUrl) && revealTiming === "after_answer" && showFunFact;
  const funFactOnly = Boolean(showFunFact && (question.funFact || shouldShowFunFactImage));

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full overflow-hidden">
        <CardContent className="flex h-full flex-col justify-start p-4 lg:p-5">
          <div className="flex shrink-0 items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-base px-4 py-2">{question.category}</Badge>
              <Badge className="bg-zinc-800 text-zinc-300 text-base px-4 py-2"><Icon size={16} className={`mr-2 ${meta.color}`} />{meta.label}</Badge>
              {imageUrl && <Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20 text-base px-4 py-2"><Image size={16} className="mr-2" />{question.imageTiming === "after_answer" ? "Reveal Media" : "Media"}</Badge>}
            </div>
            <span className="text-zinc-500 font-mono text-lg">{index + 1} / {total}</span>
          </div>

          {funFactOnly ? (
            <div className="min-h-0 flex flex-1 items-center justify-center">
              <div className="max-h-full min-h-0 w-full overflow-y-auto rounded-lg border border-[#AEB2EF]/30 bg-[#AEB2EF]/10 p-4 lg:p-6 text-center">
                {shouldShowFunFactImage && <div className="mb-3 flex justify-center"><img src={imageUrl} alt="Fun fact media" className="max-h-[32vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}
                <div className="flex items-center justify-center gap-3 text-[#AEB2EF] font-black mb-3 text-xl"><Sparkles size={24} />{question.funFact ? "Fun Fact" : "Media"}</div>
                {question.funFact && <p className={`${funFactTextClass(question.funFact)} font-black leading-snug text-white max-w-5xl mx-auto`}>{question.funFact}</p>}
              </div>
            </div>
          ) : (
            <>
              {shouldShowImage && <div className="mb-3 flex justify-center"><img src={imageUrl} alt="Question" className="max-h-[28vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}

              <h2 className="text-3xl lg:text-5xl font-black leading-tight text-white text-center mb-4">{question.questionText}</h2>

              {question.type === "true_false" && (
                <div className={`grid w-full grid-cols-2 gap-4 max-w-4xl mx-auto mb-3 ${showAnswer ? "" : "min-h-32 flex-1 max-h-[34vh]"}`}>
                  <div className="flex min-h-0 items-center justify-center rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-center text-4xl font-black text-emerald-300 lg:text-5xl">True</div>
                  <div className="flex min-h-0 items-center justify-center rounded-lg border-2 border-red-500/30 bg-red-500/10 px-5 py-4 text-center text-4xl font-black text-red-300 lg:text-5xl">False</div>
                </div>
              )}

              {question.type === "multiple_choice" && question.options.length > 0 && (
                <div className={`grid w-full grid-cols-2 gap-4 max-w-5xl mx-auto mb-3 ${showAnswer ? "" : "min-h-52 flex-1 max-h-[38vh] auto-rows-fr"}`}>
                  {question.options.map((option, optionIndex) => <div key={optionIndex} className="flex min-h-0 items-center rounded-lg border border-white/10 bg-zinc-900/80 px-6 py-4 text-2xl font-bold leading-tight text-zinc-100 lg:text-3xl">{option}</div>)}
                </div>
              )}

              {showAnswer && (
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                  <p className="text-zinc-400 text-sm uppercase tracking-wider mb-2">Answer</p>
                  <p className="text-3xl lg:text-4xl font-black text-emerald-300">{question.answer}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PresentSession;
