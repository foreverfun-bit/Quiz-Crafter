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
  List,
  Loader2,
  Maximize2,
  MessageSquare,
  MonitorPlay,
  Palette,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Tags,
  Timer,
  Trash2,
  Trophy,
  Upload,
  Users,
  Wifi,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const STORAGE_BASE = process.env.REACT_APP_SUPABASE_URL ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/` : "";
const DEFAULT_PUBLIC_SITE = "https://quizcrafter.com";
const POINTS_BY_TYPE = { true_false: 25, multiple_choice: 50, written: 100 };
const DEFAULT_BRANDING = { name: "Forever Fun Events", logoUrl: "/quiz-crafter-logo.svg", primaryColor: "#71E0DC", accentColor: "#AEB2EF" };

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
const HOST_DEFAULT_BRANDING_KEY = "quiz-crafter-host-branding-defaults";
const hostBrandingKey = (sessionId) => `quiz-crafter-host-branding-${sessionId}`;
const sanitizeHexColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
const normalizeBranding = (branding = {}) => {
  const source = branding && typeof branding === "object" ? branding : {};
  const logoUrl = String(source.logoUrl || "").trim();
  return {
    name: String(source.name || "").trim() || DEFAULT_BRANDING.name,
    logoUrl: logoUrl === "/forever-fun-logo.png" ? DEFAULT_BRANDING.logoUrl : logoUrl,
    primaryColor: sanitizeHexColor(source.primaryColor, DEFAULT_BRANDING.primaryColor),
    accentColor: sanitizeHexColor(source.accentColor, DEFAULT_BRANDING.accentColor),
  };
};
const readDefaultBranding = () => {
  try {
    return normalizeBranding({ ...DEFAULT_BRANDING, ...JSON.parse(localStorage.getItem(HOST_DEFAULT_BRANDING_KEY) || "null") });
  } catch {
    return DEFAULT_BRANDING;
  }
};
const writeDefaultBranding = (branding) => { try { localStorage.setItem(HOST_DEFAULT_BRANDING_KEY, JSON.stringify(normalizeBranding(branding))); } catch { /* Ignore storage failures so branding never crashes hosting. */ } };
const getSessionBranding = (session) => {
  const defaults = readDefaultBranding();
  return {
    ...defaults,
    name: session?.host_brand_name || session?.brand_name || session?.company_name || session?.venue_name || defaults.name,
    logoUrl: session?.host_logo_url || session?.brand_logo_url || session?.logo_url || defaults.logoUrl,
    primaryColor: sanitizeHexColor(session?.host_primary_color || session?.primary_color, defaults.primaryColor),
    accentColor: sanitizeHexColor(session?.host_accent_color || session?.accent_color, defaults.accentColor),
  };
};
const readStoredBranding = (sessionId, session = null) => {
  try {
    const stored = JSON.parse(localStorage.getItem(hostBrandingKey(sessionId)) || "null");
    return stored ? normalizeBranding({ ...getSessionBranding(session), ...stored }) : getSessionBranding(session);
  } catch {
    return getSessionBranding(session);
  }
};
const writeStoredBranding = (sessionId, branding) => { try { localStorage.setItem(hostBrandingKey(sessionId), JSON.stringify(normalizeBranding(branding))); } catch { /* Ignore storage failures so branding never crashes hosting. */ } };
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });

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
const normalizeWagerTiming = (value) => value === "after_answer" || value === "after" ? "after_answer" : "before_answer";
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
      const questionType = normalizeType(question, type);
      const roundOrder = getRoundOrder(question, 1);
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
        points: question.points ?? question.question_points ?? null,
        timerSeconds: Number(question.timer_seconds ?? question.time_limit ?? 30) || 30,
        wagerLimit: Number(question.wager_limit ?? question.free_wager_limit ?? 0) || 0,
        wagerTiming: normalizeWagerTiming(question.wager_timing || question.wagerTiming),
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
const hostToolsStorageKey = (sessionId, name) => `quiz-crafter-host-tools-${sessionId}-${name}`;
const readStoredList = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeStoredList = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Live hosting should keep running even if browser storage is unavailable.
  }
};
const persistLiveVote = (sessionId, name, payload, makeKey) => {
  const key = hostToolsStorageKey(sessionId, name);
  const current = readStoredList(key);
  const next = [...current.filter((item) => makeKey(item) !== makeKey(payload)), payload];
  writeStoredList(key, next);
};
const persistLiveIdea = (sessionId, payload) => {
  const key = hostToolsStorageKey(sessionId, "ideas");
  const current = readStoredList(key);
  const next = [payload, ...current.filter((item) => !(item.playerId === payload.playerId && item.submittedAt === payload.submittedAt))].slice(0, 200);
  writeStoredList(key, next);
  return next;
};

const getDefaultPoints = (question) => POINTS_BY_TYPE[question?.type] || 100;
const getQuestionPoints = (question) => Number(question?.points ?? 0) > 0 ? Number(question.points) : getDefaultPoints(question);
const answerKey = (answer) => `${answer.playerId}-${answer.questionIndex}`;
const normalizeAnswerText = (value) => String(value || "").trim().toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
const isCorrectSubmission = (answer, question) => Boolean(question?.answer) && normalizeAnswerText(answer?.answer) === normalizeAnswerText(question.answer);
const serializeRoundIntro = (round) => round ? { key: round.key, name: round.name, description: round.description || "", categories: [...new Set((round.questions || []).map((question) => question.category).filter(Boolean))], questionCount: round.questions?.length || 0, startIndex: round.startIndex } : null;
const getTeamScore = (leaderboard, teamId) => Number(leaderboard.find((team) => team.id === teamId)?.score || 0);
const isLateSubmission = (answer) => answer?.secondsRemainingAtSubmit !== null && answer?.secondsRemainingAtSubmit !== undefined && Number(answer.secondsRemainingAtSubmit) <= 5;
const getWagerAward = (answer, leaderboard, wagerLimit, previousPoints = 0) => {
  const requested = Math.max(0, Number(answer?.wagerAmount || 0));
  if (!requested) return 0;
  const currentScore = getTeamScore(leaderboard, answer.playerId);
  const scoreBeforeThisGrade = Math.max(0, currentScore - Number(previousPoints || 0));
  const submittedCap = Number.isFinite(Number(answer?.wagerCap)) ? Number(answer.wagerCap) : Number.POSITIVE_INFINITY;
  const configuredCap = Number(wagerLimit || 0) > 0 ? Number(wagerLimit) : Number.POSITIVE_INFINITY;
  return Math.min(requested, configuredCap, submittedCap, scoreBeforeThisGrade);
};
const buildFairPlayStats = (players, answers, gradedAnswers, playerActivity) => {
  const teamIds = new Set([...players.map((player) => player.id), ...answers.map((answer) => answer.playerId)]);
  const byTeam = new Map([...teamIds].map((teamId) => [teamId, { lateCorrect: 0, correctStreak: 0, longestCorrectStreak: 0, leftScreen: 0, correct: 0, graded: 0, flags: [] }]));
  [...byTeam.keys()].forEach((teamId) => {
    const teamAnswers = answers.filter((answer) => answer.playerId === teamId).sort((a, b) => Number(a.questionIndex || 0) - Number(b.questionIndex || 0));
    let streak = 0;
    teamAnswers.forEach((answer) => {
      const graded = gradedAnswers[answerKey(answer)];
      if (!graded?.status) return;
      const stats = byTeam.get(teamId);
      stats.graded += 1;
      if (graded.status === "correct") {
        stats.correct += 1;
        streak += 1;
        stats.correctStreak = streak;
        stats.longestCorrectStreak = Math.max(stats.longestCorrectStreak, streak);
        if (isLateSubmission(answer)) stats.lateCorrect += 1;
      } else {
        streak = 0;
        stats.correctStreak = 0;
      }
    });
  });
  playerActivity.filter((event) => event.eventType === "left_screen").forEach((event) => {
    const stats = byTeam.get(event.playerId);
    if (stats) stats.leftScreen += 1;
  });
  byTeam.forEach((stats) => {
    if (stats.lateCorrect >= 2) stats.flags.push(`${stats.lateCorrect} late correct`);
    if (stats.correctStreak >= 4) stats.flags.push(`${stats.correctStreak} correct in a row`);
    if (stats.leftScreen >= 2) stats.flags.push(`${stats.leftScreen} screen exits`);
    if (stats.lateCorrect >= 1 && stats.leftScreen >= 1) stats.flags.push("late + left screen");
  });
  return byTeam;
};

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
  const [introRoundKey, setIntroRoundKey] = useState(null);
  const [pendingBonusIndex, setPendingBonusIndex] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [leaderboard, setLeaderboard] = useState(() => readStoredLeaderboard(id));
  const [teamName, setTeamName] = useState("");
  const [teamScore, setTeamScore] = useState("");
  const [players, setPlayers] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [playerActivity, setPlayerActivity] = useState([]);
  const [playerIdeas, setPlayerIdeas] = useState(() => readStoredList(hostToolsStorageKey(id, "ideas")));
  const [gradedAnswers, setGradedAnswers] = useState({});
  const [scoreModal, setScoreModal] = useState(null);
  const [liveStatus, setLiveStatus] = useState("connecting");
  const [pointsPerQuestion, setPointsPerQuestion] = useState(25);
  const [wagerMode, setWagerMode] = useState(false);
  const [wagerLimit, setWagerLimit] = useState(0);
  const [wagerTiming, setWagerTiming] = useState("before_answer");
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState("answers");
  const [branding, setBranding] = useState(() => readStoredBranding(id));

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
        setBranding(readStoredBranding(id, data));
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
      .on("broadcast", { event: "player_activity" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setPlayerActivity((current) => [...current, payload].slice(-400));
      })
      .on("broadcast", { event: "feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        persistLiveVote(id, "feedback", payload, (item) => `${item.playerId}-${item.questionIndex}`);
      })
      .on("broadcast", { event: "category_feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || !payload.category) return;
        persistLiveVote(id, "category-feedback", payload, (item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`);
      })
      .on("broadcast", { event: "idea_submit" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayerIdeas(() => persistLiveIdea(id, payload));
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
  const nextRound = rounds.find((round) => round.startIndex > currentIndex);
  const defaultIntroRound = currentRound && currentIndex >= currentRound.startIndex + currentRound.questions.length - 1 && nextRound ? nextRound : currentRound;
  const introRound = rounds.find((round) => round.key === (introRoundKey || defaultIntroRound?.key)) || defaultIntroRound || currentRound;
  const currentAnswers = answers.filter((answer) => answer.questionIndex === currentIndex).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const currentActivity = playerActivity.filter((activity) => Number(activity.questionIndex) === Number(currentIndex));
  const fairPlayStats = useMemo(() => buildFairPlayStats(players, answers, gradedAnswers, playerActivity), [players, answers, gradedAnswers, playerActivity]);
  const progress = questions.length ? Math.round(((currentIndex + 1) / questions.length) * 100) : 0;
  const sessionName = session?.name || session?.session_name || "Trivia Session";
  const joinUrl = `${getPublicOrigin()}/join?session=${id}`;
  const timeRemaining = timerEndAt ? Math.max(0, Math.ceil((timerEndAt - now) / 1000)) : null;
  const acceptingAnswers = timeRemaining === null || timeRemaining > 0;

  useEffect(() => {
    if (!currentQuestion) return;
    setPointsPerQuestion(getQuestionPoints(currentQuestion));
    setTimerSeconds(Number(currentQuestion.timerSeconds || 30));
    setWagerLimit(Number(currentQuestion.wagerLimit || 0));
    setWagerTiming(normalizeWagerTiming(currentQuestion.wagerTiming));
    setWagerMode(Number(currentQuestion.wagerLimit || 0) > 0);
  }, [currentQuestion]);

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
      pendingBonusIndex,
      pendingBonusRound: pendingBonusIndex !== null ? serializeRoundIntro(rounds.find((round) => pendingBonusIndex >= round.startIndex && pendingBonusIndex < round.startIndex + round.questions.length)) : null,
      currentQuestion: publicQuestion,
      introRound: serializeRoundIntro(introRound),
      showAnswer,
      revealedAnswer: showAnswer ? currentQuestion.answer : "",
      showFunFact,
      leaderboard,
      players,
      pointsPerQuestion: Number(pointsPerQuestion) || getDefaultPoints(currentQuestion),
      wagerMode,
      wagerLimit: Number(wagerLimit || 0),
      wagerTiming,
      timerEndAt,
      timeRemaining,
      acceptingAnswers,
      branding,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`quiz-crafter-present-state-${id}`, JSON.stringify(state));
    liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: state });
  }, [id, session, sessionName, questions.length, currentQuestion, currentIndex, pendingBonusIndex, rounds, introRound, showAnswer, showFunFact, presentMode, gameStarted, joinUrl, leaderboard, players, pointsPerQuestion, wagerMode, wagerLimit, wagerTiming, timerEndAt, timeRemaining, acceptingAnswers, branding]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      try {
        const state = JSON.parse(localStorage.getItem(`quiz-crafter-present-state-${id}`) || "null");
        if (state) liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: state });
      } catch {
        // Late-joining phones will catch the next regular host-state update.
      }
    }, 2500);
    return () => window.clearInterval(interval);
  }, [id]);

  const goToQuestion = (index, options = {}) => {
    if (index < 0 || index >= questions.length) return;
    const targetQuestion = questions[index];
    const targetRound = rounds.find((round) => index >= round.startIndex && index < round.startIndex + round.questions.length);
    const isRoundBonus = targetRound && targetRound.questions.length > 1 && index === targetRound.startIndex + targetRound.questions.length - 1;
    if (options.pauseBeforeBonus !== false && isRoundBonus && pendingBonusIndex !== index) {
      setPendingBonusIndex(index);
      setShowAnswer(false);
      setShowFunFact(false);
      setTimerEndAt(null);
      setPresentMode("bonus_pause");
      setGameStarted(true);
      return;
    }
    setCurrentIndex(index);
    setPendingBonusIndex(null);
    setShowAnswer(false);
    setShowFunFact(false);
    setTimerEndAt(options.startTimer ? Date.now() + Math.max(1, Number(targetQuestion?.timerSeconds || 30)) * 1000 : null);
    setPresentMode("question");
    if (options.startTimer) setGameStarted(true);
  };

  const releaseMode = (mode, roundKey = null) => {
    if (mode === "categories") setIntroRoundKey(roundKey || introRound?.key || currentRound?.key || null);
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
  const saveBranding = async (nextBranding) => {
    const cleanBranding = normalizeBranding(nextBranding);
    setBranding(cleanBranding);
    writeStoredBranding(id, cleanBranding);
    try {
      const { error } = await supabase.from("sessions").update({
        host_brand_name: cleanBranding.name,
        host_logo_url: cleanBranding.logoUrl,
        host_primary_color: cleanBranding.primaryColor,
        host_accent_color: cleanBranding.accentColor,
      }).eq("id", id);
      if (error && !String(error.message || "").includes("column")) throw error;
      toast.success("Host branding saved");
    } catch (error) {
      console.error("Save host branding error:", error);
      toast.success("Host branding saved on this device");
    }
  };
  const saveBrandingAsDefault = (nextBranding) => {
    const cleanBranding = normalizeBranding(nextBranding);
    writeDefaultBranding(cleanBranding);
    saveBranding(cleanBranding);
    toast.success("Default host branding saved");
  };
  const useDefaultBranding = () => {
    const defaults = readDefaultBranding();
    saveBranding(defaults);
    return defaults;
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
  const setScore = (teamId, score) => setLeaderboard((teams) => teams.map((team) => team.id === teamId ? { ...team, score: Number(score || 0) } : team));
  const removeTeam = (teamId) => setLeaderboard((teams) => teams.filter((team) => team.id !== teamId));
  const openScoreModal = (teamId, context = {}) => {
    const team = leaderboard.find((item) => item.id === teamId) || players.find((item) => item.id === teamId);
    setScoreModal({ teamId, teamName: team?.name || context.playerName || "Team", currentScore: Number(team?.score || 0), adjustment: "", setTo: String(Number(team?.score || 0)), ...context });
  };
  const markAnswer = (answer, status, options = {}) => {
    const key = answerKey(answer);
    const previous = gradedAnswers[key];
    const previousPoints = Number(previous?.points || 0);
    const award = wagerMode && Number(answer.wagerAmount) > 0 ? getWagerAward(answer, leaderboard, wagerLimit, previousPoints) : Number(pointsPerQuestion) || getDefaultPoints(currentQuestion);
    const wagerPenalty = wagerMode && Number(answer.wagerAmount) > 0 ? getWagerAward(answer, leaderboard, wagerLimit, previousPoints) : 0;
    const nextPoints = status === "correct" ? award : status === "incorrect" && wagerPenalty > 0 ? -wagerPenalty : 0;
    const delta = nextPoints - previousPoints;
    if (delta) adjustScore(answer.playerId, delta);
    setGradedAnswers((current) => ({ ...current, [key]: { status, points: nextPoints, gradedAt: new Date().toISOString() } }));
    if (!options.silent) toast.success(status === "correct" ? `Marked correct (+${delta || 0})` : delta ? `Marked incorrect (${delta})` : "Marked incorrect");
  };

  useEffect(() => {
    if (!currentQuestion) return;
    currentAnswers.forEach((answer) => {
      const key = answerKey(answer);
      if (gradedAnswers[key] || !isCorrectSubmission(answer, currentQuestion)) return;
      if (wagerMode && wagerTiming === "after_answer" && !Number(answer.wagerAmount || 0)) return;
      markAnswer(answer, "correct", { silent: true });
    });
  // markAnswer intentionally stays outside the deps so this effect only reacts to answer/game state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAnswers, currentQuestion, gradedAnswers, wagerMode, wagerTiming]);

  if (loading) return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={34} /></div>;
  if (!session || !currentQuestion) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-6 text-center"><div><p className="text-white text-2xl font-bold mb-2">No questions to host</p><p className="text-zinc-500 mb-4">Add questions to this session first.</p><Button onClick={() => navigate(`/session/${id}`)} className="gradient-btn">Back to Session</Button></div></div>;
  }

  const brandStyle = { "--host-primary": branding.primaryColor, "--host-accent": branding.accentColor };
  return <div className="min-h-screen bg-[#09090B] text-white" data-testid="host-session-page" style={brandStyle}>
    {!focusMode && <TopBar navigate={navigate} id={id} sessionName={sessionName} questions={questions} players={players} currentIndex={currentIndex} liveStatus={liveStatus} openPresentation={openPresentation} setFocusMode={setFocusMode} progress={progress} branding={branding} customizeOpen={customizeOpen} setCustomizeOpen={setCustomizeOpen} />}
    <div className={`max-w-[1680px] mx-auto p-4 lg:p-8 ${focusMode ? "min-h-screen flex flex-col" : ""}`}>
      {focusMode && <div className="flex justify-between items-center mb-4"><Badge className="bg-zinc-800 text-zinc-300">{currentRound?.name || "Round"} - {currentIndex + 1} / {questions.length}</Badge><Button variant="outline" onClick={() => setFocusMode(false)} className="border-white/10 text-zinc-300 hover:text-white">Exit Focus</Button></div>}
      <div className={focusMode ? "flex-1 flex items-center" : "grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-7"}>
        <main className="w-full">
          {!focusMode && <PresentationControls mode={presentMode} setMode={releaseMode} rounds={rounds} currentIndex={currentIndex} currentRound={currentRound} introRoundKey={introRound?.key || introRoundKey} setIntroRoundKey={setIntroRoundKey} />}
          {!focusMode && customizeOpen && <HostCustomizePanel branding={branding} defaultBranding={readDefaultBranding()} onSave={saveBranding} onSaveDefault={saveBrandingAsDefault} onUseDefault={useDefaultBranding} onClose={() => setCustomizeOpen(false)} />}
          {presentMode === "bonus_pause" ? <BonusPauseStage round={rounds.find((round) => pendingBonusIndex >= round.startIndex && pendingBonusIndex < round.startIndex + round.questions.length)} leaderboard={leaderboard} /> : presentMode === "winners" ? <WinnersStage leaderboard={leaderboard} /> : presentMode === "feedback" ? <FeedbackStage ideas={playerIdeas} /> : <QuestionStage question={currentQuestion} index={currentIndex} total={questions.length} roundName={currentRound?.name} showAnswer={showAnswer} showFunFact={showFunFact} focusMode={focusMode} pointsPerQuestion={pointsPerQuestion} setPointsPerQuestion={setPointsPerQuestion} timerSeconds={timerSeconds} setTimerSeconds={setTimerSeconds} timeRemaining={timeRemaining} startTimer={startTimer} resetTimer={resetTimer} wagerMode={wagerMode} setWagerMode={setWagerMode} wagerLimit={wagerLimit} setWagerLimit={setWagerLimit} wagerTiming={wagerTiming} setWagerTiming={setWagerTiming} branding={branding} />}
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap"><Button variant="outline" onClick={() => goToQuestion(currentIndex - 1)} disabled={currentIndex === 0} className="border-white/10 text-zinc-300 hover:text-white"><ChevronLeft size={18} className="mr-2" />Previous</Button><div className="flex gap-2 flex-wrap justify-end"><Button onClick={toggleAnswer} disabled={presentMode === "bonus_pause" || presentMode === "winners" || presentMode === "feedback"} className={showAnswer ? "bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50" : "gradient-btn disabled:opacity-50"}>{showAnswer ? <EyeOff size={18} className="mr-2" /> : <Eye size={18} className="mr-2" />}{showAnswer ? "Hide Answer" : "Reveal Answer"}</Button><Button onClick={toggleFunFact} disabled={presentMode === "bonus_pause" || presentMode === "winners" || presentMode === "feedback" || !currentQuestion.funFact} className="bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50"><Sparkles size={18} className="mr-2" />Fun Fact</Button><Button onClick={() => presentMode === "bonus_pause" && pendingBonusIndex !== null ? goToQuestion(pendingBonusIndex, { startTimer: true, pauseBeforeBonus: false }) : goToQuestion(currentIndex + 1, { startTimer: true })} disabled={presentMode !== "bonus_pause" && currentIndex === questions.length - 1} className="bg-[#AEB2EF] text-zinc-950 hover:bg-[#AEB2EF]/90"><ChevronRight size={18} className="mr-2" />{presentMode === "bonus_pause" ? "Start Bonus" : "Next"}</Button></div></div>
        </main>
        {!focusMode && <HostSidePanel activeTab={sidePanelTab} setActiveTab={setSidePanelTab} joinUrl={joinUrl} copyJoinLink={copyJoinLink} players={players} answers={answers} currentAnswers={currentAnswers} currentActivity={currentActivity} fairPlayStats={fairPlayStats} leaderboard={leaderboard} gradedAnswers={gradedAnswers} markAnswer={markAnswer} openScoreModal={openScoreModal} pointsPerQuestion={Number(pointsPerQuestion) || getDefaultPoints(currentQuestion)} wagerMode={wagerMode} wagerLimit={wagerLimit} setMode={releaseMode} teamName={teamName} teamScore={teamScore} setTeamName={setTeamName} setTeamScore={setTeamScore} addTeam={addTeam} adjustScore={adjustScore} removeTeam={removeTeam} showLeaderboard={() => releaseMode("leaderboard")} rounds={rounds} currentIndex={currentIndex} goToQuestion={goToQuestion} editBuild={() => navigate(`/build/${id}`)} ideas={playerIdeas} />}
      </div>
    </div>
    {scoreModal && <ScoreAdjustModal modal={scoreModal} setModal={setScoreModal} adjustScore={adjustScore} setScore={setScore} />}
  </div>;
};

const TopBar = ({ navigate, id, sessionName, questions, players, currentIndex, liveStatus, openPresentation, setFocusMode, progress, branding, customizeOpen, setCustomizeOpen }) => <div className="border-b border-white/10 bg-zinc-950/80 sticky top-0 z-20"><div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><Button variant="ghost" onClick={() => navigate(`/session/${id}`)} className="text-zinc-400 hover:text-white h-9 w-9 p-0" aria-label="Back to session"><ArrowLeft size={18} /></Button>{branding?.logoUrl && <img src={branding.logoUrl} alt={branding.name || "Host logo"} className="h-10 w-10 rounded-md bg-white object-contain p-1" />}<div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--host-primary)" }}>{branding?.name || "Host"}</p><h1 className="font-bold truncate">{sessionName}</h1><p className="text-xs text-zinc-500">Hosting view - {questions.length} questions - {players.length} players</p></div></div><div className="flex items-center gap-2 flex-wrap justify-end"><Badge className={liveStatus === "live" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}><Wifi size={13} className="mr-1" />{liveStatus === "live" ? "Live" : "Connecting"}</Badge><Badge className="bg-zinc-800 text-zinc-300">{currentIndex + 1} / {questions.length}</Badge><Button variant="outline" onClick={() => setCustomizeOpen((value) => !value)} className={customizeOpen ? "border-white/10 text-zinc-950 hover:opacity-90" : "border-white/10 text-zinc-300 hover:text-white"} style={customizeOpen ? { backgroundColor: "var(--host-primary)" } : undefined}><Palette size={16} className="mr-2" />Customize</Button><Button variant="outline" onClick={openPresentation} className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Presentation</Button><Button variant="outline" onClick={() => setFocusMode(true)} className="border-white/10 text-zinc-300 hover:text-white"><Maximize2 size={16} className="mr-2" />Focus</Button></div></div><div className="h-1 bg-zinc-900"><div className="h-1 transition-all" style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--host-primary), var(--host-accent))" }} /></div></div>;

