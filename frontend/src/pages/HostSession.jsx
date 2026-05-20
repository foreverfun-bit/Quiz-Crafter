import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import {
  ArrowLeft,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  Image,
  List,
  Loader2,
  Maximize2,
  MessageSquare,
  MonitorPlay,
  Plus,
  Sparkles,
  Tags,
  Trash2,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

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
  const order = getRoundOrder(question, fallbackOrder);
  return `Round ${order}`;
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

const readStoredLeaderboard = (sessionId) => {
  try {
    return JSON.parse(localStorage.getItem(`quiz-crafter-leaderboard-${sessionId}`) || "[]");
  } catch {
    return [];
  }
};

const HostSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showFunFact, setShowFunFact] = useState(false);
  const [presentMode, setPresentMode] = useState("question");
  const [focusMode, setFocusMode] = useState(false);
  const [leaderboard, setLeaderboard] = useState(() => readStoredLeaderboard(id));
  const [teamName, setTeamName] = useState("");
  const [teamScore, setTeamScore] = useState("");

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.from("sessions").select("*").eq("id", id).single();
        if (error) throw error;
        setSession(data);
      } catch (error) {
        console.error("Host session load error:", error);
        toast.error(error.message || "Failed to load session");
        navigate("/past-sessions");
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [id, navigate]);

  const questions = useMemo(() => flattenSession(session), [session]);
  const rounds = useMemo(() => makeRounds(questions), [questions]);
  const currentQuestion = questions[currentIndex] || null;
  const currentRound = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
  const progress = questions.length ? Math.round(((currentIndex + 1) / questions.length) * 100) : 0;
  const sessionName = session?.name || session?.session_name || "Trivia Session";

  useEffect(() => {
    localStorage.setItem(`quiz-crafter-leaderboard-${id}`, JSON.stringify(leaderboard));
  }, [id, leaderboard]);

  useEffect(() => {
    if (!session || !questions.length) return;
    const state = {
      sessionId: id,
      sessionName,
      mode: presentMode,
      currentIndex,
      showAnswer,
      showFunFact,
      leaderboard,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`quiz-crafter-present-state-${id}`, JSON.stringify(state));
  }, [id, session, sessionName, questions.length, currentIndex, showAnswer, showFunFact, presentMode, leaderboard]);

  const goToQuestion = (index) => {
    if (index < 0 || index >= questions.length) return;
    setCurrentIndex(index);
    setShowAnswer(false);
    setShowFunFact(false);
    setPresentMode("question");
  };

  const openPresentation = () => {
    window.open(`/present-session/${id}`, "_blank", "noopener,noreferrer");
  };

  const addTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    setLeaderboard((teams) => [...teams, { id: `${Date.now()}-${name}`, name, score: Number(teamScore || 0) }]);
    setTeamName("");
    setTeamScore("");
    setPresentMode("leaderboard");
  };

  const adjustScore = (teamId, amount) => {
    setLeaderboard((teams) => teams.map((team) => team.id === teamId ? { ...team, score: Number(team.score || 0) + amount } : team));
  };

  const removeTeam = (teamId) => {
    setLeaderboard((teams) => teams.filter((team) => team.id !== teamId));
  };

  if (loading) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={34} /></div>;
  }

  if (!session || !currentQuestion) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-white text-2xl font-bold mb-2">No questions to host</p>
          <p className="text-zinc-500 mb-4">Add questions to this session first.</p>
          <Button onClick={() => navigate(`/session/${id}`)} className="gradient-btn">Back to Session</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-white" data-testid="host-session-page">
      {!focusMode && (
        <div className="border-b border-white/10 bg-zinc-950/80 sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" onClick={() => navigate(`/session/${id}`)} className="text-zinc-400 hover:text-white h-9 w-9 p-0" aria-label="Back to session"><ArrowLeft size={18} /></Button>
              <div className="min-w-0">
                <h1 className="font-bold truncate">{sessionName}</h1>
                <p className="text-xs text-zinc-500">Hosting view · {questions.length} questions</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-zinc-800 text-zinc-300">{currentIndex + 1} / {questions.length}</Badge>
              <Button variant="outline" onClick={openPresentation} className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Presentation</Button>
              <Button variant="outline" onClick={() => setFocusMode(true)} className="border-white/10 text-zinc-300 hover:text-white"><Maximize2 size={16} className="mr-2" />Focus</Button>
            </div>
          </div>
          <div className="h-1 bg-zinc-900"><div className="h-1 bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] transition-all" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      <div className={`max-w-7xl mx-auto p-4 lg:p-6 ${focusMode ? "min-h-screen flex flex-col" : ""}`}>
        {focusMode && (
          <div className="flex justify-between items-center mb-4">
            <Badge className="bg-zinc-800 text-zinc-300">{currentRound?.name || "Round"} · {currentIndex + 1} / {questions.length}</Badge>
            <Button variant="outline" onClick={() => setFocusMode(false)} className="border-white/10 text-zinc-300 hover:text-white">Exit Focus</Button>
          </div>
        )}

        <div className={focusMode ? "flex-1 flex items-center" : "grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5"}>
          <main className="w-full">
            {!focusMode && (
              <PresentationControls
                mode={presentMode}
                setMode={setPresentMode}
                showAnswer={showAnswer}
                setShowAnswer={setShowAnswer}
                showFunFact={showFunFact}
                setShowFunFact={setShowFunFact}
                hasFunFact={Boolean(currentQuestion.funFact)}
              />
            )}

            <QuestionStage question={currentQuestion} index={currentIndex} total={questions.length} roundName={currentRound?.name} showAnswer={showAnswer} showFunFact={showFunFact} focusMode={focusMode} />

            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <Button variant="outline" onClick={() => goToQuestion(currentIndex - 1)} disabled={currentIndex === 0} className="border-white/10 text-zinc-300 hover:text-white"><ChevronLeft size={18} className="mr-2" />Previous</Button>
              <div className="flex gap-2 flex-wrap justify-end">
                <Button onClick={() => setShowAnswer((value) => !value)} className={showAnswer ? "bg-zinc-800 text-white hover:bg-zinc-700" : "gradient-btn"}>{showAnswer ? <EyeOff size={18} className="mr-2" /> : <Eye size={18} className="mr-2" />}{showAnswer ? "Hide Answer" : "Reveal Answer"}</Button>
                <Button onClick={() => setShowFunFact((value) => !value)} disabled={!currentQuestion.funFact} className="bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50"><Sparkles size={18} className="mr-2" />Fun Fact</Button>
                <Button onClick={() => goToQuestion(currentIndex + 1)} disabled={currentIndex === questions.length - 1} className="bg-[#AEB2EF] text-zinc-950 hover:bg-[#AEB2EF]/90"><ChevronRight size={18} className="mr-2" />Next</Button>
              </div>
            </div>
          </main>

          {!focusMode && <aside className="space-y-3">
            <LeaderboardPanel
              leaderboard={leaderboard}
              teamName={teamName}
              teamScore={teamScore}
              setTeamName={setTeamName}
              setTeamScore={setTeamScore}
              addTeam={addTeam}
              adjustScore={adjustScore}
              removeTeam={removeTeam}
              showLeaderboard={() => setPresentMode("leaderboard")}
            />

            <Card className="glass-card">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-3 text-white font-semibold"><MonitorPlay size={18} className="text-[#71E0DC]" />Run Sheet</div>
                <div className="space-y-4 max-h-[540px] overflow-y-auto pr-1">
                  {rounds.map((round) => (
                    <section key={round.key}>
                      <button type="button" onClick={() => goToQuestion(round.startIndex)} className="w-full flex items-center justify-between text-left mb-2 px-2 py-1 rounded hover:bg-white/5">
                        <span className="text-sm font-bold text-white">{round.name}</span>
                        <Badge className="bg-zinc-800 text-zinc-300">{round.questions.length}</Badge>
                      </button>
                      <div className="space-y-1">
                        {round.questions.map((question, localIndex) => {
                          const absoluteIndex = round.startIndex + localIndex;
                          const active = absoluteIndex === currentIndex;
                          return (
                            <button key={question.id} type="button" onClick={() => goToQuestion(absoluteIndex)} className={`w-full text-left rounded-md px-2 py-2 border transition-colors ${active ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/5 bg-zinc-950/40 hover:bg-zinc-900"}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-zinc-500 font-mono">#{localIndex + 1}</span>
                                <QuestionBadge type={question.type} />
                                {question.imageUrl && <Image size={12} className="text-amber-300" />}
                              </div>
                              <p className="text-xs text-zinc-300 line-clamp-2">{question.questionText}</p>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>}
        </div>
      </div>
    </div>
  );
};

const PresentationControls = ({ mode, setMode, showAnswer, setShowAnswer, showFunFact, setShowFunFact, hasFunFact }) => (
  <Card className="glass-card mb-4">
    <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => setMode("question")} className={mode === "question" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><MonitorPlay size={15} className="mr-2" />Question</Button>
        <Button size="sm" onClick={() => setMode("categories")} className={mode === "categories" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Tags size={15} className="mr-2" />Round Categories</Button>
        <Button size="sm" onClick={() => setMode("leaderboard")} className={mode === "leaderboard" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Trophy size={15} className="mr-2" />Leaderboard</Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setShowAnswer((value) => !value)} className="border-white/10 text-zinc-300 hover:text-white">{showAnswer ? <EyeOff size={15} className="mr-2" /> : <Eye size={15} className="mr-2" />}{showAnswer ? "Hide Answer" : "Show Answer"}</Button>
        <Button size="sm" variant="outline" onClick={() => setShowFunFact((value) => !value)} disabled={!hasFunFact} className="border-white/10 text-zinc-300 hover:text-white disabled:opacity-50"><Sparkles size={15} className="mr-2" />{showFunFact ? "Hide Fun Fact" : "Show Fun Fact"}</Button>
      </div>
    </CardContent>
  </Card>
);

const LeaderboardPanel = ({ leaderboard, teamName, teamScore, setTeamName, setTeamScore, addTeam, adjustScore, removeTeam, showLeaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  return (
    <Card className="glass-card">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-white font-semibold"><Trophy size={18} className="text-amber-300" />Leaderboard</div>
          <Button size="sm" variant="outline" onClick={showLeaderboard} className="h-8 border-white/10 text-zinc-300 hover:text-white">Show</Button>
        </div>
        <div className="grid grid-cols-[1fr_76px_36px] gap-2 mb-3">
          <input value={teamName} onChange={(event) => setTeamName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Team name" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" />
          <input value={teamScore} onChange={(event) => setTeamScore(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Score" type="number" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" />
          <Button onClick={addTeam} className="h-9 w-9 p-0 gradient-btn" aria-label="Add team"><Plus size={16} /></Button>
        </div>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {sorted.map((team) => (
            <div key={team.id} className="rounded-md border border-white/10 bg-zinc-950/60 p-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-semibold text-sm truncate">{team.name}</span>
                <span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" onClick={() => adjustScore(team.id, -1)} className="h-7 flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200">-1</Button>
                <Button size="sm" onClick={() => adjustScore(team.id, 1)} className="h-7 flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200">+1</Button>
                <Button size="sm" variant="outline" onClick={() => removeTeam(team.id)} className="h-7 w-8 p-0 border-white/10 text-zinc-400 hover:text-red-300" aria-label="Remove team"><Trash2 size={13} /></Button>
              </div>
            </div>
          ))}
          {!sorted.length && <p className="text-xs text-zinc-500 text-center py-3">Add teams here to show a leaderboard on the presentation screen.</p>}
        </div>
      </CardContent>
    </Card>
  );
};

const QuestionBadge = ({ type }) => {
  const meta = typeMeta[type] || typeMeta.written;
  const Icon = meta.icon;
  return <Badge className="bg-zinc-800 text-zinc-300 text-[11px]"><Icon size={11} className={`mr-1 ${meta.color}`} />{meta.short}</Badge>;
};

const QuestionStage = ({ question, index, total, roundName, showAnswer, showFunFact, focusMode }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);

  return (
    <Card className={`glass-card overflow-hidden ${focusMode ? "w-full" : ""}`}>
      <CardContent className={focusMode ? "p-8 lg:p-12" : "p-5 lg:p-7"}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{roundName || "Round"}</Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">{question.category}</Badge>
            <Badge className="bg-zinc-800 text-zinc-300"><Icon size={13} className={`mr-1 ${meta.color}`} />{meta.label}</Badge>
          </div>
          <span className="text-zinc-500 font-mono text-sm">{index + 1} / {total}</span>
        </div>

        {imageUrl && <div className="mb-6 flex justify-center"><img src={imageUrl} alt="Question" className="max-h-[42vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}

        <h2 className={`${focusMode ? "text-4xl lg:text-6xl" : "text-2xl lg:text-4xl"} font-black leading-tight text-white text-center mb-8`}>{question.questionText}</h2>

        {question.type === "true_false" && (
          <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto mb-6">
            <div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-center font-bold py-5 text-2xl">True</div>
            <div className="rounded-lg border-2 border-red-500/30 bg-red-500/10 text-red-300 text-center font-bold py-5 text-2xl">False</div>
          </div>
        )}

        {question.type === "multiple_choice" && question.options.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl mx-auto mb-6">
            {question.options.map((option, optionIndex) => <div key={optionIndex} className="rounded-lg border border-white/10 bg-zinc-900/80 px-4 py-3 text-zinc-200 text-lg">{option}</div>)}
          </div>
        )}

        {showAnswer && (
          <div className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <p className="text-zinc-400 text-sm uppercase tracking-wider mb-1">Answer</p>
            <p className={`${focusMode ? "text-4xl" : "text-2xl"} font-bold text-emerald-300`}>{question.answer}</p>
          </div>
        )}

        {showFunFact && question.funFact && (
          <div className="mt-5 rounded-lg border border-[#AEB2EF]/30 bg-[#AEB2EF]/10 p-5 text-center">
            <div className="flex items-center justify-center gap-2 text-[#AEB2EF] font-bold mb-2"><Sparkles size={18} />Fun Fact</div>
            <p className="text-zinc-300 max-w-3xl mx-auto">{question.funFact}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HostSession;
