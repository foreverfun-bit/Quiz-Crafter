import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  Send,
  Trophy,
  Clock,
  Loader2,
  Coins,
  Timer,
} from "lucide-react";
import { useCountdown } from "../hooks/useCountdown";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const PlayerView = () => {
  const { gameId } = useParams();
  const [state, setState] = useState(null);
  const [answer, setAnswer] = useState("");
  const [wagerAmount, setWagerAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const wsRef = useRef(null);

  const playerId = sessionStorage.getItem("player_id");
  const playerName = sessionStorage.getItem("player_name");
  const countdown = useCountdown(state?.timer_end_at);
  const isTimedOut = countdown === 0;

  useEffect(() => {
    if (!playerId || !gameId) return;

    const wsUrl = API_URL.replace("https://", "wss://").replace("http://", "ws://");

    const connect = () => {
      const ws = new WebSocket(`${wsUrl}/api/ws/game/${gameId}?role=player&player_id=${playerId}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "init") {
          setState(msg.data);
        } else {
          ws.close();
          setTimeout(connect, 100);
        }
      };

      ws.onclose = () => {};

      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 30000);

      return () => { clearInterval(ping); ws.close(); };
    };

    const cleanup = connect();
    return cleanup;
  }, [gameId, playerId]);

  const handleSubmitAnswer = () => {
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "submit_answer", answer: answer.trim() }));
        setState((prev) => prev ? { ...prev, has_answered: true, my_answer: answer.trim() } : prev);
        setAnswer("");
        toast.success("Answer submitted!");
      }
    } catch { toast.error("Failed to submit"); }
    finally { setSubmitting(false); }
  };

  const handleSubmitWager = () => {
    const amount = parseInt(wagerAmount) || 0;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "submit_wager", amount }));
      setState((prev) => prev ? { ...prev, has_wagered: true, my_wager: amount } : prev);
      toast.success(`Wagered ${amount} points!`);
    }
  };

  const handleDirectAnswer = (ans) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "submit_answer", answer: ans }));
      setState((prev) => prev ? { ...prev, has_answered: true, my_answer: ans } : prev);
      toast.success("Answer submitted!");
    }
  };

  if (!playerId) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-zinc-400 text-lg mb-4">Session expired</p>
          <a href="/join" className="text-[#71E0DC] underline">Join again</a>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="text-[#71E0DC] animate-spin" size={32} />
      </div>
    );
  }

  const isLobby = state.status === "lobby";
  const isWagering = state.status === "wagering";
  const isQuestion = state.status === "question";
  const isReveal = state.status === "answer_reveal";
  const isScores = state.status === "scores";
  const isFinished = state.status === "finished";
  const q = state.current_question;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col" data-testid="player-view">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <span className="text-white font-medium">{playerName}</span>
        <div className="flex items-center gap-2">
          {countdown !== null && countdown > 0 && (isQuestion || isWagering) && (
            <span className={`font-mono font-bold text-sm ${countdown <= 5 ? "text-red-400 animate-pulse" : countdown <= 10 ? "text-amber-400" : "text-[#71E0DC]"}`} data-testid="player-countdown">
              <Timer size={14} className="inline mr-1" />{countdown}s
            </span>
          )}
          {isTimedOut && isQuestion && (
            <span className="text-red-400 text-xs font-bold animate-pulse">TIME'S UP</span>
          )}
          <Badge className="bg-[#71E0DC]/20 text-[#71E0DC] font-mono">{state.player_score} pts</Badge>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {/* Lobby */}
        {isLobby && (
          <div className="text-center">
            <Clock className="mx-auto text-zinc-600 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">You're in!</h2>
            <p className="text-zinc-400">Waiting for the host to start...</p>
            <p className="text-zinc-600 text-sm mt-2">{state.players_count} players joined</p>
          </div>
        )}

        {/* Wagering phase (picture questions) */}
        {isWagering && q && !state.has_wagered && (
          <div className="w-full max-w-md text-center">
            <Coins className="mx-auto text-purple-400 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Wager Round!</h2>
            <Badge className="bg-zinc-800 text-zinc-300 mb-4">{q.type_label} - {q.category}</Badge>
            <p className="text-white text-lg mb-2">{q.question}</p>

            {q.image_url && (
              <img
                src={q.image_url.startsWith("/api") ? `${API_URL}${q.image_url}` : q.image_url}
                alt="Question"
                className="mx-auto mt-3 mb-4 max-h-48 rounded-lg border border-white/10"
              />
            )}

            <p className="text-zinc-400 text-sm mb-4">
              How many points do you want to wager?
              <br />
              <span className="text-[#71E0DC]">Max: {state.max_wager || 0} pts</span>
            </p>

            <div className="flex gap-2 mb-3">
              <Input
                value={wagerAmount}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  setWagerAmount(String(Math.min(val, state.max_wager || 0)));
                }}
                placeholder="0"
                className="bg-zinc-900 border-white/10 text-white text-2xl text-center h-14 font-mono"
                type="number"
                inputMode="numeric"
                data-testid="wager-input"
              />
            </div>

            <div className="flex gap-2 mb-4">
              {[0, Math.floor((state.max_wager || 0) * 0.25), Math.floor((state.max_wager || 0) * 0.5), state.max_wager || 0].map((preset, i) => (
                <Button
                  key={i}
                  variant="outline"
                  onClick={() => setWagerAmount(String(preset))}
                  className="flex-1 border-purple-500/30 text-purple-300 hover:bg-purple-500/10 text-sm"
                >
                  {i === 3 ? "All In" : preset}
                </Button>
              ))}
            </div>

            <Button
              onClick={handleSubmitWager}
              disabled={submitting}
              className="w-full h-12 text-lg bg-gradient-to-r from-purple-500 to-[#AEB2EF] text-white font-bold hover:opacity-90"
              data-testid="submit-wager-btn"
            >
              <Coins size={20} className="mr-2" /> Lock In Wager
            </Button>
          </div>
        )}

        {/* Wagering - already wagered */}
        {isWagering && state.has_wagered && (
          <div className="text-center">
            <Coins className="mx-auto text-purple-400 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">Wager Locked!</h2>
            <p className="text-purple-300 text-xl font-mono font-bold">{state.my_wager} pts</p>
            <p className="text-zinc-600 text-sm mt-2">Waiting for host to start answering...</p>
          </div>
        )}

        {/* Question - waiting to answer */}
        {isQuestion && q && !state.has_answered && (
          <div className="w-full max-w-md">
            <div className="text-center mb-6">
              <Badge className="bg-zinc-800 text-zinc-300 mb-3">{q.type_label} - {q.category}</Badge>
              <p className="text-white text-xl font-medium">{q.question}</p>
              {q.image_url && (
                <img src={q.image_url.startsWith("/api") ? `${API_URL}${q.image_url}` : q.image_url} alt="Question" className="mx-auto mt-4 max-h-48 rounded-lg border border-white/10" />
              )}
            </div>

            {isTimedOut ? (
              <div className="text-center p-6 rounded-2xl bg-red-500/10 border-2 border-red-500/30" data-testid="player-timed-out">
                <Clock className="mx-auto text-red-400 mb-2" size={40} />
                <p className="text-red-400 text-xl font-bold">Time's Up!</p>
                <p className="text-zinc-500 text-sm mt-1">Waiting for the host...</p>
              </div>
            ) : (
              <>
                {q.question_type === "true_false" ? (
              <div className="flex gap-3">
                <Button onClick={() => handleDirectAnswer("True")} className="flex-1 h-16 text-xl bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30" data-testid="answer-true">True</Button>
                <Button onClick={() => handleDirectAnswer("False")} className="flex-1 h-16 text-xl bg-red-500/20 border-2 border-red-500/40 text-red-300 hover:bg-red-500/30" data-testid="answer-false">False</Button>
              </div>
            ) : q.question_type === "multiple_choice" && q.options ? (
              <div className="space-y-3">
                {q.options.map((opt, i) => {
                  const colors = [
                    "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30",
                    "bg-blue-500/20 border-blue-500/40 text-blue-300 hover:bg-blue-500/30",
                    "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30",
                    "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30",
                  ];
                  return (
                    <Button key={i} onClick={() => handleDirectAnswer(opt)} className={`w-full h-14 text-lg border-2 justify-start px-4 ${colors[i] || colors[0]}`} data-testid={`answer-option-${i}`}>
                      {opt}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="flex gap-2">
                <Input value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmitAnswer()} placeholder="Type your answer..." className="bg-zinc-900 border-white/10 text-white text-lg h-14" autoFocus data-testid="answer-text-input" />
                <Button onClick={handleSubmitAnswer} disabled={submitting || !answer.trim()} className="h-14 px-6 bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold" data-testid="submit-answer-btn">
                  <Send size={20} />
                </Button>
              </div>
            )}
              </>
            )}
          </div>
        )}

        {/* Answered - waiting */}
        {isQuestion && state.has_answered && (
          <div className="text-center">
            <CheckCircle className="mx-auto text-emerald-400 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">Answer Locked In!</h2>
            <p className="text-zinc-400">Your answer: <span className="text-white font-medium">{state.my_answer}</span></p>
          </div>
        )}

        {/* Answer Reveal */}
        {isReveal && (
          <div className="text-center w-full max-w-md">
            <div className="mb-6 p-6 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/30">
              <p className="text-zinc-400 text-sm mb-1">Correct Answer</p>
              <p className="text-emerald-400 text-3xl font-bold">{state.correct_answer}</p>
            </div>
            {state.was_correct !== undefined && (
              <div className={`p-4 rounded-xl ${state.was_correct ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                {state.was_correct ? (
                  <div className="flex items-center justify-center gap-2 text-emerald-400">
                    <CheckCircle size={24} />
                    <span className="text-xl font-bold">+{state.score_awarded} points!</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-red-400">
                    <XCircle size={24} />
                    <span className="text-xl font-bold">{state.score_awarded < 0 ? `${state.score_awarded} points` : "Not this time"}</span>
                  </div>
                )}
                {state.my_answer && <p className="text-zinc-400 text-sm mt-2">You answered: {state.my_answer}</p>}
              </div>
            )}
            {state.fun_fact && <p className="text-zinc-400 text-sm mt-4">{state.fun_fact}</p>}
          </div>
        )}

        {/* Scores / Finished */}
        {(isScores || isFinished) && state.scoreboard && (
          <div className="w-full max-w-md">
            {isFinished && (
              <div className="text-center mb-6">
                <Trophy className="mx-auto text-amber-400 mb-3" size={48} />
                <h2 className="text-3xl font-bold text-white">Game Over!</h2>
              </div>
            )}
            <div className="space-y-2">
              {state.scoreboard.map((p, idx) => (
                <div key={p.id} className={`flex items-center justify-between p-3 rounded-xl ${
                  p.id === playerId ? "bg-[#71E0DC]/10 border-2 border-[#71E0DC]/30" :
                  idx === 0 ? "bg-amber-500/5 border border-amber-500/20" :
                  "bg-zinc-900 border border-white/5"
                }`}>
                  <div className="flex items-center gap-3">
                    <span className={`font-bold ${idx === 0 ? "text-amber-400" : "text-zinc-500"}`}>#{idx + 1}</span>
                    <span className={`font-medium ${p.id === playerId ? "text-[#71E0DC]" : "text-white"}`}>{p.name}</span>
                    {p.id === playerId && <Badge className="bg-[#71E0DC]/20 text-[#71E0DC] text-xs">You</Badge>}
                  </div>
                  <span className="text-[#71E0DC] font-mono font-bold">{p.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerView;
