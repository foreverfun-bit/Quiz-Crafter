import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "../lib/supabase";
import { mergeNewerLiveState } from "../lib/liveState";
import { findLiveGame, fetchLivePlayers, subscribeLivePlayers } from "../lib/liveGame";
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
  true_false: { label: "True/False", short: "T/F", icon: CheckCircle },
  multiple_choice: { label: "Multiple Choice", short: "MC", icon: List },
  written: { label: "Written", short: "Written", icon: MessageSquare },
};

// Kept separate from the customizable brand colors below -- gold/silver/bronze
// are universal placement colors, not something a host's brand identity should
// override, so rank medals and winners stay on this palette regardless of branding.
const GOLD = "#F0B94D";
const SILVER = "#C9CDDD";
const BRONZE = "#CF9A63";

const DEFAULT_BRANDING = { name: "Forever Fun Events", logoUrl: "/quiz-crafter-logo.svg", primaryColor: "#71E0DC", accentColor: "#AEB2EF", correctColor: "", optionColor: "#7C8496", lobbyTagline: "Let's get quizzical." };
const sanitizeHexColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
const normalizeBranding = (branding = {}) => {
  const source = branding && typeof branding === "object" ? branding : {};
  return {
    name: String(source.name || "").trim() || DEFAULT_BRANDING.name,
    logoUrl: String(source.logoUrl || "").trim() || DEFAULT_BRANDING.logoUrl,
    primaryColor: sanitizeHexColor(source.primaryColor, DEFAULT_BRANDING.primaryColor),
    accentColor: sanitizeHexColor(source.accentColor, DEFAULT_BRANDING.accentColor),
    correctColor: /^#[0-9a-f]{6}$/i.test(String(source.correctColor || "")) ? source.correctColor : "",
    optionColor: sanitizeHexColor(source.optionColor, DEFAULT_BRANDING.optionColor),
    lobbyTagline: String(source.lobbyTagline || "").trim() || DEFAULT_BRANDING.lobbyTagline,
  };
};
const brandInitials = (name) => (String(name || "").trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("") || "QC").toUpperCase();
const tint = (hex, pct, base = "transparent") => `color-mix(in srgb, ${hex} ${pct}%, ${base})`;

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
const normalizeWagerTiming = (value) => value === "after_answer" || value === "after" ? "after_answer" : "before_answer";

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
        imageUrl: firstQuestionImageUrl(question),
        imageTiming: normalizeImageTiming(question.image_timing || question.image_display_timing || question.media_timing || question.mediaTiming),
        options: buildAnswerOptions(question, questionType),
        type: questionType,
        roundName: getRoundName(question, roundOrder),
        roundOrder,
        sourceOrder: getSourceOrder(question, index + 1),
        roundDescription: question.round_description || getRoundDescription(session, roundOrder, getRoundName(question, roundOrder)),
        points: Number(question.points ?? question.question_points ?? 0) || null,
        timerSeconds: Number(question.timer_seconds ?? question.time_limit ?? 30) || 30,
        wagerLimit: Number(question.wager_limit ?? question.free_wager_limit ?? 0) || 0,
        wagerTiming: normalizeWagerTiming(question.wager_timing || question.wagerTiming),
        isBonus: String(question.category || "").trim().toUpperCase() === "BONUS",
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
  const [liveGameId, setLiveGameId] = useState(null);
  const [livePlayers, setLivePlayers] = useState([]);
  const [now, setNow] = useState(Date.now());
  const hasLiveStateRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  // Backs off (2s, 4s, 8s ... capped at 20s) instead of polling a fixed
  // 2s forever -- until a live game exists this loop never finds one to
  // stop it, so a flat interval means every connected screen hammers the
  // endpoint indefinitely for the whole lobby wait, worse still if the
  // endpoint itself is erroring.
  useEffect(() => {
    if (liveGameId) return undefined;
    let cancelled = false;
    let timeoutId = null;
    let delay = 2000;
    const lookup = async () => {
      try {
        const game = await findLiveGame(id);
        if (game && !cancelled) { setLiveGameId(game.id); return; }
      } catch (error) {
        console.warn("Live game lookup unavailable:", error);
      }
      if (cancelled) return;
      delay = Math.min(delay * 2, 20000);
      timeoutId = window.setTimeout(lookup, delay);
    };
    lookup();
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [id, liveGameId]);

  useEffect(() => {
    if (!liveGameId) return undefined;
    let cancelled = false;
    fetchLivePlayers(liveGameId)
      .then((rows) => { if (!cancelled) setLivePlayers(rows.map((row) => ({ id: row.id, name: row.name, score: Number(row.score || 0) }))); })
      .catch((error) => console.warn("Live roster load unavailable:", error));
    const unsubscribe = subscribeLivePlayers(liveGameId, ({ eventType, new: newRow, old: oldRow }) => {
      setLivePlayers((current) => {
        if (eventType === "DELETE") return current.filter((team) => team.id !== oldRow.id);
        const nextTeam = { id: newRow.id, name: newRow.name, score: Number(newRow.score || 0) };
        const exists = current.some((team) => team.id === nextTeam.id);
        return exists ? current.map((team) => (team.id === nextTeam.id ? nextTeam : team)) : [...current, nextTeam];
      });
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [liveGameId]);

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

  // This is a fallback for the realtime broadcast channel above (catches
  // state it might have missed, e.g. after a reconnect) -- not the primary
  // sync path, so it doesn't need sub-2s polling. That was pulling
  // hosted_results on every connected screen continuously for the whole
  // game and was a major, needless contributor to Supabase egress.
  useEffect(() => {
    const loadDurableState = async () => {
      const { data } = await supabase.from("sessions").select("hosted_results").eq("id", id).single();
      applyNewerState(setPresentState, hasLiveStateRef, getSessionLiveState(data));
    };
    const interval = window.setInterval(loadDurableState, 8000);
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
  const playerCount = livePlayers.length;
  const sortedLeaderboard = useMemo(() => [...livePlayers].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)), [livePlayers]);
  const presentedLeaderboard = sortedLeaderboard.slice(0, mode === "winners" ? 3 : 12);
  const showLobby = mode === "qr" || !hasPresentationStarted(presentState, currentIndex);
  const branding = normalizeBranding(presentState.branding);
  const correctColor = branding.correctColor || branding.primaryColor;
  const isQuestionScene = mode !== "qr" && mode !== "categories" && mode !== "leaderboard" && mode !== "winners" && mode !== "feedback" && mode !== "bonus_pause";
  const timerEndAt = Number(presentState.timerEndAt) || null;
  const timeRemaining = isQuestionScene && timerEndAt ? Math.max(0, Math.ceil((timerEndAt - now) / 1000)) : null;
  const timerTotal = Math.max(1, Number(currentQuestion?.timerSeconds) || 30);

  if (loading) {
    return <div className="min-h-screen bg-[#07080C] flex items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={42} /></div>;
  }

  if (showLobby && session) {
    return (
      <Stage branding={branding}>
        <LobbyView branding={branding} sessionName={sessionName} joinUrl={joinUrl} playerCount={playerCount} teams={livePlayers} />
      </Stage>
    );
  }

  if (!session || !currentQuestion) {
    return (
      <div className="min-h-screen bg-[#07080C] text-white flex items-center justify-center text-center p-8">
        <div>
          <p className="text-4xl font-black mb-2">Presentation Not Ready</p>
          <p className="text-zinc-400">Open the host screen first, then choose what to show.</p>
        </div>
      </div>
    );
  }

  return (
    <Stage branding={branding} data-testid="present-session-page">
      <div className="h-screen flex flex-col p-3 lg:p-5 relative z-10">
        <TopStrip
          branding={branding}
          sessionName={sessionName}
          roundName={displayRound?.name}
          categoryLabel={currentQuestion?.category}
          questionIndex={currentIndex}
          totalQuestions={questions.length}
          progressPct={questions.length ? Math.round(((currentIndex + (presentState.showAnswer ? 1 : 0)) / questions.length) * 100) : 0}
          timeRemaining={timeRemaining}
          timerTotal={timerTotal}
          showTimer={isQuestionScene && timerEndAt !== null}
          showJoinChip={hasPresentationStarted(presentState, currentIndex) && mode !== "qr"}
          joinUrl={joinUrl}
        />

        <main className="min-h-0 flex-1 flex items-center justify-center overflow-hidden py-3">
          {mode === "categories" && <CategoriesView branding={branding} round={introRound} />}
          {mode === "leaderboard" && <LeaderboardView branding={branding} leaderboard={presentedLeaderboard} />}
          {mode === "winners" && <WinnersView branding={branding} leaderboard={presentedLeaderboard} sessionName={sessionName} />}
          {mode === "feedback" && <FeedbackView branding={branding} />}
          {mode === "bonus_pause" && <BonusPauseView branding={branding} round={presentState.pendingBonusRound || currentRound} leaderboard={presentedLeaderboard} />}
          {mode === "qr" && <LobbyView branding={branding} sessionName={sessionName} joinUrl={joinUrl} playerCount={playerCount} teams={livePlayers} compact />}
          {mode !== "qr" && mode !== "categories" && mode !== "leaderboard" && mode !== "winners" && mode !== "feedback" && mode !== "bonus_pause" && (
            <QuestionView branding={branding} correctColor={correctColor} question={currentQuestion} index={currentIndex} total={questions.length} showAnswer={presentState.showAnswer} showFunFact={presentState.showFunFact} />
          )}
        </main>
      </div>
    </Stage>
  );
};

// Ambient stage lighting shared by every scene, including the pre-game lobby --
// this is a screen meant for a dark room (TV/projector), so it deliberately
// doesn't have a light-mode treatment.
const Stage = ({ branding, children, ...rest }) => (
  <div className="h-screen bg-[#07080C] text-white overflow-hidden relative" {...rest}>
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -top-[22vw] -left-[14vw] h-[60vw] w-[60vw] rounded-full blur-[90px] opacity-20 animate-[drift-a_26s_ease-in-out_infinite]" style={{ background: branding.primaryColor }} />
      <div className="absolute -top-[26vw] -right-[18vw] h-[60vw] w-[60vw] rounded-full blur-[90px] opacity-20 animate-[drift-b_32s_ease-in-out_infinite]" style={{ background: branding.accentColor }} />
    </div>
    <div className="pointer-events-none fixed inset-0 z-0" style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 40%, rgba(5,6,9,0.55) 100%)" }} />
    <div className="relative z-10 h-full">{children}</div>
  </div>
);

const TopStrip = ({ branding, sessionName, roundName, categoryLabel, questionIndex, totalQuestions, progressPct, timeRemaining, timerTotal, showTimer, showJoinChip, joinUrl }) => {
  const low = timeRemaining !== null && timeRemaining <= 8;
  const ringColor = low ? "#FF6F70" : branding.primaryColor;
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const offset = timeRemaining === null ? circumference : circumference * (1 - Math.min(timeRemaining, timerTotal) / timerTotal);

  return (
    <header className="shrink-0 flex items-center gap-4 border-b border-white/10 pb-3">
      <div className="flex items-center gap-3 min-w-0">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.name} className="h-9 w-9 rounded-lg bg-white object-contain p-1 shrink-0" />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center font-black text-sm text-[#07080C]" style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.accentColor})` }}>{brandInitials(branding.name)}</div>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 font-mono truncate">{sessionName}</p>
          <h1 className="text-lg lg:text-xl font-bold truncate leading-tight">{roundName || "Round"}{categoryLabel ? ` · ${categoryLabel}` : ""}</h1>
        </div>
      </div>

      <div className="flex-1" />

      {totalQuestions > 0 && (
        <div className="hidden md:flex flex-col items-end gap-1.5 shrink-0">
          <p className="font-mono text-xs text-zinc-500">Q<span className="text-white font-semibold">{questionIndex + 1}</span> / {totalQuestions}</p>
          <div className="w-52 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${branding.primaryColor}, ${branding.accentColor})` }} />
          </div>
        </div>
      )}

      {showTimer && timeRemaining !== null && (
        <div className="relative shrink-0 flex items-center justify-center" style={{ width: 76, height: 76 }}>
          <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90">
            <circle cx="38" cy="38" r={radius} fill="none" stroke="rgba(244,246,250,0.08)" strokeWidth="5" />
            <circle cx="38" cy="38" r={radius} fill="none" stroke={ringColor} strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: "stroke-dashoffset 0.5s linear, stroke 0.3s ease" }} />
          </svg>
          <span className="relative font-mono font-bold text-xl tabular-nums" style={{ color: low ? "#FF6F70" : "#fff" }}>{timeRemaining}</span>
        </div>
      )}

      {showJoinChip && <HeaderJoinQr branding={branding} joinUrl={joinUrl} />}
    </header>
  );
};