const PresentationControls = ({ mode, setMode, rounds, currentIndex, currentRound, introRoundKey, setIntroRoundKey }) => {
  const nextRound = rounds.find((round) => round.startIndex > currentIndex);
  const suggestedRound = currentRound && currentIndex >= currentRound.startIndex + currentRound.questions.length - 1 && nextRound ? nextRound : currentRound;
  const selectedIntroKey = introRoundKey || suggestedRound?.key || currentRound?.key || "";
  const chooseIntroRound = (roundKey) => {
    setIntroRoundKey(roundKey);
    if (mode === "categories") setMode("categories", roundKey);
  };

  return <Card className="glass-card mb-5"><CardContent className="p-4 lg:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Presentation</p><p className="text-sm text-zinc-300 mt-1">Choose what the audience screen is showing.</p></div><div className="flex items-center gap-2 flex-wrap"><Button size="sm" onClick={() => setMode("question")} className={mode === "question" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><MonitorPlay size={15} className="mr-2" />Question</Button><Button size="sm" onClick={() => setMode("categories", selectedIntroKey)} className={mode === "categories" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Tags size={15} className="mr-2" />Round Intro</Button><select aria-label="Round intro target" value={selectedIntroKey} onChange={(event) => chooseIntroRound(event.target.value)} className="h-9 min-w-[150px] rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-zinc-200">{rounds.map((round) => <option key={round.key} value={round.key}>{round.name}</option>)}</select><Button size="sm" onClick={() => setMode("leaderboard")} className={mode === "leaderboard" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Trophy size={15} className="mr-2" />Leaderboard</Button><Button size="sm" onClick={() => setMode("winners")} className={mode === "winners" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Sparkles size={15} className="mr-2" />Winners</Button><Button size="sm" onClick={() => setMode("feedback")} className={mode === "feedback" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><MessageSquare size={15} className="mr-2" />Feedback</Button></div></div></CardContent></Card>;
};

