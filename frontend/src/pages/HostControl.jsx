import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Play,
  SkipForward,
  Eye,
  Trophy,
  Users,
  CheckCircle,
  XCircle,
  ChevronRight,
  Square,
  Edit3,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const HostControl = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [editingScore, setEditingScore] = useState(null);
  const [editScore, setEditScore] = useState("");
  const wsRef = useRef(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await api.get(`/games/${gameId}/host`);
      setState(res.data);
    } catch {
      toast.error("Game not found");
      navigate("/");
    } finally {
      setLoading(false);
    }
  }, [gameId, navigate]);

  useEffect(() => {
    fetchState();

    const token = localStorage.getItem("token");
    const wsUrl = API_URL.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/ws/game/${gameId}?role=host&token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "init" || msg.type === "player_joined" || msg.type === "answer_submitted" || msg.type === "score_updated") {
        fetchState();
      }
    };

    ws.onclose = () => {};
    ws.onerror = () => {};

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, [gameId, fetchState]);

  const handleAction = async (endpoint) => {
    setActionLoading(true);
    try {
      const res = await api.post(`/games/${gameId}/${endpoint}`);
      setState(res.data);
    } catch (err) {
      toast.error("Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOverride = async (playerId, questionIndex, isCorrect, score) => {
    try {
      const res = await api.post(`/games/${gameId}/override`, {
        player_id: playerId,
        question_index: questionIndex,
        is_correct: isCorrect,
        score: parseInt(score),
      });
      setState(res.data);
      setEditingScore(null);
      toast.success("Score updated");
    } catch {
      toast.error("Failed to update score");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading game...</div>
      </div>
    );
  }

  if (!state) return null;

  const players = Object.entries(state.players || {});
  const isLobby = state.status === "lobby";
  const isQuestion = state.status === "question";
  const isReveal = state.status === "answer_reveal";
  const isScores = state.status === "scores";
  const isFinished = state.status === "finished";
  const currentQ = state.current_question;
  const answers = state.answers || {};
  const progressPct = state.total_questions > 0 ? ((state.current_index + 1) / state.total_questions) * 100 : 0;

  return (
    <div className="min-h-screen bg-zinc-950 p-4 lg:p-6" data-testid="host-control">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{state.session_name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge className="bg-[#71E0DC]/20 text-[#71E0DC] text-lg px-3 py-1 font-mono">
              Code: {state.code}
            </Badge>
            <Badge className="bg-zinc-800 text-zinc-300">
              <Users size={14} className="mr-1" /> {players.length} players
            </Badge>
            {!isLobby && (
              <Badge className="bg-zinc-800 text-zinc-300">
                Q {state.current_index + 1} / {state.total_questions}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(`/present/${state.code}`, "_blank")}
            className="border-[#AEB2EF]/30 text-[#AEB2EF]"
            data-testid="open-presentation-btn"
          >
            <Eye size={16} className="mr-2" /> Presentation
          </Button>
          {!isFinished && (
            <Button
              variant="outline"
              onClick={() => handleAction("end")}
              className="border-red-500/30 text-red-400"
              data-testid="end-game-btn"
            >
              <Square size={16} className="mr-2" /> End
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {!isLobby && (
        <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-6">
          <div className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] h-1.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Lobby */}
          {isLobby && (
            <Card className="bg-zinc-900/80 border-white/10">
              <CardContent className="p-8 text-center">
                <h2 className="text-3xl font-bold text-white mb-2">Waiting for Players</h2>
                <p className="text-zinc-400 mb-6">
                  Share code <span className="text-[#71E0DC] font-mono text-2xl font-bold">{state.code}</span> with your players
                </p>
                <div className="flex justify-center mb-6">
                  <div className="bg-white p-3 rounded-xl" data-testid="host-qr-code">
                    <QRCodeSVG
                      value={`${window.location.origin}/join?code=${state.code}`}
                      size={160}
                      level="H"
                    />
                  </div>
                </div>
                <p className="text-zinc-500 text-sm mb-6">Players can scan this QR code to join</p>
                <Button
                  onClick={() => handleAction("next")}
                  disabled={actionLoading || players.length === 0}
                  className="h-14 px-8 text-lg bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold"
                  data-testid="start-game-btn"
                >
                  <Play size={20} className="mr-2" /> Start Game
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Current Question */}
          {currentQ && !isLobby && !isFinished && (
            <Card className="bg-zinc-900/80 border-white/10">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Badge className="bg-zinc-800 text-zinc-300">{currentQ.type_label} - {currentQ.category}</Badge>
                  <span className="text-zinc-500 text-sm">{state.answers_count || 0} / {players.length} answered</span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-white text-xl font-medium mb-4">{currentQ.question}</p>

                {currentQ.image_url && (
                  <img
                    src={currentQ.image_url.startsWith("/api") ? `${API_URL}${currentQ.image_url}` : currentQ.image_url}
                    alt="Question"
                    className="max-w-sm rounded-lg border border-white/10 mb-4"
                  />
                )}

                {currentQ.options && (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {currentQ.options.map((opt, i) => (
                      <div key={i} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm">{opt}</div>
                    ))}
                  </div>
                )}

                {(isReveal || isScores) && (
                  <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <p className="text-emerald-400 font-medium">Answer: {currentQ.answer}</p>
                    {currentQ.fun_fact && <p className="text-zinc-400 text-sm mt-1">{currentQ.fun_fact}</p>}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-6">
                  {isQuestion && (
                    <Button
                      onClick={() => handleAction("reveal")}
                      disabled={actionLoading}
                      className="bg-amber-500 hover:bg-amber-600 text-zinc-900 font-bold"
                      data-testid="reveal-answer-btn"
                    >
                      <Eye size={16} className="mr-2" /> Reveal Answer
                    </Button>
                  )}
                  {isReveal && (
                    <>
                      <Button
                        onClick={() => handleAction("scores")}
                        disabled={actionLoading}
                        className="bg-[#AEB2EF] hover:bg-[#AEB2EF]/90 text-zinc-900 font-bold"
                        data-testid="show-scores-btn"
                      >
                        <Trophy size={16} className="mr-2" /> Show Scores
                      </Button>
                      <Button
                        onClick={() => handleAction("next")}
                        disabled={actionLoading}
                        className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold"
                        data-testid="next-question-btn"
                      >
                        <SkipForward size={16} className="mr-2" /> Next Question
                      </Button>
                    </>
                  )}
                  {isScores && (
                    <Button
                      onClick={() => handleAction("next")}
                      disabled={actionLoading}
                      className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold"
                      data-testid="next-question-btn"
                    >
                      <ChevronRight size={16} className="mr-2" /> Next Question
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Player Answers (visible after reveal) */}
          {(isReveal || isScores) && Object.keys(answers).length > 0 && (
            <Card className="bg-zinc-900/80 border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-white text-lg">Player Answers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(answers).map(([pid, ans]) => {
                    const player = state.players[pid];
                    if (!player) return null;
                    return (
                      <div key={pid} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 border border-white/5">
                        <div className="flex items-center gap-3">
                          {ans.is_correct ? (
                            <CheckCircle size={18} className="text-emerald-400" />
                          ) : (
                            <XCircle size={18} className="text-red-400" />
                          )}
                          <span className="text-white font-medium">{player.name}</span>
                          <span className="text-zinc-400 text-sm">{ans.answer}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {editingScore === pid ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editScore}
                                onChange={(e) => setEditScore(e.target.value)}
                                className="w-16 h-8 bg-zinc-950 border-white/10 text-white text-center text-sm"
                                type="number"
                              />
                              <Button size="sm" variant="ghost" onClick={() => handleOverride(pid, state.current_index, parseInt(editScore) > 0, parseInt(editScore) || 0)} className="h-8 text-emerald-400">
                                <CheckCircle size={14} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingScore(null)} className="h-8 text-zinc-500">
                                <XCircle size={14} />
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Badge className={ans.is_correct ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}>
                                +{ans.score_awarded}
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => { setEditingScore(pid); setEditScore(String(ans.score_awarded)); }}
                                className="h-8 text-zinc-500 hover:text-white"
                                data-testid={`override-score-${pid}`}
                              >
                                <Edit3 size={14} />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Finished */}
          {isFinished && (
            <Card className="bg-zinc-900/80 border-white/10">
              <CardContent className="p-8 text-center">
                <Trophy className="mx-auto text-amber-400 mb-4" size={48} />
                <h2 className="text-3xl font-bold text-white mb-2">Game Over!</h2>
                <p className="text-zinc-400 mb-6">Final scores are displayed</p>
                <Button onClick={() => navigate("/")} className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold">
                  Back to Dashboard
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: Players & Scores */}
        <div>
          <Card className="bg-zinc-900/80 border-white/10 sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Users size={18} /> Players ({players.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {players.length === 0 ? (
                <p className="text-zinc-500 text-sm">Waiting for players to join...</p>
              ) : (
                <div className="space-y-2">
                  {players
                    .sort((a, b) => b[1].score - a[1].score)
                    .map(([pid, player], idx) => (
                      <div key={pid} className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/50">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold w-6 text-center ${idx === 0 ? "text-amber-400" : idx === 1 ? "text-zinc-300" : idx === 2 ? "text-amber-700" : "text-zinc-500"}`}>
                            #{idx + 1}
                          </span>
                          <span className="text-white text-sm">{player.name}</span>
                        </div>
                        <span className="text-[#71E0DC] font-mono font-bold text-sm">{player.score}</span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default HostControl;
