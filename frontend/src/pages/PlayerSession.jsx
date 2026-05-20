import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { CheckCircle, Loader2, Send, Smartphone, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";

const makePlayerId = () => `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getStoredPlayer = (sessionId) => {
  try { return JSON.parse(sessionStorage.getItem(`quiz-crafter-player-${sessionId}`) || "null"); } catch { return null; }
};

const PlayerSession = () => {
  const { id } = useParams();
  const [name, setName] = useState("");
  const [player, setPlayer] = useState(() => getStoredPlayer(id));
  const [hostState, setHostState] = useState(null);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const channelRef = useRef(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

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
  const myScore = leaderboard.find((team) => team.id === player?.id)?.score || 0;
  const sessionName = hostState?.sessionName || "Trivia Session";
  const timeRemaining = hostState?.timerEndAt ? Math.max(0, Math.ceil((new Date(hostState.timerEndAt).getTime() - now) / 1000)) : null;
  const acceptingAnswers = timeRemaining === null || timeRemaining > 0;
  const pointsPerQuestion = Number(hostState?.pointsPerQuestion || 1);

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
    const payload = { playerId: player.id, playerName: player.name, answer: finalAnswer, points: pointsPerQuestion, questionIndex: hostState.currentIndex, questionId: currentQuestion.id, questionText: currentQuestion.questionText, submittedAt: new Date().toISOString() };
    channelRef.current?.send({ type: "broadcast", event: "answer_submit", payload });
    setSubmitted(payload);
    setAnswer("");
    toast.success("Answer submitted");
  };

  if (!player) {
    return <div className="min-h-screen bg-[#09090B] text-white flex items-center justify-center p-4"><div className="w-full max-w-sm"><div className="text-center mb-6"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#71E0DC] to-[#AEB2EF] flex items-center justify-center mx-auto mb-4"><Smartphone className="text-zinc-950" size={32} /></div><h1 className="text-3xl font-black">Join Trivia</h1><p className="text-zinc-500 mt-1">Enter your team name</p></div><Card className="glass-card"><CardContent className="p-5 space-y-4"><div><label className="text-zinc-400 text-sm block mb-1.5">Team Name</label><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinGame()} placeholder="Enter team name" maxLength={32} className="w-full h-12 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white text-lg outline-none focus:border-[#71E0DC]/60" autoFocus /></div><Button onClick={joinGame} className="w-full h-12 gradient-btn text-base font-bold">Join Game</Button></CardContent></Card></div></div>;
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-white flex flex-col" data-testid="player-session-page">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 bg-zinc-950/80 sticky top-0 z-10"><div className="min-w-0"><p className="font-bold truncate">{player.name}</p><p className="text-xs text-zinc-500 truncate">{sessionName}</p></div><div className="flex items-center gap-2"><Badge className="bg-amber-400/15 text-amber-200 border border-amber-400/20">{pointsPerQuestion} pts</Badge><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{Number(myScore)} pts</Badge></div></header>
      <main className="flex-1 flex items-center justify-center p-4">
        {!hostState && <div className="text-center"><Loader2 className="mx-auto mb-4 text-[#71E0DC] animate-spin" size={34} /><h2 className="text-2xl font-black mb-1">You’re in</h2><p className="text-zinc-500">{connected ? "Waiting for the host to start." : "Connecting to the host screen."}</p></div>}
        {hostState?.mode === "leaderboard" && <LeaderboardView leaderboard={leaderboard} playerId={player.id} />}
        {hostState && hostState.mode !== "leaderboard" && !currentQuestion && <div className="text-center"><p className="text-zinc-400">Waiting for the next question.</p></div>}
        {hostState && hostState.mode !== "leaderboard" && currentQuestion && <div className="w-full max-w-md"><div className="text-center mb-5"><div className="flex items-center justify-center gap-2 flex-wrap mb-3"><Badge className="bg-zinc-800 text-zinc-300">{currentQuestion.roundName || "Round"} · {currentQuestion.category}</Badge>{timeRemaining !== null && <Badge className={timeRemaining === 0 ? "bg-red-500/15 text-red-300 border border-red-500/20" : "bg-[#AEB2EF]/15 text-[#AEB2EF] border border-[#AEB2EF]/20"}><Timer size={13} className="mr-1" />{timeRemaining}s</Badge>}</div><h2 className="text-2xl font-black leading-tight">{currentQuestion.questionText}</h2></div>{hostState.showAnswer ? <Card className="border-emerald-500/30 bg-emerald-500/10"><CardContent className="p-5 text-center"><p className="text-zinc-400 text-sm uppercase tracking-wide mb-1">Answer</p><p className="text-3xl font-black text-emerald-300">{currentQuestion.answer}</p>{hostState.showFunFact && currentQuestion.funFact && <p className="text-zinc-300 mt-3">{currentQuestion.funFact}</p>}</CardContent></Card> : submitted?.questionIndex === hostState.currentIndex ? <Card className="glass-card"><CardContent className="p-6 text-center"><CheckCircle className="mx-auto text-emerald-300 mb-3" size={42} /><h3 className="text-2xl font-black mb-1">Answer Locked</h3><p className="text-zinc-400">You answered: <span className="text-white font-bold">{submitted.answer}</span></p></CardContent></Card> : !acceptingAnswers ? <Card className="border-red-500/30 bg-red-500/10"><CardContent className="p-6 text-center"><Timer className="mx-auto text-red-300 mb-3" size={42} /><h3 className="text-2xl font-black">Time’s Up</h3><p className="text-zinc-400 mt-1">Waiting for the answer reveal.</p></CardContent></Card> : <AnswerForm question={currentQuestion} answer={answer} setAnswer={setAnswer} submitAnswer={submitAnswer} />}</div>}
      </main>
    </div>
  );
};

const LeaderboardView = ({ leaderboard, playerId }) => <div className="w-full max-w-md"><div className="text-center mb-5"><Trophy className="mx-auto text-amber-300 mb-2" size={38} /><h2 className="text-3xl font-black">Leaderboard</h2></div><div className="space-y-2">{leaderboard.map((team, index) => <div key={team.id || team.name} className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${team.id === playerId ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/70"}`}><div className="flex items-center gap-3 min-w-0"><span className="font-black text-zinc-500">#{index + 1}</span><span className="font-bold truncate">{team.name}</span></div><span className="font-black text-[#71E0DC]">{Number(team.score || 0)}</span></div>)}</div></div>;