const HostCustomizePanel = ({ branding, defaultBranding, onSave, onSaveDefault, onUseDefault, onClose }) => {
  const [form, setForm] = useState(() => normalizeBranding(branding));
  useEffect(() => setForm(normalizeBranding(branding)), [branding]);
  const safeForm = normalizeBranding(form);
  const safeDefault = normalizeBranding(defaultBranding);
  const update = (key, value) => setForm((current) => ({ ...normalizeBranding(current), [key]: value }));
  const uploadLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file for the logo");
    update("logoUrl", await fileToDataUrl(file));
  };
  return <Card className="glass-card mb-4"><CardContent className="p-4"><div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="text-lg font-bold text-white flex items-center gap-2"><Palette size={18} style={{ color: "var(--host-primary)" }} />Customize Host Screen</h2><p className="text-xs text-zinc-500">Default branding is used for new host sessions. This session can still be customized.</p></div><Button size="sm" variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-white">Close</Button></div><div className="grid grid-cols-1 lg:grid-cols-[160px_1fr] gap-4"><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 flex flex-col items-center justify-center min-h-36">{safeForm.logoUrl ? <img src={safeForm.logoUrl} alt="Logo preview" className="max-h-24 max-w-full rounded-md bg-white object-contain p-2" /> : <div className="h-24 w-24 rounded-md border border-white/10 bg-zinc-900 flex items-center justify-center text-zinc-500"><Image size={28} /></div>}<p className="mt-3 text-sm font-bold text-white text-center">{safeForm.name || "Host Name"}</p></div><div className="space-y-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="text-xs text-zinc-400">Host name<input value={safeForm.name || ""} onChange={(event) => update("name", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="text-xs text-zinc-400">Logo URL<input value={safeForm.logoUrl || ""} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://..." className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"><label className="text-xs text-zinc-400">Upload logo<span className="mt-1 h-10 rounded-md border border-white/10 bg-zinc-950 px-3 text-zinc-200 flex items-center gap-2 cursor-pointer hover:border-[#71E0DC]/50"><Upload size={15} />Choose file<input type="file" accept="image/*" onChange={uploadLogo} className="hidden" /></span></label><ColorField label="Primary color" value={safeForm.primaryColor} onChange={(value) => update("primaryColor", value)} /><ColorField label="Accent color" value={safeForm.accentColor} onChange={(value) => update("accentColor", value)} /></div><div className="rounded-md border border-white/10 bg-zinc-950/50 p-3"><div className="flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold text-white">Current default</p><p className="text-xs text-zinc-500">{safeDefault.name} · {safeDefault.primaryColor} / {safeDefault.accentColor}</p></div><Button size="sm" variant="outline" onClick={() => setForm(normalizeBranding(onUseDefault()))} className="border-white/10 text-zinc-300 hover:text-white">Use Default</Button></div></div><div className="flex justify-end gap-2 pt-1 flex-wrap"><Button variant="outline" onClick={() => setForm(DEFAULT_BRANDING)} className="border-white/10 text-zinc-300 hover:text-white">Reset</Button><Button variant="outline" onClick={() => onSaveDefault(safeForm)} className="border-white/10 text-zinc-300 hover:text-white">Save as Default</Button><Button onClick={() => onSave(safeForm)} className="text-zinc-950 font-semibold hover:opacity-90" style={{ background: `linear-gradient(90deg, ${safeForm.primaryColor}, ${safeForm.accentColor})` }}><Save size={16} className="mr-2" />Save This Session</Button></div></div></div></CardContent></Card>;
};

