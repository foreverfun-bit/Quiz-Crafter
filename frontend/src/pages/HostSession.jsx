import { useEffect, useMemo, useRef, useState } from "react";
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
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Image,
  Link,
  List,
  Mail,
  Loader2,
  Maximize2,
  MessageSquare,
  MonitorPlay,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Tags,
  Timer,
  Trash2,
  Trophy,
  Users,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

const STORAGE_BASE = process.env.REACT_APP_SUPABASE_URL ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/` : "";
const DEFAULT_PUBLIC_SITE = "https://quizcrafter.com";
const POINTS_BY_TYPE = { true_false: 25, multiple_choice: 50, written: 100 };

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
      // Fall through to semicolon parsing.
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

const getRoundMetadata = (session) => {
  const raw = session?.round_descriptions || session?.rounds_metadata || session?.rounds || [];
  return Array.isArray(raw) ? raw : [];
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
      const questionType = normalizeType(question, type);
      const roundOrder = getRoundOrder(question, 1);
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
        roundDescription: question.round_description || getRoundDescription(session, roundOrder, getRoundName(question, roundOrder)),
      };
    });
  });

  return entries.sort((a, b) => a.roundOrder !== b.roundOrder ? a.roundOrder - b.roundOrder : a.sourceOrder - b.sourceOrder);
};

const makeRounds = (questions) => {
  const groups = new Map();
  questions.forEach((question, index) => {
    const key = `${question.roundOrder}-${question.roundName}`;
    if (!groups.has(key)) groups.set(key, { key, name: question.roundName, description: question.roundDescription || "", startIndex: index, questions: [] });
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

const getDefaultPoints = (question) => POINTS_BY_TYPE[question?.type] || 100;

const HostSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const liveChannelRef = useRef(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showFunFact, setShowFunFact] = useState(false);
  const [presentMode, setPresentMode] = useState("question");
  const [gameStarted, setGameStarted] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [leaderboard, setLeaderboard] = useState(() => readStoredLeaderboard(id));
  const [teamName, setTeamName] = useState("");
  const [teamScore, setTeamScore] = useState("");
  const [players, setPlayers] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [hostUpdateMessage, setHostUpdateMessage] = useState("");
  const [feedback, setFeedback] = useState([]);
  const [categoryFeedback, setCategoryFeedback] = useState([]);
  const [liveStatus, setLiveStatus] = useState("connecting");
  const [pointsPerQuestion, setPointsPerQuestion] = useState(25);
  const [wagerMode, setWagerMode] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

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

  useEffect(() => {
    const channel = supabase.channel(`quiz-crafter-live-${id}`, { config: { broadcast: { self: false } } });
    liveChannelRef.current = channel;
    channel
      .on("broadcast", { event: "player_join" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayers((current) => {
          const nextPlayer = { id: payload.playerId, name: payload.playerName || "Team", updatePreference: payload.updatePreference || "none", updateContact: payload.updateContact || "", joinedAt: payload.joinedAt };
          return current.some((player) => player.id === payload.playerId) ? current.map((player) => player.id === payload.playerId ? { ...player, ...nextPlayer } : player) : [...current, nextPlayer];
        });
        setLeaderboard((teams) => teams.some((team) => team.id === payload.playerId) ? teams : [...teams, { id: payload.playerId, name: payload.playerName || "Team", score: 0 }]);
      })
      .on("broadcast", { event: "answer_submit" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setAnswers((current) => {
          const filtered = current.filter((answer) => !(answer.playerId === payload.playerId && answer.questionIndex === payload.questionIndex));
          return [...filtered, payload];
        });
      })
      .on("broadcast", { event: "feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setFeedback((current) => {
          const filtered = current.filter((item) => !(item.playerId === payload.playerId && item.questionIndex === payload.questionIndex));
          return [...filtered, payload];
        });
      })
      .on("broadcast", { event: "category_feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || !payload.category) return;
        setCategoryFeedback((current) => {
          const filtered = current.filter((item) => !(item.playerId === payload.playerId && item.category === payload.category && item.roundName === payload.roundName));
          return [...filtered, payload];
        });
      })
      .subscribe((status) => setLiveStatus(status === "SUBSCRIBED" ? "live" : "connecting"));
    return () => {
      supabase.removeChannel(channel);
      liveChannelRef.current = null;
    };
  }, [id]);

  const questions = useMemo(() => flattenSession(session), [session]);
  const rounds = useMemo(() => makeRounds(questions), [questions]);
  const currentQuestion = questions[currentIndex] || null;
  const currentRound = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
  const currentAnswers = answers.filter((answer) => answer.questionIndex === currentIndex).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const progress = questions.length ? Math.round(((currentIndex + 1) / questions.length) * 100) : 0;
  const sessionName = session?.name || session?.session_name || "Trivia Session";
  const joinUrl = `${getPublicOrigin()}/join?session=${id}`;
  const timeRemaining = timerEndAt ? Math.max(0, Math.ceil((timerEndAt - now) / 1000)) : null;
  const acceptingAnswers = timeRemaining === null || timeRemaining > 0;

  useEffect(() => {
    if (!currentQuestion) return;
    setPointsPerQuestion(getDefaultPoints(currentQuestion));
    setWagerMode(false);
  }, [currentQuestion?.id]);

  useEffect(() => {
    localStorage.setItem(`quiz-crafter-leaderboard-${id}`, JSON.stringify(leaderboard));
  }, [id, leaderboard]);

  useEffect(() => {
    if (!session || !questions.length || !currentQuestion) return;
    const publicQuestion = { ...currentQuestion, answer: showAnswer ? currentQuestion.answer : "" };
    const state = {
      sessionId: id,
      sessionName,
      mode: presentMode,
      gameStarted,
      joinUrl,
      currentIndex,
      currentQuestion: publicQuestion,
      showAnswer,
      showFunFact,
      leaderboard,
      players,
      pointsPerQuestion: Number(pointsPerQuestion) || getDefaultPoints(currentQuestion),
      wagerMode,
      timerEndAt,
      timeRemaining,
      acceptingAnswers,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`quiz-crafter-present-state-${id}`, JSON.stringify(state));
    liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: state });
  }, [id, session, sessionName, questions.length, currentQuestion, currentIndex, showAnswer, showFunFact, presentMode, gameStarted, joinUrl, leaderboard, players, pointsPerQuestion, wagerMode, timerEndAt, timeRemaining, acceptingAnswers]);

  const goToQuestion = (index) => {
    if (index < 0 || index >= questions.length) return;
    setCurrentIndex(index);
    setShowAnswer(false);
    setShowFunFact(false);
    setTimerEndAt(null);
    setPresentMode("question");
  };

  const releaseMode = (mode) => {
    setPresentMode(mode);
    setGameStarted(true);
  };

  const toggleAnswer = () => {
    setShowAnswer((value) => !value);
    setGameStarted(true);
    setPresentMode("question");
  };

  const toggleFunFact = () => {
    setShowFunFact((value) => !value);
    setGameStarted(true);
    releaseMode("question");
  };

  const startTimer = () => {
    setTimerEndAt(Date.now() + Math.max(1, Number(timerSeconds) || 30) * 1000);
    setGameStarted(true);
    setPresentMode("question");
  };
  const resetTimer = () => setTimerEndAt(null);
  const openPresentation = () => window.open(`/present-session/${id}`, "_blank", "noopener,noreferrer");
  const copyJoinLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success("Join link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const sendHostUpdate = async () => {
    const message = hostUpdateMessage.trim();
    if (!message) return toast.error("Write an update first");
    liveChannelRef.current?.send({ type: "broadcast", event: "host_update", payload: { message, sentAt: new Date().toISOString() } });
    setHostUpdateMessage("");
    toast.success("Update sent to connected players");
  };

  const addTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    setLeaderboard((teams) => [...teams, { id: `${Date.now()}-${name}`, name, score: Number(teamScore || 0) }]);
    setTeamName("");
    setTeamScore("");
    releaseMode("leaderboard");
  };

  const adjustScore = (teamId, amount) => setLeaderboard((teams) => teams.map((team) => team.id === teamId ? { ...team, score: Number(team.score || 0) + amount } : team));
  const removeTeam = (teamId) => setLeaderboard((teams) => teams.filter((team) => team.id !== teamId));

  if (loading) return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={34} /></div>;
  if (!session || !currentQuestion) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-6 text-center"><div><p className="text-white text-2xl font-bold mb-2">No questions to host</p><p className="text-zinc-500 mb-4">Add questions to this session first.</p><Button onClick={() => navigate(`/session/${id}`)} className="gradient-btn">Back to Session</Button></div></div>;
  }

  return <div className="min-h-screen bg-[#09090B] text-white" data-testid="host-session-page">
    {!focusMode && <TopBar navigate={navigate} id={id} sessionName={sessionName} questions={questions} players={players} currentIndex={currentIndex} liveStatus={liveStatus} openPresentation={openPresentation} setFocusMode={setFocusMode} progress={progress} />}
    <div className={`max-w-7xl mx-auto p-4 lg:p-6 ${focusMode ? "min-h-screen flex flex-col" : ""}`}>
      {focusMode && <div className="flex justify-between items-center mb-4"><Badge className="bg-zinc-800 text-zinc-300">{currentRound?.name || "Round"} · {currentIndex + 1} / {questions.length}</Badge><Button variant="outline" onClick={() => setFocusMode(false)} className="border-white/10 text-zinc-300 hover:text-white">Exit Focus</Button></div>}
      <div className={focusMode ? "flex-1 flex items-center" : "grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5"}>
        <main className="w-full">
          {!focusMode && <PresentationControls mode={presentMode} setMode={releaseMode} showAnswer={showAnswer} toggleAnswer={toggleAnswer} showFunFact={showFunFact} toggleFunFact={toggleFunFact} hasFunFact={Boolean(currentQuestion.funFact)} />}
          <HostSettings pointsPerQuestion={pointsPerQuestion} setPointsPerQuestion={setPointsPerQuestion} wagerMode={wagerMode} setWagerMode={setWagerMode} timerSeconds={timerSeconds} setTimerSeconds={setTimerSeconds} timeRemaining={timeRemaining} startTimer={startTimer} resetTimer={resetTimer} />
          <QuestionStage question={currentQuestion} index={currentIndex} total={questions.length} roundName={currentRound?.name} showAnswer={showAnswer} showFunFact={showFunFact} focusMode={focusMode} pointsPerQuestion={pointsPerQuestion} timeRemaining={timeRemaining} wagerMode={wagerMode} />
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap"><Button variant="outline" onClick={() => goToQuestion(currentIndex - 1)} disabled={currentIndex === 0} className="border-white/10 text-zinc-300 hover:text-white"><ChevronLeft size={18} className="mr-2" />Previous</Button><div className="flex gap-2 flex-wrap justify-end"><Button onClick={toggleAnswer} className={showAnswer ? "bg-zinc-800 text-white hover:bg-zinc-700" : "gradient-btn"}>{showAnswer ? <EyeOff size={18} className="mr-2" /> : <Eye size={18} className="mr-2" />}{showAnswer ? "Hide Answer" : "Reveal Answer"}</Button><Button onClick={toggleFunFact} disabled={!currentQuestion.funFact} className="bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50"><Sparkles size={18} className="mr-2" />Fun Fact</Button><Button onClick={() => goToQuestion(currentIndex + 1)} disabled={currentIndex === questions.length - 1} className="bg-[#AEB2EF] text-zinc-950 hover:bg-[#AEB2EF]/90"><ChevronRight size={18} className="mr-2" />Next</Button></div></div>
        </main>
        {!focusMode && <aside className="space-y-3"><PhonePlayPanel joinUrl={joinUrl} copyJoinLink={copyJoinLink} players={players} answers={currentAnswers} adjustScore={adjustScore} pointsPerQuestion={Number(pointsPerQuestion) || getDefaultPoints(currentQuestion)} wagerMode={wagerMode} setMode={releaseMode} /><HostUpdatesPanel players={players} message={hostUpdateMessage} setMessage={setHostUpdateMessage} sendUpdate={sendHostUpdate} /><HostFeedbackPanel feedback={feedback} categoryFeedback={categoryFeedback} currentIndex={currentIndex} currentQuestion={currentQuestion} /><LeaderboardPanel leaderboard={leaderboard} teamName={teamName} teamScore={teamScore} setTeamName={setTeamName} setTeamScore={setTeamScore} addTeam={addTeam} adjustScore={adjustScore} removeTeam={removeTeam} showLeaderboard={() => releaseMode("leaderboard")} /><RunSheet rounds={rounds} currentIndex={currentIndex} goToQuestion={goToQuestion} /></aside>}
      </div>
    </div>
  </div>;
};

const TopBar = ({ navigate, id, sessionName, questions, players, currentIndex, liveStatus, openPresentation, setFocusMode, progress }) => <div className="border-b border-white/10 bg-zinc-950/80 sticky top-0 z-20"><div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><Button variant="ghost" onClick={() => navigate(`/session/${id}`)} className="text-zinc-400 hover:text-white h-9 w-9 p-0" aria-label="Back to session"><ArrowLeft size={18} /></Button><div className="min-w-0"><h1 className="font-bold truncate">{sessionName}</h1><p className="text-xs text-zinc-500">Hosting view · {questions.length} questions · {players.length} players</p></div></div><div className="flex items-center gap-2 flex-wrap justify-end"><Badge className={liveStatus === "live" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}><Wifi size={13} className="mr-1" />{liveStatus === "live" ? "Live" : "Connecting"}</Badge><Badge className="bg-zinc-800 text-zinc-300">{currentIndex + 1} / {questions.length}</Badge><Button variant="outline" onClick={openPresentation} className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Presentation</Button><Button variant="outline" onClick={() => setFocusMode(true)} className="border-white/10 text-zinc-300 hover:text-white"><Maximize2 size={16} className="mr-2" />Focus</Button></div></div><div className="h-1 bg-zinc-900"><div className="h-1 bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] transition-all" style={{ width: `${progress}%` }} /></div></div>;

const PresentationControls = ({ mode, setMode, showAnswer, toggleAnswer, showFunFact, toggleFunFact, hasFunFact }) => <Card className="glass-card mb-4"><CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap"><div className="flex items-center gap-2 flex-wrap"><Button size="sm" onClick={() => setMode("question")} className={mode === "question" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><MonitorPlay size={15} className="mr-2" />Question</Button><Button size="sm" onClick={() => setMode("categories")} className={mode === "categories" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Tags size={15} className="mr-2" />Round Intro</Button><Button size="sm" onClick={() => setMode("leaderboard")} className={mode === "leaderboard" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Trophy size={15} className="mr-2" />Leaderboard</Button></div><div className="flex items-center gap-2 flex-wrap"><Button size="sm" variant="outline" onClick={toggleAnswer} className="border-white/10 text-zinc-300 hover:text-white">{showAnswer ? <EyeOff size={15} className="mr-2" /> : <Eye size={15} className="mr-2" />}{showAnswer ? "Hide Answer" : "Show Answer"}</Button><Button size="sm" variant="outline" onClick={toggleFunFact} disabled={!hasFunFact} className="border-white/10 text-zinc-300 hover:text-white disabled:opacity-50"><Sparkles size={15} className="mr-2" />{showFunFact ? "Hide Fun Fact" : "Show Fun Fact"}</Button></div></CardContent></Card>;

const HostSettings = ({ pointsPerQuestion, setPointsPerQuestion, wagerMode, setWagerMode, timerSeconds, setTimerSeconds, timeRemaining, startTimer, resetTimer }) => <Card className="glass-card mb-4"><CardContent className="p-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end"><label className="text-xs text-zinc-400">Points<input type="number" min="0" value={pointsPerQuestion} onChange={(event) => setPointsPerQuestion(event.target.value)} className="mt-1 w-full h-9 rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="text-xs text-zinc-400">Timer seconds<input type="number" min="5" value={timerSeconds} onChange={(event) => setTimerSeconds(event.target.value)} className="mt-1 w-full h-9 rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><Button onClick={() => setWagerMode((value) => !value)} className={wagerMode ? "h-9 bg-purple-500/20 text-purple-200 border border-purple-500/30 hover:bg-purple-500/30" : "h-9 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}>Wager {wagerMode ? "On" : "Off"}</Button><Button onClick={startTimer} className="h-9 gradient-btn"><Play size={15} className="mr-2" />Start Timer</Button><Button variant="outline" onClick={resetTimer} className="h-9 border-white/10 text-zinc-300 hover:text-white"><RotateCcw size={15} className="mr-2" />{timeRemaining === null ? "Clear" : `${timeRemaining}s`}</Button></CardContent></Card>;

const PhonePlayPanel = ({ joinUrl, copyJoinLink, players, answers, adjustScore, pointsPerQuestion, wagerMode, setMode }) => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=132x132&margin=8&data=${encodeURIComponent(joinUrl)}`;
  return <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2 text-white font-semibold"><Users size={18} className="text-[#71E0DC]" />Phone Play</div><Button size="sm" variant="outline" onClick={copyJoinLink} className="h-8 border-white/10 text-zinc-300 hover:text-white"><Copy size={14} className="mr-1" />Copy</Button></div><div className="grid grid-cols-[132px_1fr] gap-3 items-center rounded-lg border border-[#71E0DC]/20 bg-[#71E0DC]/10 p-3 mb-3"><div className="bg-white rounded-md p-1"><img src={qrUrl} alt="Player join QR code" className="w-[124px] h-[124px]" /></div><div className="min-w-0"><div className="flex items-center gap-2 text-[#71E0DC] font-semibold mb-2"><Link size={16} />Player join link</div><p className="text-xs text-zinc-200 break-all">{joinUrl}</p></div></div><div className="grid grid-cols-2 gap-2 mb-3"><div className="rounded-md bg-zinc-950/70 border border-white/10 p-2"><p className="text-xs text-zinc-500">Players</p><p className="text-xl font-black">{players.length}</p></div><div className="rounded-md bg-zinc-950/70 border border-white/10 p-2"><p className="text-xs text-zinc-500">Answers</p><p className="text-xl font-black">{answers.length}</p></div></div><Button size="sm" onClick={() => setMode("leaderboard")} className="w-full mb-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100"><Trophy size={14} className="mr-2" />Show Leaderboard</Button><div className="space-y-2 max-h-48 overflow-y-auto pr-1">{answers.map((answer) => { const award = wagerMode && Number(answer.wagerAmount) > 0 ? Number(answer.wagerAmount) : pointsPerQuestion; return <div key={`${answer.playerId}-${answer.questionIndex}`} className="rounded-md border border-white/10 bg-zinc-950/60 p-2"><div className="flex items-center justify-between gap-2 mb-1"><span className="font-semibold text-sm truncate">{answer.playerName}</span><Button size="sm" onClick={() => adjustScore(answer.playerId, award)} className="h-7 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">+{award}</Button></div>{answer.wagerMode && <p className="text-xs text-purple-300 mb-1">Wager: {answer.wagerAmount}</p>}<p className="text-sm text-zinc-300 break-words">{answer.answer}</p></div>; })}{!answers.length && <p className="text-xs text-zinc-500 text-center py-3">Answers for the current question will appear here.</p>}</div></CardContent></Card>;
};

