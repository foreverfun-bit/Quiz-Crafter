import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { PROFILE_VENUES_KEY, mergeProfileRecords, normalizeVenue, readLocalVenues, writeLocalVenues } from "../lib/venues";
import { loadHostSetupSettings } from "../lib/profileState";

// Replaces navigating to BuildSession.jsx's old "Session Setup" card for a
// brand-new event. Inserts the sessions row immediately, even with zero
// questions -- from that point on this event is a real, already-saved row
// the unified workspace (EventWorkspace/HostSession) can mutate in place,
// the same way every other phase of the workspace merge operates. A draft
// that doesn't exist in the DB yet doesn't fit that pattern at all, which is
// why this is a tiny standalone step rather than part of the workspace itself.
const NewEventModal = ({ onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [venueId, setVenueId] = useState("");
  const [venues, setVenues] = useState(() => readLocalVenues());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const metadata = data?.session?.user?.user_metadata || {};
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupVenues = Array.isArray(setupSettings.venues) ? setupSettings.venues.map(normalizeVenue) : [];
        const remoteVenues = Array.isArray(metadata[PROFILE_VENUES_KEY]) ? metadata[PROFILE_VENUES_KEY].map(normalizeVenue) : [];
        const merged = mergeProfileRecords([...setupVenues, ...remoteVenues], readLocalVenues(), normalizeVenue);
        if (!cancelled && merged.length) {
          setVenues(merged);
          writeLocalVenues(merged);
        }
      } catch (error) {
        console.warn("Venue sync unavailable:", error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedVenue = venues.find((venue) => venue.id === venueId);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return toast.error("Give the event a name");
    setSaving(true);
    try {
      const venueName = selectedVenue?.name || selectedVenue?.nightName || "";
      if (venueId) {
        const { error: venueError } = await supabase.from("venues").upsert({ id: venueId, user_id: user.id, name: venueName || "Untitled venue" }, { onConflict: "id" });
        if (venueError) throw venueError;
      }
      const { data, error } = await supabase.from("sessions").insert({
        user_id: user.id,
        name: trimmedName,
        session_name: trimmedName,
        source_type: "built",
        is_past: false,
        session_date: date || null,
        event_date: date || null,
        event_time: time || null,
        venue: venueName || null,
        venue_id: venueId || null,
        true_false_questions: [],
        multiple_choice_questions: [],
        written_questions: [],
        picture_questions: [],
        round_descriptions: [],
      }).select("id").single();
      if (error) throw error;
      navigate(`/session/${data.id}`);
    } catch (error) {
      console.error("Create event error:", error);
      toast.error(error.message || "Failed to create event");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close">
          <X size={18} />
        </button>
        <h2 className="mb-5 text-xl font-bold text-white">New Event</h2>
        <div className="space-y-4">
          <label className="block">
            <Label className="text-zinc-300">Event name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleCreate()} placeholder="e.g., Tuesday Night Trivia" className="mt-1 bg-zinc-950/50 border-white/10 text-white" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label className="text-zinc-300">Date</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 bg-zinc-950/50 border-white/10 text-white" />
            </label>
            <label className="block">
              <Label className="text-zinc-300">Start time</Label>
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1 bg-zinc-950/50 border-white/10 text-white" />
            </label>
          </div>
          <label className="block">
            <Label className="text-zinc-300">Venue</Label>
            <select value={venueId} onChange={(event) => setVenueId(event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950/50 border border-white/10 px-3 text-white">
              <option value="">No venue</option>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name || venue.nightName || "Untitled venue"}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="border-white/10 text-zinc-300 hover:text-white">Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={saving} className="gradient-btn">{saving ? "Creating..." : "Create Event"}</Button>
        </div>
      </div>
    </div>
  );
};

export default NewEventModal;
