import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { mergeNewerLiveState } from "../lib/liveState";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { CheckCircle, Pencil, Send, Sparkles, Tags, ThumbsDown, ThumbsUp, Timer, Trophy, X } from "lucide-react";
import { toast } from "sonner";

const makePlayerId = () => `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_HOST_LOGO_SRC = process.env.REACT_APP_BRAND_LOGO_URL || "/quiz-crafter-logo.svg";
const QUIZ_CRAFTER_LOGO_SRC = "/quiz-crafter-logo.svg";

const arrayConfig = [
  { key: "true_false_questions", type: "true_false" },
  { key: "multiple_choice_questions", type: "multiple_choice" },
  { key: "written_questions", type: "written" },
  { key: "picture_questions", type: "written" },
];

const playerStorageKey = (sessionId) => `quiz-crafter-player-${sessionId}`;
const readJsonStorage = (storage, key) => {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
const getStoredPlayer = (sessionId) => {
  if (typeof window === "undefined") return null;
  return readJsonStorage(sessionStorage, playerStorageKey(sessionId)) || readJsonStorage(localStorage, playerStorageKey(sessionId));
};
const saveStoredPlayer = (sessionId, player) => {
  const value = JSON.stringify(player);
  try { sessionStorage.setItem(playerStorageKey(sessionId), value); } catch { /* Ignore storage failures. */ }
  try { localStorage.setItem(playerStorageKey(sessionId), value); } catch { /* Ignore storage failures. */ }
};
const getStoredFeedback = (sessionId, name) => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`quiz-crafter-player-${sessionId}-${name}`) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
const writeStoredFeedback = (sessionId, name, value) => {
  try {
    sessionStorage.setItem(`quiz-crafter-player-${sessionId}-${name}`, JSON.stringify(value));
  } catch {
    // Feedback still broadcasts if device storage is unavailable.
  }
};
const applyHostState = (setHostState, payload) => {
  if (!payload || typeof payload !== "object") return;
  setHostState((current) => mergeNewerLiveState(current, payload));
};

const getRoundOrder = (question, fallbackOrder = 1) => Number(question?.round_order || question?.round_number || question?.round || fallbackOrder) || fallbackOrder;
const getRoundName = (question, fallbackOrder = 1) => {
  if (question?.round_name) return question.round_name;
  if (question?.round_title) return question.round_title;
  if (question?.round && Number.isNaN(Number(question.round))) return question.round;
  return `Round ${getRoundOrder(question, fallbackOrder)}`;
};

const getSessionBranding = (session) => ({
  name: session?.host_brand_name || session?.brand_name || session?.company_name || session?.venue_name || "Forever Fun Events",
  logoUrl: session?.host_logo_url || session?.brand_logo_url || session?.logo_url || DEFAULT_HOST_LOGO_SRC,
});
const mergeBranding = (session, hostState) => {
  const sessionBranding = getSessionBranding(session);
  const liveBranding = hostState?.branding && typeof hostState.branding === "object" ? hostState.branding : {};
  return {
    name: liveBranding.name || sessionBranding.name,
    logoUrl: liveBranding.logoUrl || sessionBranding.logoUrl,
  };
};

const buildRoundCategories = (session) => {
  const metadata = getRoundMetadata(session);
  const groups = new Map();
  arrayConfig.forEach(({ key }) => {
    const questions = Array.isArray(session?.[key]) ? session[key] : [];
    questions.forEach((question) => {
      const roundOrder = getRoundOrder(question, 1);
      const roundName = getRoundName(question, roundOrder);
      const mapKey = `${roundOrder}-${roundName}`;
      if (!groups.has(mapKey)) groups.set(mapKey, { key: mapKey, name: roundName, order: roundOrder, description: question.round_description || getRoundDescription(metadata, roundOrder, roundName), categories: new Set() });
      if (question.category) groups.get(mapKey).categories.add(question.category);
    });
  });

  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((round) => ({ ...round, categories: [...round.categories] }));
};

const getRoundMetadata = (session) => {
  const raw = session?.round_descriptions || session?.rounds_metadata || session?.rounds || [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
};

const getRoundDescription = (metadata, roundOrder, roundName) => {
  const match = metadata.find((round) => Number(round.order || round.round_order) === Number(roundOrder) || String(round.name || round.round_name || "").toLowerCase() === String(roundName || "").toLowerCase());
  return match?.description || match?.round_description || "";
};

const hasGameStarted = (hostState) => {
  if (!hostState) return false;
  if (hostState.gameStarted) return true;
  if (hostState.timerEndAt) return true;
  if (hostState.showAnswer || hostState.showFunFact) return true;
  return Number(hostState.currentIndex || 0) > 0;
};
const getCurrentQuestionPoints = (hostState, currentQuestion) => Number(currentQuestion?.questionPoints ?? currentQuestion?.points ?? hostState?.pointsPerQuestion ?? 1) || 1;

const PlayerSession = () => {
  const { id } = useParams();
  const [name, setName] = useState("");
  const [player, setPlayer] = useState(() => getStoredPlayer(id));
  const [editingName, setEditingName] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [session, setSession] = useState(null);
  const [hostState, setHostState] = useState(null);
  const [answer, setAnswer] = useState("");
  const [wagerAmount, setWagerAmount] = useState("0");
  const [updatePreference, setUpdatePreference] = useState("none");
  const [updateContact, setUpdateContact] = useState("");
  const [hostUpdate, setHostUpdate] = useState(null);
  const [ideaForm, setIdeaForm] = useState({ category: "", question: "" });
  const [feedbackByQuestion, setFeedbackByQuestion] = useState(() => getStoredFeedback(id, "question-feedback"));
  const [feedbackByCategory, setFeedbackByCategory] = useState(() => getStoredFeedback(id, "category-feedback"));
  const [submitted, setSubmitted] = useState(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const channelRef = useRef(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.from("sessions").select("*").eq("id", id).single();
      setSession(data || null);
    };
    loadSession();
  }, [id]);

  useEffect(() => {
    if (player) return undefined;
    const channel = supabase.channel(`quiz-crafter-live-${id}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "host_state" }, ({ payload }) => {
        applyHostState(setHostState, payload);
      })
      .on("broadcast", { event: "host_mode" }, ({ payload }) => {
        if (!payload?.mode) return;
        setHostState((current) => ({ ...(current || {}), ...payload }));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, player]);

  useEffect(() => {
    if (!player) return undefined;
    const channel = supabase.channel(`quiz-crafter-live-${id}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "host_state" }, ({ payload }) => {
        applyHostState(setHostState, payload);
        setSubmitted((previous) => {
          if (!previous) return null;
          return previous.questionIndex === payload?.currentIndex ? previous : null;
        });
      })
      .on("broadcast", { event: "host_mode" }, ({ payload }) => {
        if (!payload?.mode) return;
        setHostState((current) => ({ ...(current || {}), ...payload }));
      })
      .on("broadcast", { event: "host_update" }, ({ payload }) => {
        if (!payload?.message) return;
        setHostUpdate(payload);
        toast.info("Host update received");
      })
      .subscribe((status) => {
        const isConnected = status === "SUBSCRIBED";
        setConnected(isConnected);
        if (isConnected) {
          channel.send({ type: "broadcast", event: "player_join", payload: { playerId: player.id, playerName: player.name, updatePreference: player.updatePreference || "none", updateContact: player.updateContact || "", joinedAt: new Date().toISOString() } });
        }
      });
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [id, player]);

  const currentQuestion = useMemo(() => (hostState?.currentQuestion ? { ...hostState.currentQuestion, answer: hostState.showAnswer ? (hostState.revealedAnswer || hostState.currentQuestion.answer || "") : "" } : null), [hostState]);
  const leaderboard = useMemo(() => [...(hostState?.leaderboard || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)), [hostState]);
  const roundCategories = useMemo(() => buildRoundCategories(session), [session]);
  const branding = useMemo(() => mergeBranding(session, hostState), [session, hostState]);
  const myScore = leaderboard.find((team) => team.id === player?.id)?.score || 0;
  const sessionName = hostState?.sessionName || session?.name || session?.session_name || "Trivia Session";
  const timeRemaining = hostState?.timerEndAt ? Math.max(0, Math.ceil((new Date(hostState.timerEndAt).getTime() - now) / 1000)) : null;
  const acceptingAnswers = timeRemaining === null || timeRemaining > 0;
  const submissionTiming = () => ({ secondsRemainingAtSubmit: timeRemaining, timerEndAt: hostState?.timerEndAt || null, timerSeconds: hostState?.timerSeconds || null });
  const pointsPerQuestion = getCurrentQuestionPoints(hostState, currentQuestion);
  const wagerMode = Boolean(hostState?.wagerMode);
  const wagerLimit = Number(hostState?.wagerLimit || 0);
  const effectiveWagerLimit = wagerMode ? Math.max(0, Math.min(wagerLimit || Number.POSITIVE_INFINITY, Number(myScore || 0))) : 0;
  const wagerTiming = hostState?.wagerTiming === "after_answer" ? "after_answer" : "before_answer";
  const gameStarted = hasGameStarted(hostState);
  const introRound = hostState?.introRound || null;
  const activeRoundCategories = useMemo(() => {
    if (hostState?.mode === "categories" && Array.isArray(introRound?.categories)) return introRound.categories;
    const roundName = currentQuestion?.roundName;
    if (!roundName) return [];
    const matchedRound = roundCategories.find((round) => round.name === roundName);
    return matchedRound?.categories || [];
  }, [currentQuestion?.roundName, hostState?.mode, introRound, roundCategories]);
  const activeRoundName = hostState?.mode === "categories" ? (introRound?.name || currentQuestion?.roundName || "Round") : (currentQuestion?.roundName || "Round");
  const activeRoundDescription = hostState?.mode === "categories" ? (introRound?.description || "") : (roundCategories.find((round) => round.name === activeRoundName)?.description || "");
  const categoryFeedbackKey = hostState?.mode === "categories" ? (introRound?.key || hostState.currentIndex) : hostState?.currentIndex;

  useEffect(() => {
    if (!player || !hostState || !currentQuestion || hostState.mode !== "question") return undefined;
    const sendActivity = (eventType) => {
      channelRef.current?.send({ type: "broadcast", event: "player_activity", payload: { playerId: player.id, playerName: player.name, eventType, questionIndex: hostState.currentIndex, questionId: currentQuestion.id, questionText: currentQuestion.questionText, submittedAt: new Date().toISOString() } });
    };
    const handleVisibility = () => {
      if (document.hidden) sendActivity("left_screen");
      else sendActivity("returned");
    };
    const handlePageHide = () => sendActivity("left_screen");
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [currentQuestion, hostState, player]);

  useEffect(() => {
    setWagerAmount("0");
  }, [hostState?.currentIndex, wagerMode]);

  const joinGame = () => {
    const trimmed = name.trim();
    const contact = updateContact.trim();
    if (!trimmed) return toast.error("Enter a team name");
    if (updatePreference === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return toast.error("Enter a valid email address");
    const nextPlayer = { id: makePlayerId(), name: trimmed.slice(0, 32), updatePreference, updateContact: updatePreference === "none" ? "" : contact };
    saveStoredPlayer(id, nextPlayer);
    setPlayer(nextPlayer);
  };

  const saveTeamName = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !player) return toast.error("Enter a team name");
    const nextPlayer = { ...player, name: trimmed.slice(0, 32) };
    saveStoredPlayer(id, nextPlayer);
    setPlayer(nextPlayer);
    setEditingName(false);
    channelRef.current?.send({ type: "broadcast", event: "player_rename", payload: { playerId: nextPlayer.id, playerName: nextPlayer.name, updatedAt: new Date().toISOString() } });
    toast.success("Team name updated");
  };

  const submitFeedback = (sentiment) => {
    if (!player || !currentQuestion || !hostState) return;
    const key = String(hostState.currentIndex);
    setFeedbackByQuestion((current) => {
      const next = { ...current, [key]: sentiment };
      writeStoredFeedback(id, "question-feedback", next);
      return next;
    });
    channelRef.current?.send({ type: "broadcast", event: "feedback_submit", payload: { playerId: player.id, playerName: player.name, sentiment, questionIndex: hostState.currentIndex, questionId: currentQuestion.id, questionText: currentQuestion.questionText, category: currentQuestion.category || "Uncategorized", roundName: currentQuestion.roundName || "Round", submittedAt: new Date().toISOString() } });
    toast.success("Feedback saved");
  };

  const submitCategoryFeedback = (category, sentiment) => {
    if (!player || !hostState || !category) return;
    const key = `${categoryFeedbackKey}-${category}`;
    setFeedbackByCategory((current) => {
      const next = { ...current, [key]: sentiment };
      writeStoredFeedback(id, "category-feedback", next);
      return next;
    });
    channelRef.current?.send({ type: "broadcast", event: "category_feedback_submit", payload: { playerId: player.id, playerName: player.name, sentiment, category, questionIndex: hostState.currentIndex, roundKey: categoryFeedbackKey, roundName: activeRoundName, submittedAt: new Date().toISOString() } });
    toast.success("Feedback saved");
  };

  const submitAnswer = (value) => {
    if (!acceptingAnswers) return toast.error("Time is up");
    const finalAnswer = String(value || answer).trim();
    if (!finalAnswer || !player || !currentQuestion) return;
    const shouldWagerBefore = wagerMode && wagerTiming !== "after_answer";
    const requestedWager = Number(wagerAmount || 0);
    if (shouldWagerBefore && (!Number.isFinite(requestedWager) || requestedWager < 0)) return toast.error("Enter a wager of 0 or more");
    if (shouldWagerBefore && requestedWager > effectiveWagerLimit) return toast.error(`Wager up to ${effectiveWagerLimit}`);
    const wager = shouldWagerBefore ? requestedWager : 0;
    const awardedPoints = wagerMode ? wager : pointsPerQuestion;
    const payload = { playerId: player.id, playerName: player.name, answer: finalAnswer, points: awardedPoints, wagerAmount: wager, wagerSubmitted: !wagerMode || wagerTiming !== "after_answer", wagerMode, wagerLimit, wagerCap: effectiveWagerLimit, scoreAtWager: Number(myScore || 0), wagerTiming, questionIndex: hostState.currentIndex, questionId: currentQuestion.id, questionText: currentQuestion.questionText, ...submissionTiming(), submittedAt: new Date().toISOString() };
    channelRef.current?.send({ type: "broadcast", event: "answer_submit", payload });
    setSubmitted(payload);
    setAnswer("");
    toast.success("Answer submitted");
  };

  const submitWager = () => {
    if (!submitted || !wagerMode || wagerTiming !== "after_answer") return;
    const wager = Number(wagerAmount || 0);
    if (!Number.isFinite(wager) || wager < 0) return toast.error("Enter a wager of 0 or more");
    if (wager > effectiveWagerLimit) return toast.error(`Wager up to ${effectiveWagerLimit}`);
    const payload = { ...submitted, points: wager, wagerAmount: wager, wagerSubmitted: true, wagerLimit, wagerCap: effectiveWagerLimit, scoreAtWager: Number(myScore || 0), wagerTiming, ...submissionTiming(), submittedAt: new Date().toISOString() };
    channelRef.current?.send({ type: "broadcast", event: "answer_submit", payload });
    setSubmitted(payload);
    toast.success("Wager submitted");
  };
  const submitIdeas = () => {
    const category = ideaForm.category.trim();
    const question = ideaForm.question.trim();
    if (!category && !question) return toast.error("Add a category or question idea");
    channelRef.current?.send({ type: "broadcast", event: "idea_submit", payload: { playerId: player.id, playerName: player.name, category, question, submittedAt: new Date().toISOString() } });
    setIdeaForm({ category: "", question: "" });
    toast.success("Idea sent");
  };

  if (!player) {
    return <JoinScreen name={name} setName={setName} joinGame={joinGame} sessionName={sessionName} branding={branding} updatePreference={updatePreference} setUpdatePreference={setUpdatePreference} updateContact={updateContact} setUpdateContact={setUpdateContact} />;
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-white flex flex-col" data-testid="player-session-page">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 bg-zinc-950/80 sticky top-0 z-10"><div className="min-w-0 flex items-center gap-2">{branding.logoUrl && <img src={branding.logoUrl} alt={branding.name} className="h-9 w-9 shrink-0 rounded-full bg-white object-contain p-1" />}<div className="min-w-0">{editingName ? <div className="flex items-center gap-1"><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveTeamName(); if (event.key === "Escape") setEditingName(false); }} maxLength={32} className="h-8 min-w-0 rounded-md border border-white/10 bg-zinc-950 px-2 text-sm font-bold text-white outline-none focus:border-[#71E0DC]/60" autoFocus /><button type="button" onClick={saveTeamName} className="h-8 w-8 rounded-md bg-[#71E0DC] text-zinc-950 flex items-center justify-center" aria-label="Save team name"><CheckCircle size={16} /></button><button type="button" onClick={() => setEditingName(false)} className="h-8 w-8 rounded-md border border-white/10 text-zinc-400 flex items-center justify-center" aria-label="Cancel rename"><X size={16} /></button></div> : <div className="flex items-center gap-1 min-w-0"><p className="font-bold truncate">{player.name}</p><button type="button" onClick={() => { setRenameValue(player.name || ""); setEditingName(true); }} className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:text-white" aria-label="Change team name"><Pencil size={14} /></button></div>}<p className="text-xs text-zinc-500 truncate">{sessionName}</p></div></div><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{Number(myScore)} pts</Badge></header>
      <main className="flex-1 flex items-center justify-center p-4">
        {!gameStarted && <PlayerLobby sessionName={sessionName} connected={connected} branding={branding} />}
        {hostUpdate && <HostUpdateBanner update={hostUpdate} onDismiss={() => setHostUpdate(null)} />}
        {gameStarted && hostState?.mode === "leaderboard" && <LeaderboardView leaderboard={leaderboard} playerId={player.id} />}
        {gameStarted && hostState?.mode === "winners" && <LeaderboardView leaderboard={leaderboard} playerId={player.id} title="Final Winners" />}
        {hostState?.mode === "feedback" && <IdeasView form={ideaForm} setForm={setIdeaForm} onSubmit={submitIdeas} />}
        {gameStarted && hostState?.mode === "bonus_pause" && <LeaderboardView leaderboard={leaderboard} playerId={player.id} title="Bonus Question Next" />}
        {gameStarted && hostState?.mode === "categories" && <RoundIntroFeedback roundName={activeRoundName} description={activeRoundDescription} categories={activeRoundCategories} selectedByCategory={feedbackByCategory} currentIndex={categoryFeedbackKey} onSelect={submitCategoryFeedback} />}
        {gameStarted && hostState && hostState.mode !== "leaderboard" && hostState.mode !== "winners" && hostState.mode !== "feedback" && hostState.mode !== "categories" && hostState.mode !== "bonus_pause" && !currentQuestion && <div className="text-center"><p className="text-zinc-400">Waiting for the next question.</p></div>}
        {gameStarted && hostState && hostState.mode !== "leaderboard" && hostState.mode !== "winners" && hostState.mode !== "feedback" && hostState.mode !== "categories" && hostState.mode !== "bonus_pause" && currentQuestion && <PlayerQuestionView currentQuestion={currentQuestion} hostState={hostState} pointsPerQuestion={pointsPerQuestion} wagerMode={wagerMode} effectiveWagerLimit={effectiveWagerLimit} timeRemaining={timeRemaining} selectedFeedback={feedbackByQuestion[String(hostState.currentIndex)]} onFeedback={submitFeedback} submitted={submitted} wagerTiming={wagerTiming} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} submitWager={submitWager} acceptingAnswers={acceptingAnswers} answer={answer} setAnswer={setAnswer} submitAnswer={submitAnswer} />}
      </main>
    </div>
  );
};

const PlayerQuestionView = ({ currentQuestion, hostState, pointsPerQuestion, wagerMode, effectiveWagerLimit, timeRemaining, selectedFeedback, onFeedback, submitted, wagerTiming, wagerAmount, setWagerAmount, submitWager, acceptingAnswers, answer, setAnswer, submitAnswer }) => {
  const imageUrl = currentQuestion.imageUrl || currentQuestion.image_url || "";
  const imageTiming = currentQuestion.imageTiming || currentQuestion.image_timing || "initial";
  const showQuestionMedia = Boolean(imageUrl) && imageTiming !== "after_answer" && !hostState.showFunFact;
  const showFunFactMedia = Boolean(imageUrl) && imageTiming === "after_answer" && hostState.showFunFact;

  return (
    <div className="w-full max-w-md">
      {!hostState.showFunFact && (
        <div className="text-center mb-5">
          <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
            <Badge className="bg-zinc-800 text-zinc-300"><span>{currentQuestion.roundName || "Round"}</span><span className="mx-1 text-zinc-500">/</span><span>{currentQuestion.category}</span></Badge>
            {!wagerMode && <Badge className="bg-amber-500/15 text-amber-200 border border-amber-500/20">{pointsPerQuestion} pts</Badge>}
            {wagerMode && <Badge className="bg-purple-500/15 text-purple-300 border border-purple-500/20">Wager up to {effectiveWagerLimit}</Badge>}
            {timeRemaining !== null && <Badge className={timeRemaining === 0 ? "bg-red-500/15 text-red-300 border border-red-500/20" : "bg-[#AEB2EF]/15 text-[#AEB2EF] border border-[#AEB2EF]/20"}><Timer size={13} className="mr-1" />{timeRemaining}s</Badge>}
          </div>
          {showQuestionMedia && <img src={imageUrl} alt="Question media" className="mx-auto mb-4 max-h-56 max-w-full rounded-xl border border-white/10 object-contain" />}
          <h2 className="text-2xl font-black leading-tight">{currentQuestion.questionText}</h2>
          <FeedbackButtons selected={selectedFeedback} onSelect={onFeedback} />
        </div>
      )}

      {hostState.showAnswer && !hostState.showFunFact && (
        <Card className="border-emerald-500/30 bg-emerald-500/10">
          <CardContent className="p-5 text-center">
            <p className="text-zinc-400 text-sm uppercase tracking-wide mb-1">Answer</p>
            <p className="text-3xl font-black text-emerald-300">{currentQuestion.answer}</p>
          </CardContent>
        </Card>
      )}

      {hostState.showFunFact && currentQuestion.funFact && (
        <Card className="border-[#AEB2EF]/30 bg-[#AEB2EF]/10">
          <CardContent className="p-5 text-center">
            {showFunFactMedia && <img src={imageUrl} alt="Fun fact media" className="mx-auto mb-4 max-h-64 max-w-full rounded-xl border border-white/10 object-contain" />}
            <p className="text-[#AEB2EF] text-sm uppercase tracking-wide mb-2">Fun Fact</p>
            <p className="text-zinc-200 leading-relaxed">{currentQuestion.funFact}</p>
          </CardContent>
        </Card>
      )}

      {!hostState.showAnswer && !hostState.showFunFact && (submitted?.questionIndex === hostState.currentIndex ? (
        <Card className="glass-card"><CardContent className="p-6 text-center"><CheckCircle className="mx-auto text-emerald-300 mb-3" size={42} /><h3 className="text-2xl font-black mb-1">Answer Locked</h3><p className="text-zinc-400">You answered: <span className="text-white font-bold">{submitted.answer}</span></p>{submitted.wagerMode && wagerTiming === "after_answer" && !submitted.wagerSubmitted ? <div className="mt-4"><WagerInput wagerMode wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} wagerLimit={effectiveWagerLimit} /><Button onClick={submitWager} className="w-full gradient-btn">Submit Wager</Button></div> : submitted.wagerMode && <p className="text-purple-300 font-bold mt-2">Wager: {submitted.wagerAmount}</p>}</CardContent></Card>
      ) : !acceptingAnswers ? (
        <Card className="border-red-500/30 bg-red-500/10"><CardContent className="p-6 text-center"><Timer className="mx-auto text-red-300 mb-3" size={42} /><h3 className="text-2xl font-black">Time&apos;s Up</h3><p className="text-zinc-400 mt-1">Waiting for the answer reveal.</p></CardContent></Card>
      ) : (
        <AnswerForm question={currentQuestion} answer={answer} setAnswer={setAnswer} submitAnswer={submitAnswer} wagerMode={wagerMode && wagerTiming !== "after_answer"} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} wagerLimit={effectiveWagerLimit} />
      ))}
    </div>
  );
};

const HostBrandMark = ({ branding }) => {
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [branding.logoUrl]);

  if (branding.logoUrl && !logoFailed) {
    return (
      <div className="mx-auto mb-4 flex justify-center">
        <img src={branding.logoUrl} alt={branding.name} onError={() => setLogoFailed(true)} className="h-28 w-28 rounded-full bg-white object-contain p-2" />
      </div>
    );
  }

  return <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-white text-zinc-950 shadow-lg shadow-[#71E0DC]/10"><div className="text-center leading-none"><div className="text-base font-black">{branding.name.split(" ")[0] || "Trivia"}</div><div className="text-xl font-black">Host</div></div></div>;
};

const QuizCrafterBadge = () => (
  <div className="mt-4 flex flex-col items-center justify-center gap-1.5 text-center text-sm uppercase tracking-wide text-zinc-500">
    <span>Powered by</span>
    <img src={QUIZ_CRAFTER_LOGO_SRC} alt="Quiz Crafter" className="h-10 w-44 object-contain" />
  </div>
);

const JoinScreen = ({ name, setName, joinGame, sessionName, branding, updatePreference, setUpdatePreference, updateContact, setUpdateContact }) => (
  <div className="min-h-screen bg-[#09090B] text-white flex items-center justify-center p-4">
    <div className="w-full max-w-sm">
      <div className="text-center mb-6">
        <HostBrandMark branding={branding} />
        <p className="text-zinc-400 text-xs font-bold uppercase tracking-wide mb-1">{branding.name}</p>
        <p className="text-[#71E0DC] text-sm font-bold uppercase tracking-wide mb-2">{sessionName}</p>
        <h1 className="text-3xl font-black">Join Trivia</h1>
        <QuizCrafterBadge />
      </div>
      <Card className="glass-card mt-4"><CardContent className="p-5 space-y-4"><div><label className="text-zinc-400 text-sm block mb-1.5">Team Name</label><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinGame()} placeholder="Enter team name" maxLength={32} className="w-full h-12 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white text-lg outline-none focus:border-[#71E0DC]/60" autoFocus /></div><div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3 space-y-3"><div><p className="text-sm font-bold text-white">Would you like updates from the host?</p><p className="text-xs text-zinc-500">Clues, cancellations, schedule changes, and other trivia night updates.</p></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setUpdatePreference("none")} className={`h-10 rounded-md border text-sm font-bold ${updatePreference === "none" ? "border-[#71E0DC]/60 bg-[#71E0DC]/15 text-[#71E0DC]" : "border-white/10 bg-zinc-900 text-zinc-300"}`}>No thanks</button><button type="button" onClick={() => setUpdatePreference("email")} className={`h-10 rounded-md border text-sm font-bold ${updatePreference === "email" ? "border-[#71E0DC]/60 bg-[#71E0DC]/15 text-[#71E0DC]" : "border-white/10 bg-zinc-900 text-zinc-300"}`}>Email me</button></div>{updatePreference === "email" && <input value={updateContact} onChange={(event) => setUpdateContact(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinGame()} placeholder="Email address" inputMode="email" className="w-full h-11 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" />}</div><Button onClick={joinGame} className="w-full h-12 gradient-btn text-base font-bold">Join Game</Button></CardContent></Card>
    </div>
  </div>
);

const HostUpdateBanner = ({ update, onDismiss }) => (
  <div className="fixed inset-x-4 top-20 z-30 mx-auto max-w-md rounded-xl border border-[#71E0DC]/30 bg-zinc-950/95 p-4 shadow-2xl shadow-black/50">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[#71E0DC]">Host Update</p>
        <p className="mt-1 text-sm text-white whitespace-pre-wrap">{update.message}</p>
      </div>
      <button type="button" onClick={onDismiss} className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:text-white">Close</button>
    </div>
  </div>
);

const PlayerLobby = ({ sessionName, connected, branding }) => (
  <div className="w-full max-w-md text-center">
    <HostBrandMark branding={branding} />
    <p className="text-zinc-400 text-xs font-bold uppercase tracking-wide mb-1">{branding.name}</p>
    <p className="text-[#71E0DC] text-sm font-bold uppercase tracking-wide mb-2">{sessionName}</p>
    <h1 className="text-3xl font-black">You&apos;re In</h1>
    <p className="text-zinc-500 mt-1 mb-5">{connected ? "Waiting for the host to start." : "Connecting to the host screen."}</p>
    <QuizCrafterBadge />
  </div>
);

const RoundIntroFeedback = ({ roundName, description, categories, selectedByCategory, currentIndex, onSelect }) => (
  <div className="w-full max-w-md text-center">
    <Tags className="mx-auto text-[#71E0DC] mb-3" size={38} />
    <p className="text-[#71E0DC] text-sm font-bold uppercase tracking-wide mb-2">Round Info</p>
    <h2 className="text-3xl font-black mb-2">{roundName}</h2>
    {description && <p className="text-zinc-300 mb-4 leading-relaxed">{description}</p>}
    <p className="text-zinc-500 mb-5">Rate the categories separately from the questions.</p>
    <div className="space-y-3 text-left">
      {categories.map((category) => {
        const selected = selectedByCategory[`${currentIndex}-${category}`];
        return (
          <div key={category} className="rounded-xl border border-white/10 bg-zinc-950/70 px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <p className="min-w-0 flex-1 text-xl font-black leading-tight text-white">{category}</p>
              <div className="flex shrink-0 items-center gap-1.5">
                <FeedbackIconButton label={`Thumbs up for ${category}`} selected={selected === "like"} tone="like" icon={ThumbsUp} onClick={() => onSelect(category, "like")} />
                <FeedbackIconButton label={`Thumbs down for ${category}`} selected={selected === "dislike"} tone="dislike" icon={ThumbsDown} onClick={() => onSelect(category, "dislike")} />
              </div>
            </div>
          </div>
        );
      })}
      {!categories.length && <p className="text-sm text-zinc-500 text-center rounded-xl border border-white/10 bg-zinc-950/70 p-4">Categories will appear when this round has categories saved.</p>}
    </div>
  </div>
);

const FeedbackIconButton = ({ label, selected, tone, icon: Icon, onClick }) => {
  const selectedClass = tone === "like"
    ? "text-[#71E0DC] ring-[#71E0DC]/55 shadow-[0_0_18px_rgba(113,224,220,0.22)]"
    : "text-red-300 ring-red-400/45 shadow-[0_0_18px_rgba(248,113,113,0.16)]";
  const hoverClass = tone === "like" ? "hover:text-[#71E0DC]" : "hover:text-red-300";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-[#71E0DC]/50 ${selected ? `bg-white/[0.03] ring-1 ${selectedClass}` : `bg-transparent text-zinc-500 hover:bg-white/[0.04] ${hoverClass}`}`}
    >
      <Icon size={30} strokeWidth={1.7} />
    </button>
  );
};