const HostUpdatesPanel = ({ players, message, setMessage, sendUpdate }) => {
  const emailPlayers = players.filter((player) => player.updatePreference === "email" && player.updateContact);
  const copyContacts = async (items, label) => {
    if (!items.length) return toast.error(`No ${label} contacts yet`);
    try {
      await navigator.clipboard.writeText(items.map((player) => `${player.name}: ${player.updateContact}`).join("\n"));
      toast.success(`${label} contacts copied`);
    } catch {
      toast.error("Could not copy contacts");
    }
  };

  return <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2 text-white font-semibold"><MessageSquare size={18} className="text-[#AEB2EF]" />Host Updates</div><Badge className="bg-zinc-800 text-zinc-300">{emailPlayers.length} opted in</Badge></div><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type a clue, cancellation, or update for players..." className="min-h-24 w-full resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><Button onClick={sendUpdate} disabled={!message.trim()} className="mt-2 w-full gradient-btn"><SendIconLabel />Send In-App Update</Button><div className="mt-3"><Button size="sm" variant="outline" onClick={() => copyContacts(emailPlayers, "email")} className="w-full border-white/10 text-zinc-300 hover:text-white"><Mail size={14} className="mr-1" />Copy emails ({emailPlayers.length})</Button></div><p className="mt-2 text-[11px] text-zinc-500">In-app updates go to connected phones now. Email contacts are collected here for host follow-up.</p></CardContent></Card>;
};

const SendIconLabel = () => <><MessageSquare size={15} className="mr-2" /></>;

const HostFeedbackPanel = ({ feedback, categoryFeedback, currentIndex, currentQuestion }) => {
  const current = feedback.filter((item) => Number(item.questionIndex) === Number(currentIndex));
  const likes = current.filter((item) => item.sentiment === "like").length;
  const dislikes = current.filter((item) => item.sentiment === "dislike").length;
  const categoryRows = Object.values(categoryFeedback.reduce((groups, item) => {
    const key = item.category || "Uncategorized";
    if (!groups[key]) groups[key] = { category: key, likes: 0, dislikes: 0 };
    if (item.sentiment === "like") groups[key].likes += 1;
    if (item.sentiment === "dislike") groups[key].dislikes += 1;
    return groups;
  }, {})).sort((a, b) => (b.likes - b.dislikes) - (a.likes - a.dislikes)).slice(0, 5);

  return <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2 text-white font-semibold"><Sparkles size={18} className="text-[#71E0DC]" />Player Feedback</div><Badge className="bg-zinc-800 text-zinc-300">{feedback.length + categoryFeedback.length} votes</Badge></div><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 mb-3"><p className="text-xs text-zinc-500 mb-1">Current question</p><p className="text-sm text-zinc-300 line-clamp-2 mb-2">{currentQuestion?.questionText || "No question selected"}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 text-center"><p className="text-xl font-black text-emerald-300">{likes}</p><p className="text-xs text-zinc-500">Likes</p></div><div className="rounded-md bg-red-500/10 border border-red-500/20 p-2 text-center"><p className="text-xl font-black text-red-300">{dislikes}</p><p className="text-xs text-zinc-500">Dislikes</p></div></div></div><div className="space-y-2 max-h-40 overflow-y-auto pr-1">{categoryRows.map((row) => <div key={row.category} className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-zinc-950/60 px-2 py-2"><span className="text-sm text-zinc-300 truncate">{row.category}</span><span className="text-xs text-zinc-500">Like {row.likes} · Dislike {row.dislikes}</span></div>)}{!categoryRows.length && <p className="text-xs text-zinc-500 text-center py-2">Category likes and dislikes will appear from the round intro screen.</p>}</div></CardContent></Card>;
};

const LeaderboardPanel = ({ leaderboard, teamName, teamScore, setTeamName, setTeamScore, addTeam, adjustScore, removeTeam, showLeaderboard }) => { const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)); return <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2 text-white font-semibold"><Trophy size={18} className="text-amber-300" />Leaderboard</div><Button size="sm" variant="outline" onClick={showLeaderboard} className="h-8 border-white/10 text-zinc-300 hover:text-white">Show</Button></div><div className="grid grid-cols-[1fr_76px_36px] gap-2 mb-3"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Team name" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><input value={teamScore} onChange={(event) => setTeamScore(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Score" type="number" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><Button onClick={addTeam} className="h-9 w-9 p-0 gradient-btn" aria-label="Add team"><Plus size={16} /></Button></div><div className="space-y-2 max-h-48 overflow-y-auto pr-1">{sorted.map((team) => <div key={team.id} className="rounded-md border border-white/10 bg-zinc-950/60 p-2"><div className="flex items-center justify-between gap-2 mb-2"><span className="font-semibold text-sm truncate">{team.name}</span><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div><div className="flex items-center gap-1"><Button size="sm" onClick={() => adjustScore(team.id, -1)} className="h-7 flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200">-1</Button><Button size="sm" onClick={() => adjustScore(team.id, 1)} className="h-7 flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200">+1</Button><Button size="sm" variant="outline" onClick={() => removeTeam(team.id)} className="h-7 w-8 p-0 border-white/10 text-zinc-400 hover:text-red-300" aria-label="Remove team"><Trash2 size={13} /></Button></div></div>)}{!sorted.length && <p className="text-xs text-zinc-500 text-center py-3">Teams will appear here when players join from their phones.</p>}</div></CardContent></Card>; };

const RunSheet = ({ rounds, currentIndex, goToQuestion }) => <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center gap-2 mb-3 text-white font-semibold"><MonitorPlay size={18} className="text-[#71E0DC]" />Run Sheet</div><div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">{rounds.map((round) => <section key={round.key}><button type="button" onClick={() => goToQuestion(round.startIndex)} className="w-full flex items-center justify-between text-left mb-2 px-2 py-1 rounded hover:bg-white/5"><span className="text-sm font-bold text-white">{round.name}</span><Badge className="bg-zinc-800 text-zinc-300">{round.questions.length}</Badge></button><div className="space-y-1">{round.questions.map((question, localIndex) => { const absoluteIndex = round.startIndex + localIndex; const active = absoluteIndex === currentIndex; return <button key={question.id} type="button" onClick={() => goToQuestion(absoluteIndex)} className={`w-full text-left rounded-md px-2 py-2 border transition-colors ${active ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/5 bg-zinc-950/40 hover:bg-zinc-900"}`}><div className="flex items-center gap-2 mb-1"><span className="text-xs text-zinc-500 font-mono">#{localIndex + 1}</span><QuestionBadge type={question.type} />{question.imageUrl && <Image size={12} className="text-amber-300" />}</div><p className="text-xs text-zinc-300 line-clamp-2">{question.questionText}</p></button>; })}</div></section>)}</div></CardContent></Card>;

const QuestionBadge = ({ type }) => { const meta = typeMeta[type] || typeMeta.written; const Icon = meta.icon; return <Badge className="bg-zinc-800 text-zinc-300 text-[11px]"><Icon size={11} className={`mr-1 ${meta.color}`} />{meta.short}</Badge>; };

const QuestionStage = ({ question, index, total, roundName, showAnswer, showFunFact, focusMode, pointsPerQuestion, timeRemaining, wagerMode }) => { const meta = typeMeta[question.type] || typeMeta.written; const Icon = meta.icon; const imageUrl = buildStorageUrl(question.imageUrl); return <Card className={`glass-card overflow-hidden ${focusMode ? "w-full" : ""}`}><CardContent className={focusMode ? "p-8 lg:p-12" : "p-5 lg:p-7"}><div className="flex items-center justify-between gap-3 flex-wrap mb-6"><div className="flex items-center gap-2 flex-wrap"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{roundName || "Round"}</Badge><Badge variant="outline" className="border-zinc-700 text-zinc-300">{question.category}</Badge><Badge className="bg-zinc-800 text-zinc-300"><Icon size={13} className={`mr-1 ${meta.color}`} />{meta.label}</Badge><Badge className={wagerMode ? "bg-purple-500/15 text-purple-300 border border-purple-500/20" : "bg-amber-400/15 text-amber-200 border border-amber-400/20"}>{wagerMode ? "Wager" : `${Number(pointsPerQuestion) || getDefaultPoints(question)} pts`}</Badge>{timeRemaining !== null && <Badge className={timeRemaining === 0 ? "bg-red-500/15 text-red-300 border border-red-500/20" : "bg-[#AEB2EF]/15 text-[#AEB2EF] border border-[#AEB2EF]/20"}><Timer size={13} className="mr-1" />{timeRemaining}s</Badge>}</div><span className="text-zinc-500 font-mono text-sm">{index + 1} / {total}</span></div>{imageUrl && <div className="mb-6 flex justify-center"><img src={imageUrl} alt="Question" className="max-h-[42vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}<h2 className={`${focusMode ? "text-4xl lg:text-6xl" : "text-2xl lg:text-4xl"} font-black leading-tight text-white text-center mb-8`}>{question.questionText}</h2>{question.type === "true_false" && <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto mb-6"><div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-center font-bold py-5 text-2xl">True</div><div className="rounded-lg border-2 border-red-500/30 bg-red-500/10 text-red-300 text-center font-bold py-5 text-2xl">False</div></div>}{question.type === "multiple_choice" && question.options.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl mx-auto mb-6">{question.options.map((option, optionIndex) => <div key={optionIndex} className="rounded-lg border border-white/10 bg-zinc-900/80 px-4 py-3 text-zinc-200 text-lg">{option}</div>)}</div>}{showAnswer && <div className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center"><p className="text-zinc-400 text-sm uppercase tracking-wider mb-1">Answer</p><p className={`${focusMode ? "text-4xl" : "text-2xl"} font-bold text-emerald-300`}>{question.answer}</p></div>}{showFunFact && question.funFact && <div className="mt-5 rounded-lg border border-[#AEB2EF]/30 bg-[#AEB2EF]/10 p-5 text-center"><div className="flex items-center justify-center gap-2 text-[#AEB2EF] font-bold mb-2"><Sparkles size={18} />Fun Fact</div><p className="text-zinc-300 max-w-3xl mx-auto">{question.funFact}</p></div>}</CardContent></Card>; };

export default HostSession;
