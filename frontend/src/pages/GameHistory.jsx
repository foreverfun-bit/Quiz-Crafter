import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Trophy,
  Users,
  Calendar,
  ArrowLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export const GameHistory = () => {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await api.get("/game-history");
        setGames(res.data);
      } catch {
        toast.error("Failed to load game history");
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="text-[#71E0DC] animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in" data-testid="game-history-page">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          Game <span className="gradient-text">History</span>
        </h1>
        <p className="text-zinc-500">View results from past live games</p>
      </div>

      {games.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <Trophy className="mx-auto text-zinc-600 mb-4" size={48} />
            <p className="text-zinc-400 text-lg">No games played yet</p>
            <p className="text-zinc-600 text-sm mt-1">Host a live game from any session to see results here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {games.map((game) => (
            <Card
              key={game.id}
              className="glass-card hover:border-[#71E0DC]/30 transition-all cursor-pointer"
              onClick={() => navigate(`/game-history/${game.id}`)}
              data-testid={`game-history-item-${game.game_id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white font-semibold text-lg">{game.session_name}</h3>
                      <Badge className="bg-zinc-800 text-zinc-400 text-xs">Code: {game.code}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-500">
                      <span className="flex items-center gap-1"><Users size={14} /> {game.player_count} players</span>
                      <span className="flex items-center gap-1"><Trophy size={14} /> {game.total_questions} questions</span>
                      <span className="flex items-center gap-1">
                        <Calendar size={14} />
                        {new Date(game.ended_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    {/* Top 3 */}
                    {game.scoreboard && game.scoreboard.length > 0 && (
                      <div className="flex items-center gap-3 mt-2">
                        {game.scoreboard.slice(0, 3).map((p, i) => (
                          <Badge key={p.id} className={`text-xs ${i === 0 ? "bg-amber-500/20 text-amber-300" : i === 1 ? "bg-zinc-600/20 text-zinc-300" : "bg-amber-800/20 text-amber-600"}`}>
                            #{i + 1} {p.name}: {p.score}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="text-zinc-600" size={20} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default function GameHistoryDetail() {
  const { historyId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await api.get(`/game-history/${historyId}`);
        setGame(res.data);
      } catch {
        toast.error("Game not found");
        navigate("/game-history");
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [historyId, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="text-[#71E0DC] animate-spin" size={32} />
      </div>
    );
  }

  if (!game) return null;

  const scoreboard = game.scoreboard || [];
  const questions = game.question_results || [];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-fade-in" data-testid="game-history-detail">
      <Button variant="ghost" onClick={() => navigate("/game-history")} className="text-zinc-400 hover:text-white mb-4" data-testid="back-to-history">
        <ArrowLeft size={18} className="mr-2" /> Back to History
      </Button>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">{game.session_name}</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <Badge className="bg-zinc-800 text-zinc-400">Code: {game.code}</Badge>
          <span><Users size={14} className="inline mr-1" />{game.player_count} players</span>
          <span>{game.total_questions} questions</span>
          <span>{new Date(game.ended_at).toLocaleString()}</span>
        </div>
      </div>

      {/* Scoreboard */}
      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2"><Trophy size={20} className="text-amber-400" /> Final Scoreboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {scoreboard.map((player, idx) => (
              <div key={player.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50" data-testid={`scoreboard-player-${idx}`}>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold w-8 text-center ${idx === 0 ? "text-amber-400" : idx === 1 ? "text-zinc-300" : idx === 2 ? "text-amber-700" : "text-zinc-500"}`}>
                    #{idx + 1}
                  </span>
                  <span className="text-white font-medium">{player.name}</span>
                </div>
                <span className="text-[#71E0DC] font-mono font-bold text-lg">{player.score} pts</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Question Breakdown */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Question Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[600px]">
            <div className="space-y-4 pr-4">
              {questions.map((q, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-zinc-800/30 border border-white/5" data-testid={`question-result-${idx}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-zinc-700 text-zinc-300 text-xs">Q{idx + 1}</Badge>
                    <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">{q.type_label}</Badge>
                    <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">{q.category}</Badge>
                    <Badge className="bg-amber-500/20 text-amber-300 text-xs">{q.points} pts</Badge>
                  </div>
                  <p className="text-white font-medium mb-1">{q.question}</p>
                  <p className="text-emerald-400 text-sm mb-3">Answer: {q.answer}</p>

                  {/* Player Answers */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {q.player_answers.map((pa) => (
                      <div key={pa.player_id} className={`p-2 rounded-lg text-xs ${pa.is_correct ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                        <div className="flex items-center gap-1 mb-0.5">
                          {pa.is_correct ? <CheckCircle size={10} className="text-emerald-400" /> : <XCircle size={10} className="text-red-400" />}
                          <span className="text-zinc-300 font-medium">{pa.player_name}</span>
                        </div>
                        <span className="text-zinc-500">{pa.answer}</span>
                        <span className={`ml-2 font-mono ${pa.score_awarded >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {pa.score_awarded >= 0 ? "+" : ""}{pa.score_awarded}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
