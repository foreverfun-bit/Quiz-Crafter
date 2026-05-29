import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "../lib/supabase";
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
    return JSON.parse(localStorage.getItem(`quiz-crafter-present-state-${sessionId}`) || "{}");
  } catch {
    return {};
  }
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
  const [presentState, setPresentState] = useState(() => readPresentState(id));

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true);
      const { data } = await supabase.from("sessions").select("*").eq("id", id).single();
      setSession(data || null);
      setLoading(false);
    };

    loadSession();
  }, [id]);

  useEffect(() => {
    const syncState = (event) => {
      if (event.key === `quiz-crafter-present-state-${id}`) setPresentState(readPresentState(id));
    };

    const interval = window.setInterval(() => setPresentState(readPresentState(id)), 1200);
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
        if (!payload) return;
        setPresentState(payload);
        try {
          localStorage.setItem(`quiz-crafter-present-state-${id}`, JSON.stringify(payload));
        } catch {
          // The live broadcast still updates this screen if browser storage is unavailable.
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
  const showLobby = !hasPresentationStarted(presentState, currentIndex);

  if (loading) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={42} /></div>;
  }

  if (showLobby && session) {
    return (
      <div className="min-h-screen bg-[#09090B] text-white overflow-hidden" data-testid="present-session-page">
        <LobbyView sessionName={sessionName} joinUrl={joinUrl} players={presentState.players || []} />
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
    <div className="min-h-screen bg-[#09090B] text-white overflow-hidden" data-testid="present-session-page">
      <div className="min-h-screen flex flex-col p-6 lg:p-10">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-[#71E0DC] font-semibold tracking-wide uppercase text-sm">{sessionName}</p>
            <h1 className="text-3xl lg:text-5xl font-black mt-1">{mode === "categories" ? "Round Intro" : mode === "leaderboard" ? "Leaderboard" : mode === "winners" ? "Winners" : mode === "feedback" ? "Feedback" : mode === "bonus_pause" ? "Bonus Coming Up" : currentRound?.name || "Question"}</h1>
          </div>
          <Badge className="bg-white/10 text-zinc-200 border border-white/10 text-base px-4 py-2">{displayRound?.name || "Round"}</Badge>
        </header>

        <main className="flex-1 flex items-center justify-center py-8">
          {mode === "categories" && <CategoriesView round={introRound} rounds={rounds} />}
          {mode === "leaderboard" && <LeaderboardView leaderboard={presentState.leaderboard || []} />}
          {mode === "winners" && <WinnersView leaderboard={presentState.leaderboard || []} sessionName={sessionName} />}
          {mode === "feedback" && <FeedbackView />}
          {mode === "bonus_pause" && <BonusPauseView round={presentState.pendingBonusRound || currentRound} leaderboard={presentState.leaderboard || []} />}
          {mode !== "categories" && mode !== "leaderboard" && mode !== "winners" && mode !== "feedback" && mode !== "bonus_pause" && (
            <QuestionView question={currentQuestion} index={currentIndex} total={questions.length} showAnswer={presentState.showAnswer} showFunFact={presentState.showFunFact} />
          )}
        </main>
      </div>
    </div>
  );
};

const LobbyView = ({ sessionName, joinUrl, players }) => {
  const playerCount = players.length;

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div className="w-full max-w-5xl">
        <p className="text-[#71E0DC] font-semibold tracking-wide uppercase text-sm mb-3">{sessionName}</p>
        <h1 className="text-5xl lg:text-8xl font-black leading-none mb-8">Join Trivia</h1>
        <div className="flex justify-center mb-7">
          <div className="rounded-2xl bg-white p-4 shadow-2xl shadow-[#71E0DC]/10">
            <QRCodeCanvas value={joinUrl} size={320} marginSize={2} level="M" className="h-72 w-72 lg:h-80 lg:w-80" />
          </div>
        </div>
        <p className="text-xl lg:text-2xl text-zinc-300 mb-3">Scan to play from your phone</p>
        <p className="mx-auto max-w-4xl break-all text-lg lg:text-2xl font-semibold text-[#71E0DC]">{joinUrl}</p>
        <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-zinc-200">
          <Users size={20} className="text-[#71E0DC]" />
          <span>{playerCount} {playerCount === 1 ? "team" : "teams"} joined</span>
          <span className="text-zinc-500">·</span>
          <span>Waiting for host to start</span>
        </div>
      </div>
    </div>
  );
};

const CategoriesView = ({ round, rounds }) => {
  const categories = round?.categories || [...new Set((round?.questions || []).map((question) => question.category).filter(Boolean))];

  return (
    <div className="w-full max-w-6xl">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <Card className="glass-card">
          <CardContent className="p-8 lg:p-10">
            <div className="flex items-center gap-3 mb-8">
              <Tags className="text-[#71E0DC]" size={32} />
              <div>
                <p className="text-zinc-400">Current round</p>
                <h2 className="text-4xl font-black">{round?.name || "Round"}</h2>
              </div>
            </div>
            {round?.description && <p className="text-2xl lg:text-3xl text-zinc-200 leading-relaxed mb-8">{round.description}</p>}
            <p className="text-zinc-400 uppercase tracking-wider text-sm font-semibold mb-3">Round Categories</p>
            <div className="flex flex-wrap gap-4">
              {categories.map((category) => (
                <div key={category} className="rounded-lg border border-[#71E0DC]/30 bg-[#71E0DC]/10 px-6 py-4 text-2xl font-bold text-[#71E0DC]">{category}</div>
              ))}
              {!categories.length && <p className="text-zinc-400 text-2xl">No categories saved for this round yet.</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-5 space-y-3">
            {rounds.map((item) => (
              <div key={item.key} className={`rounded-lg border px-4 py-3 ${item.key === round?.key ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/60"}`}>
                <div className="flex justify-between gap-3">
                  <span className="font-bold">{item.name}</span>
                  <span className="text-zinc-400">{item.questions.length}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const LeaderboardView = ({ leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  return (
    <div className="w-full max-w-4xl">
      <Card className="glass-card">
        <CardContent className="p-8 lg:p-10">
          <div className="flex items-center justify-center gap-3 mb-8">
            <Trophy className="text-amber-300" size={40} />
            <h2 className="text-5xl font-black">Leaderboard</h2>
          </div>
          <div className="space-y-4">
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

const WinnersView = ({ leaderboard, sessionName }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const winners = sorted.slice(0, 3);
  const first = winners[0];

  return (
    <div className="w-full max-w-6xl">
      <Card className="glass-card overflow-hidden">
        <CardContent className="p-8 lg:p-12 text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/15 shadow-2xl shadow-amber-300/10">
            <Trophy className="text-amber-300" size={52} />
          </div>
          <p className="text-[#71E0DC] text-xl font-black uppercase tracking-[0.3em]">{sessionName}</p>
          <h2 className="mt-4 text-6xl lg:text-9xl font-black leading-none text-white">Winners</h2>
          {first && <p className="mt-5 text-3xl lg:text-5xl font-black text-amber-200">{first.name}</p>}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
            {winners.map((team, index) => (
              <div key={team.id || team.name} className={`rounded-xl border p-6 ${index === 0 ? "border-amber-300/50 bg-amber-300/15 md:order-2 md:scale-105" : index === 1 ? "border-[#AEB2EF]/35 bg-[#AEB2EF]/10 md:order-1" : "border-[#71E0DC]/35 bg-[#71E0DC]/10 md:order-3"}`}>
                <p className="text-sm font-black uppercase tracking-wide text-zinc-400">{index === 0 ? "Champion" : index === 1 ? "Second Place" : "Third Place"}</p>
                <p className="mt-4 text-3xl font-black text-white truncate">{team.name}</p>
                <p className="mt-3 text-5xl font-black" style={{ color: index === 0 ? "#FDE68A" : index === 1 ? "#AEB2EF" : "#71E0DC" }}>{Number(team.score || 0)}</p>
              </div>
            ))}
            {!winners.length && <p className="md:col-span-3 rounded-lg border border-white/10 bg-zinc-950/70 p-8 text-center text-2xl text-zinc-400">Winners will appear once teams have scores.</p>}
          </div>
          <p className="mt-10 text-3xl font-black text-zinc-200">Thanks for playing!</p>
        </CardContent>
      </Card>
    </div>
  );
};

const FeedbackView = () => (
  <div className="w-full max-w-5xl">
    <Card className="glass-card overflow-hidden">
      <CardContent className="p-8 lg:p-12 text-center">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-[#71E0DC]/40 bg-[#71E0DC]/15 shadow-2xl shadow-[#71E0DC]/10">
          <Sparkles className="text-[#71E0DC]" size={52} />
        </div>
        <p className="text-[#71E0DC] text-xl font-black uppercase tracking-[0.3em]">One More Thing</p>
        <h2 className="mt-4 text-5xl lg:text-8xl font-black leading-none text-white">Send Us Ideas</h2>
        <p className="mx-auto mt-8 max-w-3xl text-3xl text-zinc-300">Use your phone to send category ideas, question ideas, or topics you want at a future trivia night.</p>
        <p className="mt-10 text-3xl font-black text-zinc-200">Thanks for playing!</p>
      </CardContent>
    </Card>
  </div>
);

const BonusPauseView = ({ round, leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);

  return (
    <div className="w-full max-w-5xl">
      <Card className="glass-card">
        <CardContent className="p-8 lg:p-12 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10">
            <Loader2 className="animate-spin text-[#71E0DC]" size={38} />
          </div>
          <p className="text-[#71E0DC] font-bold uppercase tracking-wide mb-2">Bonus question next</p>
          <h2 className="text-5xl lg:text-8xl font-black leading-none mb-5">{round?.name || "Round"} Bonus</h2>
          <p className="text-2xl text-zinc-300 mb-8">Current leaderboard</p>
          <div className="mx-auto max-w-4xl space-y-3 text-left">
            {sorted.map((team, index) => (
              <div key={team.id || team.name} className="grid grid-cols-[64px_1fr_auto] items-center gap-4 rounded-lg border border-white/10 bg-zinc-950/70 px-5 py-4">
                <div className={`h-12 w-12 rounded-full flex items-center justify-center font-black text-xl ${index === 0 ? "bg-amber-300 text-zinc-950" : "bg-white/10 text-zinc-200"}`}>{index + 1}</div>
                <div className="text-3xl font-bold truncate">{team.name}</div>
                <div className="text-4xl font-black text-[#71E0DC]">{Number(team.score || 0)}</div>
              </div>
            ))}
            {!sorted.length && <p className="rounded-lg border border-white/10 bg-zinc-950/70 p-8 text-center text-2xl text-zinc-400">Leaderboard will appear once teams join or are added.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const QuestionView = ({ question, index, total, showAnswer, showFunFact }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);
  const funFactOnly = Boolean(showFunFact && question.funFact);
  const shouldShowImage = Boolean(imageUrl) && question.imageTiming !== "after_answer";
  const shouldShowFunFactImage = Boolean(imageUrl) && question.imageTiming === "after_answer" && funFactOnly;

  return (
    <div className="w-full max-w-6xl">
      <Card className="glass-card overflow-hidden">
        <CardContent className="p-8 lg:p-12">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-8">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-base px-4 py-2">{question.category}</Badge>
              <Badge className="bg-zinc-800 text-zinc-300 text-base px-4 py-2"><Icon size={16} className={`mr-2 ${meta.color}`} />{meta.label}</Badge>
              {imageUrl && <Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20 text-base px-4 py-2"><Image size={16} className="mr-2" />{question.imageTiming === "after_answer" ? "Reveal Media" : "Media"}</Badge>}
            </div>
            <span className="text-zinc-500 font-mono text-lg">{index + 1} / {total}</span>
          </div>

          {funFactOnly ? (
            <div className="min-h-[50vh] flex items-center justify-center">
              <div className="w-full rounded-lg border border-[#AEB2EF]/30 bg-[#AEB2EF]/10 p-8 lg:p-12 text-center">
                {shouldShowFunFactImage && <div className="mb-8 flex justify-center"><img src={imageUrl} alt="Fun fact media" className="max-h-[42vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}
                <div className="flex items-center justify-center gap-3 text-[#AEB2EF] font-black mb-5 text-2xl"><Sparkles size={28} />Fun Fact</div>
                <p className="text-4xl lg:text-6xl font-black leading-tight text-white max-w-5xl mx-auto">{question.funFact}</p>
              </div>
            </div>
          ) : (
            <>
              {shouldShowImage && <div className="mb-8 flex justify-center"><img src={imageUrl} alt="Question" className="max-h-[44vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}

              <h2 className="text-4xl lg:text-7xl font-black leading-tight text-white text-center mb-10">{question.questionText}</h2>

              {question.type === "true_false" && (
                <div className="grid grid-cols-2 gap-5 max-w-3xl mx-auto mb-8">
                  <div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-center font-black py-6 text-4xl">True</div>
                  <div className="rounded-lg border-2 border-red-500/30 bg-red-500/10 text-red-300 text-center font-black py-6 text-4xl">False</div>
                </div>
              )}

              {question.type === "multiple_choice" && question.options.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto mb-8">
                  {question.options.map((option, optionIndex) => <div key={optionIndex} className="rounded-lg border border-white/10 bg-zinc-900/80 px-5 py-4 text-zinc-100 text-2xl font-semibold">{option}</div>)}
                </div>
              )}

              {showAnswer && (
                <div className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                  <p className="text-zinc-400 text-sm uppercase tracking-wider mb-2">Answer</p>
                  <p className="text-4xl lg:text-5xl font-black text-emerald-300">{question.answer}</p>
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
