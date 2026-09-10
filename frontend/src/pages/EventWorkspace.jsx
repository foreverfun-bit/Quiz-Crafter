import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Settings, X, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { findLiveGame } from "../lib/liveGame";
import HostSession from "./HostSession";
import EventSettingsModal from "../components/EventSettings/EventSettingsModal";

// The merged builder/host popout: one screen per event instead of separate
// /build/:id and /host-session/:id pages. Mounted at /session/:id, replacing
// SessionDetail.jsx there. HostSession now owns both editing (the question
// card list) and hosting in one always-mounted tree -- there is no more
// separate "editor" component to switch to (see Sub-phase 2b: the earlier
// mode-toggle between embedded BuildSession/HostSession still looked like
// two different screens swapping, which is exactly what the unified view was
// meant to replace). BuildSession stays reachable at its own /build/:id
// route for now; a card's "Advanced Edit" entry point back into it is a
// follow-up, not part of this pass.
//
// What HostSession does need up front is whether the event has actually
// been opened yet (initialEventOpen) -- naively trusting "does a
// non-finished live_games row exist" isn't enough: ending a real session
// never used to mark that row finished (fixed in the same change that added
// this check, see endSession() in HostSession.jsx), so every session ever
// hosted even once would otherwise look "live" forever. Two guards fix that:
// - A session already marked is_past (fully hosted before) always opens
//   already-open, so its cards show as completed/reviewable immediately.
// - A live_games row from an abandoned Test Run (is_test: true) never
//   counts as "open" either -- only a real, still-open game does.
const EventWorkspace = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [initialEventOpen, setInitialEventOpen] = useState(null); // null while checking, then boolean
  const [settingsSession, setSettingsSession] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionRow, error: sessionError } = await supabase.from("sessions").select("is_past").eq("id", id).single();
        if (sessionError) throw sessionError;
        if (sessionRow?.is_past) { if (!cancelled) setInitialEventOpen(true); return; }
        const game = await findLiveGame(id);
        if (!cancelled) setInitialEventOpen(Boolean(game && !game.is_test));
      } catch (error) {
        console.warn("Live game lookup unavailable:", error);
        if (!cancelled) setInitialEventOpen(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // A lightweight fetch of its own, used only for the Event Settings modal --
  // BuildSession/HostSession each already load the full session independently,
  // no need to share state with them for this.
  const openSettings = async () => {
    try {
      const { data, error } = await supabase.from("sessions").select("*").eq("id", id).single();
      if (error) throw error;
      setSettingsSession(data);
      setSettingsOpen(true);
    } catch (error) {
      console.error("Load event settings error:", error);
    }
  };

  const close = () => navigate("/past-sessions");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 lg:p-6">
      <div className="relative flex h-full w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#09090B] shadow-2xl shadow-black/60">
        <div className="absolute right-3 top-3 z-50 flex items-center gap-2">
          <button
            type="button"
            onClick={openSettings}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-zinc-950/80 text-zinc-400 hover:text-white"
            aria-label="Event settings"
            data-testid="event-workspace-settings-btn"
          >
            <Settings size={17} />
          </button>
          <button
            type="button"
            onClick={close}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-zinc-950/80 text-zinc-400 hover:text-white"
            aria-label="Close event"
            data-testid="close-event-workspace-btn"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {initialEventOpen === null ? (
            <div className="flex h-full items-center justify-center"><Loader2 className="text-[#71E0DC] animate-spin" size={34} /></div>
          ) : (
            <HostSession sessionIdProp={id} initialEventOpen={initialEventOpen} />
          )}
        </div>
      </div>
      {settingsOpen && settingsSession && (
        <EventSettingsModal
          session={settingsSession}
          onClose={() => setSettingsOpen(false)}
          onUpdateSession={(patch) => setSettingsSession((prev) => ({ ...prev, ...patch }))}
        />
      )}
    </div>
  );
};

export default EventWorkspace;