const HeaderJoinQr = ({ branding, joinUrl }) => (
  <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/80 px-2 py-1.5 md:flex shrink-0">
    <div className="rounded bg-white p-1">
      <QRCodeCanvas value={joinUrl} size={54} marginSize={1} level="M" />
    </div>
    <div className="pr-1 text-left">
      <p className="text-xs font-black uppercase tracking-wide" style={{ color: branding.primaryColor }}>Late teams</p>
      <p className="text-[11px] text-zinc-400">Scan to join</p>
    </div>
  </div>
);

const LobbyView = ({ branding, sessionName, joinUrl, playerCount = 0, teams = [], compact = false }) => {
  const recentTeams = teams.slice(-6);
  return (
    <div className="h-full flex items-center justify-center p-4 text-center">
      <div className="w-full max-w-5xl flex flex-col items-center gap-6">
        <p className="font-mono text-sm font-semibold tracking-[0.14em] uppercase" style={{ color: branding.primaryColor }}>{sessionName}</p>
        <h1 className="text-5xl lg:text-6xl font-black leading-[0.98] text-balance">
          {branding.lobbyTagline.split(" ").map((word, i, words) => (
            <span key={i}>
              {i === Math.max(0, words.length - 2) ? <span style={{ backgroundImage: `linear-gradient(120deg, ${branding.primaryColor}, ${branding.accentColor})`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>{word}</span> : word}
              {" "}
            </span>
          ))}
        </h1>
        <div className="rounded-2xl bg-white p-4 shadow-2xl" style={{ boxShadow: `0 30px 70px -20px ${tint(branding.primaryColor, 35)}` }}>
          <QRCodeCanvas value={joinUrl} size={compact ? 200 : 240} marginSize={2} level="M" />
        </div>
        <p className="text-xl text-zinc-300">Scan to play from your phone</p>
        <p className="mx-auto max-w-4xl break-all text-lg font-semibold" style={{ color: branding.primaryColor }}>{joinUrl}</p>
        <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
          {recentTeams.map((team) => <span key={team.id} className="font-mono text-xs px-3 py-1.5 rounded-full border border-white/15 bg-white/5">{team.name}</span>)}
          <span className="text-xs px-3 py-1.5 rounded-full font-bold text-[#07080C]" style={{ background: `linear-gradient(120deg, ${branding.primaryColor}, ${branding.accentColor})` }}>
            <Users size={12} className="inline mr-1.5 -mt-0.5" />{playerCount} {playerCount === 1 ? "team" : "teams"} joined
          </span>
        </div>
      </div>
    </div>
  );
};

const CategoriesView = ({ branding, round }) => {
  const categories = round?.categories || [...new Set((round?.questions || []).map((question) => question.category).filter(Boolean))];
  const swatches = [branding.primaryColor, branding.accentColor];

  return (
    <div className="h-full w-full max-w-6xl flex items-start">
      <Card className="glass-card w-full">
        <CardContent className="p-6 lg:p-8">
          <div className="flex items-center gap-4 mb-5">
            <Tags size={38} style={{ color: branding.primaryColor }} />
            <div>
              <p className="text-lg text-zinc-400">Current round</p>
              <h2 className="text-4xl lg:text-5xl font-black">{round?.name || "Round"}</h2>
            </div>
          </div>
          {round?.description && <p className="text-2xl lg:text-3xl text-zinc-200 leading-snug mb-7">{round.description}</p>}
          <p className="text-zinc-400 uppercase tracking-wider text-base font-semibold mb-4">Round Categories</p>
          <div className="flex flex-wrap gap-4">
            {categories.map((category, index) => {
              const color = swatches[index % swatches.length];
              return <div key={category} className="rounded-lg px-5 py-3 text-2xl lg:text-3xl font-bold border" style={{ color, borderColor: tint(color, 30), background: tint(color, 10) }}>{category}</div>;
            })}
            {!categories.length && <p className="text-zinc-400 text-2xl">No categories saved for this round yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const rankTone = (index) => (index === 0 ? GOLD : index === 1 ? SILVER : index === 2 ? BRONZE : null);

const LeaderboardView = ({ branding, leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const maxScore = Number(sorted[0]?.score || 0) || 1;

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full">
        <CardContent className="flex h-full flex-col p-4 lg:p-5">
          <div className="flex shrink-0 items-center justify-center gap-3 mb-3">
            <Trophy className="text-amber-300" size={30} />
            <h2 className="text-3xl font-black">Leaderboard</h2>
          </div>
          <div className="min-h-0 flex-1 grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-2">
            {sorted.map((team, index) => {
              const rank = rankTone(index);
              return (
                <div key={team.id || team.name} className="grid grid-cols-[52px_1fr_auto] items-center gap-4 rounded-lg border border-white/10 bg-zinc-950/70 px-5 py-3">
                  <div className="h-11 w-11 rounded-full flex items-center justify-center font-black text-lg" style={rank ? { background: rank, color: "#07080C" } : { background: "rgba(255,255,255,0.08)", color: "#e5e7eb" }}>{index + 1}</div>
                  <div className="min-w-0">
                    <div className="text-2xl font-bold truncate mb-1.5">{team.name}</div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.round((Number(team.score || 0) / maxScore) * 100))}%`, background: `linear-gradient(90deg, ${branding.primaryColor}, ${branding.accentColor})` }} /></div>
                  </div>
                  <div className="font-mono text-3xl font-black tabular-nums" style={{ color: branding.primaryColor }}>{Number(team.score || 0)}</div>
                </div>
              );
            })}
            {!sorted.length && <p className="text-center text-zinc-400 text-2xl py-10 col-span-2">Leaderboard will appear here when teams are added on the host screen.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const WinnersView = ({ branding, leaderboard, sessionName }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const winners = sorted.slice(0, 3);
  const first = winners[0];
  const runnersUp = winners.slice(1);

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full overflow-hidden">
        <CardContent className="flex h-full flex-col justify-center p-4 lg:p-6 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full border shadow-2xl" style={{ borderColor: tint(GOLD, 40), background: tint(GOLD, 15), boxShadow: `0 0 40px -10px ${tint(GOLD, 40)}` }}>
            <Trophy style={{ color: GOLD }} size={32} />
          </div>
          <p className="text-xl font-black uppercase tracking-[0.3em]" style={{ color: branding.primaryColor }}>{sessionName}</p>
          <h2 className="mt-1 text-4xl lg:text-5xl font-black leading-none text-white">Winners</h2>
          {first ? (
            <div className="mx-auto mt-3 w-full max-w-3xl rounded-xl border-2 p-4 text-center shadow-2xl" style={{ borderColor: tint(GOLD, 60), background: tint(GOLD, 15), boxShadow: `0 30px 70px -25px ${tint(GOLD, 45)}` }}>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full text-xl font-black" style={{ background: GOLD, color: "#07080C" }}>1</div>
              <p className="mt-2 text-sm font-black uppercase tracking-[0.2em]" style={{ color: GOLD }}>Champion</p>
              <p className="mt-1 truncate text-3xl font-black text-white lg:text-4xl">{first.name}</p>
              <p className="mt-1 font-mono text-4xl font-black lg:text-5xl" style={{ color: GOLD }}>{Number(first.score || 0)}</p>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-white/10 bg-zinc-950/70 p-5 text-center text-xl text-zinc-400">Winners will appear once teams have scores.</p>
          )}
          {runnersUp.length > 0 && (
            <div className="mx-auto mt-3 grid w-full max-w-4xl grid-cols-2 gap-3 text-left">
              {runnersUp.map((team, index) => {
                const place = index + 2;
                const color = place === 2 ? SILVER : BRONZE;
                return (
                  <div key={team.id || team.name} className="rounded-xl border p-3" style={{ borderColor: tint(color, 35), background: tint(color, 10) }}>
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full font-black" style={{ background: color, color: "#07080C" }}>{place}</span>
                      <p className="text-xs font-black uppercase tracking-wide text-zinc-400">{place === 2 ? "Second Place" : "Third Place"}</p>
                    </div>
                    <p className="mt-2 truncate text-2xl font-black text-white">{team.name}</p>
                    <p className="mt-1 font-mono text-3xl font-black" style={{ color }}>{Number(team.score || 0)}</p>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xl font-black text-zinc-200">Thanks for playing!</p>
        </CardContent>
      </Card>
    </div>
  );
};

const FeedbackView = ({ branding }) => (
  <div className="h-full w-full max-w-5xl">
    <Card className="glass-card h-full overflow-hidden">
      <CardContent className="flex h-full flex-col justify-center p-5 lg:p-7 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border shadow-2xl" style={{ borderColor: tint(branding.primaryColor, 40), background: tint(branding.primaryColor, 15) }}>
          <Sparkles style={{ color: branding.primaryColor }} size={36} />
        </div>
        <p className="text-xl font-black uppercase tracking-[0.3em]" style={{ color: branding.primaryColor }}>One More Thing</p>
        <h2 className="mt-3 text-4xl lg:text-6xl font-black leading-none text-white">Send Us Ideas</h2>
        <p className="mx-auto mt-5 max-w-3xl text-2xl text-zinc-300">Use your phone to send category ideas, question ideas, or topics you want at a future trivia night.</p>
        <p className="mt-6 text-2xl font-black text-zinc-200">Thanks for playing!</p>
      </CardContent>
    </Card>
  </div>
);

const BonusPauseView = ({ branding, round, leaderboard }) => {
  const sorted = [...leaderboard].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
  const maxScore = Number(sorted[0]?.score || 0) || 1;

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full">
        <CardContent className="flex h-full flex-col p-4 lg:p-5 text-center">
          <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest" style={{ borderColor: tint(GOLD, 35), background: tint(GOLD, 10), color: GOLD }}>
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: GOLD }} />
            Bonus question next
          </div>
          <h2 className="text-3xl lg:text-5xl font-black leading-none mb-2">{round?.name || "Round"} Bonus</h2>
          <p className="text-xl text-zinc-300 mb-3">Current leaderboard</p>
          <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-2 text-left">
            {sorted.map((team, index) => {
              const rank = rankTone(index);
              return (
                <div key={team.id || team.name} className="grid min-h-0 grid-cols-[38px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2">
                  <div className="h-9 w-9 rounded-full flex items-center justify-center font-black" style={rank ? { background: rank, color: "#07080C" } : { background: "rgba(255,255,255,0.08)", color: "#e5e7eb" }}>{index + 1}</div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold truncate mb-1">{team.name}</div>
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.round((Number(team.score || 0) / maxScore) * 100))}%`, background: `linear-gradient(90deg, ${branding.primaryColor}, ${branding.accentColor})` }} /></div>
                  </div>
                  <div className="font-mono text-2xl font-black" style={{ color: branding.primaryColor }}>{Number(team.score || 0)}</div>
                </div>
              );
            })}
            {!sorted.length && <p className="rounded-lg border border-white/10 bg-zinc-950/70 p-8 text-center text-2xl text-zinc-400 col-span-2">Leaderboard will appear once teams join or are added.</p>}
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

const QuestionView = ({ branding, correctColor, question, index, total, showAnswer, showFunFact }) => {
  const meta = typeMeta[question.type] || typeMeta.written;
  const Icon = meta.icon;
  const imageUrl = buildStorageUrl(question.imageUrl);
  const revealTiming = normalizeImageTiming(question.imageTiming || question.image_timing);
  const shouldShowImage = Boolean(imageUrl) && revealTiming !== "after_answer";
  const shouldShowFunFactImage = Boolean(imageUrl) && revealTiming === "after_answer" && showFunFact;
  const funFactOnly = Boolean(showFunFact && (question.funFact || shouldShowFunFactImage));
  const imageRevealed = Boolean(showAnswer || showFunFact);
  const questionImageClass = imageRevealed ? "max-h-[26vh] max-w-[min(680px,100%)]" : "max-h-[42vh] w-full max-w-[min(880px,100%)]";
  const optionColor = branding.optionColor;

  return (
    <div className="h-full w-full max-w-6xl">
      <Card className="glass-card h-full overflow-hidden">
        <CardContent className="flex h-full flex-col justify-start p-4 lg:p-5">
          <div className="flex shrink-0 items-center justify-between gap-3 flex-wrap mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-zinc-800 text-zinc-300 text-base px-4 py-2"><Icon size={16} className="mr-2" style={{ color: branding.primaryColor }} />{meta.label}</Badge>
              {imageUrl && <Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20 text-base px-4 py-2"><Image size={16} className="mr-2" />{question.imageTiming === "after_answer" ? "Reveal Media" : "Media"}</Badge>}
            </div>
            <span className="text-zinc-500 font-mono text-lg">{index + 1} / {total}</span>
          </div>

          {!funFactOnly && (
            <div className="text-center mb-3 shrink-0">
              <span className="text-3xl lg:text-4xl font-black" style={{ color: branding.accentColor }}>{question.category}</span>
            </div>
          )}

          {funFactOnly ? (
            <div className="min-h-0 flex flex-1 items-center justify-center">
              <div className="max-h-full min-h-0 w-full overflow-y-auto rounded-lg border p-4 lg:p-6 text-center" style={{ borderColor: tint(branding.accentColor, 30), background: tint(branding.accentColor, 10) }}>
                {shouldShowFunFactImage && <div className="mb-3 flex justify-center"><img src={imageUrl} alt="Fun fact media" className="max-h-[32vh] max-w-full rounded-lg border border-white/10 object-contain" /></div>}
                <div className="flex items-center justify-center gap-3 font-black mb-3 text-xl" style={{ color: branding.accentColor }}><Sparkles size={24} />{question.funFact ? "Fun Fact" : "Media"}</div>
                {question.funFact && <p className={`${funFactTextClass(question.funFact)} font-black leading-snug text-white max-w-5xl mx-auto`}>{question.funFact}</p>}
              </div>
            </div>
          ) : (
            <>
              {shouldShowImage && <div className="mb-3 flex justify-center"><img src={imageUrl} alt="Question" className={`${questionImageClass} rounded-lg border border-white/10 object-contain transition-[max-height,width] duration-300 shadow-2xl`} /></div>}

              <h2 className="text-3xl lg:text-5xl font-black leading-tight text-white text-center mb-4">{question.questionText}</h2>

              {question.type === "true_false" && (
                <div className={`grid w-full grid-cols-2 gap-4 max-w-4xl mx-auto mb-3 ${showAnswer ? "" : "min-h-32 flex-1 max-h-[34vh]"}`}>
                  <div className="flex min-h-0 items-center justify-center rounded-lg border-2 px-5 py-4 text-center text-4xl font-black lg:text-5xl transition-all" style={showAnswer && question.answer === "False" ? { opacity: 0.35, borderColor: "rgba(52,211,153,0.3)", background: "rgba(52,211,153,0.1)", color: "#6ee7b7" } : { borderColor: showAnswer ? correctColor : "rgba(52,211,153,0.3)", background: showAnswer ? tint(correctColor, 16) : "rgba(52,211,153,0.1)", color: showAnswer ? correctColor : "#6ee7b7", boxShadow: showAnswer ? `0 0 0 2px ${correctColor}` : "none", transform: showAnswer ? "scale(1.02)" : "none" }}>True</div>
                  <div className="flex min-h-0 items-center justify-center rounded-lg border-2 px-5 py-4 text-center text-4xl font-black lg:text-5xl transition-all" style={showAnswer && question.answer === "True" ? { opacity: 0.35, borderColor: "rgba(255,111,112,0.3)", background: "rgba(255,111,112,0.1)", color: "#ff9b9c" } : { borderColor: showAnswer ? correctColor : "rgba(255,111,112,0.3)", background: showAnswer ? tint(correctColor, 16) : "rgba(255,111,112,0.1)", color: showAnswer ? correctColor : "#ff9b9c", boxShadow: showAnswer ? `0 0 0 2px ${correctColor}` : "none", transform: showAnswer ? "scale(1.02)" : "none" }}>False</div>
                </div>
              )}

              {question.type === "multiple_choice" && question.options.length > 0 && (
                <div className={`grid w-full grid-cols-2 gap-4 max-w-5xl mx-auto mb-3 ${showAnswer ? "" : "min-h-52 flex-1 max-h-[38vh] auto-rows-fr"}`}>
                  {question.options.map((option, optionIndex) => {
                    const isCorrect = showAnswer && optionKey(option) === optionKey(question.answer);
                    const isWrong = showAnswer && !isCorrect;
                    return (
                      <div key={optionIndex} className="flex min-h-0 items-center gap-4 rounded-lg border px-6 py-4 text-2xl font-bold leading-tight lg:text-3xl transition-all" style={isCorrect ? { borderColor: correctColor, background: tint(correctColor, 12), color: "#fff", boxShadow: `0 0 0 2px ${correctColor}` } : { borderColor: tint(optionColor, isWrong ? 12 : 24, "rgba(255,255,255,0.1)"), background: tint(optionColor, isWrong ? 3 : 7, "rgba(24,24,27,0.8)"), color: "#f4f6fa", opacity: isWrong ? 0.4 : 1 }}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md font-mono text-lg font-bold" style={isCorrect ? { background: correctColor, color: "#07080C" } : { background: tint(optionColor, 18, "rgba(255,255,255,0.06)"), color: tint(optionColor, 70, "#e5e7eb") }}>{String.fromCharCode(65 + optionIndex)}</span>
                        {option}
                      </div>
                    );
                  })}
                </div>
              )}

              {showAnswer && (
                <div className="mt-3 rounded-lg border p-3 text-center" style={{ borderColor: tint(correctColor, 30), background: tint(correctColor, 10) }}>
                  <p className="text-zinc-400 text-sm uppercase tracking-wider mb-2">Answer</p>
                  <p className="text-3xl lg:text-4xl font-black" style={{ color: correctColor }}>{question.answer}</p>
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