const ColorField = ({ label, value, onChange }) => { const safeValue = sanitizeHexColor(value, DEFAULT_BRANDING.primaryColor); return <label className="text-xs text-zinc-400">{label}<div className="mt-1 flex h-10 rounded-md border border-white/10 bg-zinc-950 overflow-hidden focus-within:border-[#71E0DC]/60"><input type="color" value={safeValue} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 border-0 bg-transparent p-1" /><input value={value || ""} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-white outline-none" /></div></label>; };

const HostSidePanel = ({ activeTab, setActiveTab, joinUrl, copyJoinLink, players, answers, currentAnswers, currentActivity, fairPlayStats, leaderboard, gradedAnswers, markAnswer, openScoreModal, pointsPerQuestion, wagerMode, wagerLimit, setMode, teamName, teamScore, setTeamName, setTeamScore, addTeam, adjustScore, removeTeam, showLeaderboard, rounds, currentIndex, goToQuestion, editBuild, ideas }) => {
  const tabs = [
    { key: "answers", label: "Answers", icon: MessageSquare },
    { key: "teams", label: "Teams", icon: Trophy },
    { key: "run", label: "Run Sheet", icon: MonitorPlay },
    { key: "ideas", label: "Ideas", icon: Sparkles },
  ];
  return <aside className="space-y-4"><Card className="glass-card"><CardContent className="p-2"><div className="grid grid-cols-4 gap-1">{tabs.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition ${activeTab === key ? "text-zinc-950" : "text-zinc-300 hover:bg-white/5 hover:text-white"}`} style={activeTab === key ? { background: "linear-gradient(90deg, var(--host-primary), var(--host-accent))" } : undefined}><Icon size={14} />{label}</button>)}</div></CardContent></Card>{activeTab === "answers" && <PhonePlayPanel players={players} answers={currentAnswers} activity={currentActivity} fairPlayStats={fairPlayStats} gradedAnswers={gradedAnswers} markAnswer={markAnswer} pointsPerQuestion={pointsPerQuestion} setMode={setMode} />}{activeTab === "teams" && <LeaderboardPanel leaderboard={leaderboard} teamName={teamName} teamScore={teamScore} setTeamName={setTeamName} setTeamScore={setTeamScore} addTeam={addTeam} adjustScore={adjustScore} openScoreModal={openScoreModal} removeTeam={removeTeam} showLeaderboard={showLeaderboard} fairPlayStats={fairPlayStats} />}{activeTab === "run" && <RunSheet rounds={rounds} currentIndex={currentIndex} goToQuestion={goToQuestion} answers={answers} players={players} gradedAnswers={gradedAnswers} editBuild={editBuild} />}{activeTab === "ideas" && <IdeasPanel ideas={ideas} />}</aside>;
};

const PhonePlayPanel = ({ players, answers, activity, fairPlayStats, gradedAnswers, markAnswer, pointsPerQuestion, setMode }) => {
  const submittedPlayerIds = new Set(answers.map((answer) => answer.playerId));
  const submittedCount = submittedPlayerIds.size;
  const playerCount = players.length;
  const allSubmitted = playerCount > 0 && submittedCount >= playerCount;
  const leftScreenIds = new Set(activity.filter((event) => event.eventType === "left_screen").map((event) => event.playerId));
  const leftScreenCount = leftScreenIds.size;
  const lateCorrectIds = new Set(answers.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct" && isLateSubmission(answer)).map((answer) => answer.playerId));
  const patternIds = new Set([...fairPlayStats.entries()].filter(([, stats]) => stats.flags.length > 0).map(([teamId]) => teamId));
  const groups = [...answers.reduce((map, answer) => {
    const label = String(answer.answer || "Blank").trim() || "Blank";
    const key = normalizeAnswerText(label) || label.toLowerCase();
    const current = map.get(key) || { key, label, answers: [] };
    current.answers.push(answer);
    map.set(key, current);
    return map;
  }, new Map()).values()].sort((a, b) => b.answers.length - a.answers.length || a.label.localeCompare(b.label));
  const toggleGroup = (group) => {
    const allCorrect = group.answers.every((answer) => gradedAnswers[answerKey(answer)]?.status === "correct");
    group.answers.forEach((answer) => markAnswer(answer, allCorrect ? "incorrect" : "correct"));
  };

  return <Card className="glass-card"><CardContent className="p-4"><div className="flex items-center justify-between gap-2 mb-4"><div className="flex items-center gap-2 text-white font-semibold"><Users size={18} className="text-[#71E0DC]" />Answers Submitted ({submittedCount}/{playerCount || 0})</div><Badge className={allSubmitted ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{allSubmitted ? "Complete" : "Waiting"}</Badge></div>{allSubmitted && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">All answers are in</div>}{leftScreenCount > 0 && <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm font-bold text-amber-200">{leftScreenCount} team{leftScreenCount === 1 ? "" : "s"} left the game screen during this question</div>}{lateCorrectIds.size > 0 && <div className="mb-4 rounded-lg border border-purple-400/30 bg-purple-400/10 p-3 text-sm font-bold text-purple-200">{lateCorrectIds.size} late correct answer{lateCorrectIds.size === 1 ? "" : "s"} flagged</div>}<Button size="sm" onClick={() => setMode("leaderboard")} className="w-full mb-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-100"><Trophy size={14} className="mr-2" />Show Leaderboard</Button><div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Click an answer to toggle true/false</p><p className="text-[11px] text-zinc-600">Correct: +{pointsPerQuestion}</p></div><div className="flex flex-wrap gap-3 max-h-[520px] overflow-y-auto pr-1">{groups.map((group) => { const allCorrect = group.answers.every((answer) => gradedAnswers[answerKey(answer)]?.status === "correct"); const anyIncorrect = group.answers.some((answer) => gradedAnswers[answerKey(answer)]?.status === "incorrect"); const groupLeftScreen = group.answers.some((answer) => leftScreenIds.has(answer.playerId)); const groupLateCorrect = group.answers.some((answer) => lateCorrectIds.has(answer.playerId)); const groupPattern = group.answers.some((answer) => patternIds.has(answer.playerId)); const tone = allCorrect ? "correct" : anyIncorrect ? "incorrect" : "ungraded"; const className = tone === "correct" ? "border-emerald-500/35 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/25" : tone === "incorrect" ? "border-rose-500/35 bg-rose-500/20 text-rose-300 hover:bg-rose-500/25" : "border-white/10 bg-zinc-900/80 text-zinc-200 hover:border-[#71E0DC]/40"; return <button key={group.key} type="button" onClick={() => toggleGroup(group)} className={`inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 transition ${className}`}><span className="flex -space-x-2">{group.answers.slice(0, 4).map((answer) => <span key={answer.playerId} title={answer.playerName} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-zinc-950 text-xs font-black ${leftScreenIds.has(answer.playerId) ? "bg-amber-200 text-zinc-950 ring-2 ring-amber-400/50" : lateCorrectIds.has(answer.playerId) ? "bg-purple-200 text-zinc-950 ring-2 ring-purple-400/50" : "bg-zinc-200 text-zinc-800"}`}>{String(answer.playerName || "?").slice(0, 1).toUpperCase()}</span>)}{group.answers.length > 4 && <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-zinc-950 bg-zinc-700 text-xs font-black text-white">+{group.answers.length - 4}</span>}</span><span className="min-w-0 max-w-[150px] truncate text-sm font-bold">{group.label}</span>{groupLeftScreen && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-200">Left</span>}{groupLateCorrect && <span className="rounded-full bg-purple-400/15 px-2 py-0.5 text-[11px] font-bold text-purple-200">Late</span>}{groupPattern && <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-200">Pattern</span>}<span className="text-xs font-bold">{tone === "correct" ? "True" : tone === "incorrect" ? "False" : `${group.answers.length}`}</span>{tone === "correct" ? <CheckCircle size={15} /> : tone === "incorrect" ? <XCircle size={15} /> : null}</button>; })}{!groups.length && <p className="w-full text-xs text-zinc-500 text-center py-4">Answers for the current question will appear here.</p>}</div></CardContent></Card>;
};

