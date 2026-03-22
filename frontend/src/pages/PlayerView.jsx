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
} from "lucide-react";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const PlayerView = () => {
  const { gameId } = useParams();
  const [state, setState] = useState(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const wsRef = useRef(null);

  const playerId = sessionStorage.getItem("player_id");
  const playerName = sessionStorage.getItem("player_name");

  useEffect(() => {
    if (!playerId || !gameId) return;

    const wsUrl = API_URL.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/ws/game/${gameId}?role=player&player_id=${playerId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "init") {
        setState(msg.data);
      } else if (msg.data) {
        // Refetch player state on any update
        fetchState();
      }
    };

    const fetchState = async () => {
      try {
        // Use websocket init for state - no direct player endpoint needed
        // The WS init sends the full player state
      } catch {}
    };

    ws.onclose = () => {};

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 30000);

    return () => { clearInterval(ping); ws.close(); };
  }, [gameId, playerId]);

  // Re-fetch state on WS updates by reconnecting
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
          // For non-init messages, reconnect to get fresh state
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

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    setSubmitting(true);

    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "submit_answer", answer: answer.trim() }));
        setState((prev) => prev ? { ...prev, has_answered: true, my_answer: answer.trim() } : prev);
        setAnswer("");
        toast.success("Answer submitted!");
      }
    } catch {
      toast.error("Failed to submit");
    } finally {
      setSubmitting(false);
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
        <Badge className="bg-[#71E0DC]/20 text-[#71E0DC] font-mono">{state.player_score} pts</Badge>
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

        {/* Question - waiting to answer */}
        {isQuestion && q && !state.has_answered && (
          <div className="w-full max-w-md">
            <div className="text-center mb-6">
              <Badge className="bg-zinc-800 text-zinc-300 mb-3">{q.type_label} - {q.category}</Badge>
              <p className="text-white text-xl font-medium">{q.question}</p>

              {q.image_url && (
                <img
                  src={q.image_url.startsWith("/api") ? `${API_URL}${q.image_url}` : q.image_url}
                  alt="Question"
                  className="mx-auto mt-4 max-h-48 rounded-lg border border-white/10"
                />
              )}
            </div>

            {/* Answer input based on type */}
            {q.question_type === "true_false" ? (
              <div className="flex gap-3">
                <Button
                  onClick={() => { setAnswer("True"); setTimeout(() => { handleSubmit(); }, 0); }}
                  className="flex-1 h-16 text-xl bg-emerald-500/20 border-2 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30"
                  data-testid="answer-true"
                >
                  True
                </Button>
                <Button
                  onClick={() => { setAnswer("False"); setTimeout(() => { handleSubmit(); }, 0); }}
                  className="flex-1 h-16 text-xl bg-red-500/20 border-2 border-red-500/40 text-red-300 hover:bg-red-500/30"
                  data-testid="answer-false"
                >
                  False
                </Button>
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
                    <Button
                      key={i}
                      onClick={() => {
                        setAnswer(opt);
                        // Submit directly
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                          wsRef.current.send(JSON.stringify({ type: "submit_answer", answer: opt }));
                          setState((prev) => prev ? { ...prev, has_answered: true, my_answer: opt } : prev);
                          toast.success("Answer submitted!");
                        }
                      }}
                      className={`w-full h-14 text-lg border-2 justify-start px-4 ${colors[i] || colors[0]}`}
                      data-testid={`answer-option-${i}`}
                    >
                      {opt}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="Type your answer..."
                  className="bg-zinc-900 border-white/10 text-white text-lg h-14"
                  autoFocus
                  data-testid="answer-text-input"
                />
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !answer.trim()}
                  className="h-14 px-6 bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold"
                  data-testid="submit-answer-btn"
                >
                  <Send size={20} />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Answered - waiting */}
        {isQuestion && state.has_answered && (
          <div className="text-center">
            <CheckCircle className="mx-auto text-emerald-400 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">Answer Locked In!</h2>
            <p className="text-zinc-400">Your answer: <span className="text-white font-medium">{state.my_answer}</span></p>
            <p className="text-zinc-600 text-sm mt-2">Waiting for everyone...</p>
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
                    <span className="text-xl font-bold">Not this time</span>
                  </div>
                )}
                {state.my_answer && (
                  <p className="text-zinc-400 text-sm mt-2">You answered: {state.my_answer}</p>
                )}
              </div>
            )}

            {state.fun_fact && (
              <p className="text-zinc-400 text-sm mt-4">{state.fun_fact}</p>
            )}
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
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-3 rounded-xl ${
                    p.id === playerId ? "bg-[#71E0DC]/10 border-2 border-[#71E0DC]/30" :
                    idx === 0 ? "bg-amber-500/5 border border-amber-500/20" :
                    "bg-zinc-900 border border-white/5"
                  }`}
                >
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
