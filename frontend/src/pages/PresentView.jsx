import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Trophy, Users, CheckCircle, HelpCircle, Image, List, MessageSquare, Coins, Timer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCountdown } from "../hooks/useCountdown";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const typeIcons = {
  true_false: CheckCircle,
  multiple_choice: List,
  written: MessageSquare,
  picture: Image,
};

const PresentView = () => {
  const { code } = useParams();
  const [state, setState] = useState(null);
  const [gameId, setGameId] = useState(null);
  const wsRef = useRef(null);
  const countdown = useCountdown(state?.timer_end_at);

  // Find game by code first
  useEffect(() => {
    const findGame = async () => {
      try {
        const res = await fetch(`${API_URL}/api/games/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, player_name: "__presentation__" }),
        });
        if (res.ok) {
          const data = await res.json();
          setGameId(data.game_id);
        }
      } catch {}
    };
    findGame();
  }, [code]);

  useEffect(() => {
    if (!gameId) return;

    const fetchState = async () => {
      try {
        const res = await fetch(`${API_URL}/api/games/${gameId}/present`);
        if (res.ok) setState(await res.json());
      } catch {}
    };
    fetchState();

    const wsUrl = API_URL.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/ws/game/${gameId}?role=presentation`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.data) setState(msg.data);
    };

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 30000);

    return () => { clearInterval(ping); ws.close(); };
  }, [gameId]);

  if (!state) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 text-2xl">Connecting...</div>
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
  const TypeIcon = q ? (typeIcons[q.question_type] || HelpCircle) : HelpCircle;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col" data-testid="present-view">
      {/* Top bar */}
      <div className="px-8 py-4 flex items-center justify-between border-b border-white/5">
        <h1 className="text-xl font-bold text-white">{state.session_name}</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-zinc-400">
            <Users size={18} />
            <span>{state.players_count} players</span>
          </div>
          {state.current_index >= 0 && (
            <span className="text-zinc-500">Q {state.current_index + 1} / {state.total_questions}</span>
          )}
          {countdown !== null && countdown > 0 && (isQuestion || isWagering) && (
            <div className={`flex items-center gap-2 font-mono font-bold text-xl ${countdown <= 5 ? "text-red-400 animate-pulse" : countdown <= 10 ? "text-amber-400" : "text-[#71E0DC]"}`} data-testid="present-countdown">
              <Timer size={20} />
              {countdown}
            </div>
          )}
          {countdown === 0 && isQuestion && (
            <span className="text-red-400 font-bold text-xl animate-pulse" data-testid="present-times-up">TIME'S UP!</span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-8">
        {/* Lobby */}
        {isLobby && (
          <div className="text-center">
            <p className="text-zinc-400 text-2xl mb-4">Join at</p>
            <p className="text-white text-xl mb-6">{window.location.origin}/join</p>
            <div className="flex items-center justify-center gap-12 mb-8">
              <div className="text-[#71E0DC] text-[10rem] font-mono font-bold leading-none tracking-[0.3em]">
                {state.code}
              </div>
              <div className="bg-white p-4 rounded-2xl" data-testid="join-qr-code">
                <QRCodeSVG
                  value={`${window.location.origin}/join?code=${state.code}`}
                  size={200}
                  level="H"
                />
              </div>
            </div>
            <p className="text-zinc-500 text-lg mb-6">Scan QR code or enter the code above</p>
            <div className="flex flex-wrap justify-center gap-3">
              {state.player_names?.map((name, i) => (
                <span key={i} className="px-4 py-2 rounded-full bg-zinc-800 text-white text-lg animate-fade-in">
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Wagering Phase */}
        {isWagering && q && (
          <div className="w-full max-w-4xl text-center" data-testid="present-wagering">
            <div className="flex items-center justify-center gap-3 mb-6">
              <Coins className="text-purple-400" size={36} />
              <span className="text-purple-400 text-3xl font-bold">Wager Round</span>
            </div>

            <div className="flex items-center justify-center gap-3 mb-6">
              <Image className="text-[#71E0DC]" size={28} />
              <span className="text-[#71E0DC] text-xl font-medium">{q.type_label}</span>
              <span className="text-zinc-500 text-xl">-</span>
              <span className="text-zinc-400 text-xl">{q.category}</span>
            </div>

            {q.image_url && (
              <div className="mb-6 flex justify-center">
                <img
                  src={q.image_url.startsWith("/api") ? `${API_URL}${q.image_url}` : q.image_url}
                  alt="Question"
                  className="max-h-[40vh] rounded-2xl border-2 border-white/10"
                />
              </div>
            )}

            <h2 className="text-white text-4xl lg:text-5xl font-bold leading-tight mb-8">{q.question}</h2>

            <div className="mt-8 p-6 rounded-2xl bg-purple-500/10 border-2 border-purple-500/30">
              <p className="text-purple-300 text-2xl font-medium mb-2">Players are placing their wagers...</p>
              <p className="text-zinc-400 text-lg">{state.wagers_count || 0} / {state.players_count} wagered</p>
            </div>
          </div>
        )}

        {/* Question */}
        {isQuestion && q && (
          <div className="w-full max-w-4xl text-center">
            <div className="flex items-center justify-center gap-3 mb-6">
              <TypeIcon className="text-[#71E0DC]" size={28} />
              <span className="text-[#71E0DC] text-xl font-medium">{q.type_label}</span>
              <span className="text-zinc-500 text-xl">-</span>
              <span className="text-zinc-400 text-xl">{q.category}</span>
            </div>

            {q.image_url && (
              <div className="mb-6 flex justify-center">
                <img
                  src={q.image_url.startsWith("/api") ? `${API_URL}${q.image_url}` : q.image_url}
                  alt="Question"
                  className="max-h-[40vh] rounded-2xl border-2 border-white/10"
                />
              </div>
            )}

            <h2 className="text-white text-4xl lg:text-5xl font-bold leading-tight mb-8">{q.question}</h2>

            {/* Big countdown timer */}
            {countdown !== null && countdown > 0 && (
              <div className="flex justify-center mb-8" data-testid="present-timer-circle">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 ${
                  countdown <= 5 ? "border-red-500 text-red-400 animate-pulse" : countdown <= 10 ? "border-amber-500 text-amber-300" : "border-[#71E0DC] text-[#71E0DC]"
                }`}>
                  <span className="text-4xl font-mono font-black">{countdown}</span>
                </div>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex justify-center mb-8">
                <div className="px-8 py-3 rounded-full bg-red-500/20 border-2 border-red-500/40">
                  <span className="text-red-400 text-2xl font-bold animate-pulse">TIME'S UP!</span>
                </div>
              </div>
            )}

            {q.options && (
              <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
                {q.options.map((opt, i) => {
                  const colors = [
                    "bg-red-500/20 border-red-500/40 text-red-300",
                    "bg-blue-500/20 border-blue-500/40 text-blue-300",
                    "bg-amber-500/20 border-amber-500/40 text-amber-300",
                    "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
                  ];
                  return (
                    <div key={i} className={`px-6 py-4 rounded-xl border-2 text-xl font-medium ${colors[i] || colors[0]}`}>
                      {opt}
                    </div>
                  );
                })}
              </div>
            )}

            {q.question_type === "true_false" && (
              <div className="flex justify-center gap-6 mt-4">
                <div className="px-12 py-6 rounded-xl border-2 bg-emerald-500/20 border-emerald-500/40 text-emerald-300 text-3xl font-bold">True</div>
                <div className="px-12 py-6 rounded-xl border-2 bg-red-500/20 border-red-500/40 text-red-300 text-3xl font-bold">False</div>
              </div>
            )}

            <div className="mt-8 text-zinc-500 text-lg">
              {state.answers_count || 0} / {state.players_count} answered
            </div>
          </div>
        )}

        {/* Answer Reveal */}
        {isReveal && q && (
          <div className="w-full max-w-4xl text-center">
            <p className="text-zinc-400 text-xl mb-4">{q.question}</p>
            <div className="my-8 p-8 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/30">
              <p className="text-emerald-400 text-5xl font-bold">{state.correct_answer}</p>
            </div>
            {state.fun_fact && (
              <p className="text-zinc-400 text-lg mt-4">{state.fun_fact}</p>
            )}
          </div>
        )}

        {/* Scoreboard */}
        {(isScores || isFinished) && state.scoreboard && (
          <div className="w-full max-w-2xl">
            {isFinished && (
              <div className="text-center mb-8">
                <Trophy className="mx-auto text-amber-400 mb-4" size={64} />
                <h2 className="text-5xl font-bold text-white">Game Over!</h2>
              </div>
            )}
            {!isFinished && <h2 className="text-3xl font-bold text-white text-center mb-8">Scoreboard</h2>}
            <div className="space-y-3">
              {state.scoreboard.map((player, idx) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between p-5 rounded-xl transition-all ${
                    idx === 0 ? "bg-amber-500/10 border-2 border-amber-500/30" :
                    idx === 1 ? "bg-zinc-400/5 border-2 border-zinc-400/20" :
                    idx === 2 ? "bg-amber-700/10 border-2 border-amber-700/20" :
                    "bg-zinc-900 border border-white/5"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className={`text-2xl font-bold w-10 text-center ${
                      idx === 0 ? "text-amber-400" : idx === 1 ? "text-zinc-300" : idx === 2 ? "text-amber-700" : "text-zinc-600"
                    }`}>
                      #{idx + 1}
                    </span>
                    <span className="text-white text-2xl font-medium">{player.name}</span>
                  </div>
                  <span className="text-[#71E0DC] text-3xl font-mono font-bold">{player.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PresentView;
