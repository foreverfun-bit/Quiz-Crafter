import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { CheckCircle, Loader2, Send, Smartphone, Tags, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";

const makePlayerId = () => `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const arrayConfig = [
  { key: "true_false_questions", type: "true_false" },
  { key: "multiple_choice_questions", type: "multiple_choice" },
  { key: "written_questions", type: "written" },
  { key: "picture_questions", type: "written" },
];

const getStoredPlayer = (sessionId) => {
  try { return JSON.parse(sessionStorage.getItem(`quiz-crafter-player-${sessionId}`) || "null"); } catch { return null; }
};

const getRoundOrder = (question, fallbackOrder = 1) => Number(question?.round_order || question?.round_number || question?.round || fallbackOrder) || fallbackOrder;
const getRoundName = (question, fallbackOrder = 1) => {
  if (question?.round_name) return question.round_name;
  if (question?.round_title) return question.round_title;
  if (question?.round && Number.isNaN(Number(question.round))) return question.round;
  return `Round ${getRoundOrder(question, fallbackOrder)}`;
};

const buildRoundCategories = (session) => {
  const groups = new Map();
  arrayConfig.forEach(({ key }) => {
    const questions = Array.isArray(session?.[key]) ? session[key] : [];
    questions.forEach((question) => {
      const roundOrder = getRoundOrder(question, 1);
      const roundName = getRoundName(question, roundOrder);
      const mapKey = `${roundOrder}-${roundName}`;
      if (!groups.has(mapKey)) groups.set(mapKey, { key: mapKey, name: roundName, order: roundOrder, categories: new Set() });
      if (question.category) groups.get(mapKey).categories.add(question.category);
    });
  });

  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((round) => ({ ...round, categories: [...round.categories] }));
};

const hasGameStarted = (hostState) => {
  if (!hostState) return false;
  if (hostState.gameStarted) return true;
  if (hostState.timerEndAt) return true;
  if (hostState.showAnswer || hostState.showFunFact) return true;
  return Number(hostState.currentIndex || 0) > 0;
};

const PlayerSession = () => {
  const { id } = useParams();
  const [name, setName] = useState("");
  const [player, setPlayer] = useState(() => getStoredPlayer(id));
  const [session, setSession] = useState(null);
  const [hostState, setHostState] = useState(null);
  const [answer, setAnswer] = useState("");
  const [wagerAmount, setWagerAmount] = useState("");
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
    if (!player) return undefined;
    const channel = supabase.channel(`quiz-crafter-live-${id}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "host_state" }, ({ payload }) => {
        setHostState(payload || null);
        setSubmitted((previous) => {
          if (!previous) return null;
          return previous.questionIndex === payload?.currentIndex ? previous : null;
        });
      })
      .subscribe((status) => {
        const isConnected = status === "SUBSCRIBED";
        setConnected(isConnected);
        if (isConnected) {
          channel.send({ type: "broadcast", event: "player_join", payload: { playerId: player.id, playerName: player.name, joinedAt: new Date().toISOString() } });
        }
      });
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [id, player]);

  const currentQuestion = hostState?.currentQuestion || null;
  const leaderboard = useMemo(() => [...(hostState?.leaderboard || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)), [hostState]);
  const roundCategories = useMemo(() => buildRoundCategories(session), [session]);
  const myScore = leaderboard.find((team) => team.id === player?.id)?.score || 0;
  const sessionName = hostState?.sessionName || session?.name || session?.session_name || "Trivia Session";
  const timeRemaining = hostState?.timerEndAt ? Math.max(0, Math.ceil((new Date(hostState.timerEndAt).getTime() - now) / 1000)) : null;
  const acceptingAnswers = timeRemaining === null || timeRemaining > 0;
  const pointsPerQuestion = Number(hostState?.pointsPerQuestion || 1);
  const wagerMode = Boolean(hostState?.wagerMode);
  const gameStarted = hasGameStarted(hostState);

  useEffect(() => {
    setWagerAmount("");
  }, [hostState?.currentIndex, wagerMode]);

  const joinGame = () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Enter a team name");
    const nextPlayer = { id: makePlayerId(), name: trimmed.slice(0, 32) };
    sessionStorage.setItem(`quiz-crafter-player-${id}`, JSON.stringify(nextPlayer));
    setPlayer(nextPlayer);
  };

  const submitAnswer = (value) => {
    if (!acceptingAnswers) return toast.error("Time is up");
    const finalAnswer = String(value || answer).trim();
    if (!finalAnswer || !player || !currentQuestion) return;
    const wager = wagerMode ? Number(wagerAmount || 0) : 0;
    if (wagerMode && wager <= 0) return toast.error("Enter a wager");
    const awardedPoints = wagerMode ? wager : pointsPerQuestion;
    const payload = { playerId: player.id, playerName: player.name, answer: finalAnswer, points: awardedPoints, wagerAmount: wager, wagerMode, questionIndex: hostState.currentIndex, questionId: currentQuestion.id, questionText: currentQuestion.questionText, submittedAt: new Date().toISOString() };
    channelRef.current?.send({ type: "broadcast", event: "answer_submit", payload });
    setSubmitted(payload);
    setAnswer("");
    toast.success("Answer submitted");
  };

  if (!player) {
    return <JoinScreen name={name} setName={setName} joinGame={joinGame} sessionName={sessionName} roundCategories={roundCategories} />;
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-white flex flex-col" data-testid="player-session-page">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 bg-zinc-950/80 sticky top-0 z-10"><div className="min-w-0"><p className="font-bold truncate">{player.name}</p><p className="text-xs text-zinc-500 truncate">{sessionName}</p></div><div className="flex items-center gap-2"><Badge className={wagerMode ? "bg-purple-500/15 text-purple-300 border border-purple-500/20" : "bg-amber-400/15 text-amber-200 border border-amber-400/20"}>{wagerMode ? "Wager" : `${pointsPerQuestion} pts`}</Badge><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{Number(myScore)} pts</Badge></div></header>
      <main className="flex-1 flex items-center justify-center p-4">
        {!gameStarted && <PlayerLobby sessionName={sessionName} connected={connected} roundCategories={roundCategories} />}
        {gameStarted && hostState?.mode === "leaderboard" && <LeaderboardView leaderboard={leaderboard} playerId={player.id} />}
        {gameStarted && hostState && hostState.mode !== "leaderboard" && !currentQuestion && <div className="text-center"><p className="text-zinc-400">Waiting for the next question.</p></div>}
        {gameStarted && hostState && hostState.mode !== "leaderboard" && currentQuestion && <div className="w-full max-w-md"><div className="text-center mb-5"><div className="flex items-center justify-center gap-2 flex-wrap mb-3"><Badge className="bg-zinc-800 text-zinc-300">{currentQuestion.roundName || "Round"} · {currentQuestion.category}</Badge>{wagerMode && <Badge className="bg-purple-500/15 text-purple-300 border border-purple-500/20">Bonus Wager</Badge>}{timeRemaining !== null && <Badge className={timeRemaining === 0 ? "bg-red-500/15 text-red-300 border border-red-500/20" : "bg-[#AEB2EF]/15 text-[#AEB2EF] border border-[#AEB2EF]/20"}><Timer size={13} className="mr-1" />{timeRemaining}s</Badge>}</div><h2 className="text-2xl font-black leading-tight">{currentQuestion.questionText}</h2></div>{hostState.showAnswer ? <Card className="border-emerald-500/30 bg-emerald-500/10"><CardContent className="p-5 text-center"><p className="text-zinc-400 text-sm uppercase tracking-wide mb-1">Answer</p><p className="text-3xl font-black text-emerald-300">{currentQuestion.answer}</p>{hostState.showFunFact && currentQuestion.funFact && <p className="text-zinc-300 mt-3">{currentQuestion.funFact}</p>}</CardContent></Card> : submitted?.questionIndex === hostState.currentIndex ? <Card className="glass-card"><CardContent className="p-6 text-center"><CheckCircle className="mx-auto text-emerald-300 mb-3" size={42} /><h3 className="text-2xl font-black mb-1">Answer Locked</h3><p className="text-zinc-400">You answered: <span className="text-white font-bold">{submitted.answer}</span></p>{submitted.wagerMode && <p className="text-purple-300 font-bold mt-2">Wager: {submitted.wagerAmount}</p>}</CardContent></Card> : !acceptingAnswers ? <Card className="border-red-500/30 bg-red-500/10"><CardContent className="p-6 text-center"><Timer className="mx-auto text-red-300 mb-3" size={42} /><h3 className="text-2xl font-black">Time&apos;s Up</h3><p className="text-zinc-400 mt-1">Waiting for the answer reveal.</p></CardContent></Card> : <AnswerForm question={currentQuestion} answer={answer} setAnswer={setAnswer} submitAnswer={submitAnswer} wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} />}</div>}
      </main>
    </div>
  );
};

