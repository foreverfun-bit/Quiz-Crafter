import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Settings, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { findLiveGame } from "../lib/liveGame";
import BuildSession from "./BuildSession";
import HostSession from "./HostSession";
import EventSettingsModal from "../components/EventSettings/EventSettingsModal";

// The merged builder/host popout: one screen per event instead of separate
// /build/:id and /host-session/:id pages. Mounted at /session/:id, replacing
// SessionDetail.jsx there. Mode is derived from whether an active (non
// -"finished") live_games row exists for this session -- the same signal
// BuildSession's "Go Live" and HostSession's own mount effect already use
// via ensureLiveGame/findLiveGame -- not a new state machine on `sessions`.
//
// BuildSession and HostSession keep almost all of their internals; they're
// rendered here with the session id passed as a prop (falling back to their
// own useParams() when reached directly at their standalone routes, which
// still work), and their Go-Live / editBuild / End-Session actions flip
// `mode` below instead of navigating to a different page.
const EventWorkspace = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // null while checking, then "editor" | "live"
  const [settingsSession, setSettingsSession] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findLiveGame(id)
      .then((game) => { if (!cancelled) setMode(game ? "live" : "editor"); })
      .catch((error) => {
        console.warn("Live game lookup unavailable:", error);
        if (!cancelled) setMode("editor");
      });
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
          {mode === "live" ? (
            <HostSession sessionIdProp={id} onEditBuild={() => setMode("editor")} />
          ) : mode === "editor" ? (
            <BuildSession sessionIdProp={id} onGoLive={() => setMode("live")} />
          ) : null}
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