const AnswerForm = ({ question, answer, setAnswer, submitAnswer }) => {
  if (question.type === "true_false") return <div className="grid grid-cols-2 gap-3"><Button onClick={() => submitAnswer("True")} className="h-16 text-xl font-black bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30">True</Button><Button onClick={() => submitAnswer("False")} className="h-16 text-xl font-black bg-red-500/20 border-2 border-red-500/40 text-red-300 hover:bg-red-500/30">False</Button></div>;
  if (question.type === "multiple_choice" && question.options?.length) return <div className="space-y-3">{question.options.map((option, index) => <Button key={index} onClick={() => submitAnswer(option)} className="w-full min-h-14 whitespace-normal text-left justify-start bg-zinc-900 border border-white/10 text-white hover:bg-zinc-800 px-4 py-3">{option}</Button>)}</div>;
  return <div className="flex gap-2"><input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submitAnswer()} placeholder="Type your answer" className="min-w-0 flex-1 h-14 rounded-lg bg-zinc-950 border border-white/10 px-3 text-white text-lg outline-none focus:border-[#71E0DC]/60" autoFocus /><Button onClick={() => submitAnswer()} disabled={!answer.trim()} className="h-14 px-5 gradient-btn"><Send size={20} /></Button></div>;
};

export default PlayerSession;