const BrandMark = () => <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-[#71E0DC]/30 bg-gradient-to-br from-[#71E0DC] to-[#AEB2EF] text-zinc-950 shadow-lg shadow-[#71E0DC]/10"><div className="text-center leading-none"><div className="text-xs font-black uppercase tracking-wide">Quiz</div><div className="text-lg font-black">Crafter</div></div></div>;

const JoinScreen = ({ name, setName, joinGame, sessionName, roundCategories }) => (
  <div className="min-h-screen bg-[#09090B] text-white flex items-center justify-center p-4">
    <div className="w-full max-w-sm">
      <div className="text-center mb-6">
        <BrandMark />
        <p className="text-[#71E0DC] text-xs font-bold uppercase tracking-wide mb-1">Forever Fun Trivia</p>
        <h1 className="text-3xl font-black">Join Trivia</h1>
        <p className="text-zinc-500 mt-1">{sessionName}</p>
      </div>
      <RoundCategoryCard roundCategories={roundCategories} compact />
      <Card className="glass-card mt-4"><CardContent className="p-5 space-y-4"><div><label className="text-zinc-400 text-sm block mb-1.5">Team Name</label><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinGame()} placeholder="Enter team name" maxLength={32} className="w-full h-12 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white text-lg outline-none focus:border-[#71E0DC]/60" autoFocus /></div><Button onClick={joinGame} className="w-full h-12 gradient-btn text-base font-bold">Join Game</Button></CardContent></Card>
    </div>
  </div>
);

