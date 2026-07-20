import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { uploadQuestionMedia } from "../lib/mediaUpload";
import { ensureLiveGame, fetchLivePlayers, subscribeLivePlayers, upsertLivePlayer, setLivePlayerScore, removeLivePlayer } from "../lib/liveGame";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
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
  MoreHorizontal,
  Palette,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Tags,
  ThumbsDown,
  ThumbsUp,
  Timer,
  Trash2,
  Trophy,
  Upload,
  Users,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { loadHostSetupSettings, loadHostToolsSessionState, saveHostSetupSettings, saveHostToolsSessionState, updateUserMetadata } from "../lib/profileState";

const STORAGE_BASE = process.env.REACT_APP_SUPABASE_URL ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/` : "";
const DEFAULT_PUBLIC_SITE = "https://quizcrafter.com";
const POINTS_BY_TYPE = { true_false: 25, multiple_choice: 50, written: 100 };
const DEFAULT_BRANDING = { name: "Forever Fun Events", logoUrl: "/quiz-crafter-logo.svg", primaryColor: "#71E0DC", accentColor: "#AEB2EF", correctColor: "", optionColor: "#7C8496", lobbyTagline: "Let's get quizzical." };

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

const MEDIA_PLACEHOLDERS = new Set(["question", "image", "picture", "photo", "media", "n/a", "na", "none", "null", "undefined"]);

const cleanMediaValue = (value) => {
  const text = String(value || "").trim();
  if (!text || MEDIA_PLACEHOLDERS.has(text.toLowerCase())) return "";
  return text;
};

const looksLikeMediaValue = (value) => {
  const text = cleanMediaValue(value);
  if (!text) return false;
  if (/^(data:image\/|https?:\/\/|\/)/i.test(text)) return true;
  if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(text)) return true;
  if (/storage\/v1\/object|supabase|cloudinary|canva|drive\.google|dropbox|images?|photos?/i.test(text)) return true;
  return false;
};

const firstQuestionImageUrl = (question = {}) => {
  const candidates = [
    question.image_url,
    question.imageUrl,
    question.media_url,
    question.mediaUrl,
    question.question_image_url,
    question.questionImageUrl,
    question.picture_url,
    question.pictureUrl,
    question.photo_url,
    question.photoUrl,
    question.correct_answer_image,
    question.correctAnswerImage,
    question.answer_image,
    question.answerImage,
    question.reveal_image_url,
    question.revealImageUrl,
  ];
  return candidates.map(cleanMediaValue).find(looksLikeMediaValue) || "";
};

const buildStorageUrl = (path) => {
  const value = cleanMediaValue(path);
  if (!value) return "";
  if (value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://")) return value;
  if (!STORAGE_BASE) return value;
  return `${STORAGE_BASE}${value.replace(/^\/+/, "")}`;
};
const HOST_DEFAULT_BRANDING_KEY = "quiz-crafter-host-branding-defaults";
const metadataBrandingKey = "quiz_crafter_host_branding_defaults_v1";
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
    // Empty means "match the brand primary color" -- correctColor only holds a
    // value once a host explicitly picks something other than the default.
    correctColor: /^#[0-9a-f]{6}$/i.test(String(source.correctColor || "")) ? source.correctColor : "",
    optionColor: sanitizeHexColor(source.optionColor, DEFAULT_BRANDING.optionColor),
    lobbyTagline: String(source.lobbyTagline || "").trim() || DEFAULT_BRANDING.lobbyTagline,
  };
};
const readDefaultBranding = () => {
  try {
    return normalizeBranding({ ...DEFAULT_BRANDING, ...JSON.parse(localStorage.getItem(HOST_DEFAULT_BRANDING_KEY) || "null") });
  } catch {
    return DEFAULT_BRANDING;
  }
};
const readSavedDefaultBranding = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOST_DEFAULT_BRANDING_KEY) || "null");
    return parsed && typeof parsed === "object" ? normalizeBranding(parsed) : null;
  } catch {
    return null;
  }
};
const writeDefaultBranding = (branding) => { try { localStorage.setItem(HOST_DEFAULT_BRANDING_KEY, JSON.stringify(normalizeBranding(branding))); } catch { /* Ignore storage failures so branding never crashes hosting. */ } };
const brandingChanged = (left, right) => JSON.stringify(normalizeBranding(left || {})) !== JSON.stringify(normalizeBranding(right || {}));
const loadDefaultBrandingFromProfile = async () => {
  const setupSettings = await loadHostSetupSettings().catch(() => ({}));
  if (setupSettings.branding && typeof setupSettings.branding === "object") return normalizeBranding(setupSettings.branding);
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const remoteBranding = data?.user?.user_metadata?.[metadataBrandingKey];
  return remoteBranding && typeof remoteBranding === "object" ? normalizeBranding(remoteBranding) : null;
};
const saveDefaultBrandingToProfile = async (branding) => {
  const cleanBranding = normalizeBranding(branding);
  await updateUserMetadata({ [metadataBrandingKey]: cleanBranding });
  await saveHostSetupSettings({ branding: cleanBranding });
  return cleanBranding;
};
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
        imageUrl: firstQuestionImageUrl(question),
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
const readStoredObject = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const writeStoredList = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Live hosting should keep running even if browser storage is unavailable.
  }
};
const writeStoredObject = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value && typeof value === "object" ? value : {}));
  } catch {
    // Live hosting should keep running even if browser storage is unavailable.
  }
};
const persistLiveVote = (sessionId, name, payload, makeKey) => {
  const key = hostToolsStorageKey(sessionId, name);
  const current = readStoredList(key);
  const next = [...current.filter((item) => makeKey(item) !== makeKey(payload)), payload];
  writeStoredList(key, next);
  saveHostToolsSessionState(sessionId, { [name === "category-feedback" ? "categoryFeedback" : name]: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};
const persistLiveIdea = (sessionId, payload) => {
  const key = hostToolsStorageKey(sessionId, "ideas");
  const current = readStoredList(key);
  const next = [payload, ...current.filter((item) => !(item.playerId === payload.playerId && item.submittedAt === payload.submittedAt))].slice(0, 200);
  writeStoredList(key, next);
  saveHostToolsSessionState(sessionId, { ideas: next }).catch((error) => console.warn("Host tools profile save unavailable:", error));
  return next;
};

const getDefaultPoints = (question) => POINTS_BY_TYPE[question?.type] || 100;
const getQuestionPoints = (question) => Number(question?.points ?? 0) > 0 ? Number(question.points) : getDefaultPoints(question);
const isBonusQuestion = (question) => String(question?.category || "").trim().toUpperCase() === "BONUS";
const answerKey = (answer) => `${answer.playerId}-${answer.questionIndex}`;
const normalizeAnswerText = (value) => String(value || "").trim().toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
const isCorrectSubmission = (answer, question) => Boolean(question?.answer) && normalizeAnswerText(answer?.answer) === normalizeAnswerText(question.answer);
const serializeRoundIntro = (round) => round ? { key: round.key, name: round.name, description: round.description || "", categories: [...new Set((round.questions || []).map((question) => question.category).filter(Boolean))], questionCount: round.questions?.length || 0, startIndex: round.startIndex } : null;
const getTeamScore = (leaderboard, teamId) => Number(leaderboard.find((team) => team.id === teamId)?.score || 0);
const isLateSubmission = (answer) => answer?.secondsRemainingAtSubmit !== null && answer?.secondsRemainingAtSubmit !== undefined && Number(answer.secondsRemainingAtSubmit) <= 5;
const hasSubmittedWager = (answer) => Boolean(answer?.wagerMode) && (answer?.wagerSubmitted === true || answer?.wagerTiming !== "after_answer" || Number(answer?.wagerAmount || 0) > 0);
const getWagerAward = (answer, leaderboard, wagerLimit, previousPoints = 0) => {
  const requested = Math.max(0, Number(answer?.wagerAmount || 0));
  if (!requested) return 0;
  const currentScore = getTeamScore(leaderboard, answer.playerId);
  const scoreAtWager = Number.isFinite(Number(answer?.scoreAtWager))
    ? Math.max(0, Number(answer.scoreAtWager))
    : Math.max(0, currentScore - Number(previousPoints || 0));
  const submittedCap = Number.isFinite(Number(answer?.wagerCap)) ? Number(answer.wagerCap) : Number.POSITIVE_INFINITY;
  const configuredCap = Number(wagerLimit || 0) > 0 ? Number(wagerLimit) : Number.POSITIVE_INFINITY;
  return Math.min(requested, configuredCap, submittedCap, scoreAtWager);
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
  const liveStateRef = useRef(null);
  const liveStateSequenceRef = useRef(0);
  const hostedResultsRef = useRef({});
  const liveStateSaveRef = useRef(0);
  const liveStateSaveKeyRef = useRef("");
  const [session, setSession] = useState(null);
  const [liveGameId, setLiveGameId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(null);
  const [emergencyOverride, setEmergencyOverride] = useState(null);
  const [generatedEmergency, setGeneratedEmergency] = useState(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [disputeNotes, setDisputeNotes] = useState(() => readStoredList(hostToolsStorageKey(id, "disputes")));
  const [showAnswer, setShowAnswer] = useState(false);
  const [showFunFact, setShowFunFact] = useState(false);
  const [presentMode, setPresentMode] = useState("categories");
  const [introRoundKey, setIntroRoundKey] = useState(null);
  const [pendingBonusIndex, setPendingBonusIndex] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [leaderboard, setLeaderboard] = useState(() => readStoredLeaderboard(id));
  const [teamName, setTeamName] = useState("");
  const [teamScore, setTeamScore] = useState("");
  const [players, setPlayers] = useState(() => readStoredList(hostToolsStorageKey(id, "players")));
  const [answers, setAnswers] = useState(() => readStoredList(hostToolsStorageKey(id, "answers")));
  const [playerActivity, setPlayerActivity] = useState(() => readStoredList(hostToolsStorageKey(id, "activity")));
  const [feedback, setFeedback] = useState(() => readStoredList(hostToolsStorageKey(id, "feedback")));
  const [categoryFeedback, setCategoryFeedback] = useState(() => readStoredList(hostToolsStorageKey(id, "category-feedback")));
  const [playerIdeas, setPlayerIdeas] = useState(() => readStoredList(hostToolsStorageKey(id, "ideas")));
  const [gradedAnswers, setGradedAnswers] = useState(() => readStoredObject(hostToolsStorageKey(id, "graded-answers")));
  const [scoreModal, setScoreModal] = useState(null);
  const [liveStatus, setLiveStatus] = useState("connecting");
  const [hostStateLoaded, setHostStateLoaded] = useState(false);
  const [pointsPerQuestion, setPointsPerQuestion] = useState(25);
  const [wagerMode, setWagerMode] = useState(false);
  const [wagerLimit, setWagerLimit] = useState(0);
  const [wagerTiming, setWagerTiming] = useState("before_answer");
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [branding, setBranding] = useState(() => readStoredBranding(id));
  const [topbarCollapsed, setTopbarCollapsed] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState(null);

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
        hostedResultsRef.current = data?.hosted_results && typeof data.hosted_results === "object" && !Array.isArray(data.hosted_results) ? data.hosted_results : {};
        liveStateSequenceRef.current = Math.max(liveStateSequenceRef.current, Number(hostedResultsRef.current?.liveState?.liveSequence || 0));
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
    if (!session) return;
    let cancelled = false;
    ensureLiveGame(id, { sessionName: session?.name || session?.session_name || "Trivia Night" })
      .then((game) => { if (!cancelled) setLiveGameId(game.id); })
      .catch((error) => console.warn("Live game setup unavailable:", error));
    return () => { cancelled = true; };
  }, [id, session]);

  useEffect(() => {
    if (!liveGameId) return undefined;
    let cancelled = false;
    fetchLivePlayers(liveGameId)
      .then((rows) => { if (!cancelled) setLeaderboard(rows.map((row) => ({ id: row.id, name: row.name, score: Number(row.score || 0) }))); })
      .catch((error) => console.warn("Live roster load unavailable:", error));
    const unsubscribe = subscribeLivePlayers(liveGameId, ({ eventType, new: newRow, old: oldRow }) => {
      setLeaderboard((current) => {
        if (eventType === "DELETE") return current.filter((team) => team.id !== oldRow.id);
        const nextTeam = { id: newRow.id, name: newRow.name, score: Number(newRow.score || 0) };
        const exists = current.some((team) => team.id === nextTeam.id);
        return exists ? current.map((team) => (team.id === nextTeam.id ? nextTeam : team)) : [...current, nextTeam];
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [liveGameId]);

  useEffect(() => {
    const loadProfileHostState = async () => {
      try {
        const state = await loadHostToolsSessionState(id);
        const snapshot = state.results && typeof state.results === "object" ? { ...state, ...state.results } : state;
        if (Array.isArray(snapshot.players)) setPlayers(snapshot.players);
        if (Array.isArray(snapshot.answers)) setAnswers(snapshot.answers);
        if (Array.isArray(snapshot.activity)) setPlayerActivity(snapshot.activity);
        if (Array.isArray(snapshot.feedback)) setFeedback(snapshot.feedback);
        if (Array.isArray(snapshot.categoryFeedback)) setCategoryFeedback(snapshot.categoryFeedback);
        if (Array.isArray(snapshot.ideas)) setPlayerIdeas(snapshot.ideas);
        if (Array.isArray(snapshot.disputes)) setDisputeNotes(snapshot.disputes);
        if (snapshot.gradedAnswers && typeof snapshot.gradedAnswers === "object") setGradedAnswers(snapshot.gradedAnswers);
        if (Number.isFinite(Number(snapshot.currentIndex))) setCurrentIndex(Math.max(0, Number(snapshot.currentIndex)));
        if (snapshot.endedAt) {
          setGameStarted(true);
          setPresentMode(snapshot.presentMode || "winners");
        }
      } catch (error) {
        console.warn("Live host profile state unavailable:", error);
      } finally {
        setHostStateLoaded(true);
      }
    };
    loadProfileHostState();
  }, [id]);

  useEffect(() => {
    const loadProfileBranding = async () => {
      try {
        const defaultBranding = await loadDefaultBrandingFromProfile();
        const savedLocalBranding = readSavedDefaultBranding();
        if (defaultBranding) {
          writeDefaultBranding(defaultBranding);
        } else if (savedLocalBranding && brandingChanged(savedLocalBranding, DEFAULT_BRANDING)) {
          await saveDefaultBrandingToProfile(savedLocalBranding);
        } else {
          return;
        }
        const hasSessionOverride = !!localStorage.getItem(hostBrandingKey(id));
        if (!hasSessionOverride) setBranding(readStoredBranding(id, session));
      } catch (error) {
        console.warn("Host default branding profile sync unavailable:", error);
      }
    };
    loadProfileBranding();
  }, [id, session]);

  useEffect(() => {
    const channel = supabase.channel(`quiz-crafter-live-${id}`, { config: { broadcast: { self: false } } });
    liveChannelRef.current = channel;
    channel
      .on("broadcast", { event: "player_join" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayers((current) => {
          const nextPlayer = { id: payload.playerId, name: payload.playerName || "Team", updatePreference: payload.updatePreference || "none", updateContact: payload.updateContact || "", joinedAt: payload.joinedAt };
          const next = current.some((player) => player.id === payload.playerId) ? current.map((player) => player.id === payload.playerId ? { ...player, ...nextPlayer } : player) : [...current, nextPlayer];
          saveHostToolsSessionState(id, { players: next }).catch((error) => console.warn("Players profile save unavailable:", error));
          return next;
        });
      })
      .on("broadcast", { event: "player_rename" }, ({ payload }) => {
        if (!payload?.playerId || !payload.playerName) return;
        setPlayers((current) => {
          const next = current.map((player) => player.id === payload.playerId ? { ...player, name: payload.playerName } : player);
          saveHostToolsSessionState(id, { players: next }).catch((error) => console.warn("Players profile save unavailable:", error));
          return next;
        });
        setAnswers((current) => {
          const next = current.map((answer) => answer.playerId === payload.playerId ? { ...answer, playerName: payload.playerName } : answer);
          writeStoredList(hostToolsStorageKey(id, "answers"), next);
          saveHostToolsSessionState(id, { answers: next }).catch((error) => console.warn("Answers profile save unavailable:", error));
          return next;
        });
      })
      .on("broadcast", { event: "answer_submit" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setAnswers((current) => {
          const filtered = current.filter((answer) => !(answer.playerId === payload.playerId && answer.questionIndex === payload.questionIndex));
          const next = [...filtered, payload].slice(-800);
          writeStoredList(hostToolsStorageKey(id, "answers"), next);
          saveHostToolsSessionState(id, { answers: next }).catch((error) => console.warn("Answers profile save unavailable:", error));
          return next;
        });
      })
      .on("broadcast", { event: "player_activity" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setPlayerActivity((current) => {
          const next = [...current, payload].slice(-800);
          writeStoredList(hostToolsStorageKey(id, "activity"), next);
          saveHostToolsSessionState(id, { activity: next }).catch((error) => console.warn("Activity profile save unavailable:", error));
          return next;
        });
      })
      .on("broadcast", { event: "feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setFeedback(() => persistLiveVote(id, "feedback", payload, (item) => `${item.playerId}-${item.questionIndex}`));
      })
      .on("broadcast", { event: "category_feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || !payload.category) return;
        setCategoryFeedback(() => persistLiveVote(id, "category-feedback", payload, (item) => `${item.playerId}-${item.roundKey || item.roundName}-${item.category}`));
      })
      .on("broadcast", { event: "idea_submit" }, ({ payload }) => {
        if (!payload?.playerId) return;
        setPlayerIdeas(() => persistLiveIdea(id, payload));
      })
      .on("broadcast", { event: "present_ready" }, () => {
        const state = liveStateRef.current;
        if (state) liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: state });
      })
      .subscribe((status) => {
        setLiveStatus(status === "SUBSCRIBED" ? "live" : "connecting");
        if (status === "SUBSCRIBED" && liveStateRef.current) {
          liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: liveStateRef.current });
        }
      });
    return () => {
      supabase.removeChannel(channel);
      liveChannelRef.current = null;
    };
  }, [id]);

  const questions = useMemo(() => flattenSession(session), [session]);
  const rounds = useMemo(() => makeRounds(questions), [questions]);
  const isReviewing = reviewIndex !== null;
  const hostIndex = isReviewing ? reviewIndex : currentIndex;
  const currentQuestion = questions[currentIndex] || null;
  const liveDisplayedQuestion = emergencyOverride || currentQuestion;
  const displayedQuestion = isReviewing ? questions[hostIndex] : liveDisplayedQuestion;
  const currentRound = rounds.find((round) => hostIndex >= round.startIndex && hostIndex < round.startIndex + round.questions.length);
  const liveRound = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
  const nextRound = rounds.find((round) => round.startIndex > currentIndex);
  const defaultIntroRound = liveRound && currentIndex >= liveRound.startIndex + liveRound.questions.length - 1 && nextRound ? nextRound : liveRound;
  const introRound = rounds.find((round) => round.key === (introRoundKey || defaultIntroRound?.key)) || defaultIntroRound || liveRound;
  const currentAnswers = answers.filter((answer) => answer.questionIndex === hostIndex).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const currentActivity = playerActivity.filter((activity) => Number(activity.questionIndex) === Number(hostIndex));
  const fairPlayStats = useMemo(() => buildFairPlayStats(players, answers, gradedAnswers, playerActivity), [players, answers, gradedAnswers, playerActivity]);
  const progress = questions.length ? Math.round(((currentIndex + 1) / questions.length) * 100) : 0;
  const sessionName = session?.name || session?.session_name || "Trivia Session";
  const joinUrl = `${getPublicOrigin()}/join?session=${id}`;
  const timeRemaining = timerEndAt ? Math.max(0, Math.ceil((timerEndAt - now) / 1000)) : null;
  const acceptingAnswers = timeRemaining === null || timeRemaining > 0;

  const persistLiveState = (state, force = false) => {
    liveStateSequenceRef.current = Math.max(liveStateSequenceRef.current + 1, Number(state.liveSequence || 0));
    const orderedState = { ...state, liveSequence: liveStateSequenceRef.current };
    liveStateRef.current = orderedState;
    localStorage.setItem(`quiz-crafter-present-state-${id}`, JSON.stringify(orderedState));
    liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: orderedState });
    const nowMs = Date.now();
    const durableKey = [
      orderedState.liveSequence,
      orderedState.currentIndex,
      orderedState.mode,
      orderedState.pendingBonusIndex ?? "",
      orderedState.pointsPerQuestion,
      orderedState.timerSeconds,
      orderedState.wagerLimit,
      orderedState.wagerTiming,
      orderedState.timerEndAt || "",
      orderedState.showAnswer ? "answer" : "",
      orderedState.showFunFact ? "fact" : "",
    ].join("|");
    if (force || durableKey !== liveStateSaveKeyRef.current || nowMs - liveStateSaveRef.current > 1200) {
      liveStateSaveKeyRef.current = durableKey;
      liveStateSaveRef.current = nowMs;
      const hostedResults = { ...hostedResultsRef.current, liveState: orderedState, liveStateUpdatedAt: orderedState.updatedAt };
      hostedResultsRef.current = hostedResults;
      supabase.from("sessions").update({ hosted_results: hostedResults }).eq("id", id).then(({ error }) => {
        if (error) console.warn("Live presentation state save unavailable:", error);
      }).catch((error) => console.warn("Live presentation state save unavailable:", error));
    }
  };

  const buildLiveState = ({
    question,
    index,
    mode,
    pendingIndex = pendingBonusIndex,
    showAnswerValue = showAnswer,
    showFunFactValue = showFunFact,
    timerEndAtValue = timerEndAt,
    gameStartedValue = gameStarted,
    pointsValue = pointsPerQuestion,
    timerValue = timerSeconds,
    wagerLimitValue = wagerLimit,
    wagerModeValue = wagerMode,
    wagerTimingValue = wagerTiming,
  }) => {
    if (!question) return null;
    const activePoints = Number(pointsValue) || getQuestionPoints(question);
    const activeTimer = Number(timerValue) || Number(question.timerSeconds || 0) || 30;
    const activeWagerLimit = Number(wagerLimitValue || 0);
    const activeRound = rounds.find((round) => index >= round.startIndex && index < round.startIndex + round.questions.length);
    return {
      sessionId: id,
      liveSequence: liveStateSequenceRef.current + 1,
      sessionName,
      mode,
      gameStarted: gameStartedValue,
      joinUrl,
      currentIndex: index,
      pendingBonusIndex: pendingIndex,
      pendingBonusRound: pendingIndex !== null ? serializeRoundIntro(rounds.find((round) => pendingIndex >= round.startIndex && pendingIndex < round.startIndex + round.questions.length)) : null,
      currentQuestion: {
        ...question,
        points: activePoints,
        questionPoints: activePoints,
        timerSeconds: activeTimer,
        wagerLimit: activeWagerLimit,
        wagerTiming: wagerTimingValue,
        isBonus: isBonusQuestion(question),
        answer: showAnswerValue ? question.answer : "",
      },
      introRound: serializeRoundIntro(mode === "categories" ? introRound : activeRound || introRound),
      showAnswer: showAnswerValue,
      revealedAnswer: showAnswerValue ? question.answer : "",
      showFunFact: showFunFactValue,
      pointsPerQuestion: activePoints,
      wagerMode: wagerModeValue,
      wagerLimit: activeWagerLimit,
      wagerTiming: wagerTimingValue,
      timerSeconds: activeTimer,
      timerEndAt: timerEndAtValue,
      acceptingAnswers: timerEndAtValue === null || timerEndAtValue > Date.now(),
      branding,
      updatedAt: new Date().toISOString(),
    };
  };

  useEffect(() => {
    if (!liveDisplayedQuestion || isReviewing) return;
    setPointsPerQuestion(getQuestionPoints(liveDisplayedQuestion));
    setTimerSeconds(Number(liveDisplayedQuestion.timerSeconds || 30));
    setWagerLimit(Number(liveDisplayedQuestion.wagerLimit || 0));
    setWagerTiming(normalizeWagerTiming(liveDisplayedQuestion.wagerTiming));
    setWagerMode(Number(liveDisplayedQuestion.wagerLimit || 0) > 0);
  }, [liveDisplayedQuestion, isReviewing]);

  useEffect(() => {
    if (!hostStateLoaded) return;
    localStorage.setItem(`quiz-crafter-leaderboard-${id}`, JSON.stringify(leaderboard));
    saveHostToolsSessionState(id, { leaderboard }).catch((error) => console.warn("Leaderboard profile save unavailable:", error));
  }, [id, leaderboard, hostStateLoaded]);

  useEffect(() => {
    if (!hostStateLoaded) return;
    writeStoredList(hostToolsStorageKey(id, "players"), players);
    saveHostToolsSessionState(id, { players }).catch((error) => console.warn("Players profile save unavailable:", error));
  }, [id, players, hostStateLoaded]);

  useEffect(() => {
    if (!hostStateLoaded) return;
    writeStoredObject(hostToolsStorageKey(id, "graded-answers"), gradedAnswers);
    saveHostToolsSessionState(id, { gradedAnswers }).catch((error) => console.warn("Graded answers profile save unavailable:", error));
  }, [id, gradedAnswers, hostStateLoaded]);

  useEffect(() => {
    if (!session || !questions.length || !liveDisplayedQuestion) return;
    const state = buildLiveState({
      question: liveDisplayedQuestion,
      index: currentIndex,
      mode: presentMode,
    });
    if (state) persistLiveState(state);
  // The live snapshot helpers intentionally read the latest host state in this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session, sessionName, questions.length, liveDisplayedQuestion, currentIndex, pendingBonusIndex, rounds, introRound, showAnswer, showFunFact, presentMode, gameStarted, joinUrl, pointsPerQuestion, wagerMode, wagerLimit, wagerTiming, timerSeconds, timerEndAt, acceptingAnswers, branding]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = liveStateRef.current;
      if (state) liveChannelRef.current?.send({ type: "broadcast", event: "host_state", payload: state });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [id]);

  const goToQuestion = (index, options = {}) => {
    if (index < 0 || index >= questions.length) return;
    if (options.reviewOnly) {
      setReviewIndex(index);
      return;
    }
    const targetQuestion = questions[index];
    const targetRound = rounds.find((round) => index >= round.startIndex && index < round.startIndex + round.questions.length);
    const isRoundBonus = isBonusQuestion(targetQuestion) || (targetRound && targetRound.questions.length > 1 && index === targetRound.startIndex + targetRound.questions.length - 1);
    const shouldPauseForBonus = options.pauseBeforeBonus !== false && presentMode !== "leaderboard" && isRoundBonus && pendingBonusIndex !== index;
    if (shouldPauseForBonus) {
      setPendingBonusIndex(index);
      setShowAnswer(false);
      setShowFunFact(false);
      setTimerEndAt(null);
      setPresentMode("bonus_pause");
      setGameStarted(true);
      // Broadcast this transition immediately instead of waiting on the
      // reactive snapshot effect -- the host can click straight through to
      // the bonus question next, and that call's own broadcast shouldn't be
      // racing a still-pending one for this state.
      const pauseState = buildLiveState({
        question: currentQuestion,
        index: currentIndex,
        mode: "bonus_pause",
        pendingIndex: index,
        showAnswerValue: false,
        showFunFactValue: false,
        timerEndAtValue: null,
        gameStartedValue: true,
      });
      if (pauseState) persistLiveState(pauseState, true);
      return;
    }
    setReviewIndex(null);
    setPointsPerQuestion(getQuestionPoints(targetQuestion));
    setTimerSeconds(Number(targetQuestion?.timerSeconds || 30));
    setWagerLimit(Number(targetQuestion?.wagerLimit || 0));
    setWagerTiming(normalizeWagerTiming(targetQuestion?.wagerTiming));
    setWagerMode(Number(targetQuestion?.wagerLimit || 0) > 0);
    setCurrentIndex(index);
    setEmergencyOverride(null);
    setPendingBonusIndex(null);
    setShowAnswer(false);
    setShowFunFact(false);
    const nextTimerEndAt = options.startTimer ? Date.now() + Math.max(1, Number(targetQuestion?.timerSeconds || 30)) * 1000 : null;
    setTimerEndAt(nextTimerEndAt);
    setPresentMode("question");
    if (options.startTimer) setGameStarted(true);
    const nextState = buildLiveState({
      question: targetQuestion,
      index,
      mode: "question",
      pendingIndex: null,
      showAnswerValue: false,
      showFunFactValue: false,
      timerEndAtValue: nextTimerEndAt,
      gameStartedValue: options.startTimer ? true : gameStarted,
      pointsValue: getQuestionPoints(targetQuestion),
      timerValue: Number(targetQuestion?.timerSeconds || 30),
      wagerLimitValue: Number(targetQuestion?.wagerLimit || 0),
      wagerModeValue: Number(targetQuestion?.wagerLimit || 0) > 0,
      wagerTimingValue: normalizeWagerTiming(targetQuestion?.wagerTiming),
    });
    if (nextState) persistLiveState(nextState, true);
  };

  const reviewQuestion = (index) => goToQuestion(index, { reviewOnly: true });
  const returnToLiveQuestion = () => setReviewIndex(null);
  const releaseReviewedQuestion = () => {
    if (!isReviewing) return;
    goToQuestion(reviewIndex, { startTimer: false, pauseBeforeBonus: false });
  };

  const releaseMode = (mode, roundKey = null) => {
    if (mode === "categories") setIntroRoundKey(roundKey || introRound?.key || currentRound?.key || null);
    setPresentMode(mode);
    const nextGameStarted = mode === "qr" ? gameStarted : true;
    if (mode !== "qr") setGameStarted(true);
    liveChannelRef.current?.send({
      type: "broadcast",
      event: "host_mode",
      payload: { mode, gameStarted: nextGameStarted, introRoundKey: roundKey || null, updatedAt: new Date().toISOString() },
    });
  };

  const toggleAnswer = () => {
    if (isReviewing) return;
    setShowAnswer((value) => !value);
    setGameStarted(true);
    setPresentMode("question");
  };

  const toggleFunFact = () => {
    if (isReviewing) return;
    setShowFunFact((value) => !value);
    setGameStarted(true);
    releaseMode("question");
  };

  const startTimer = () => {
    if (isReviewing) return;
    setTimerEndAt(Date.now() + Math.max(1, Number(timerSeconds) || 30) * 1000);
    setGameStarted(true);
    setPresentMode("question");
  };
  const startTriviaIntro = () => {
    setIntroRoundKey(introRound?.key || currentRound?.key || null);
    setShowAnswer(false);
    setShowFunFact(false);
    setTimerEndAt(null);
    setPresentMode("categories");
    setGameStarted(true);
  };
  const startIntroQuestion = () => {
    const targetIndex = Number(introRound?.startIndex ?? currentIndex);
    goToQuestion(targetIndex, { startTimer: true, pauseBeforeBonus: false });
  };
  const resetTimer = () => setTimerEndAt(null);
  const startTimerOnly = (seconds = 60) => {
    setTimerSeconds(seconds);
    setTimerEndAt(Date.now() + Math.max(1, Number(seconds) || 60) * 1000);
    setGameStarted(true);
    setPresentMode("question");
  };
  const makeFallbackEmergency = (kind = "replacement") => ({
    id: `emergency-${Date.now()}`,
    category: kind === "tiebreaker" ? "Tiebreaker" : (displayedQuestion?.category || "Emergency"),
    questionText: kind === "tiebreaker" ? "What year did the first modern crossword puzzle appear in a newspaper?" : "What common kitchen spice comes from the dried inner bark of trees in the Cinnamomum family?",
    answer: kind === "tiebreaker" ? "1913" : "Cinnamon",
    funFact: kind === "tiebreaker" ? "Arthur Wynne's word-cross appeared in the New York World in December 1913." : "The curled sticks are called quills and form as strips of bark dry.",
    options: [],
    type: "written",
    roundName: currentRound?.name || "Emergency",
    roundOrder: currentRound?.questions?.[0]?.roundOrder || 1,
    sourceOrder: currentIndex + 1,
    points: pointsPerQuestion || 25,
    timerSeconds: timerSeconds || 30,
    wagerLimit: 0,
    wagerTiming: "before_answer",
  });
  const generateEmergencyQuestion = async (kind = "replacement") => {
    setEmergencyLoading(true);
    try {
      const response = await fetch("/api/generate-session-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: `emergency-${id}-${currentIndex}`,
          questionType: "written",
          count: 1,
          difficulty: kind === "tiebreaker" ? "hard" : "medium",
          theme: `${kind === "tiebreaker" ? "Create a fair numeric tiebreaker question." : "Create one fresh emergency replacement question."}\nCurrent category: ${displayedQuestion?.category || ""}\nCurrent question to avoid: ${displayedQuestion?.questionText || ""}`,
          excludeUsed: true,
          avoidDuplicates: true,
          rejectedQuestions: [displayedQuestion?.questionText].filter(Boolean),
        }),
      });
      const data = await response.json();
      const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
      if (!response.ok || !candidate) throw new Error(data?.error || "No emergency question returned");
      setGeneratedEmergency({
        ...makeFallbackEmergency(kind),
        category: candidate.category || (kind === "tiebreaker" ? "Tiebreaker" : "Emergency"),
        questionText: candidate.question_text || candidate.question || "",
        answer: candidate.correct_answer || candidate.answer || "",
        funFact: candidate.fun_fact || "",
        options: [],
        type: "written",
      });
      toast.success(kind === "tiebreaker" ? "Tiebreaker generated" : "Replacement generated");
    } catch (error) {
      setGeneratedEmergency(makeFallbackEmergency(kind));
      toast.info("Using backup emergency question");
    } finally {
      setEmergencyLoading(false);
    }
  };
  const activateEmergencyQuestion = (question) => {
    if (!question?.questionText || !question?.answer) return toast.error("Generate or enter an emergency question first");
    setEmergencyOverride({ ...question, id: question.id || `emergency-${Date.now()}` });
    setAnswers((current) => current.filter((answer) => Number(answer.questionIndex) !== Number(currentIndex)));
    setShowAnswer(false);
    setShowFunFact(false);
    setTimerEndAt(null);
    setPresentMode("question");
    setGameStarted(true);
    toast.success("Emergency question is live");
  };
  const addDisputeNote = (note) => {
    const body = String(note || "").trim();
    if (!body) return;
    const next = [{ id: `dispute-${Date.now()}`, questionIndex: currentIndex, questionText: displayedQuestion?.questionText || "", note: body, createdAt: new Date().toISOString() }, ...disputeNotes].slice(0, 100);
    setDisputeNotes(next);
    writeStoredList(hostToolsStorageKey(id, "disputes"), next);
    saveHostToolsSessionState(id, { disputes: next }).catch((error) => console.warn("Disputes profile save unavailable:", error));
    toast.success("Dispute note saved");
  };
  const endSession = async () => {
    if (!window.confirm("End this hosted session and save the live results?")) return;
    const endedAt = new Date().toISOString();
    const results = {
      endedAt,
      sessionId: id,
      sessionName,
      leaderboard: [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
      players,
      answers,
      gradedAnswers,
      feedback,
      categoryFeedback,
      ideas: playerIdeas,
      activity: playerActivity,
      disputes: disputeNotes,
      questionCount: questions.length,
      currentIndex,
      presentMode: "winners",
    };
    writeStoredObject(hostToolsStorageKey(id, "results"), results);
    writeStoredList(hostToolsStorageKey(id, "players"), players);
    writeStoredList(hostToolsStorageKey(id, "answers"), answers);
    writeStoredObject(hostToolsStorageKey(id, "graded-answers"), gradedAnswers);
    writeStoredList(hostToolsStorageKey(id, "feedback"), feedback);
    writeStoredList(hostToolsStorageKey(id, "category-feedback"), categoryFeedback);
    writeStoredList(hostToolsStorageKey(id, "ideas"), playerIdeas);
    writeStoredList(hostToolsStorageKey(id, "activity"), playerActivity);
    writeStoredList(hostToolsStorageKey(id, "disputes"), disputeNotes);
    setGameStarted(true);
    setPresentMode("winners");
    toast.success("Hosted session ended");
    saveHostToolsSessionState(id, { endedAt, currentIndex, presentMode: "winners" }).catch((error) => console.warn("End session profile marker unavailable:", error));
    hostedResultsRef.current = { ...results, liveState: liveStateRef.current, liveStateUpdatedAt: new Date().toISOString() };
    supabase.from("sessions").update({ hosted_at: endedAt, hosted_results: hostedResultsRef.current }).eq("id", id).then(({ error }) => {
      if (error) console.warn("End session database backup unavailable:", error);
    }).catch((error) => console.warn("End session database backup unavailable:", error));
  };
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
  const saveBrandingAsDefault = async (nextBranding) => {
    const cleanBranding = normalizeBranding(nextBranding);
    writeDefaultBranding(cleanBranding);
    try {
      await saveDefaultBrandingToProfile(cleanBranding);
      toast.success("Default host branding saved to your profile");
    } catch (error) {
      console.warn("Host default branding profile save unavailable:", error);
      toast.success("Default host branding saved on this device");
    }
    saveBranding(cleanBranding);
  };
  const useDefaultBranding = () => {
    const defaults = readDefaultBranding();
    saveBranding(defaults);
    return defaults;
  };


  const addTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    const nextTeam = { id: crypto.randomUUID(), name, score: Number(teamScore || 0) };
    setLeaderboard((teams) => [...teams, nextTeam]);
    if (liveGameId) upsertLivePlayer(liveGameId, nextTeam).catch((error) => console.warn("Live roster save unavailable:", error));
    setTeamName("");
    setTeamScore("");
    releaseMode("leaderboard");
  };

  const adjustScore = (teamId, amount) => {
    const nextScore = Number((leaderboard.find((team) => team.id === teamId)?.score) || 0) + amount;
    setLeaderboard((teams) => teams.map((team) => team.id === teamId ? { ...team, score: nextScore } : team));
    setLivePlayerScore(teamId, nextScore).catch((error) => console.warn("Live roster save unavailable:", error));
  };
  const setScore = (teamId, score) => {
    setLeaderboard((teams) => teams.map((team) => team.id === teamId ? { ...team, score: Number(score || 0) } : team));
    setLivePlayerScore(teamId, score).catch((error) => console.warn("Live roster save unavailable:", error));
  };
  const removeTeam = (teamId) => {
    setLeaderboard((teams) => teams.filter((team) => team.id !== teamId));
    setPlayers((current) => current.filter((player) => player.id !== teamId));
    removeLivePlayer(teamId).catch((error) => console.warn("Live roster removal unavailable:", error));
  };
  const openScoreModal = (teamId, context = {}) => {
    const team = leaderboard.find((item) => item.id === teamId) || players.find((item) => item.id === teamId);
    setScoreModal({ teamId, teamName: team?.name || context.playerName || "Team", currentScore: Number(team?.score || 0), adjustment: "", setTo: String(Number(team?.score || 0)), ...context });
  };
  const addManualAnswer = ({ playerId, answer, wagerAmount = 0 }) => {
    const team = leaderboard.find((item) => item.id === playerId) || players.find((item) => item.id === playerId);
    if (!team || !displayedQuestion) return toast.error("Choose a team and answer");
    const finalAnswer = String(answer || "").trim();
    if (!finalAnswer) return toast.error("Enter the team's answer");
    const questionWagerMode = isReviewing ? Number(displayedQuestion.wagerLimit || 0) > 0 : wagerMode;
    const questionWagerLimit = isReviewing ? Number(displayedQuestion.wagerLimit || 0) : Number(wagerLimit || 0);
    const questionWagerTiming = isReviewing ? normalizeWagerTiming(displayedQuestion.wagerTiming) : wagerTiming;
    const questionPoints = isReviewing ? getQuestionPoints(displayedQuestion) : Number(pointsPerQuestion) || getDefaultPoints(displayedQuestion);
    const wager = questionWagerMode ? Math.max(0, Number(wagerAmount || 0)) : 0;
    const payload = {
      playerId,
      playerName: team.name || "Team",
      answer: finalAnswer,
      points: questionWagerMode ? wager : questionPoints,
      wagerAmount: wager,
      wagerSubmitted: true,
      wagerMode: questionWagerMode,
      wagerLimit: questionWagerLimit,
      wagerCap: questionWagerLimit,
      scoreAtWager: getTeamScore(leaderboard, playerId),
      wagerTiming: questionWagerTiming,
      questionIndex: hostIndex,
      questionId: displayedQuestion.id,
      questionText: displayedQuestion.questionText,
      manuallyEntered: true,
      submittedAt: new Date().toISOString(),
    };
    setAnswers((current) => {
      const filtered = current.filter((item) => !(item.playerId === payload.playerId && Number(item.questionIndex) === Number(payload.questionIndex)));
      const next = [...filtered, payload].slice(-800);
      writeStoredList(hostToolsStorageKey(id, "answers"), next);
      saveHostToolsSessionState(id, { answers: next }).catch((error) => console.warn("Manual answer profile save unavailable:", error));
      return next;
    });
    if (showAnswer || isReviewing) markAnswer(payload, isCorrectSubmission(payload, displayedQuestion) ? "correct" : "incorrect", { applyScore: !isReviewing });
    toast.success(`Added answer for ${team.name || "team"}`);
  };
  const markAnswer = (answer, status, options = {}) => {
    const key = answerKey(answer);
    const previous = gradedAnswers[key];
    const previousPoints = previous?.scoreApplied === false ? 0 : Number(previous?.points || 0);
    const answerQuestion = questions[Number(answer.questionIndex)] || displayedQuestion;
    const answerPoints = Number(answer.points || 0) || Number(answerQuestion?.points || 0) || getDefaultPoints(answerQuestion);
    const answerWagerLimit = Number(answer.wagerLimit || 0) || Number(answerQuestion?.wagerLimit || 0) || wagerLimit;
    const answerUsesWager = Boolean(answer.wagerMode) || Number(answerQuestion?.wagerLimit || 0) > 0 || hasSubmittedWager(answer) || Number(answer.wagerAmount || 0) > 0;
    const award = answerUsesWager ? getWagerAward(answer, leaderboard, answerWagerLimit, previousPoints) : answerPoints;
    const wagerPenalty = answerUsesWager ? getWagerAward(answer, leaderboard, answerWagerLimit, previousPoints) : 0;
    const nextPoints = status === "correct" ? award : status === "incorrect" && wagerPenalty > 0 ? -wagerPenalty : 0;
    const scoreApplied = Boolean(showAnswer || options.applyScore || previous?.scoreApplied === true);
    const delta = scoreApplied ? nextPoints - previousPoints : 0;
    if (delta) adjustScore(answer.playerId, delta);
    setGradedAnswers((current) => ({ ...current, [key]: { status, points: nextPoints, scoreApplied, gradedAt: new Date().toISOString() } }));
    if (!options.silent) toast.success(!scoreApplied ? `Marked ${status}; score updates on reveal` : status === "correct" ? `Marked correct (+${delta || 0})` : delta ? `Marked incorrect (${delta})` : "Marked incorrect");
  };

  // Points/timer/wager edits used to only touch the live pointsPerQuestion/
  // timerSeconds/wagerLimit state, which goToQuestion resets from the
  // question's own stored fields on every navigation -- so an edit "stuck"
  // only until you left and came back, which read as "doesn't save". This
  // writes the change back into the question itself (in `session`, and to
  // Supabase), so it survives navigation and reloads.
  const updateQuestionSettings = async (patch, scope, baseQuestion) => {
    const target = baseQuestion || displayedQuestion;
    if (!target || !session) return;
    const match = String(target.id || "").match(/^(.+)-(\d+)$/);
    if (!match) return;
    const baseIndex = questions.findIndex((question) => question.id === target.id);
    if (baseIndex === -1) return;
    const targetRound = rounds.find((round) => baseIndex >= round.startIndex && baseIndex < round.startIndex + round.questions.length);
    const scopedQuestions = scope === "round" && targetRound ? targetRound.questions
      : scope === "all" ? questions.slice(baseIndex)
      : [target];
    const dbPatch = {};
    if (patch.points !== undefined) dbPatch.points = patch.points;
    if (patch.timerSeconds !== undefined) dbPatch.timer_seconds = patch.timerSeconds;
    if (patch.wagerLimit !== undefined) dbPatch.wager_limit = patch.wagerLimit;
    if (patch.wagerTiming !== undefined) dbPatch.wager_timing = patch.wagerTiming;

    const affectedIndicesByKey = new Map();
    scopedQuestions.forEach((question) => {
      const questionMatch = String(question.id || "").match(/^(.+)-(\d+)$/);
      if (!questionMatch) return;
      const [, key, indexStr] = questionMatch;
      if (!affectedIndicesByKey.has(key)) affectedIndicesByKey.set(key, new Set());
      affectedIndicesByKey.get(key).add(Number(indexStr));
    });

    const updatedArrays = {};
    affectedIndicesByKey.forEach((indices, key) => {
      const current = Array.isArray(session[key]) ? session[key] : [];
      updatedArrays[key] = current.map((question, index) => (indices.has(index) ? { ...question, ...dbPatch } : question));
    });

    setSession((current) => ({ ...current, ...updatedArrays }));
    if (scopedQuestions.some((question) => question.id === displayedQuestion?.id)) {
      if (patch.points !== undefined) setPointsPerQuestion(patch.points);
      if (patch.timerSeconds !== undefined) setTimerSeconds(patch.timerSeconds);
      if (patch.wagerLimit !== undefined) { setWagerLimit(patch.wagerLimit); setWagerMode(patch.wagerLimit > 0); }
      if (patch.wagerTiming !== undefined) setWagerTiming(patch.wagerTiming);
    }
    try {
      const { error } = await supabase.from("sessions").update(updatedArrays).eq("id", id);
      if (error) throw error;
    } catch (error) {
      console.warn("Question settings save unavailable:", error);
      toast.error("Saved for this session, but couldn't sync to the database");
    }
  };

  useEffect(() => {
    if (!displayedQuestion || !showAnswer) return;
    currentAnswers.forEach((answer) => {
      const key = answerKey(answer);
      const grade = gradedAnswers[key];
      const submittedWager = hasSubmittedWager(answer);
      if (wagerMode && wagerTiming === "after_answer" && !submittedWager) return;
      if (grade?.scoreApplied === false) {
        markAnswer(answer, grade.status, { silent: true, applyScore: true });
        return;
      }
      if (wagerMode && submittedWager && grade && Number(answer.wagerAmount || 0) > 0 && Number(grade.points || 0) === 0) {
        markAnswer(answer, grade.status, { silent: true, applyScore: true });
        return;
      }
      if (grade) return;
      // Auto-grade against the accepted answer so nothing sits ungraded once
      // it's revealed -- the host corrects mistakes by clicking the answer.
      const correct = isCorrectSubmission(answer, displayedQuestion);
      markAnswer(answer, correct ? "correct" : "incorrect", { silent: true });
    });
  // markAnswer intentionally stays outside the deps so this effect only reacts to answer/game state changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAnswers, displayedQuestion, gradedAnswers, wagerMode, wagerTiming, showAnswer]);

  if (loading) return <div className="min-h-screen bg-[#09090B] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={34} /></div>;
  if (!session || !displayedQuestion) {
    return <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-6 text-center"><div><p className="text-white text-2xl font-bold mb-2">No questions to host</p><p className="text-zinc-500 mb-4">Add questions to this session first.</p><Button onClick={() => navigate(`/session/${id}`)} className="gradient-btn">Back to Session</Button></div></div>;
  }

  const viewPointsPerQuestion = isReviewing ? getQuestionPoints(displayedQuestion) : pointsPerQuestion;
  const viewTimerSeconds = isReviewing ? Number(displayedQuestion.timerSeconds || 30) : timerSeconds;
  const viewWagerLimit = isReviewing ? Number(displayedQuestion.wagerLimit || 0) : wagerLimit;
  const viewWagerMode = isReviewing ? Number(displayedQuestion.wagerLimit || 0) > 0 : wagerMode;
  const viewWagerTiming = isReviewing ? normalizeWagerTiming(displayedQuestion.wagerTiming) : wagerTiming;
  const hasRevealMedia = Boolean(displayedQuestion.imageUrl || displayedQuestion.image_url) && normalizeImageTiming(displayedQuestion.imageTiming || displayedQuestion.image_timing) === "after_answer";
  const hasRevealExtra = Boolean(displayedQuestion.funFact || hasRevealMedia);
  const brandStyle = { "--host-primary": branding.primaryColor, "--host-accent": branding.accentColor };
  const flaggedTeamCount = [...fairPlayStats.values()].filter((stats) => stats.flags.length > 0).length;
  const activeTeamIds = new Set(leaderboard.map((team) => team.id));
  const activePlayers = players.filter((player) => activeTeamIds.has(player.id));
  const activeCurrentAnswers = currentAnswers.filter((answer) => activeTeamIds.has(answer.playerId));
  const selectedIntroKey = introRoundKey || currentRound?.key || rounds[0]?.key || "";
  const chooseIntroRound = (roundKey) => {
    setIntroRoundKey(roundKey);
    if (presentMode === "categories") releaseMode("categories", roundKey);
  };
  return <div className="min-h-screen bg-[#09090B] text-white" data-testid="host-session-page" style={brandStyle}>
    {!focusMode && <TopBar navigate={navigate} id={id} sessionName={sessionName} venueName={session?.venue_name || session?.venueName || session?.venue || ""} questions={questions} players={players} currentIndex={currentIndex} liveStatus={liveStatus} openPresentation={openPresentation} setFocusMode={setFocusMode} progress={progress} branding={branding} customizeOpen={customizeOpen} setCustomizeOpen={setCustomizeOpen} endSession={endSession} collapsed={topbarCollapsed} onToggleCollapse={() => setTopbarCollapsed((value) => !value)} />}
    <div className={`max-w-[1680px] mx-auto p-4 lg:p-8 ${focusMode ? "min-h-screen flex flex-col" : ""}`}>
      {focusMode && <div className="flex justify-between items-center mb-4"><Badge className="bg-zinc-800 text-zinc-300">{currentRound?.name || "Round"} - {currentIndex + 1} / {questions.length}</Badge><Button variant="outline" onClick={() => setFocusMode(false)} className="border-white/10 text-zinc-300 hover:text-white">Exit Focus</Button></div>}
      {!focusMode && <QuestionNavStrip questions={questions} rounds={rounds} currentIndex={currentIndex} hostIndex={hostIndex} isReviewing={isReviewing} currentRound={currentRound} onSelectPill={reviewQuestion} onPrev={() => reviewQuestion(hostIndex - 1)} onNext={() => reviewQuestion(hostIndex + 1)} onBackToLive={returnToLiveQuestion} onGoLive={releaseReviewedQuestion} onSelectRoundIntro={(roundKey) => releaseMode("categories", roundKey)} />}
      <div className={focusMode ? "flex-1 flex items-center" : "grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-7"}>
        <main className="w-full">
          {!focusMode && customizeOpen && <HostCustomizePanel branding={branding} defaultBranding={readDefaultBranding()} onSave={saveBranding} onSaveDefault={saveBrandingAsDefault} onUseDefault={useDefaultBranding} onClose={() => setCustomizeOpen(false)} />}
          {!gameStarted && !isReviewing ? <LobbyStage playerCount={players.length} onStartTrivia={startTriviaIntro} /> : presentMode === "categories" && !isReviewing ? <RoundIntroStage round={introRound} gameStarted={gameStarted} onStartIntro={startTriviaIntro} onStartQuestion={startIntroQuestion} /> : presentMode === "bonus_pause" && !isReviewing ? <BonusPauseStage round={rounds.find((round) => pendingBonusIndex >= round.startIndex && pendingBonusIndex < round.startIndex + round.questions.length)} leaderboard={leaderboard} /> : presentMode === "winners" && !isReviewing ? <WinnersStage leaderboard={leaderboard} /> : presentMode === "feedback" && !isReviewing ? <FeedbackStage ideas={playerIdeas} /> : <QuestionStage question={displayedQuestion} index={hostIndex} total={questions.length} showAnswer={isReviewing ? true : showAnswer} showFunFact={isReviewing ? false : showFunFact} focusMode={focusMode} pointsPerQuestion={viewPointsPerQuestion} timerSeconds={viewTimerSeconds} timeRemaining={isReviewing ? null : timeRemaining} wagerMode={viewWagerMode} wagerLimit={viewWagerLimit} wagerTiming={viewWagerTiming} onUpdateSettings={isReviewing ? () => {} : updateQuestionSettings} branding={branding} players={activePlayers} answers={activeCurrentAnswers} activity={currentActivity} fairPlayStats={fairPlayStats} gradedAnswers={gradedAnswers} markAnswer={markAnswer} addManualAnswer={addManualAnswer} setMode={releaseMode} isReviewing={isReviewing} />}
        </main>
        {!focusMode && <PlaybackRail mode={presentMode} setMode={releaseMode} rounds={rounds} introRoundKey={selectedIntroKey} chooseIntroRound={chooseIntroRound} isReviewing={isReviewing} showAnswer={isReviewing ? true : showAnswer} onRevealAnswer={toggleAnswer} showFunFact={isReviewing ? false : showFunFact} onShowFunFact={toggleFunFact} hasRevealExtra={hasRevealExtra} hasFunFact={Boolean(displayedQuestion.funFact)} timeRemaining={isReviewing ? null : timeRemaining} timerSeconds={viewTimerSeconds} startTimer={startTimer} resetTimer={isReviewing ? () => {} : resetTimer} currentIndex={currentIndex} total={questions.length} onPrev={() => goToQuestion(currentIndex - 1, { startTimer: false })} onNext={() => {
          if (!gameStarted) return startTriviaIntro();
          if (presentMode === "categories") return startIntroQuestion();
          if (presentMode === "bonus_pause" && pendingBonusIndex !== null) return goToQuestion(pendingBonusIndex, { startTimer: true, pauseBeforeBonus: false });
          const liveRoundNow = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
          const isLastQuestionOfRound = liveRoundNow && currentIndex === liveRoundNow.startIndex + liveRoundNow.questions.length - 1;
          const nextRoundNow = isLastQuestionOfRound ? rounds[rounds.findIndex((round) => round.key === liveRoundNow.key) + 1] : null;
          if (nextRoundNow) return releaseMode("categories", nextRoundNow.key);
          return goToQuestion(currentIndex + 1, { startTimer: true });
        }} onOpenDrawer={setActiveDrawer} flaggedTeamCount={flaggedTeamCount} currentQuestionLabel={`Q${currentIndex + 1}`} />}
      </div>
    </div>
    {scoreModal && <ScoreAdjustModal modal={scoreModal} setModal={setScoreModal} adjustScore={adjustScore} setScore={setScore} />}
    {!focusMode && <ToolDrawer activeDrawer={activeDrawer} onClose={() => setActiveDrawer(null)}>
      {activeDrawer === "teams" && <LeaderboardPanel leaderboard={leaderboard} teamName={teamName} teamScore={teamScore} setTeamName={setTeamName} setTeamScore={setTeamScore} addTeam={addTeam} openScoreModal={openScoreModal} removeTeam={removeTeam} showLeaderboard={() => releaseMode("leaderboard")} fairPlayStats={fairPlayStats} />}
      {activeDrawer === "run" && <div className="space-y-4"><RunSheet rounds={rounds} currentIndex={hostIndex} goToQuestion={reviewQuestion} answers={answers} players={activePlayers} gradedAnswers={gradedAnswers} editBuild={() => navigate(`/build/${id}`)} /><AnswerHistoryPanel rounds={rounds} players={activePlayers} leaderboard={leaderboard} answers={answers} gradedAnswers={gradedAnswers} currentIndex={hostIndex} markAnswer={markAnswer} openScoreModal={openScoreModal} reviewQuestion={reviewQuestion} /></div>}
      {activeDrawer === "fairplay" && <FairPlayPanel leaderboard={leaderboard} fairPlayStats={fairPlayStats} openScoreModal={openScoreModal} />}
      {activeDrawer === "disputes" && <DisputesPanel currentIndex={currentIndex} addDisputeNote={addDisputeNote} disputeNotes={disputeNotes} />}
      {activeDrawer === "emergency" && <EmergencyPanel currentIndex={currentIndex} emergencyOverride={emergencyOverride} generatedEmergency={generatedEmergency} emergencyLoading={emergencyLoading} generateEmergencyQuestion={generateEmergencyQuestion} activateEmergencyQuestion={activateEmergencyQuestion} clearEmergency={() => setEmergencyOverride(null)} startTimerOnly={startTimerOnly} goToQuestion={goToQuestion} editBuild={() => navigate(`/build/${id}`)} />}
      {activeDrawer === "feedback" && <LiveSignalsPanel feedback={feedback} categoryFeedback={categoryFeedback} ideas={playerIdeas} currentIndex={currentIndex} displayedQuestion={displayedQuestion} />}
    </ToolDrawer>}
  </div>;
};

const QuestionNavStrip = ({ questions, rounds, currentIndex, hostIndex, isReviewing, currentRound, onSelectPill, onPrev, onNext, onBackToLive, onGoLive, onSelectRoundIntro }) => {
  const activeRound = currentRound || rounds[0];
  const jumpToRound = (roundKey) => {
    const round = rounds.find((item) => item.key === roundKey);
    if (round) onSelectPill(round.startIndex);
  };
  return <div className="glass-card rounded-xl mb-4 sticky top-[57px] z-10">
    <div className="flex items-center gap-2 p-2.5">
      <select aria-label="Jump to round" value={activeRound?.key || ""} onChange={(event) => jumpToRound(event.target.value)} className="h-9 shrink-0 rounded-md border border-white/10 bg-zinc-950 px-2.5 text-xs font-bold text-zinc-200 outline-none focus:border-[#71E0DC]/60">
        {rounds.map((round) => <option key={round.key} value={round.key}>{round.name}</option>)}
      </select>
      <button type="button" onClick={onPrev} disabled={hostIndex === 0} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-950 text-zinc-300 hover:border-[#71E0DC]/40 hover:text-[#71E0DC] disabled:opacity-30" aria-label="Previous question"><ChevronLeft size={16} /></button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        <button type="button" onClick={() => onSelectRoundIntro(activeRound?.key)} title={`Show ${activeRound?.name || "round"} intro`} className="shrink-0 max-w-[12ch] truncate rounded-md border border-white/10 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400 hover:border-[#71E0DC]/40 hover:text-[#71E0DC]">{activeRound?.name || "Round"}</button>
        {(activeRound?.questions || []).map((question, localIndex) => {
          const index = activeRound.startIndex + localIndex;
          const isLive = index === currentIndex;
          const isSelected = index === hostIndex;
          const isDone = index < currentIndex;
          return <button key={question.id} type="button" onClick={() => onSelectPill(index)} title={question.questionText} className={`relative flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-2 text-xs font-bold transition ${isSelected ? "bg-[#71E0DC]/15 text-[#71E0DC] ring-1 ring-[#71E0DC]/50" : isDone ? "bg-zinc-900 text-zinc-400" : "bg-zinc-900/60 text-zinc-500 hover:text-zinc-300"}`}>
            {index + 1}
            {isBonusQuestion(question) && <span className="absolute -top-1.5 left-0.5 text-[9px] text-amber-300">&#9733;</span>}
            {isLive && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-400 ring-2 ring-zinc-950 animate-pulse" />}
          </button>;
        })}
      </div>
      <button type="button" onClick={onNext} disabled={hostIndex >= questions.length - 1} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-950 text-zinc-300 hover:border-[#71E0DC]/40 hover:text-[#71E0DC] disabled:opacity-30" aria-label="Next question"><ChevronRight size={16} /></button>
      <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1.5 text-xs font-bold text-rose-200">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
        LIVE: Q{currentIndex + 1}
      </div>
    </div>
    {isReviewing && <div className="flex flex-wrap items-center gap-2 border-t border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
      <Eye size={13} className="shrink-0 text-amber-300" />
      <span className="flex-1">Reviewing Q{hostIndex + 1} &mdash; players and the presentation screen still see <b>Q{currentIndex + 1}</b>, live.</span>
      <Button size="sm" variant="outline" onClick={onBackToLive} className="h-7 border-amber-300/30 text-amber-100 hover:text-white">Back to Live</Button>
      <Button size="sm" onClick={onGoLive} className="h-7 bg-amber-300 text-zinc-950 hover:bg-amber-200">Go Live With This Question</Button>
    </div>}
  </div>;
};

const PLAYBACK_TOOLS = [
  { key: "teams", label: "Teams", icon: Trophy },
  { key: "run", label: "Run Sheet", icon: MonitorPlay },
  { key: "fairplay", label: "Fair Play", icon: AlertTriangle },
  { key: "disputes", label: "Disputes", icon: Clock },
  { key: "emergency", label: "Emergency", icon: Zap },
  { key: "feedback", label: "Feedback", icon: ThumbsUp },
];

const PlaybackRail = ({ mode, setMode, rounds, introRoundKey, chooseIntroRound, isReviewing, showAnswer, onRevealAnswer, showFunFact, onShowFunFact, hasRevealExtra, hasFunFact, timeRemaining, timerSeconds, startTimer, resetTimer, currentIndex, total, onPrev, onNext, onOpenDrawer, flaggedTeamCount, currentQuestionLabel }) => {
  const nonQuestionMode = mode === "bonus_pause" || mode === "winners" || mode === "feedback";
  const liveRound = rounds.find((round) => currentIndex >= round.startIndex && currentIndex < round.startIndex + round.questions.length);
  const liveRoundListIndex = rounds.findIndex((round) => round.key === liveRound?.key);
  const nextRound = liveRoundListIndex >= 0 ? rounds[liveRoundListIndex + 1] : null;
  const isLastQuestionOfRound = liveRound && currentIndex === liveRound.startIndex + liveRound.questions.length - 1;
  const nextIsRoundIntro = mode === "question" && isLastQuestionOfRound && Boolean(nextRound);
  const sceneActive = (key) => mode === key;
  const sceneButtonClass = (active) => `h-14 rounded-lg text-[11px] font-bold flex flex-col items-center justify-center gap-1 transition ${active ? "text-zinc-950" : "border border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white"}`;
  const sceneButtonStyle = (active) => active ? { background: "linear-gradient(90deg, var(--host-primary), var(--host-accent))" } : undefined;

  return <aside className="space-y-4">
    <Card className="glass-card overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Playback</p>
          <p className="text-[11px] text-zinc-600">controls {currentQuestionLabel}, live</p>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-3 py-3">
          {PLAYBACK_TOOLS.map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => onOpenDrawer(key)} className="relative flex items-center gap-1.5 rounded-md border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-bold text-zinc-300 hover:border-white/25 hover:text-white">
            <Icon size={13} />{label}
            {key === "fairplay" && flaggedTeamCount > 0 && <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400 text-[9px] font-black text-zinc-950">{flaggedTeamCount}</span>}
          </button>)}
        </div>
        <div className="space-y-2.5 p-3.5">
          <div className="flex items-center justify-center gap-4 py-1">
            <button type="button" onClick={onPrev} disabled={isReviewing || currentIndex <= 0} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-950 text-zinc-300 hover:border-[#71E0DC]/40 hover:text-[#71E0DC] disabled:opacity-30" aria-label="Previous question"><ChevronLeft size={17} /></button>
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#71E0DC]/25" style={{ borderTopColor: "var(--host-primary)" }}>
              <span className="font-mono text-sm font-bold text-white">{timeRemaining !== null ? `${timeRemaining}s` : `${Number(timerSeconds) || 0}s`}</span>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <button type="button" onClick={onNext} disabled={isReviewing || (currentIndex >= total - 1 && !nextIsRoundIntro)} title={nextIsRoundIntro ? `Go to ${nextRound.name} intro` : undefined} className={`flex h-9 w-9 items-center justify-center rounded-full border text-zinc-300 hover:text-[#71E0DC] disabled:opacity-30 ${nextIsRoundIntro ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950 hover:border-[#71E0DC]/40"}`} aria-label={nextIsRoundIntro ? `Go to ${nextRound.name} intro` : "Next question"}><ChevronRight size={17} /></button>
              {nextIsRoundIntro && <span className="max-w-[64px] truncate text-[9px] font-bold uppercase tracking-wide text-[#71E0DC]">Next: {nextRound.name}</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={startTimer} disabled={isReviewing} className="h-10 gradient-btn disabled:opacity-40"><Play size={15} className="mr-1.5" />Start Timer</Button>
            <Button size="sm" variant="outline" onClick={resetTimer} disabled={isReviewing} className="h-10 border-white/10 text-zinc-300 hover:text-white disabled:opacity-40"><RotateCcw size={15} className="mr-1.5" />Clear</Button>
          </div>
          <Button onClick={onRevealAnswer} disabled={isReviewing || nonQuestionMode} className={`w-full h-10 ${showAnswer ? "bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40" : "gradient-btn disabled:opacity-40"}`}>{showAnswer ? <EyeOff size={16} className="mr-2" /> : <Eye size={16} className="mr-2" />}{showAnswer ? "Hide Answer" : "Reveal Answer"}</Button>
          <Button onClick={onShowFunFact} disabled={isReviewing || nonQuestionMode || !hasRevealExtra} className="w-full h-10 bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40"><Sparkles size={16} className="mr-2" />{showFunFact ? "Hide" : hasFunFact ? "Reveal Fun Fact" : "Reveal Media"}</Button>
        </div>
      </CardContent>
    </Card>

    <Card className="glass-card">
      <CardContent className="p-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Viewer Screen</p>
          <select aria-label="Round intro target" value={introRoundKey} onChange={(event) => chooseIntroRound(event.target.value)} className="h-7 min-w-[110px] rounded-md bg-zinc-950 border border-white/10 px-2 text-[11px] text-zinc-300 outline-none focus:border-[#71E0DC]/60">
            {rounds.map((round) => <option key={round.key} value={round.key}>{round.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setMode("qr")} className={sceneButtonClass(sceneActive("qr"))} style={sceneButtonStyle(sceneActive("qr"))}><QrCode size={16} /><span>Lobby / QR</span></button>
          <button type="button" onClick={() => setMode("categories")} className={sceneButtonClass(sceneActive("categories"))} style={sceneButtonStyle(sceneActive("categories"))}><Tags size={16} /><span>Round Intro</span></button>
          <button type="button" onClick={() => setMode("question")} className={sceneButtonClass(sceneActive("question"))} style={sceneButtonStyle(sceneActive("question"))}><MonitorPlay size={16} /><span>Question</span></button>
          <button type="button" onClick={() => setMode("leaderboard")} className={sceneButtonClass(sceneActive("leaderboard"))} style={sceneButtonStyle(sceneActive("leaderboard"))}><Trophy size={16} /><span>Leaderboard</span></button>
          <button type="button" onClick={() => setMode("winners")} className={sceneButtonClass(sceneActive("winners"))} style={sceneButtonStyle(sceneActive("winners"))}><Sparkles size={16} /><span>Winners</span></button>
          <button type="button" onClick={() => setMode("feedback")} className={sceneButtonClass(sceneActive("feedback"))} style={sceneButtonStyle(sceneActive("feedback"))}><MessageSquare size={16} /><span>Feedback</span></button>
        </div>
      </CardContent>
    </Card>
  </aside>;
};

const TopBar = ({ navigate, id, sessionName, venueName, questions, players, currentIndex, liveStatus, openPresentation, setFocusMode, progress, branding, customizeOpen, setCustomizeOpen, endSession, collapsed, onToggleCollapse }) => <div className="border-b border-white/10 bg-zinc-950/85 sticky top-0 z-20 backdrop-blur"><div className={`max-w-[1680px] mx-auto px-4 lg:px-6 flex items-center gap-3 transition-[padding] ${collapsed ? "py-1.5" : "py-3"}`}>{!collapsed && <Button variant="ghost" onClick={() => navigate(`/session/${id}`)} className="text-zinc-400 hover:text-white h-9 w-9 p-0 shrink-0" aria-label="Back to session"><ArrowLeft size={18} /></Button>}{!collapsed && branding?.logoUrl && <img src={branding.logoUrl} alt={branding.name || "Host logo"} className="h-10 w-10 rounded-md bg-white object-contain p-1 shrink-0" />}<div className="min-w-0 flex-1">{!collapsed && <p className="text-xs font-bold uppercase tracking-wide truncate" style={{ color: "var(--host-primary)" }}>{venueName || branding?.name || "Live Trivia"}</p>}<h1 className={`font-bold truncate ${collapsed ? "text-sm" : ""}`}>{sessionName}</h1>{!collapsed && <p className="text-xs text-zinc-500">{players.length} player{players.length === 1 ? "" : "s"} connected</p>}</div>{!collapsed && <div className="flex items-center gap-2 flex-wrap justify-end"><Badge className={liveStatus === "live" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}><Wifi size={13} className="mr-1" />{liveStatus === "live" ? "Live" : "Connecting"}</Badge><Badge className="bg-zinc-800 text-zinc-300">Question {currentIndex + 1} of {questions.length}</Badge><Button onClick={endSession} className="bg-amber-300 text-zinc-950 hover:bg-amber-200"><Save size={16} className="mr-2" />End Session</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-10 w-10 border-white/10 p-0 text-zinc-300 hover:text-white" aria-label="Host screen options"><MoreHorizontal size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="border-white/10 bg-zinc-950 text-zinc-100"><DropdownMenuItem onClick={() => setCustomizeOpen((value) => !value)} className="cursor-pointer focus:bg-zinc-900 focus:text-white"><Palette size={15} className="mr-2" />{customizeOpen ? "Hide Customize" : "Customize"}</DropdownMenuItem><DropdownMenuItem onClick={() => setFocusMode(true)} className="cursor-pointer focus:bg-zinc-900 focus:text-white"><Maximize2 size={15} className="mr-2" />Focus Mode</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>}<Button variant="outline" onClick={onToggleCollapse} className="h-8 w-8 shrink-0 border-white/10 p-0 text-zinc-400 hover:text-white" aria-label={collapsed ? "Expand toolbar" : "Minimize toolbar"} title={collapsed ? "Expand toolbar" : "Minimize toolbar"}><ChevronLeft size={15} className={`transition-transform ${collapsed ? "-rotate-90" : "rotate-90"}`} /></Button><div className="w-px h-7 bg-white/10 shrink-0" /><Button onClick={openPresentation} className="shrink-0 text-zinc-950 font-bold shadow-lg shadow-[#71E0DC]/20" style={{ background: "linear-gradient(90deg, var(--host-primary), var(--host-accent))" }} title="Opens the audience screen in a new tab, for a TV or projector"><MonitorPlay size={16} className="mr-2" />Present<ExternalLink size={13} className="ml-2 opacity-70" /></Button></div>{!collapsed && <div className="h-1 bg-zinc-900"><div className="h-1 transition-all" style={{ width: `${progress}%`, background: "linear-gradient(90deg, var(--host-primary), var(--host-accent))" }} /></div>}</div>;

const PresentationControls = ({ mode, setMode, rounds, currentIndex, currentRound, introRoundKey, setIntroRoundKey }) => {
  const nextRound = rounds.find((round) => round.startIndex > currentIndex);
  const suggestedRound = currentRound && currentIndex >= currentRound.startIndex + currentRound.questions.length - 1 && nextRound ? nextRound : currentRound;
  const selectedIntroKey = introRoundKey || suggestedRound?.key || currentRound?.key || "";
  const chooseIntroRound = (roundKey) => {
    setIntroRoundKey(roundKey);
    if (mode === "categories") setMode("categories", roundKey);
  };

  return <Card className="glass-card mb-5"><CardContent className="p-4 lg:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Presentation</p><p className="text-sm text-zinc-300 mt-1">Choose what the audience screen is showing.</p></div><div className="flex items-center gap-2 flex-wrap"><Button size="sm" onClick={() => setMode("qr")} className={mode === "qr" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><QrCode size={15} className="mr-2" />QR Code</Button><Button size="sm" onClick={() => setMode("categories", selectedIntroKey)} className={mode === "categories" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Tags size={15} className="mr-2" />Round Intro</Button><select aria-label="Round intro target" value={selectedIntroKey} onChange={(event) => chooseIntroRound(event.target.value)} className="h-9 min-w-[150px] rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-zinc-200">{rounds.map((round) => <option key={round.key} value={round.key}>{round.name}</option>)}</select><Button size="sm" onClick={() => setMode("question")} className={mode === "question" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><MonitorPlay size={15} className="mr-2" />Question</Button><Button size="sm" onClick={() => setMode("leaderboard")} className={mode === "leaderboard" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Trophy size={15} className="mr-2" />Leaderboard</Button><Button size="sm" onClick={() => setMode("winners")} className={mode === "winners" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><Sparkles size={15} className="mr-2" />Winners</Button><Button size="sm" onClick={() => setMode("feedback")} className={mode === "feedback" ? "gradient-btn" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}><MessageSquare size={15} className="mr-2" />Feedback</Button></div></div></CardContent></Card>;
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
    try {
      update("logoUrl", await uploadQuestionMedia(file));
    } catch (error) {
      console.error("Upload logo error:", error);
      toast.error(error.message || "Failed to upload logo");
    }
  };
  return <Card className="glass-card mb-4"><CardContent className="p-4"><div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="text-lg font-bold text-white flex items-center gap-2"><Palette size={18} style={{ color: "var(--host-primary)" }} />Customize Host Screen</h2><p className="text-xs text-zinc-500">Default branding is used for new host sessions. This session can still be customized.</p></div><Button size="sm" variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-white">Close</Button></div><div className="grid grid-cols-1 lg:grid-cols-[160px_1fr] gap-4"><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 flex flex-col items-center justify-center min-h-36">{safeForm.logoUrl ? <img src={safeForm.logoUrl} alt="Logo preview" className="max-h-24 max-w-full rounded-md bg-white object-contain p-2" /> : <div className="h-24 w-24 rounded-md border border-white/10 bg-zinc-900 flex items-center justify-center text-zinc-500"><Image size={28} /></div>}<p className="mt-3 text-sm font-bold text-white text-center">{safeForm.name || "Host Name"}</p></div><div className="space-y-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="text-xs text-zinc-400">Host name<input value={safeForm.name || ""} onChange={(event) => update("name", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="text-xs text-zinc-400">Logo URL<input value={safeForm.logoUrl || ""} onChange={(event) => update("logoUrl", event.target.value)} placeholder="https://..." className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"><label className="text-xs text-zinc-400">Upload logo<span className="mt-1 h-10 rounded-md border border-white/10 bg-zinc-950 px-3 text-zinc-200 flex items-center gap-2 cursor-pointer hover:border-[#71E0DC]/50"><Upload size={15} />Choose file<input type="file" accept="image/*" onChange={uploadLogo} className="hidden" /></span></label><ColorField label="Primary color" value={safeForm.primaryColor} onChange={(value) => update("primaryColor", value)} /><ColorField label="Accent color" value={safeForm.accentColor} onChange={(value) => update("accentColor", value)} /></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end"><div><div className="mb-1 flex items-center justify-between"><span className="text-xs text-zinc-400">Correct answer color (present screen)</span>{safeForm.correctColor && <button type="button" onClick={() => update("correctColor", "")} className="text-[11px] font-semibold text-[#71E0DC] hover:underline">Match brand primary</button>}</div><div className="flex h-10 rounded-md border border-white/10 bg-zinc-950 overflow-hidden focus-within:border-[#71E0DC]/60"><input type="color" value={sanitizeHexColor(safeForm.correctColor, safeForm.primaryColor)} onChange={(event) => update("correctColor", event.target.value)} className="h-10 w-12 border-0 bg-transparent p-1" /><input value={safeForm.correctColor} onChange={(event) => update("correctColor", event.target.value)} placeholder={`Auto (${safeForm.primaryColor})`} className="min-w-0 flex-1 bg-transparent px-2 text-white outline-none placeholder:text-zinc-600" /></div></div><ColorField label="Answer option color (present screen)" value={safeForm.optionColor} onChange={(value) => update("optionColor", value)} /></div><label className="block text-xs text-zinc-400">Lobby tagline (present screen)<input value={safeForm.lobbyTagline} onChange={(event) => update("lobbyTagline", event.target.value)} placeholder={DEFAULT_BRANDING.lobbyTagline} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><div className="rounded-md border border-white/10 bg-zinc-950/50 p-3"><div className="flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold text-white">Current default</p><p className="text-xs text-zinc-500">{safeDefault.name} · {safeDefault.primaryColor} / {safeDefault.accentColor}</p></div><Button size="sm" variant="outline" onClick={() => setForm(normalizeBranding(onUseDefault()))} className="border-white/10 text-zinc-300 hover:text-white">Use Default</Button></div></div><div className="flex justify-end gap-2 pt-1 flex-wrap"><Button variant="outline" onClick={() => setForm(DEFAULT_BRANDING)} className="border-white/10 text-zinc-300 hover:text-white">Reset</Button><Button variant="outline" onClick={() => onSaveDefault(safeForm)} className="border-white/10 text-zinc-300 hover:text-white">Save as Default</Button><Button onClick={() => onSave(safeForm)} className="text-zinc-950 font-semibold hover:opacity-90" style={{ background: `linear-gradient(90deg, ${safeForm.primaryColor}, ${safeForm.accentColor})` }}><Save size={16} className="mr-2" />Save This Session</Button></div></div></div></CardContent></Card>;
};

const ColorField = ({ label, value, onChange }) => { const safeValue = sanitizeHexColor(value, DEFAULT_BRANDING.primaryColor); return <label className="text-xs text-zinc-400">{label}<div className="mt-1 flex h-10 rounded-md border border-white/10 bg-zinc-950 overflow-hidden focus-within:border-[#71E0DC]/60"><input type="color" value={safeValue} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 border-0 bg-transparent p-1" /><input value={value || ""} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-white outline-none" /></div></label>; };

const sentimentCounts = (items) => ({
  like: items.filter((item) => item.sentiment === "like").length,
  dislike: items.filter((item) => item.sentiment === "dislike").length,
});

const LiveFeedbackPanel = ({ feedback, categoryFeedback, currentIndex, displayedQuestion }) => {
  const currentFeedback = feedback.filter((item) => Number(item.questionIndex) === Number(currentIndex));
  const questionCounts = sentimentCounts(currentFeedback);
  const currentCategoryFeedback = categoryFeedback.filter((item) => item.roundName === displayedQuestion?.roundName || item.category === displayedQuestion?.category || Number(item.questionIndex) === Number(currentIndex));
  const categoryCounts = sentimentCounts(currentCategoryFeedback);
  const recentVotes = [...feedback.map((item) => ({ ...item, kind: "Question" })), ...categoryFeedback.map((item) => ({ ...item, kind: "Category" }))].sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""))).slice(0, 14);

  return <Card className="glass-card"><CardContent className="p-4 space-y-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-white font-semibold"><ThumbsUp size={18} className="text-[#71E0DC]" />Live Feedback</div><Badge className="bg-zinc-800 text-zinc-300">{feedback.length + categoryFeedback.length}</Badge></div><div className="grid grid-cols-2 gap-3"><FeedbackMetric title="This Question" likes={questionCounts.like} dislikes={questionCounts.dislike} /><FeedbackMetric title="Round/Categories" likes={categoryCounts.like} dislikes={categoryCounts.dislike} /></div><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Recent responses</p><div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">{recentVotes.map((vote, index) => <div key={`${vote.kind}-${vote.playerId}-${vote.submittedAt}-${index}`} className="rounded-md border border-white/10 bg-zinc-950/60 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-white truncate">{vote.playerName || "Team"}</span><Badge className={vote.sentiment === "like" ? "bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20" : "bg-red-400/15 text-red-300 border border-red-400/20"}>{vote.sentiment === "like" ? <ThumbsUp size={12} className="mr-1" /> : <ThumbsDown size={12} className="mr-1" />}{vote.sentiment === "like" ? "Liked" : "Disliked"}</Badge></div><p className="mt-1 text-xs text-zinc-500">{vote.kind}: {vote.kind === "Category" ? vote.category : (vote.questionText || `Question ${Number(vote.questionIndex || 0) + 1}`)}</p></div>)}{!recentVotes.length && <p className="rounded-lg border border-white/10 bg-zinc-950/50 p-4 text-center text-xs text-zinc-500">Thumbs-up and thumbs-down responses will appear here live.</p>}</div></div></CardContent></Card>;
};

const FeedbackMetric = ({ title, likes, dislikes }) => <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{title}</p><div className="mt-3 flex items-center gap-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-[#71E0DC]/15 px-2.5 py-1 text-sm font-bold text-[#71E0DC]"><ThumbsUp size={15} />{likes}</span><span className="inline-flex items-center gap-1.5 rounded-full bg-red-400/15 px-2.5 py-1 text-sm font-bold text-red-300"><ThumbsDown size={15} />{dislikes}</span></div></div>;

const LiveSignalsPanel = ({ feedback, categoryFeedback, ideas, currentIndex, displayedQuestion }) => {
  const [dismissed, setDismissed] = useState([]);
  const dismiss = (key) => setDismissed((current) => [...new Set([...current, key])]);
  const isDismissed = (key) => dismissed.includes(key);
  const currentFeedback = feedback.filter((item) => Number(item.questionIndex) === Number(currentIndex));
  const questionCounts = sentimentCounts(currentFeedback);
  const categoryRows = Object.values(categoryFeedback.reduce((groups, item) => {
    const label = item.category || item.roundName || "Category";
    if (!groups[label]) groups[label] = { key: `category-${label}`, label, likes: 0, dislikes: 0 };
    if (item.sentiment === "like") groups[label].likes += 1;
    if (item.sentiment === "dislike") groups[label].dislikes += 1;
    return groups;
  }, {})).sort((a, b) => (b.likes + b.dislikes) - (a.likes + a.dislikes)).slice(0, 4);
  const recentIdeas = [...ideas].sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""))).slice(0, 4);
  const currentQuestionFlag = questionCounts.dislike > questionCounts.like && questionCounts.dislike > 0 ? { key: `flag-${currentIndex}`, label: `Question ${Number(currentIndex) + 1} flagged confusing`, detail: displayedQuestion?.questionText || "" } : null;
  const signals = [
    ...categoryRows.map((row) => ({ ...row, type: "category" })),
    ...(currentQuestionFlag ? [currentQuestionFlag] : []),
    ...recentIdeas.map((idea, index) => ({ key: `idea-${idea.playerId || "player"}-${idea.submittedAt || index}`, type: "idea", label: idea.category || idea.question || "Player idea", detail: idea.question || idea.category || "", playerName: idea.playerName || "Team" })),
  ].filter((signal) => !isDismissed(signal.key)).slice(0, 8);
  const saveIdea = (signal) => toast.success(signal.type === "idea" ? "Idea saved for review" : "Signal saved");
  const markReview = () => toast.success(`Question ${Number(currentIndex) + 1} marked for review`);
  const favoriteCategory = (label) => toast.success(`${label} saved as a favorite category`);

  return <Card className="glass-card border-[#71E0DC]/10"><CardContent className="p-4"><div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-white font-semibold"><Sparkles size={18} className="text-[#71E0DC]" />Live Signals</div><Badge className="bg-zinc-800 text-zinc-300">{feedback.length + categoryFeedback.length + ideas.length}</Badge></div><div className="mb-3 grid grid-cols-2 gap-2"><FeedbackMetric title="Question" likes={questionCounts.like} dislikes={questionCounts.dislike} /><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Ideas</p><p className="mt-2 text-2xl font-black text-[#AEB2EF]">{ideas.length}</p></div></div><div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">{signals.map((signal) => <div key={signal.key} className="rounded-lg border border-white/10 bg-zinc-950/65 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0">{signal.type === "category" ? <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="truncate text-sm font-bold text-white">{signal.label}</span><span className="inline-flex items-center gap-1 rounded-full bg-[#71E0DC]/15 px-2 py-0.5 text-xs font-bold text-[#71E0DC]"><ThumbsUp size={12} />{signal.likes}</span><span className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2 py-0.5 text-xs font-bold text-red-300"><ThumbsDown size={12} />{signal.dislikes}</span></div> : signal.type === "idea" ? <><p className="text-sm font-bold text-white line-clamp-2">"{signal.label}"</p><p className="mt-1 text-xs text-zinc-500">{signal.playerName}</p></> : <><p className="text-sm font-bold text-red-200">{signal.label}</p><p className="mt-1 line-clamp-2 text-xs text-zinc-500">{signal.detail}</p></>}</div><button type="button" onClick={() => dismiss(signal.key)} className="shrink-0 text-zinc-600 hover:text-zinc-300" aria-label="Dismiss signal">x</button></div><div className="mt-2 flex flex-wrap gap-1.5">{signal.type === "category" && <Button size="sm" variant="outline" onClick={() => favoriteCategory(signal.label)} className="h-7 border-white/10 px-2 text-xs text-zinc-300 hover:text-white">Favorite</Button>}{signal.type === "idea" && <Button size="sm" variant="outline" onClick={() => saveIdea(signal)} className="h-7 border-white/10 px-2 text-xs text-zinc-300 hover:text-white">Save Idea</Button>}{signal.type !== "idea" && <Button size="sm" variant="outline" onClick={markReview} className="h-7 border-white/10 px-2 text-xs text-zinc-300 hover:text-white">Review Q</Button>}</div></div>)}{!signals.length && <p className="rounded-lg border border-white/10 bg-zinc-950/60 p-4 text-center text-xs text-zinc-500">Live category reactions, question flags, and player ideas will appear here without covering answers.</p>}</div></CardContent></Card>;
};