const LeaderboardPanel = ({ leaderboard, teamName, teamScore, setTeamName, setTeamScore, addTeam, adjustScore, openScoreModal, removeTeam, showLeaderboard, fairPlayStats }) => { const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)); return <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2 text-white font-semibold"><Trophy size={18} className="text-amber-300" />Leaderboard</div><Button size="sm" variant="outline" onClick={showLeaderboard} className="h-8 border-white/10 text-zinc-300 hover:text-white">Show</Button></div><div className="grid grid-cols-[1fr_76px_36px] gap-2 mb-3"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Team name" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><input value={teamScore} onChange={(event) => setTeamScore(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Score" type="number" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><Button onClick={addTeam} className="h-9 w-9 p-0 gradient-btn" aria-label="Add team"><Plus size={16} /></Button></div><div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">{sorted.map((team) => { const stats = fairPlayStats.get(team.id) || {}; return <div key={team.id} className="rounded-md border border-white/10 bg-zinc-950/60 p-2"><div className="flex items-center justify-between gap-2 mb-2"><span className="font-semibold text-sm truncate">{team.name}</span><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>{Boolean(stats.flags?.length) && <div className="mb-2 flex flex-wrap gap-1">{stats.flags.map((flag) => <span key={flag} className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-200">{flag}</span>)}</div>}<div className="mb-2 grid grid-cols-3 gap-1 text-[11px] text-zinc-500"><span>Streak {stats.correctStreak || 0}</span><span>Late {stats.lateCorrect || 0}</span><span>Exit {stats.leftScreen || 0}</span></div><div className="flex items-center gap-1"><Button size="sm" onClick={() => adjustScore(team.id, -1)} className="h-7 flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200">-1</Button><Button size="sm" onClick={() => adjustScore(team.id, 1)} className="h-7 flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200">+1</Button><Button size="sm" variant="outline" onClick={() => openScoreModal(team.id)} className="h-7 flex-1 border-white/10 text-zinc-300 hover:text-white">Edit</Button><Button size="sm" variant="outline" onClick={() => removeTeam(team.id)} className="h-7 w-8 p-0 border-white/10 text-zinc-400 hover:text-red-300" aria-label="Remove team"><Trash2 size={13} /></Button></div></div>; })}{!sorted.length && <p className="text-xs text-zinc-500 text-center py-3">Teams will appear here when players join from their phones.</p>}</div></CardContent></Card>; };

const BonusPauseStage = ({ round, leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
  return <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-10 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10"><Loader2 className="animate-spin text-[#71E0DC]" size={30} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Bonus question next</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">{round?.name || "Round"} Bonus</h2><p className="mt-3 text-zinc-400">Leaderboard pause before the final question of the round.</p><div className="mx-auto mt-8 max-w-3xl space-y-3 text-left">{sorted.map((team, index) => <div key={team.id || team.name} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/70 px-4 py-3"><div className={`h-9 w-9 rounded-full flex items-center justify-center font-black ${index === 0 ? "bg-amber-300 text-zinc-950" : "bg-white/10 text-zinc-200"}`}>{index + 1}</div><span className="truncate text-lg font-bold text-white">{team.name}</span><span className="text-2xl font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>)}{!sorted.length && <p className="rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-center text-zinc-500">Leaderboard will appear once teams join or are added.</p>}</div></CardContent></Card>;
};

const WinnersStage = ({ leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const winners = sorted.slice(0, 3);
  return <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-12 text-center"><div className="mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10"><Trophy className="text-amber-300" size={42} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Final Scores</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">Tonight&apos;s Winners</h2><div className="mx-auto mt-8 grid max-w-4xl grid-cols-1 md:grid-cols-3 gap-4 text-left">{winners.map((team, index) => <div key={team.id || team.name} className={`rounded-xl border p-5 ${index === 0 ? "border-amber-300/40 bg-amber-300/15 md:order-2" : index === 1 ? "border-[#AEB2EF]/30 bg-[#AEB2EF]/10 md:order-1" : "border-[#71E0DC]/30 bg-[#71E0DC]/10 md:order-3"}`}><p className="text-sm font-bold uppercase tracking-wide text-zinc-400">{index === 0 ? "Champion" : `${index + 1}${index === 1 ? "nd" : "rd"} Place`}</p><p className="mt-3 text-2xl font-black text-white truncate">{team.name}</p><p className="mt-2 text-4xl font-black" style={{ color: index === 0 ? "#FDE68A" : index === 1 ? "#AEB2EF" : "#71E0DC" }}>{Number(team.score || 0)}</p></div>)}{!winners.length && <p className="md:col-span-3 rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-center text-zinc-500">Winners will appear once teams have scores.</p>}</div><p className="mt-8 text-xl font-bold text-zinc-300">Thanks for playing.</p></CardContent></Card>;
};

const FeedbackStage = ({ ideas }) => <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-12 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10"><MessageSquare className="text-[#71E0DC]" size={34} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Player Feedback</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">Send Category or Question Ideas</h2><p className="mx-auto mt-4 max-w-2xl text-xl text-zinc-300">Players can submit ideas from their phones now.</p><div className="mx-auto mt-8 max-w-3xl rounded-lg border border-white/10 bg-zinc-950/60 p-5"><p className="text-5xl font-black text-[#71E0DC]">{ideas.length}</p><p className="text-zinc-400">idea{ideas.length === 1 ? "" : "s"} submitted</p></div></CardContent></Card>;

const IdeasPanel = ({ ideas }) => <Card className="glass-card"><CardContent className="p-4"><div className="flex items-center justify-between gap-2 mb-4"><div className="flex items-center gap-2 text-white font-semibold"><Sparkles size={18} className="text-[#71E0DC]" />Player Ideas</div><Badge className="bg-zinc-800 text-zinc-300">{ideas.length}</Badge></div><div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">{ideas.map((idea, index) => <div key={`${idea.playerId}-${idea.submittedAt}-${index}`} className="rounded-md border border-white/10 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-bold text-white truncate">{idea.playerName || "Team"}</span><span className="text-[11px] text-zinc-600">{new Date(idea.submittedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>{idea.category && <p className="text-sm text-[#71E0DC]"><span className="text-zinc-500">Category:</span> {idea.category}</p>}{idea.question && <p className="mt-2 text-sm text-zinc-200 whitespace-pre-wrap">{idea.question}</p>}</div>)}{!ideas.length && <p className="text-xs text-zinc-500 text-center py-6">Ideas will appear here after players submit them.</p>}</div></CardContent></Card>;

const ScoreAdjustModal = ({ modal, setModal, adjustScore, setScore }) => {
  const adjustment = Number(modal.adjustment || 0);
  const setTo = Number(modal.setTo || 0);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-wide text-[#71E0DC]">Manual Score</p><h3 className="text-xl font-black text-white">{modal.teamName}</h3><p className="text-sm text-zinc-500">Current score: {modal.currentScore}</p></div>{modal.answer && <div className="mb-4 rounded-md border border-white/10 bg-zinc-900/70 p-3"><p className="text-xs text-zinc-500 mb-1">Answer</p><p className="text-sm text-zinc-200 break-words">{modal.answer.answer}</p></div>}<div className="space-y-3"><label className="block text-xs text-zinc-400">Add or subtract points<input type="number" value={modal.adjustment} onChange={(event) => setModal((current) => ({ ...current, adjustment: event.target.value }))} placeholder="e.g. 25 or -10" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-900 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="block text-xs text-zinc-400">Set total score<input type="number" value={modal.setTo} onChange={(event) => setModal((current) => ({ ...current, setTo: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-900 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setModal(null)} className="border-white/10 text-zinc-300 hover:text-white">Cancel</Button><Button onClick={() => { adjustScore(modal.teamId, adjustment); setModal(null); toast.success(`Adjusted ${modal.teamName} by ${adjustment}`); }} disabled={!adjustment} className="bg-zinc-800 text-white hover:bg-zinc-700">Apply Adjustment</Button><Button onClick={() => { setScore(modal.teamId, setTo); setModal(null); toast.success(`Set ${modal.teamName} to ${setTo}`); }} className="gradient-btn">Set Score</Button></div></div></div>;
};

const RunSheet = ({ rounds, currentIndex, goToQuestion, answers, players, gradedAnswers, editBuild }) => <Card className="glass-card"><CardContent className="p-4"><div className="flex items-center justify-between gap-2 mb-4"><div className="flex items-center gap-2 text-white font-semibold"><MonitorPlay size={18} className="text-[#71E0DC]" />Run Sheet</div><Button size="sm" variant="outline" onClick={editBuild} className="h-8 border-white/10 text-zinc-300 hover:text-white"><Pencil size={14} className="mr-1" />Edit Build</Button></div><div className="space-y-4 max-h-[660px] overflow-y-auto pr-1">{rounds.map((round) => <section key={round.key}><button type="button" onClick={() => goToQuestion(round.startIndex)} className="w-full flex items-center justify-between text-left mb-2 px-2 py-1 rounded hover:bg-white/5"><span className="text-sm font-bold text-white">{round.name}</span><Badge className="bg-zinc-800 text-zinc-300">{round.questions.length}</Badge></button><div className="space-y-2">{round.questions.map((question, localIndex) => { const absoluteIndex = round.startIndex + localIndex; const active = absoluteIndex === currentIndex; const questionAnswers = answers.filter((answer) => Number(answer.questionIndex) === absoluteIndex); const graded = questionAnswers.map((answer) => gradedAnswers[answerKey(answer)]).filter(Boolean); const correctCount = graded.filter((item) => item.status === "correct").length; const incorrectCount = graded.filter((item) => item.status === "incorrect").length; return <button key={question.id} type="button" onClick={() => goToQuestion(absoluteIndex)} className={`w-full text-left rounded-md px-3 py-3 border transition-colors ${active ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/5 bg-zinc-950/40 hover:bg-zinc-900"}`}><div className="flex items-start justify-between gap-3 mb-2"><div className="flex items-center gap-2 flex-wrap"><span className="text-xs text-zinc-500 font-mono">#{localIndex + 1}</span><QuestionBadge type={question.type} />{question.imageUrl && <Image size={12} className="text-amber-300" />}</div><div className="flex items-center gap-1 text-[11px]"><span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">{questionAnswers.length}/{players.length || 0}</span>{correctCount > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">+{correctCount}</span>}{incorrectCount > 0 && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-300">-{incorrectCount}</span>}</div></div><p className="text-xs text-zinc-300 line-clamp-2">{question.questionText}</p><p className="mt-1 text-[11px] text-zinc-600">{question.category}</p></button>; })}</div></section>)}</div></CardContent></Card>;

const QuestionBadge = ({ type }) => { const meta = typeMeta[type] || typeMeta.written; const Icon = meta.icon; return <Badge className="bg-zinc-800 text-zinc-300 text-[11px]"><Icon size={11} className={`mr-1 ${meta.color}`} />{meta.short}</Badge>; };

const QuestionStage = ({ question, index, total, roundName, showAnswer, showFunFact, focusMode, pointsPerQuestion, setPointsPerQuestion, timerSeconds, setTimerSeconds, timeRemaining, startTimer, resetTimer, wagerMode, setWagerMode, wagerLimit, setWagerLimit, wagerTiming, setWagerTiming, branding }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);
  const shouldShowImage = Boolean(imageUrl) && question.imageTiming !== "after_answer";
  const shouldShowFunFactImage = Boolean(imageUrl) && question.imageTiming === "after_answer" && showFunFact && question.funFact;
  const editNumber = (label, value, onSave) => {
    const next = window.prompt(label, String(value ?? ""));
    if (next === null) return;
    const parsed = Math.max(0, Number(next) || 0);
    onSave(parsed);
  };

  return <Card className={`glass-card overflow-hidden ${focusMode ? "w-full" : ""}`}><CardContent className={focusMode ? "p-8 lg:p-12" : "p-5 lg:p-7"}><div className="flex items-start justify-between gap-4 flex-wrap mb-6"><div className="flex items-center gap-2 flex-wrap">{branding?.logoUrl && <img src={branding.logoUrl} alt={branding.name || "Host logo"} className="h-8 w-8 rounded bg-white object-contain p-1" />}<Badge className="border" style={{ backgroundColor: `${branding?.primaryColor || DEFAULT_BRANDING.primaryColor}24`, borderColor: `${branding?.primaryColor || DEFAULT_BRANDING.primaryColor}55`, color: branding?.primaryColor || DEFAULT_BRANDING.primaryColor }}>{roundName || "Round"}</Badge><Badge variant="outline" className="border-zinc-700 text-zinc-300">{question.category}</Badge><Badge className="bg-zinc-800 text-zinc-300"><Icon size={13} className={`mr-1 ${meta.color}`} />{meta.label}</Badge>{imageUrl && <Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20">{question.imageTiming === "after_answer" ? "Media with fun fact" : "Media"}</Badge>}</div><span className="text-zinc-500 font-mono text-sm">{index + 1} / {total}</span></div><div className="mb-7 flex items-center justify-between gap-3 flex-wrap rounded-lg border border-white/10 bg-zinc-950/45 p-3"><div className="flex items-center gap-2 flex-wrap"><button type="button" onClick={() => editNumber("Points for this question", pointsPerQuestion, setPointsPerQuestion)} className="rounded-full border border-amber-400/20 bg-amber-400/15 px-3 py-1.5 text-sm font-bold text-amber-200 hover:border-amber-300/50">Points: {Number(pointsPerQuestion) || getDefaultPoints(question)}</button><button type="button" onClick={() => editNumber("Timer seconds", timerSeconds, setTimerSeconds)} className="rounded-full border border-[#AEB2EF]/25 bg-[#AEB2EF]/15 px-3 py-1.5 text-sm font-bold text-[#C6C9FF] hover:border-[#AEB2EF]/60">Timer: {timeRemaining !== null ? `${timeRemaining}s left` : `${Number(timerSeconds) || 0}s`}</button><button type="button" onClick={() => { editNumber("Wager limit. Set 0 for no wager.", wagerLimit, (value) => { setWagerLimit(value); setWagerMode(value > 0); }); }} className={`rounded-full border px-3 py-1.5 text-sm font-bold ${wagerMode ? "border-purple-500/30 bg-purple-500/15 text-purple-200 hover:border-purple-400/60" : "border-white/10 bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}>Wager: {wagerMode ? wagerLimit : "Off"}</button>{wagerMode && <button type="button" onClick={() => setWagerTiming((value) => value === "after_answer" ? "before_answer" : "after_answer")} className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-sm font-bold text-purple-200 hover:border-purple-400/60">{wagerTiming === "after_answer" ? "After Answer" : "Before Answer"}</button>}</div><div className="flex items-center gap-2"><Button size="sm" onClick={startTimer} className="h-9 gradient-btn"><Play size={15} className="mr-2" />Start</Button><Button size="sm" variant="outline" onClick={resetTimer} className="h-9 border-white/10 text-zinc-300 hover:text-white"><RotateCcw size={15} className="mr-2" />Clear</Button></div></div>{shouldShowImage && <div className="mb-6 flex justify-center"><img src={imageUrl} alt="Question" className="max-h-[42vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}<h2 className={`${focusMode ? "text-4xl lg:text-6xl" : "text-2xl lg:text-4xl"} font-black leading-tight text-white text-center mb-8`}>{question.questionText}</h2>{question.type === "true_false" && <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto mb-6"><div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-center font-bold py-5 text-2xl">True</div><div className="rounded-lg border-2 border-red-500/30 bg-red-500/10 text-red-300 text-center font-bold py-5 text-2xl">False</div></div>}{question.type === "multiple_choice" && question.options.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl mx-auto mb-6">{question.options.map((option, optionIndex) => <div key={optionIndex} className="rounded-lg border border-white/10 bg-zinc-900/80 px-4 py-3 text-zinc-200 text-lg">{option}</div>)}</div>}{showAnswer && <div className="mt-8 rounded-lg border p-5 text-center" style={{ backgroundColor: `${branding?.primaryColor || DEFAULT_BRANDING.primaryColor}18`, borderColor: `${branding?.primaryColor || DEFAULT_BRANDING.primaryColor}55` }}><p className="text-zinc-400 text-sm uppercase tracking-wider mb-1">Answer</p><p className={`${focusMode ? "text-4xl" : "text-2xl"} font-bold`} style={{ color: branding?.primaryColor || DEFAULT_BRANDING.primaryColor }}>{question.answer}</p></div>}{showFunFact && question.funFact && <div className="mt-5 rounded-lg border p-5 text-center" style={{ backgroundColor: `${branding?.accentColor || DEFAULT_BRANDING.accentColor}18`, borderColor: `${branding?.accentColor || DEFAULT_BRANDING.accentColor}55` }}>{shouldShowFunFactImage && <div className="mb-4 flex justify-center"><img src={imageUrl} alt="Fun fact media" className="max-h-[32vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}<div className="flex items-center justify-center gap-2 font-bold mb-2" style={{ color: branding?.accentColor || DEFAULT_BRANDING.accentColor }}><Sparkles size={18} />Fun Fact</div><p className="text-zinc-300 max-w-3xl mx-auto">{question.funFact}</p></div>}</CardContent></Card>;
};

export default HostSession;



