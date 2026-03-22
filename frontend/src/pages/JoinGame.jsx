import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Gamepad2, ArrowRight } from "lucide-react";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const JoinGame = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) setCode(urlCode);
  }, [searchParams]);

  const handleJoin = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error("Enter a game code and your name");
      return;
    }

    setJoining(true);
    try {
      const res = await fetch(`${API_URL}/api/games/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), player_name: name.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to join");
      }

      const data = await res.json();
      // Store player info in sessionStorage
      sessionStorage.setItem("player_id", data.player_id);
      sessionStorage.setItem("player_name", data.player_name);
      sessionStorage.setItem("game_id", data.game_id);

      navigate(`/play/${data.game_id}`);
    } catch (error) {
      toast.error(error.message || "Game not found");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#71E0DC] to-[#AEB2EF] flex items-center justify-center mx-auto mb-4">
            <Gamepad2 className="text-zinc-900" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">Join Trivia</h1>
          <p className="text-zinc-500 text-sm">Enter the code from your host</p>
        </div>

        <Card className="bg-zinc-900/80 border-white/10">
          <CardContent className="p-6 space-y-4">
            <div>
              <label className="text-zinc-400 text-sm block mb-1.5">Game Code</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder="1234"
                className="bg-zinc-950 border-white/10 text-white text-center text-3xl tracking-[0.5em] font-mono h-16"
                maxLength={4}
                inputMode="numeric"
                data-testid="game-code-input"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-sm block mb-1.5">Your Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder="Enter your name"
                className="bg-zinc-950 border-white/10 text-white text-lg h-12"
                maxLength={20}
                data-testid="player-name-input"
              />
            </div>
            <Button
              onClick={handleJoin}
              disabled={joining || !code.trim() || !name.trim()}
              className="w-full h-12 text-lg bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold hover:opacity-90"
              data-testid="join-game-btn"
            >
              {joining ? "Joining..." : <>Join Game <ArrowRight className="ml-2" size={20} /></>}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default JoinGame;
