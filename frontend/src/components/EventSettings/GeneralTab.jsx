import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";

const toDateInputValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

// event_time is a plain "HH:MM" 24h string, same convention already used
// for venues.startTime in ../../lib/venues.js -- no separate formatting
// helper needed, just bind it straight to an <input type="time">.
const GeneralTab = ({ session, onUpdateSession }) => {
  const [name, setName] = useState(session.name || session.session_name || "");
  const [startDate, setStartDate] = useState(toDateInputValue(session.session_date || session.event_date));
  const [startTime, setStartTime] = useState(session.event_time || "");
  const [description, setDescription] = useState(session.description || "");
  const [rules, setRules] = useState(session.rules || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const finalName = name.trim() || "Untitled Session";
    setSaving(true);
    try {
      const patch = {
        name: finalName,
        session_name: finalName,
        session_date: startDate || null,
        event_time: startTime || null,
        description: description || null,
        rules: rules || null,
      };
      const { error } = await supabase.from("sessions").update(patch).eq("id", session.id);
      if (error) throw error;
      onUpdateSession(patch);
      toast.success("Event details saved");
    } catch (error) {
      console.error("Save event settings error:", error);
      toast.error(error.message || "Failed to save event details");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Event name" className="bg-zinc-950/50 border-white/10 text-white" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">Start Date</span>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-zinc-950/50 border-white/10 text-white" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">Start Time</span>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-zinc-950/50 border-white/10 text-white" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">Description</span>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Team Trivia Week #7" className="min-h-[80px] bg-zinc-950/50 border-white/10 text-white" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">Rules</span>
        <Textarea value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Anything you want to remind players or yourself of before the event starts" className="min-h-[100px] bg-zinc-950/50 border-white/10 text-white" />
      </label>
      <div className="flex justify-end pt-1">
        <Button onClick={handleSave} disabled={saving} className="gradient-btn">
          {saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
          Save
        </Button>
      </div>
    </div>
  );
};

export default GeneralTab;