const PlayerLobby = ({ sessionName, connected, roundCategories }) => (
  <div className="w-full max-w-md text-center">
    <BrandMark />
    <p className="text-[#71E0DC] text-xs font-bold uppercase tracking-wide mb-1">Forever Fun Trivia</p>
    <h1 className="text-3xl font-black">You&apos;re In</h1>
    <p className="text-zinc-500 mt-1 mb-5">{connected ? "Waiting for the host to start." : "Connecting to the host screen."}</p>
    <RoundCategoryCard roundCategories={roundCategories} />
  </div>
);

const RoundCategoryCard = ({ roundCategories, compact = false }) => (
  <Card className="glass-card text-left">
    <CardContent className={compact ? "p-4" : "p-5"}>
      <div className="flex items-center gap-2 mb-3 text-white font-bold"><Tags size={18} className="text-[#71E0DC]" />Round Categories</div>
      <div className="space-y-3">
        {roundCategories.map((round) => (
          <div key={round.key}>
            <p className="text-sm font-bold text-zinc-200 mb-2">{round.name}</p>
            <div className="flex flex-wrap gap-2">
              {round.categories.map((category) => <Badge key={`${round.key}-${category}`} className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{category}</Badge>)}
              {!round.categories.length && <span className="text-xs text-zinc-500">Categories coming soon.</span>}
            </div>
          </div>
        ))}
        {!roundCategories.length && <p className="text-sm text-zinc-500">Categories will appear when the host opens the session.</p>}
      </div>
    </CardContent>
  </Card>
);

const LeaderboardView = ({ leaderboard, playerId }) => <div className="w-full max-w-md"><div className="text-center mb-5"><Trophy className="mx-auto text-amber-300 mb-2" size={38} /><h2 className="text-3xl font-black">Leaderboard</h2></div><div className="space-y-2">{leaderboard.map((team, index) => <div key={team.id || team.name} className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${team.id === playerId ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/70"}`}><div className="flex items-center gap-3 min-w-0"><span className="font-black text-zinc-500">#{index + 1}</span><span className="font-bold truncate">{team.name}</span></div><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>)}</div></div>;

const WagerInput = ({ wagerMode, wagerAmount, setWagerAmount }) => wagerMode ? <div className="mb-3"><label className="text-zinc-400 text-sm block mb-1.5">Wager</label><input value={wagerAmount} onChange={(event) => setWagerAmount(event.target.value)} type="number" min="1" inputMode="numeric" placeholder="Enter wager" className="w-full h-12 rounded-lg bg-zinc-950 border border-purple-500/30 px-3 text-white text-lg outline-none focus:border-purple-400" /></div> : null;

const AnswerForm = ({ question, answer, setAnswer, submitAnswer, wagerMode, wagerAmount, setWagerAmount }) => {
  if (question.type === "true_false") return <><WagerInput wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} /><div className="grid grid-cols-2 gap-3"><Button onClick={() => submitAnswer("True")} className="h-16 text-xl font-black bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30">True</Button><Button onClick={() => submitAnswer("False")} className="h-16 text-xl font-black bg-red-500/20 border-2 border-red-500/40 text-red-300 hover:bg-red-500/30">False</Button></div></>;
  if (question.type === "multiple_choice" && question.options?.length) return <><WagerInput wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} /><div className="space-y-3">{question.options.map((option, index) => <Button key={index} onClick={() => submitAnswer(option)} className="w-full min-h-14 whitespace-normal text-left justify-start bg-zinc-900 border border-white/10 text-white hover:bg-zinc-800 px-4 py-3">{option}</Button>)}</div></>;
  return <><WagerInput wagerMode={wagerMode} wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} /><div className="flex gap-2"><input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitAnswer()} placeholder="Type your answer" className="min-w-0 flex-1 h-14 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white text-lg outline-none focus:border-[#71E0DC]/60" autoFocus /><Button onClick={() => submitAnswer()} disabled={!answer.trim()} className="h-14 px-5 gradient-btn"><Send size={20} /></Button></div></>;
};

export default PlayerSession;