const FeedbackButtons = ({ selected, onSelect }) => (
  <div className="fixed right-4 top-[7.25rem] z-20 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/85 px-2.5 py-1.5 shadow-xl shadow-black/30 backdrop-blur">
    <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Rate</p>
    <div className="flex items-center gap-1">
      <FeedbackIconButton label="Thumbs up for this question" selected={selected === "like"} tone="like" icon={ThumbsUp} onClick={() => onSelect("like")} />
      <FeedbackIconButton label="Thumbs down for this question" selected={selected === "dislike"} tone="dislike" icon={ThumbsDown} onClick={() => onSelect("dislike")} />
    </div>
  </div>
);

const LeaderboardView = ({ leaderboard, playerId, title = "Leaderboard" }) => <div className="w-full max-w-md"><div className="text-center mb-5"><Trophy className="mx-auto text-amber-300 mb-2" size={38} /><h2 className="text-3xl font-black">{title}</h2>{title !== "Leaderboard" && <p className="text-zinc-500 mt-1">Get ready.</p>}</div><div className="space-y-2">{leaderboard.map((team, index) => <div key={team.id || team.name} className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${team.id === playerId ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/70"}`}><div className="flex items-center gap-3 min-w-0"><span className="font-black text-zinc-500">#{index + 1}</span><span className="font-bold truncate">{team.name}</span></div><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>)}</div></div>;

const IdeasView = ({ form, setForm, onSubmit }) => <div className="w-full max-w-md"><div className="text-center mb-5"><Sparkles className="mx-auto text-[#71E0DC] mb-2" size={40} /><h2 className="text-3xl font-black">Send Ideas</h2><p className="text-zinc-500 mt-1">Help shape a future trivia night.</p></div><Card className="glass-card"><CardContent className="p-5 space-y-4"><label className="block text-sm text-zinc-400">Category idea<input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="e.g. Movie soundtracks" className="mt-1 h-12 w-full rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><label className="block text-sm text-zinc-400">Question idea<textarea value={form.question} onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))} placeholder="A question, clue idea, or topic you want to see" className="mt-1 min-h-28 w-full rounded-lg bg-zinc-950 border border-white/10 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /></label><Button onClick={onSubmit} className="w-full h-12 gradient-btn font-bold">Send Idea</Button></CardContent></Card></div>;

const WagerInput = ({ wagerMode, wagerAmount, setWagerAmount, wagerLimit }) => wagerMode ? <div className="mb-3"><label className="text-zinc-400 text-sm block mb-1.5">Wager from 0{wagerLimit ? ` to ${wagerLimit}` : ""}</label><input value={wagerAmount} onChange={(event) => setWagerAmount(event.target.value)} type="number" min="0" max={wagerLimit || 0} inputMode="numeric" placeholder="0" className="w-full h-12 rounded-lg bg-zinc-950 border border-purple-500/30 px-3 text-white text-lg outline-none focus:border-purple-400" /></div> : null;

const AnswerForm = ({ question, answer, setAnswer, submitAnswer, wagerMode, wagerAmount, setWagerAmount, wagerLimit }) => {
  if (question.type === "true_false") return <><WagerInput wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} wagerLimit={wagerLimit} /><div className="grid grid-cols-2 gap-3"><Button onClick={() => submitAnswer("True")} className="h-16 text-xl font-black bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30">True</Button><Button onClick={() => submitAnswer("False")} className="h-16 text-xl font-black bg-red-500/20 border-2 border-red-500/40 text-red-300 hover:bg-red-500/30">False</Button></div></>;
  if (question.type === "multiple_choice" && question.options?.length) return <><WagerInput wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} wagerLimit={wagerLimit} /><div className="space-y-3">{question.options.map((option, index) => <Button key={index} onClick={() => submitAnswer(option)} className="w-full min-h-14 whitespace-normal text-left justify-start bg-zinc-900 border border-white/10 text-white hover:bg-zinc-800 px-4 py-3">{option}</Button>)}</div></>;
  return <><WagerInput wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} wagerLimit={wagerLimit} /><div className="flex gap-2"><input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitAnswer()} placeholder="Type your answer" className="min-w-0 flex-1 h-14 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white text-lg outline-none focus:border-[#71E0DC]/60" autoFocus /><Button onClick={() => submitAnswer()} disabled={!answer.trim()} className="h-14 px-5 gradient-btn"><Send size={20} /></Button></div></>;
};

export default PlayerSession;



