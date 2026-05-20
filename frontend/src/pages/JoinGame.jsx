import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { Gamepad2, ArrowRight } from "lucide-react";

const JoinGame = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState(searchParams.get("session") || "");

  useEffect(() => {
    const linkedSession = searchParams.get("session");
    if (linkedSession) navigate(`/play-session/${linkedSession}`, { replace: true });
  }, [navigate, searchParams]);

  const handleJoin = () => {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      toast.error("Enter or paste a join link");
      return;
    }

    try {
      const maybeUrl = trimmed.includes("/") ? new URL(trimmed) : null;
      const sessionFromUrl = maybeUrl?.searchParams.get("session") || maybeUrl?.pathname.match(/\/play-session\/([^/]+)/)?.[1];
      if (sessionFromUrl) {
        navigate(`/play-session/${sessionFromUrl}`);
        return;
      }
    } catch {
      // Fall through and treat the value as a session id.
    }

    navigate(`/play-session/${trimmed}`);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#71E0DC] to-[#AEB2EF] flex items-center justify-center mx-auto mb-4">
            <Gamepad2 className="text-zinc-900" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">Join Trivia</h1>
          <p className="text-zinc-500 text-sm">Scan the host QR code or paste the join link</p>
        </div>

        <Card className="bg-zinc-900/80 border-white/10">
          <CardContent className="p-6 space-y-4">
            <div>
              <label className="text-zinc-400 text-sm block mb-1.5">Join Link or Session ID</label>
              <Input
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleJoin()}
                placeholder="Paste join link"
                className="bg-zinc-950 border-white/10 text-white text-base h-12"
                data-testid="join-session-input"
              />
            </div>
            <Button
              onClick={handleJoin}
              disabled={!sessionId.trim()}
              className="w-full h-12 text-lg bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold hover:opacity-90"
              data-testid="join-game-btn"
            >
              Continue <ArrowRight className="ml-2" size={20} />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default JoinGame;
