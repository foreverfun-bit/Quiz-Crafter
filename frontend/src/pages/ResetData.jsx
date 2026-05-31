import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { profileKeys, saveProfileValue } from "../lib/profileState";

async function tryDelete(table, applyQuery) {
  try {
    const { error } = await applyQuery(supabase.from(table).delete());
    if (error) throw error;
    return null;
  } catch (error) {
    const message = error?.message || "Delete failed";
    if (/does not exist|schema cache|Could not find/i.test(message)) return null;
    return `${table}: ${message}`;
  }
}

async function fetchIds(table, userId) {
  try {
    const { data, error } = await supabase.from(table).select("id").eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((row) => row.id).filter(Boolean);
  } catch {
    return [];
  }
}

export default function ResetData() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const canReset = confirmation === "DELETE";

  const handleReset = async () => {
    if (!canReset) {
      toast.error("Type DELETE to confirm");
      return;
    }
    if (!user?.id) {
      toast.error("Please log in again before resetting data");
      return;
    }

    setResetting(true);
    try {
      const errors = [];
      const sessionIds = await fetchIds("sessions", user.id);
      const gameIds = await fetchIds("game_sessions", user.id);
      const liveGameIds = await fetchIds("live_games", user.id);

      let roundIds = [];
      if (sessionIds.length) {
        try {
          const { data } = await supabase.from("session_rounds").select("id").in("session_id", sessionIds);
          roundIds = (data || []).map((row) => row.id).filter(Boolean);
        } catch {
          roundIds = [];
        }
      }

      if (roundIds.length) errors.push(await tryDelete("session_questions", (query) => query.in("session_round_id", roundIds)));
      if (sessionIds.length) errors.push(await tryDelete("session_rounds", (query) => query.in("session_id", sessionIds)));
      if (gameIds.length) {
        errors.push(await tryDelete("game_answers", (query) => query.in("game_id", gameIds)));
        errors.push(await tryDelete("game_players", (query) => query.in("game_id", gameIds)));
      }
      if (liveGameIds.length) {
        errors.push(await tryDelete("player_answers", (query) => query.in("game_id", liveGameIds)));
        errors.push(await tryDelete("players", (query) => query.in("game_id", liveGameIds)));
      }

      for (const table of [
        "questions",
        "sessions",
        "game_history",
        "game_sessions",
        "live_games",
        "games",
        "players",
        "game_players",
        "player_answers",
        "game_answers",
        "category_preferences",
        "categories",
        "disliked_categories",
        "rejected_categories",
      ]) {
        errors.push(await tryDelete(table, (query) => query.eq("user_id", user.id)));
      }

      const realErrors = errors.filter(Boolean);
      if (realErrors.length) {
        throw new Error(realErrors[0]);
      }

      localStorage.removeItem("trivia-flex-round-builder-state-v3");
      localStorage.removeItem("trivia-flex-round-builder-state-v2");
      localStorage.removeItem("quiz-crafter-category-preferences");
      localStorage.removeItem("quiz-crafter-rejected-ai-questions");
      await Promise.allSettled(Object.values(profileKeys).map((key) => saveProfileValue(key, null)));

      toast.success("Trivia data cleared. Fresh start ready.");
      navigate("/");
    } catch (error) {
      console.error("Reset data error:", error);
      toast.error(error.message || "Failed to reset data");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto animate-fade-in" data-testid="reset-data-page">
      <Card className="glass-card border-red-500/30">
        <CardHeader>
          <div className="w-12 h-12 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-3">
            <AlertTriangle className="text-red-300" size={24} />
          </div>
          <CardTitle className="text-white text-2xl">Reset Trivia Data</CardTitle>
          <CardDescription className="text-zinc-400">
            This clears your saved questions, imported sessions, built sessions, game history, category preferences, and builder drafts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-md border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
            This cannot be undone. Your login account stays intact, but your trivia content starts over.
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Type DELETE to confirm</label>
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="DELETE"
              className="bg-zinc-950/50 border-white/10 text-white"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/")} disabled={resetting} className="border-zinc-700 text-zinc-300">
              Cancel
            </Button>
            <Button onClick={handleReset} disabled={!canReset || resetting} className="bg-red-500/20 text-red-200 border border-red-500/40 hover:bg-red-500/30">
              {resetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2" size={16} />}
              Reset Everything
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
