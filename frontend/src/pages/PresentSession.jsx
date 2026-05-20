import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
} from "lucide-react";

const STORAGE_BASE = process.env.REACT_APP_SUPABASE_URL ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/` : "";

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

const normalizeType = (question, fallbackType = "written") => {
  const type = question?.question_type || fallbackType;
  if (type === "true_false" || type === "multiple_choice" || type === "written") return type;
  return "written";
};

const getRoundOrder = (question, fallbackOrder = 1) => Number(question?.round_order || question?.round_number || question?.round || fallbackOrder) || fallbackOrder;
const getSourceOrder = (question, fallbackOrder = 1) => Number(question?.source_order || question?.question_order || question?.order || fallbackOrder) || fallbackOrder;
const getRoundName = (question, fallbackOrder = 1) => {
  if (question?.round_name) return question.round_name;
  if (question?.round_title) return question.round_title;
  if (question?.round && Number.isNaN(Number(question.round))) return question.round;
  return `Round ${getRoundOrder(question, fallbackOrder)}`;
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
        options: questionType === "true_false" ? ["True", "False"] : parseOptions(question.incorrect_answers || question.options),
        type: questionType,
        roundName: getRoundName(question, roundOrder),
        roundOrder,
        sourceOrder: getSourceOrder(question, index + 1),
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
    if (!groups.has(key)) groups.set(key, { key, name: question.roundName, order: question.roundOrder, startIndex: index, questions: [] });
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

  const questions = useMemo(() => flattenSession(session), [session]);
  const rounds = useMemo(() => makeRounds(questions), [questions]);
  const currentIndex = Math.min(Math.max(Number(presentState.currentIndex || 0), 0), Math.max(questions.length - 1, 0));
  const currentQuestion = questions[currentIndex] || null;
  const currentRound = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
  const mode = presentState.mode || "question";
  const sessionName = presentState.sessionName || session?.name || session?.session_name || "Trivia Session";

  if (loading) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={42} /></div>;
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
            <h1 className="text-3xl lg:text-5xl font-black mt-1">{mode === "categories" ? "Round Categories" : mode === "leaderboard" ? "Leaderboard" : currentRound?.name || "Question"}</h1>
          </div>
          <Badge className="bg-white/10 text-zinc-200 border border-white/10 text-base px-4 py-2">{currentRound?.name || "Round"}</Badge>
        </header>

        <main className="flex-1 flex items-center justify-center py-8">
          {mode === "categories" && <CategoriesView round={currentRound} rounds={rounds} />}
          {mode === "leaderboard" && <LeaderboardView leaderboard={presentState.leaderboard || []} />}
          {mode !== "categories" && mode !== "leaderboard" && (
            <QuestionView question={currentQuestion} index={currentIndex} total={questions.length} showAnswer={presentState.showAnswer} showFunFact={presentState.showFunFact} />
          )}
        </main>
      </div>
    </div>
  );
};

const CategoriesView = ({ round, rounds }) => {
  const categories = [...new Set((round?.questions || []).map((question) => question.category).filter(Boolean))];

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

const QuestionView = ({ question, index, total, showAnswer, showFunFact }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);

  return (
    <div className="w-full max-w-6xl">
      <Card className="glass-card overflow-hidden">
        <CardContent className="p-8 lg:p-12">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-8">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-base px-4 py-2">{question.category}</Badge>
              <Badge className="bg-zinc-800 text-zinc-300 text-base px-4 py-2"><Icon size={16} className={`mr-2 ${meta.color}`} />{meta.label}</Badge>
              {imageUrl && <Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20 text-base px-4 py-2"><Image size={16} className="mr-2" />Media</Badge>}
            </div>
            <span className="text-zinc-500 font-mono text-lg">{index + 1} / {total}</span>
          </div>

          {imageUrl && <div className="mb-8 flex justify-center"><img src={imageUrl} alt="Question" className="max-h-[44vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}

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

          {showFunFact && question.funFact && (
            <div className="mt-5 rounded-lg border border-[#AEB2EF]/30 bg-[#AEB2EF]/10 p-5 text-center">
              <div className="flex items-center justify-center gap-2 text-[#AEB2EF] font-bold mb-2"><Sparkles size={18} />Fun Fact</div>
              <p className="text-2xl text-zinc-100 max-w-4xl mx-auto">{question.funFact}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PresentSession;