const AnswerHistoryPanel = ({ rounds, players, leaderboard, answers, gradedAnswers, currentIndex, markAnswer, openScoreModal, reviewQuestion }) => {
  const [selectedIndex, setSelectedIndex] = useState(Number(currentIndex || 0));
  useEffect(() => setSelectedIndex(Number(currentIndex || 0)), [currentIndex]);
  const questions = rounds.flatMap((round) => (round.questions || []).map((question, localIndex) => ({ ...question, roundName: question.roundName || round.name, absoluteIndex: round.startIndex + localIndex })));
  const selectedQuestion = questions.find((question) => Number(question.absoluteIndex) === Number(selectedIndex)) || questions[0];
  const selectedAnswers = answers.filter((answer) => Number(answer.questionIndex) === Number(selectedQuestion?.absoluteIndex));
  const answerByTeam = new Map(selectedAnswers.map((answer) => [answer.playerId, answer]));
  const teamMap = new Map();
  leaderboard.forEach((team) => teamMap.set(team.id, { id: team.id, name: team.name || "Team", score: Number(team.score || 0) }));
  players.forEach((player) => teamMap.set(player.id, { id: player.id, name: player.name || "Team", score: teamMap.get(player.id)?.score || 0 }));
  answers.forEach((answer) => {
    if (!teamMap.has(answer.playerId)) teamMap.set(answer.playerId, { id: answer.playerId, name: answer.playerName || "Team", score: 0 });
  });
  const teams = [...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const answeredCount = teams.filter((team) => answerByTeam.has(team.id)).length;
  const correctCount = selectedAnswers.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct").length;
  const statusBadge = (answer) => {
    if (!answer) return <Badge className="bg-zinc-800 text-zinc-400">Missing</Badge>;
    const status = gradedAnswers[answerKey(answer)]?.status;
    if (status === "correct") return <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"><CheckCircle size={12} className="mr-1" />Correct</Badge>;
    if (status === "incorrect") return <Badge className="bg-red-500/15 text-red-300 border border-red-500/20"><XCircle size={12} className="mr-1" />Incorrect</Badge>;
    return <Badge className="bg-amber-500/15 text-amber-200 border border-amber-500/20">Ungraded</Badge>;
  };

  return <Card className="glass-card"><CardContent className="p-4 space-y-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-white font-semibold"><List size={18} className="text-[#71E0DC]" />Full Game Answers</div><Badge className="bg-zinc-800 text-zinc-300">{answers.length} total</Badge></div><select value={selectedQuestion?.absoluteIndex ?? ""} onChange={(event) => setSelectedIndex(Number(event.target.value))} className="h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#71E0DC]/60">{questions.map((question) => <option key={question.absoluteIndex} value={question.absoluteIndex}>Q{question.absoluteIndex + 1} · {question.roundName || "Round"} · {question.category || "General"}</option>)}</select>{selectedQuestion && <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">Q{selectedQuestion.absoluteIndex + 1}</Badge><Badge className="bg-zinc-800 text-zinc-300">{answeredCount}/{teams.length} answered</Badge><Badge className="bg-emerald-500/15 text-emerald-300">{correctCount} correct</Badge></div><p className="text-sm font-bold text-white line-clamp-3">{selectedQuestion.questionText}</p><p className="mt-2 text-xs text-zinc-500">Answer: <span className="text-emerald-300">{selectedQuestion.answer || "Not set"}</span></p><Button size="sm" variant="outline" onClick={() => reviewQuestion(selectedQuestion.absoluteIndex)} className="mt-3 h-8 border-white/10 text-zinc-300 hover:text-white">Review This Question</Button></div>}<div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">{teams.map((team) => { const answer = answerByTeam.get(team.id); const grade = answer ? gradedAnswers[answerKey(answer)] : null; return <div key={team.id} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-bold text-white">{team.name}</span>{statusBadge(answer)}</div><div className="rounded-md bg-zinc-900/80 px-3 py-2 text-sm text-zinc-200 break-words">{answer?.answer || "No answer submitted"}</div>{answer && <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><span>{new Date(answer.submittedAt || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>{hasSubmittedWager(answer) && <span className="rounded-full bg-purple-400/15 px-2 py-0.5 font-bold text-purple-200">Wager {Number(answer.wagerAmount || 0)}</span>}<span className="rounded-full bg-zinc-800 px-2 py-0.5 font-bold text-zinc-300">Points {Number(grade?.points ?? answer.points ?? 0)}</span>{answer.manuallyEntered && <span className="rounded-full bg-[#71E0DC]/15 px-2 py-0.5 font-bold text-[#71E0DC]">Manual</span>}</div>}<div className="mt-3 flex flex-wrap gap-2">{answer ? <><Button size="sm" onClick={() => markAnswer(answer, "correct")} className="h-8 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"><CheckCircle size={13} className="mr-1" />Correct</Button><Button size="sm" onClick={() => markAnswer(answer, "incorrect")} className="h-8 bg-red-500/20 text-red-200 hover:bg-red-500/30"><XCircle size={13} className="mr-1" />Incorrect</Button><Button size="sm" variant="outline" onClick={() => openScoreModal(team.id, { answer })} className="h-8 border-white/10 text-zinc-300 hover:text-white">Adjust</Button></> : <Button size="sm" variant="outline" onClick={() => openScoreModal(team.id)} className="h-8 border-white/10 text-zinc-300 hover:text-white">Adjust Score</Button>}</div></div>; })}{!teams.length && <p className="rounded-lg border border-white/10 bg-zinc-950/50 p-4 text-center text-xs text-zinc-500">Teams will appear here once players join or you add them.</p>}</div></CardContent></Card>;
};

const EmergencyPanel = ({ currentIndex, emergencyOverride, generatedEmergency, emergencyLoading, generateEmergencyQuestion, activateEmergencyQuestion, clearEmergency, startTimerOnly, goToQuestion, editBuild }) => {
  return <Card className="glass-card"><CardContent className="p-4 space-y-4"><div><div className="flex items-center gap-2 text-white font-semibold"><Zap size={18} className="text-[#71E0DC]" />Emergency Host Tools</div><p className="text-xs text-zinc-500 mt-1">Quick fixes for a live hosting moment.</p></div>{emergencyOverride && <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100"><p className="font-bold">Emergency question is live</p><p className="mt-1 line-clamp-2">{emergencyOverride.questionText}</p><Button size="sm" variant="outline" onClick={clearEmergency} className="mt-2 h-8 border-amber-300/30 text-amber-100 hover:text-white">Return to original</Button></div>}<div className="grid grid-cols-2 gap-2"><Button size="sm" onClick={() => generateEmergencyQuestion("replacement")} disabled={emergencyLoading} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100">{emergencyLoading ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}Replacement</Button><Button size="sm" onClick={() => generateEmergencyQuestion("tiebreaker")} disabled={emergencyLoading} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100"><Trophy size={14} className="mr-1" />Tiebreaker</Button><Button size="sm" onClick={() => startTimerOnly(60)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100"><Timer size={14} className="mr-1" />60s Timer</Button><Button size="sm" onClick={() => goToQuestion(currentIndex + 1, { startTimer: true, pauseBeforeBonus: false })} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100"><ChevronRight size={14} className="mr-1" />Skip</Button></div>{generatedEmergency && <div className="rounded-lg border border-white/10 bg-zinc-950/70 p-3"><div className="flex items-center justify-between gap-2 mb-2"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{generatedEmergency.category}</Badge><Button size="sm" onClick={() => activateEmergencyQuestion(generatedEmergency)} className="h-8 gradient-btn">Use Live</Button></div><p className="text-sm font-bold text-white">{generatedEmergency.questionText}</p><p className="mt-2 text-sm text-[#71E0DC]">Answer: {generatedEmergency.answer}</p>{generatedEmergency.funFact && <p className="mt-2 text-xs text-zinc-400">{generatedEmergency.funFact}</p>}</div>}<Button size="sm" variant="outline" onClick={editBuild} className="w-full border-white/10 text-zinc-300 hover:text-white"><Pencil size={14} className="mr-2" />Open Builder for Bigger Fixes</Button></CardContent></Card>;
};

const DisputesPanel = ({ currentIndex, addDisputeNote, disputeNotes }) => {
  const [note, setNote] = useState("");
  const saveNote = () => {
    addDisputeNote(note);
    setNote("");
  };
  return <Card className="glass-card"><CardContent className="p-4 space-y-4"><div><div className="flex items-center gap-2 text-white font-semibold"><Clock size={18} className="text-[#71E0DC]" />Disputes</div><p className="text-xs text-zinc-500 mt-1">Log a ruling so it's on record for after the game.</p></div><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">Dispute note for Q{Number(currentIndex) + 1}</p><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: Team argued spelling, accepted after clarification." className="min-h-20 w-full resize-none rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><Button size="sm" onClick={saveNote} disabled={!note.trim()} className="mt-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100">Save Note</Button></div><div className="space-y-2 max-h-96 overflow-y-auto">{disputeNotes.map((item) => <div key={item.id} className="rounded-md bg-zinc-950/60 p-2 text-xs text-zinc-400"><p className="text-zinc-200 line-clamp-1">Q{Number(item.questionIndex) + 1}: {item.questionText}</p><p>{item.note}</p></div>)}{!disputeNotes.length && <p className="text-xs text-zinc-600 text-center">Dispute notes stay here for post-game review.</p>}</div></CardContent></Card>;
};

const FairPlayPanel = ({ leaderboard, fairPlayStats, openScoreModal }) => {
  const flagged = leaderboard
    .map((team) => ({ team, stats: fairPlayStats.get(team.id) || {} }))
    .filter(({ stats }) => (stats.flags?.length || 0) > 0 || Number(stats.lateCorrect || 0) > 0 || Number(stats.leftScreen || 0) > 0 || Number(stats.correctStreak || 0) >= 3);
  return <Card className="glass-card"><CardContent className="p-4 space-y-4"><div><div className="flex items-center gap-2 text-white font-semibold"><AlertTriangle size={18} className="text-amber-300" />Fair Play</div><p className="text-xs text-zinc-500 mt-1">Streaks, late-correct answers, and screen exits worth a second look.</p></div><div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">{flagged.map(({ team, stats }) => <div key={team.id} className="rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="font-semibold text-sm truncate">{team.name}</span><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>{Boolean(stats.flags?.length) && <div className="mb-2 flex flex-wrap gap-1">{stats.flags.map((flag) => <span key={flag} className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-200">{flag}</span>)}</div>}<div className="mb-2 grid grid-cols-3 gap-1 text-[11px] text-zinc-500"><span>Streak {stats.correctStreak || 0}</span><span>Late {stats.lateCorrect || 0}</span><span>Exit {stats.leftScreen || 0}</span></div><Button size="sm" variant="outline" onClick={() => openScoreModal(team.id)} className="h-7 border-white/10 text-zinc-300 hover:text-white">Adjust Score</Button></div>)}{!flagged.length && <p className="text-xs text-zinc-500 text-center py-6">No fair-play flags yet. Streaks, late-correct answers, and screen exits will show up here as the game runs.</p>}</div></CardContent></Card>;
};

const optionToneClasses = {
  correct: "border-emerald-500/45 bg-emerald-500/10 text-emerald-300 font-semibold",
  incorrect: "border-rose-500/40 bg-rose-500/10 text-zinc-300",
  neutral: "border-white/10 bg-zinc-900/70 text-zinc-200 hover:border-white/25",
};

// The grading UI for a question's answers, rendered as the same rows that
// display the options -- there is no separate "answers submitted" section.
const AnswerRows = ({ question, players, answers, activity, fairPlayStats, gradedAnswers, markAnswer, addManualAnswer, wagerMode, wagerLimit, pointsPerQuestion, setMode, isReviewing, showAnswer }) => {
  const [manualTeamId, setManualTeamId] = useState("");
  const [manualAnswer, setManualAnswer] = useState("");
  const [manualWager, setManualWager] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  const submittedPlayerIds = new Set(answers.map((answer) => answer.playerId));
  const submittedCount = submittedPlayerIds.size;
  const wageredCount = answers.filter(hasSubmittedWager).length;
  const playerCount = players.length;
  const allSubmitted = playerCount > 0 && submittedCount >= playerCount;
  const waitingPlayers = players.filter((player) => !submittedPlayerIds.has(player.id));
  const leftScreenIds = new Set(activity.filter((event) => event.eventType === "left_screen").map((event) => event.playerId));
  const leftScreenCount = leftScreenIds.size;
  const lateCorrectIds = new Set(answers.filter((answer) => gradedAnswers[answerKey(answer)]?.status === "correct" && isLateSubmission(answer)).map((answer) => answer.playerId));
  const patternIds = new Set([...fairPlayStats.entries()].filter(([, stats]) => stats.flags.length > 0).map(([teamId]) => teamId));
  const normalize = (value) => normalizeAnswerText(String(value || "").trim()) || String(value || "").trim().toLowerCase();
  const acceptedKey = normalize(question.answer);

  let rows;
  if (question.type === "multiple_choice" && question.options.length > 0) {
    rows = question.options.map((optionText, optionIndex) => ({
      key: normalize(optionText) || `option-${optionIndex}`,
      letter: String.fromCharCode(65 + optionIndex),
      label: optionText,
      answers: answers.filter((answer) => normalize(answer.answer) === normalize(optionText)),
    }));
  } else if (question.type === "true_false") {
    rows = ["True", "False"].map((label) => ({ key: normalize(label), letter: null, label, answers: answers.filter((answer) => normalize(answer.answer) === normalize(label)) }));
  } else {
    const groups = new Map();
    answers.forEach((answer) => {
      const label = String(answer.answer || "Blank").trim() || "Blank";
      const key = normalize(label) || label.toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, letter: null, label, answers: [] });
      groups.get(key).answers.push(answer);
    });
    // Keep the accepted answer visible even if nobody submitted it, once revealed.
    if (showAnswer && acceptedKey && !groups.has(acceptedKey)) groups.set(acceptedKey, { key: acceptedKey, letter: null, label: question.answer, answers: [] });
    rows = [...groups.values()].sort((a, b) => b.answers.length - a.answers.length || a.label.localeCompare(b.label));
  }

  const toggleRow = (row) => {
    if (!row.answers.length) return;
    const allCorrect = row.answers.every((answer) => gradedAnswers[answerKey(answer)]?.status === "correct");
    row.answers.forEach((answer) => markAnswer(answer, allCorrect ? "incorrect" : "correct"));
  };

  const quickAnswers = question.type === "true_false" ? ["True", "False"] : question.type === "multiple_choice" ? question.options || [] : [];
  const submitManual = (value = manualAnswer) => {
    addManualAnswer({ playerId: manualTeamId, answer: value, wagerAmount: manualWager });
    setManualAnswer("");
    setManualWager("");
  };

  return <div>
    <div className="grid gap-2 mb-3">
      {rows.map((row) => {
        const hasAnswers = row.answers.length > 0;
        const allCorrect = hasAnswers && row.answers.every((answer) => gradedAnswers[answerKey(answer)]?.status === "correct");
        const anyIncorrect = hasAnswers && row.answers.some((answer) => gradedAnswers[answerKey(answer)]?.status === "incorrect");
        const matchesAccepted = Boolean(acceptedKey) && row.key === acceptedKey;
        // Once revealed, an option with no submissions still shows correct/incorrect
        // by comparing it to the accepted answer -- correctness never waits on someone
        // having picked it.
        const tone = hasAnswers ? (allCorrect ? "correct" : anyIncorrect ? "incorrect" : "neutral") : showAnswer && acceptedKey ? (matchesAccepted ? "correct" : "incorrect") : "neutral";
        const wagerTotal = row.answers.filter(hasSubmittedWager).reduce((sum, answer) => sum + Number(answer.wagerAmount || 0), 0);
        const dim = !hasAnswers && tone !== "correct";
        return <button key={row.key} type="button" disabled={!hasAnswers || isReviewing} onClick={() => toggleRow(row)} className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${optionToneClasses[tone]} ${dim ? "opacity-60" : ""}`}>
          {row.letter && <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${tone === "correct" ? "bg-emerald-400/25 text-emerald-300" : tone === "incorrect" ? "bg-rose-400/20 text-rose-300" : "bg-white/10 text-zinc-400"}`}>{row.letter}</span>}
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {wagerMode && wagerTotal > 0 && <span className="shrink-0 rounded-full bg-purple-400/15 px-2 py-0.5 text-[10px] font-bold text-purple-200">{wagerTotal} pts at stake</span>}
          <span className="flex shrink-0 -space-x-2">
            {row.answers.slice(0, 4).map((answer) => <span key={answer.playerId} title={`${answer.playerName || "Team"}${hasSubmittedWager(answer) ? ` - wager ${Number(answer.wagerAmount || 0)}` : ""}${answer.manuallyEntered ? " - manual" : ""}`} className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-zinc-950 text-[9px] font-black ${answer.manuallyEntered ? "bg-[#71E0DC] text-zinc-950" : leftScreenIds.has(answer.playerId) ? "bg-amber-200 text-zinc-950" : lateCorrectIds.has(answer.playerId) ? "bg-purple-200 text-zinc-950" : patternIds.has(answer.playerId) ? "bg-red-200 text-zinc-950" : "bg-zinc-700 text-zinc-100"}`}>{String(answer.playerName || "?").slice(0, 1).toUpperCase()}</span>)}
            {row.answers.length > 4 && <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-zinc-950 bg-zinc-700 text-[9px] font-black text-white">+{row.answers.length - 4}</span>}
          </span>
          <span className={`shrink-0 min-w-[16px] text-right text-[11px] font-bold ${tone === "correct" ? "text-emerald-300" : tone === "incorrect" ? "text-rose-300" : "text-zinc-500"}`}>{row.answers.length}</span>
          <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded ${tone === "correct" ? "bg-emerald-400/20 text-emerald-300" : tone === "incorrect" ? "bg-rose-400/20 text-rose-300" : "bg-white/5 text-zinc-600"}`}>{tone === "correct" ? <CheckCircle size={13} /> : tone === "incorrect" ? <XCircle size={13} /> : null}</span>
        </button>;
      })}
      {!rows.length && <p className="text-xs text-zinc-500 text-center py-4">Answers for the current question will appear here.</p>}
    </div>

    {manualOpen ? <div className="mb-3 rounded-lg border border-white/10 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Manual answer</p><Button size="sm" variant="ghost" onClick={() => setManualOpen(false)} className="h-7 px-2 text-xs text-zinc-400 hover:text-white">Collapse</Button></div><div className={`grid gap-2 ${wagerMode ? "grid-cols-[1fr_1fr_76px]" : "grid-cols-[1fr_1fr]"}`}><select value={manualTeamId} onChange={(event) => setManualTeamId(event.target.value)} className="h-9 min-w-0 rounded-md border border-white/10 bg-zinc-950 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60"><option value="">Team</option>{players.map((player) => <option key={player.id} value={player.id}>{player.name || "Team"}</option>)}</select><input value={manualAnswer} onChange={(event) => setManualAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitManual()} placeholder="Answer" className="h-9 min-w-0 rounded-md border border-white/10 bg-zinc-950 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" />{wagerMode && <input value={manualWager} onChange={(event) => setManualWager(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitManual()} placeholder="Wager" type="number" min="0" max={Number(wagerLimit || 0) || undefined} className="h-9 min-w-0 rounded-md border border-white/10 bg-zinc-950 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" />}</div>{quickAnswers.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{quickAnswers.map((option) => <button key={option} type="button" onClick={() => { setManualAnswer(option); submitManual(option); }} className="rounded-full border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs font-bold text-zinc-200 hover:border-[#71E0DC]/50">{option}</button>)}</div>}<Button size="sm" onClick={() => submitManual()} className="mt-2 h-8 w-full gradient-btn">Add Manual Answer</Button></div> : <Button size="sm" variant="outline" onClick={() => setManualOpen(true)} className="mb-3 h-9 w-full border-white/10 text-zinc-300 hover:text-white"><Plus size={14} className="mr-2" />Manual Answer</Button>}

    {waitingPlayers.length > 0 && <p className="mb-2 text-[11px] text-zinc-500">Waiting on <b className="font-semibold text-amber-300">{waitingPlayers.map((player) => player.name || "Team").join(", ")}</b></p>}
    {wageredCount > 0 && <div className="mb-2 rounded-lg border border-purple-400/25 bg-purple-400/10 p-2.5 text-xs font-bold text-purple-200">Wagers submitted: {wageredCount}/{submittedCount || 0}</div>}
    {leftScreenCount > 0 && <div className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs font-bold text-amber-200">{leftScreenCount} team{leftScreenCount === 1 ? "" : "s"} left the game screen during this question</div>}
    {lateCorrectIds.size > 0 && <div className="mb-2 rounded-lg border border-purple-400/30 bg-purple-400/10 p-2.5 text-xs font-bold text-purple-200">{lateCorrectIds.size} late correct answer{lateCorrectIds.size === 1 ? "" : "s"} flagged</div>}

    <div className="mt-1 flex items-center justify-between gap-2">
      <p className="text-[11px] text-zinc-600">{allSubmitted ? "All answers are in" : `${submittedCount}/${playerCount || 0} submitted`} &middot; {wagerMode ? "Correct adds wager, incorrect subtracts wager" : `Correct: +${pointsPerQuestion}`}</p>
      <Button size="sm" variant="outline" onClick={() => setMode("leaderboard")} className="h-7 border-white/10 text-zinc-300 hover:text-white"><Trophy size={13} className="mr-1.5" />Leaderboard</Button>
    </div>
  </div>;
};

const LeaderboardPanel = ({ leaderboard, teamName, teamScore, setTeamName, setTeamScore, addTeam, openScoreModal, removeTeam, showLeaderboard, fairPlayStats }) => { const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)); return <Card className="glass-card"><CardContent className="p-3"><div className="flex items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2 text-white font-semibold"><Trophy size={18} className="text-amber-300" />Leaderboard</div><Button size="sm" variant="outline" onClick={showLeaderboard} className="h-8 border-white/10 text-zinc-300 hover:text-white">Show</Button></div><div className="grid grid-cols-[1fr_76px_36px] gap-2 mb-3"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Team name" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-3 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><input value={teamScore} onChange={(event) => setTeamScore(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTeam()} placeholder="Score" type="number" className="h-9 rounded-md bg-zinc-950 border border-white/10 px-2 text-sm text-white outline-none focus:border-[#71E0DC]/60" /><Button onClick={addTeam} className="h-9 w-9 p-0 gradient-btn" aria-label="Add team"><Plus size={16} /></Button></div><div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">{sorted.map((team) => { const stats = fairPlayStats.get(team.id) || {}; return <div key={team.id} className="rounded-md border border-white/10 bg-zinc-950/60 p-2"><div className="flex items-center justify-between gap-2 mb-2"><span className="font-semibold text-sm truncate">{team.name}</span><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>{Boolean(stats.flags?.length) && <div className="mb-2 flex flex-wrap gap-1">{stats.flags.map((flag) => <span key={flag} className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] font-bold text-red-200">{flag}</span>)}</div>}<div className="mb-2 grid grid-cols-3 gap-1 text-[11px] text-zinc-500"><span>Streak {stats.correctStreak || 0}</span><span>Late {stats.lateCorrect || 0}</span><span>Exit {stats.leftScreen || 0}</span></div><div className="flex items-center justify-end gap-1"><Button size="sm" variant="outline" onClick={() => openScoreModal(team.id)} className="h-7 min-w-24 border-white/10 text-zinc-300 hover:text-white">Edit</Button><Button size="sm" variant="outline" onClick={() => removeTeam(team.id)} className="h-7 w-8 p-0 border-white/10 text-zinc-400 hover:text-red-300" aria-label="Remove team"><Trash2 size={13} /></Button></div></div>; })}{!sorted.length && <p className="text-xs text-zinc-500 text-center py-3">Teams will appear here when players join from their phones.</p>}</div></CardContent></Card>; };

const LobbyStage = ({ playerCount, onStartTrivia }) => <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-12 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10"><QrCode className="text-[#71E0DC]" size={34} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Presentation is showing</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">Lobby / QR Code</h2><p className="mx-auto mt-4 max-w-2xl text-xl text-zinc-300">Players are scanning in from their phones. Start trivia when your room is ready.</p><div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/60 px-4 py-2 text-sm font-bold text-zinc-300"><Users size={15} className="text-[#71E0DC]" />{playerCount} {playerCount === 1 ? "team" : "teams"} joined</div><div className="mt-8"><Button onClick={onStartTrivia} className="h-12 px-8 text-base gradient-btn"><Play size={18} className="mr-2" />Start Trivia</Button></div></CardContent></Card>;

const RoundIntroStage = ({ round, gameStarted, onStartIntro, onStartQuestion }) => {
  const categories = [...new Set((round?.questions || []).map((question) => question.category).filter(Boolean))];
  return <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-12 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10"><Tags className="text-[#71E0DC]" size={34} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Round Intro</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">{round?.name || "Round"}</h2>{round?.description && <p className="mx-auto mt-4 max-w-3xl text-xl text-zinc-300">{round.description}</p>}<div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">{categories.map((category) => <Badge key={category} className="border border-white/10 bg-zinc-900 px-4 py-2 text-base text-zinc-200">{category}</Badge>)}{!categories.length && <p className="rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-zinc-500">Categories will appear here when this round has questions.</p>}</div><div className="mt-8 flex flex-wrap justify-center gap-3"><Button onClick={gameStarted ? onStartQuestion : onStartIntro} className="gradient-btn"><Play size={18} className="mr-2" />{gameStarted ? "Start Question" : "Start Trivia"}</Button>{gameStarted && <Button variant="outline" onClick={onStartIntro} className="border-white/10 text-zinc-300 hover:text-white">Show Intro Again</Button>}</div></CardContent></Card>;
};

const BonusPauseStage = ({ round, leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
  return <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-10 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10"><Loader2 className="animate-spin text-[#71E0DC]" size={30} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Bonus question next</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">{round?.name || "Round"} Bonus</h2><p className="mt-3 text-zinc-400">Leaderboard pause before the final question of the round.</p><div className="mx-auto mt-8 max-w-3xl space-y-3 text-left">{sorted.map((team, index) => <div key={team.id || team.name} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/70 px-4 py-3"><div className={`h-9 w-9 rounded-full flex items-center justify-center font-black ${index === 0 ? "bg-amber-300 text-zinc-950" : "bg-white/10 text-zinc-200"}`}>{index + 1}</div><span className="truncate text-lg font-bold text-white">{team.name}</span><span className="text-2xl font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>)}{!sorted.length && <p className="rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-center text-zinc-500">Leaderboard will appear once teams join or are added.</p>}</div></CardContent></Card>;
};

const WinnersStage = ({ leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const winners = sorted.slice(0, 3);
  const first = winners[0];
  const runnersUp = winners.slice(1);
  return <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-12 text-center"><div className="mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10"><Trophy className="text-amber-300" size={42} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Final Scores</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">Tonight&apos;s Winners</h2>{first ? <div className="mx-auto mt-8 max-w-2xl rounded-xl border-2 border-amber-300/50 bg-amber-300/15 p-7 text-center shadow-xl shadow-amber-300/5"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-300 text-xl font-black text-zinc-950">1</div><p className="mt-3 text-sm font-black uppercase tracking-[0.18em] text-amber-200">Champion</p><p className="mt-3 truncate text-3xl font-black text-white lg:text-5xl">{first.name}</p><p className="mt-2 text-5xl font-black text-amber-200 lg:text-6xl">{Number(first.score || 0)}</p></div> : <p className="mx-auto mt-8 max-w-2xl rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-center text-zinc-500">Winners will appear once teams have scores.</p>}{runnersUp.length > 0 && <div className="mx-auto mt-4 grid max-w-3xl grid-cols-1 gap-4 text-left md:grid-cols-2">{runnersUp.map((team, index) => { const place = index + 2; return <div key={team.id || team.name} className={`rounded-xl border p-5 ${place === 2 ? "border-[#AEB2EF]/30 bg-[#AEB2EF]/10" : "border-[#71E0DC]/30 bg-[#71E0DC]/10"}`}><div className="flex items-center gap-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full font-black text-zinc-950 ${place === 2 ? "bg-[#AEB2EF]" : "bg-[#71E0DC]"}`}>{place}</span><p className="text-sm font-bold uppercase tracking-wide text-zinc-400">{place === 2 ? "Second Place" : "Third Place"}</p></div><p className="mt-3 truncate text-2xl font-black text-white">{team.name}</p><p className="mt-2 text-4xl font-black" style={{ color: place === 2 ? "#AEB2EF" : "#71E0DC" }}>{Number(team.score || 0)}</p></div>; })}</div>}<p className="mt-8 text-xl font-bold text-zinc-300">Thanks for playing.</p></CardContent></Card>;
};

const FeedbackStage = ({ ideas }) => <Card className="glass-card overflow-hidden"><CardContent className="p-8 lg:p-12 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10"><MessageSquare className="text-[#71E0DC]" size={34} /></div><p className="text-sm font-bold uppercase tracking-wide text-[#71E0DC]">Player Feedback</p><h2 className="mt-2 text-4xl lg:text-6xl font-black text-white">Send Category or Question Ideas</h2><p className="mx-auto mt-4 max-w-2xl text-xl text-zinc-300">Players can submit ideas from their phones now.</p><div className="mx-auto mt-8 max-w-3xl rounded-lg border border-white/10 bg-zinc-950/60 p-5"><p className="text-5xl font-black text-[#71E0DC]">{ideas.length}</p><p className="text-zinc-400">idea{ideas.length === 1 ? "" : "s"} submitted</p></div></CardContent></Card>;

const IdeasPanel = ({ ideas }) => <Card className="glass-card"><CardContent className="p-4"><div className="flex items-center justify-between gap-2 mb-4"><div className="flex items-center gap-2 text-white font-semibold"><Sparkles size={18} className="text-[#71E0DC]" />Player Ideas</div><Badge className="bg-zinc-800 text-zinc-300">{ideas.length}</Badge></div><div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">{ideas.map((idea, index) => <div key={`${idea.playerId}-${idea.submittedAt}-${index}`} className="rounded-md border border-white/10 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-sm font-bold text-white truncate">{idea.playerName || "Team"}</span><span className="text-[11px] text-zinc-600">{new Date(idea.submittedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>{idea.category && <p className="text-sm text-[#71E0DC]"><span className="text-zinc-500">Category:</span> {idea.category}</p>}{idea.question && <p className="mt-2 text-sm text-zinc-200 whitespace-pre-wrap">{idea.question}</p>}</div>)}{!ideas.length && <p className="text-xs text-zinc-500 text-center py-6">Ideas will appear here after players submit them.</p>}</div></CardContent></Card>;

const ScoreAdjustModal = ({ modal, setModal, adjustScore, setScore }) => {
  const adjustment = Number(modal.adjustment || 0);
  const setTo = Number(modal.setTo || 0);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-2xl"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-wide text-[#71E0DC]">Manual Score</p><h3 className="text-xl font-black text-white">{modal.teamName}</h3><p className="text-sm text-zinc-500">Current score: {modal.currentScore}</p></div>{modal.answer && <div className="mb-4 rounded-md border border-white/10 bg-zinc-900/70 p-3"><p className="text-xs text-zinc-500 mb-1">Answer</p><p className="text-sm text-zinc-200 break-words">{modal.answer.answer}</p></div>}<div className="space-y-3"><label className="block text-xs text-zinc-400">Add or subtract points<input type="number" value={modal.adjustment} onChange={(event) => setModal((current) => ({ ...current, adjustment: event.target.value }))} placeholder="e.g. 25 or -10" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-900 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="block text-xs text-zinc-400">Set total score<input type="number" value={modal.setTo} onChange={(event) => setModal((current) => ({ ...current, setTo: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-900 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label></div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setModal(null)} className="border-white/10 text-zinc-300 hover:text-white">Cancel</Button><Button onClick={() => { adjustScore(modal.teamId, adjustment); setModal(null); toast.success(`Adjusted ${modal.teamName} by ${adjustment}`); }} disabled={!adjustment} className="bg-zinc-800 text-white hover:bg-zinc-700">Apply Adjustment</Button><Button onClick={() => { setScore(modal.teamId, setTo); setModal(null); toast.success(`Set ${modal.teamName} to ${setTo}`); }} className="gradient-btn">Set Score</Button></div></div></div>;
};

const TOOL_DRAWER_TITLES = { teams: "Teams & Leaderboard", run: "Run Sheet", fairplay: "Fair Play", disputes: "Disputes", emergency: "Emergency Host Tools", feedback: "Live Feedback" };

const ToolDrawer = ({ activeDrawer, onClose, children }) => {
  const open = Boolean(activeDrawer);
  return <>
    <div onClick={onClose} className={`fixed inset-0 z-40 bg-black/55 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} />
    <div className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-white/10 bg-zinc-950 shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
        <h3 className="text-lg font-bold text-white">{TOOL_DRAWER_TITLES[activeDrawer] || "Tools"}</h3>
        <Button variant="ghost" onClick={onClose} className="h-9 w-9 p-0 text-zinc-400 hover:text-white" aria-label="Close"><XCircle size={20} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{open && children}</div>
    </div>
  </>;
};

const revealTextClass = (text = "") => {
  const length = String(text || "").length;
  if (length > 320) return "text-sm lg:text-base";
  if (length > 210) return "text-base lg:text-lg";
  return "text-base lg:text-xl";
};

const RunSheet = ({ rounds, currentIndex, goToQuestion, answers, players, gradedAnswers, editBuild }) => <Card className="glass-card"><CardContent className="p-4"><div className="flex items-center justify-between gap-2 mb-4"><div className="flex items-center gap-2 text-white font-semibold"><MonitorPlay size={18} className="text-[#71E0DC]" />Run Sheet</div><Button size="sm" variant="outline" onClick={editBuild} className="h-8 border-white/10 text-zinc-300 hover:text-white"><Pencil size={14} className="mr-1" />Edit Build</Button></div><div className="space-y-4 max-h-[660px] overflow-y-auto pr-1">{rounds.map((round) => <section key={round.key}><button type="button" onClick={() => goToQuestion(round.startIndex)} className="w-full flex items-center justify-between text-left mb-2 px-2 py-1 rounded hover:bg-white/5"><span className="text-sm font-bold text-white">{round.name}</span><Badge className="bg-zinc-800 text-zinc-300">{round.questions.length}</Badge></button><div className="space-y-2">{round.questions.map((question, localIndex) => { const absoluteIndex = round.startIndex + localIndex; const active = absoluteIndex === currentIndex; const questionAnswers = answers.filter((answer) => Number(answer.questionIndex) === absoluteIndex); const graded = questionAnswers.map((answer) => gradedAnswers[answerKey(answer)]).filter(Boolean); const correctCount = graded.filter((item) => item.status === "correct").length; const incorrectCount = graded.filter((item) => item.status === "incorrect").length; return <button key={question.id} type="button" onClick={() => goToQuestion(absoluteIndex)} className={`w-full text-left rounded-md px-3 py-3 border transition-colors ${active ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/5 bg-zinc-950/40 hover:bg-zinc-900"}`}><div className="flex items-start justify-between gap-3 mb-2"><div className="flex items-center gap-2 flex-wrap"><span className="text-xs text-zinc-500 font-mono">#{localIndex + 1}</span><QuestionBadge type={question.type} />{question.imageUrl && <Image size={12} className="text-amber-300" />}</div><div className="flex items-center gap-1 text-[11px]"><span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">{questionAnswers.length}/{players.length || 0}</span>{correctCount > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">+{correctCount}</span>}{incorrectCount > 0 && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-300">-{incorrectCount}</span>}</div></div><p className="text-xs text-zinc-300 line-clamp-2">{question.questionText}</p><p className="mt-1 text-[11px] text-zinc-600">{question.category}</p></button>; })}</div></section>)}</div></CardContent></Card>;

const QuestionBadge = ({ type }) => { const meta = typeMeta[type] || typeMeta.written; const Icon = meta.icon; return <Badge className="bg-zinc-800 text-zinc-300 text-[11px]"><Icon size={11} className={`mr-1 ${meta.color}`} />{meta.short}</Badge>; };

const EDIT_SCOPE_LABEL = { question: "this question", round: "the rest of this round", all: "all remaining questions" };

// Replaces the old window.prompt()-based editor. That one only ever wrote
// to the live pointsPerQuestion/timerSeconds state, which goToQuestion
// resets from the question's own stored value on every navigation -- so an
// edit "stuck" only until you left and came back. This calls onSave(value,
// scope), which persists into the question data itself.
const EditableStatBadge = ({ label, value, unit, suffix, tone, onSave, step = 5 }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [scope, setScope] = useState("question");
  const ref = useRef(null);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  const toneClass = {
    amber: "border-amber-400/20 bg-amber-400/15 text-amber-200 hover:border-amber-300/50",
    teal: "border-[#71E0DC]/25 bg-[#71E0DC]/12 text-[#71E0DC] hover:border-[#71E0DC]/60",
    periwinkle: "border-[#AEB2EF]/25 bg-[#AEB2EF]/15 text-[#C6C9FF] hover:border-[#AEB2EF]/60",
    purple: "border-purple-500/30 bg-purple-500/15 text-purple-200 hover:border-purple-400/60",
  }[tone] || "border-white/10 bg-zinc-900 text-zinc-300 hover:text-zinc-100";
  const save = () => {
    onSave(Math.max(0, Number(draft) || 0), scope);
    setOpen(false);
    toast.success(`${label} set to ${Math.max(0, Number(draft) || 0)}${suffix || ""} for ${EDIT_SCOPE_LABEL[scope]}`);
  };
  return <div className="relative" ref={ref}>
    <button type="button" onClick={() => setOpen((current) => !current)} className={`rounded-full border px-3 py-1.5 text-sm font-bold transition ${toneClass}`}>{label}: {value}{suffix || ""}</button>
    {open && <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">{label}{unit ? ` (${unit})` : ""}</p>
      <div className="mb-2.5 flex items-center gap-2">
        <button type="button" onClick={() => setDraft((current) => Math.max(0, Number(current || 0) - step))} className="h-8 w-8 shrink-0 rounded-md border border-white/10 bg-zinc-900 text-zinc-300 hover:text-white">&minus;</button>
        <input type="number" value={draft} onChange={(event) => setDraft(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-900 px-2 text-center font-mono text-white outline-none focus:border-[#71E0DC]/60" />
        <button type="button" onClick={() => setDraft((current) => Number(current || 0) + step)} className="h-8 w-8 shrink-0 rounded-md border border-white/10 bg-zinc-900 text-zinc-300 hover:text-white">+</button>
      </div>
      <select value={scope} onChange={(event) => setScope(event.target.value)} className="mb-2.5 h-8 w-full rounded-md border border-white/10 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none focus:border-[#71E0DC]/60">
        <option value="question">This question only</option>
        <option value="round">Rest of this round</option>
        <option value="all">All remaining questions</option>
      </select>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} className="h-8 flex-1 border-white/10 text-zinc-300 hover:text-white">Cancel</Button>
        <Button size="sm" onClick={save} className="h-8 flex-1 gradient-btn">Save</Button>
      </div>
    </div>}
  </div>;
};

const QuestionStage = ({ question, index, total, showAnswer, showFunFact, focusMode, pointsPerQuestion, timerSeconds, timeRemaining, wagerMode, wagerLimit, wagerTiming, onUpdateSettings, branding, players, answers, activity, fairPlayStats, gradedAnswers, markAnswer, addManualAnswer, setMode, isReviewing }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);
  const revealTiming = normalizeImageTiming(question.imageTiming || question.image_timing);
  const shouldShowImage = Boolean(imageUrl) && revealTiming !== "after_answer";
  const shouldShowFunFactImage = Boolean(imageUrl) && revealTiming === "after_answer" && showFunFact;
  const shouldShowRevealPanel = Boolean(showFunFact && (question.funFact || shouldShowFunFactImage));
  const submittedCount = new Set(answers.map((answer) => answer.playerId)).size;
  const playerCount = players.length;
  const allSubmitted = playerCount > 0 && submittedCount >= playerCount;
  const submittedPct = playerCount > 0 ? Math.min(100, Math.round((submittedCount / playerCount) * 100)) : 0;
  const accentColor = branding?.accentColor || DEFAULT_BRANDING.accentColor;

  const answerRows = <AnswerRows question={question} players={players} answers={answers} activity={activity} fairPlayStats={fairPlayStats} gradedAnswers={gradedAnswers} markAnswer={markAnswer} addManualAnswer={addManualAnswer} wagerMode={wagerMode} wagerLimit={wagerLimit} pointsPerQuestion={Number(pointsPerQuestion) || getDefaultPoints(question)} setMode={setMode} isReviewing={isReviewing} showAnswer={showAnswer} />;

  return <Card className={`glass-card overflow-hidden ${focusMode ? "w-full" : ""}`}><CardContent className={focusMode ? "p-8 lg:p-12" : "p-5 lg:p-7"}><div className="flex items-start justify-between gap-3 mb-1"><div className="flex items-center gap-2 flex-wrap">{branding?.logoUrl && <img src={branding.logoUrl} alt={branding.name || "Host logo"} className="h-8 w-8 rounded bg-white object-contain p-1" />}</div><span className="text-zinc-500 font-mono text-sm">{index + 1} / {total}</span></div><div className="mb-8 flex items-center gap-2 flex-wrap"><Badge variant="outline" className="border-zinc-700 text-zinc-300">{question.category}</Badge><Badge className="border" style={{ backgroundColor: `${accentColor}1F`, borderColor: `${accentColor}00`, color: accentColor }}><Icon size={13} className="mr-1" />{meta.label}</Badge>{wagerMode ? <EditableStatBadge label="Wager" value={Number(wagerLimit) || 0} unit="points, 0 = off" suffix=" pts" tone="purple" step={10} onSave={(value, scope) => onUpdateSettings({ wagerLimit: value }, scope, question)} /> : <EditableStatBadge label="Points" value={Number(pointsPerQuestion) || getDefaultPoints(question)} tone="amber" step={5} onSave={(value, scope) => onUpdateSettings({ points: value }, scope, question)} />}<EditableStatBadge label="Timer" value={Number(timerSeconds) || 0} unit="seconds" suffix="s" tone="teal" step={5} onSave={(value, scope) => onUpdateSettings({ timerSeconds: value }, scope, question)} />{timeRemaining !== null && <span className="rounded-full border border-[#71E0DC]/25 bg-[#71E0DC]/10 px-3 py-1.5 text-sm font-bold text-[#71E0DC]">{timeRemaining}s left</span>}{wagerMode && <button type="button" onClick={() => onUpdateSettings({ wagerTiming: wagerTiming === "after_answer" ? "before_answer" : "after_answer" }, "question", question)} className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-sm font-bold text-purple-200 hover:border-purple-400/60">{wagerTiming === "after_answer" ? "After Answer" : "Before Answer"}</button>}{imageUrl && <Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20">{question.imageTiming === "after_answer" ? "Reveal Media" : "Media"}</Badge>}{playerCount > 0 && <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ${allSubmitted ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-400/15 text-amber-200"}`}><span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/15"><span className="block h-full rounded-full bg-current" style={{ width: `${submittedPct}%` }} /></span>{submittedCount}/{playerCount} in</span>}</div><h2 className={`${focusMode ? "text-4xl lg:text-6xl" : "text-2xl lg:text-4xl"} font-black leading-tight text-white text-center mb-6`}>{question.questionText}</h2>{shouldShowImage ? <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] items-start gap-5 mb-6">{answerRows}<div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950 aspect-[4/3]"><img src={imageUrl} alt="Question" className="h-full w-full object-cover" /></div></div> : <div className="mx-auto mb-6 w-full max-w-2xl">{answerRows}</div>}{shouldShowRevealPanel && <div className="mt-5 max-h-[42vh] overflow-y-auto rounded-lg border p-5 text-center" style={{ backgroundColor: `${accentColor}18`, borderColor: `${accentColor}55` }}>{shouldShowFunFactImage && <div className="mb-4 flex justify-center"><img src={imageUrl} alt="Reveal media" className="max-h-[28vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}<div className="flex items-center justify-center gap-2 font-bold mb-2" style={{ color: accentColor }}><Sparkles size={18} />{question.funFact ? "Fun Fact" : "Media"}</div>{question.funFact && <p className={`${revealTextClass(question.funFact)} leading-snug text-zinc-300 max-w-3xl mx-auto`}>{question.funFact}</p>}</div>}</CardContent></Card>;
};

export default HostSession;



