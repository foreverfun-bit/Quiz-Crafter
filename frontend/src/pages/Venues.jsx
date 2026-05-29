import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { CalendarDays, Clock, ExternalLink, Globe, Instagram, MapPin, Palette, Plus, Save, Trash2, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { ACTIVE_VENUE_STORAGE_KEY, VENUES_STORAGE_KEY, defaultVenue, normalizeVenue, readActiveVenueId, readLocalVenues, writeActiveVenueId, writeLocalVenues, writeVenueBuildDraft } from "../lib/venues";

const metadataVenuesKey = "quiz_crafter_venues_v1";
const metadataActiveVenueKey = "quiz_crafter_active_venue_id";
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Varies"];
const formatTime = (value) => {
  if (!value) return "Time TBD";
  const [hours, minutes = "00"] = String(value).split(":");
  const date = new Date();
  date.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const updatedLabel = (value) => {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not saved yet" : `Updated ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
};

const Venues = () => {
  const navigate = useNavigate();
  const [venues, setVenues] = useState([]);
  const [activeVenueId, setActiveVenueId] = useState(readActiveVenueId);
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [form, setForm] = useState(() => normalizeVenue(defaultVenue));
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Loading");

  const selectedVenue = useMemo(() => venues.find((venue) => venue.id === selectedVenueId) || null, [venues, selectedVenueId]);
  const activeVenue = useMemo(() => venues.find((venue) => venue.id === activeVenueId) || null, [venues, activeVenueId]);

  useEffect(() => {
    const loadVenues = async () => {
      const localVenues = readLocalVenues();
      setVenues(localVenues);
      if (localVenues[0] && !selectedVenueId) {
        setSelectedVenueId(localVenues[0].id);
        setForm(normalizeVenue(localVenues[0]));
      }
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const remoteVenues = data?.user?.user_metadata?.[metadataVenuesKey];
        const remoteActive = data?.user?.user_metadata?.[metadataActiveVenueKey];
        const normalized = Array.isArray(remoteVenues) ? remoteVenues.map(normalizeVenue) : localVenues;
        setVenues(normalized);
        writeLocalVenues(normalized);
        if (remoteActive) {
          setActiveVenueId(remoteActive);
          writeActiveVenueId(remoteActive);
        }
        const firstVenue = normalized[0] || null;
        if (firstVenue && !selectedVenueId) {
          setSelectedVenueId(firstVenue.id);
          setForm(normalizeVenue(firstVenue));
        }
        setSyncStatus("Synced");
      } catch (error) {
        console.warn("Venue metadata sync unavailable:", error);
        setSyncStatus("Local only");
      }
    };
    loadVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistVenues = async (nextVenues, nextActiveVenueId = activeVenueId) => {
    writeLocalVenues(nextVenues);
    writeActiveVenueId(nextActiveVenueId);
    setVenues(nextVenues);
    setActiveVenueId(nextActiveVenueId);
    try {
      const { error } = await supabase.auth.updateUser({ data: { [metadataVenuesKey]: nextVenues, [metadataActiveVenueKey]: nextActiveVenueId } });
      if (error) throw error;
      localStorage.setItem(VENUES_STORAGE_KEY, JSON.stringify(nextVenues));
      localStorage.setItem(ACTIVE_VENUE_STORAGE_KEY, nextActiveVenueId || "");
      setSyncStatus("Synced");
    } catch (error) {
      console.warn("Venue metadata save unavailable:", error);
      setSyncStatus("Local only");
    }
  };

  const updateForm = (key, value) => setForm((current) => normalizeVenue({ ...current, [key]: value, updatedAt: new Date().toISOString() }));

  const createVenue = () => {
    const venue = normalizeVenue({ ...defaultVenue, name: "New Venue", nightName: "Trivia Night" });
    setForm(venue);
    setSelectedVenueId("");
  };

  const editVenue = (venue) => {
    setSelectedVenueId(venue.id);
    setForm(normalizeVenue(venue));
  };

  const saveVenue = async () => {
    const venue = normalizeVenue(form);
    if (!venue.name) return toast.error("Venue name is required");
    setSaving(true);
    const nextVenues = venues.some((item) => item.id === venue.id)
      ? venues.map((item) => item.id === venue.id ? venue : item)
      : [venue, ...venues];
    const nextActive = activeVenueId || venue.id;
    await persistVenues(nextVenues, nextActive);
    setSelectedVenueId(venue.id);
    setForm(venue);
    setSaving(false);
    toast.success("Venue saved");
  };

  const deleteVenue = async (venueId) => {
    const nextVenues = venues.filter((venue) => venue.id !== venueId);
    const nextActive = activeVenueId === venueId ? (nextVenues[0]?.id || "") : activeVenueId;
    await persistVenues(nextVenues, nextActive);
    if (selectedVenueId === venueId) {
      const nextSelected = nextVenues[0] || null;
      setSelectedVenueId(nextSelected?.id || "");
      setForm(normalizeVenue(nextSelected || defaultVenue));
    }
    toast.success("Venue removed");
  };

  const setAsActive = async (venueId) => {
    await persistVenues(venues, venueId);
    toast.success("Default venue set");
  };

  const startBuild = (venue) => {
    writeVenueBuildDraft(venue);
    navigate("/build");
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="venues-page">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Host Setup</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">Venues & Events</h1>
          <p className="text-zinc-500 mt-2">Save recurring trivia nights, default branding, house rules, socials, and build settings in one place.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge className={syncStatus === "Synced" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{syncStatus}</Badge>
          <Button onClick={createVenue} className="gradient-btn"><Plus size={16} className="mr-2" />New Venue</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <section className="space-y-4">
          {activeVenue && <Card className="glass-card border-[#71E0DC]/30 overflow-hidden"><CardContent className="p-0"><div className="p-5 border-b border-white/10 bg-[#071A1D]/50"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-[#71E0DC] font-bold">Default venue for new builds</p><h2 className="text-2xl font-black text-white mt-1 truncate">{activeVenue.name}</h2><p className="text-zinc-400">{activeVenue.nightName || "Trivia Night"} / {activeVenue.dayOfWeek} at {formatTime(activeVenue.startTime)}</p></div>{activeVenue.logoUrl && <img src={activeVenue.logoUrl} alt={activeVenue.name} className="h-16 w-16 rounded-lg bg-white object-contain p-1" />}</div></div><div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm"><Metric icon={Trophy} label="Rounds" value={activeVenue.roundCount} /><Metric icon={Users} label="Per round" value={activeVenue.questionsPerRound} /><Metric icon={Clock} label="Timer" value={`${activeVenue.defaultTimer}s`} /><Metric icon={Palette} label="Points" value={activeVenue.defaultPoints} /></div><div className="px-4 pb-4"><Button onClick={() => startBuild(activeVenue)} className="gradient-btn w-full">Build From Default Venue</Button></div></CardContent></Card>}
          {!venues.length && <Card className="glass-card"><CardContent className="p-8 text-center"><MapPin className="mx-auto text-[#71E0DC] mb-3" size={38} /><h2 className="text-xl font-bold text-white">No venues yet</h2><p className="text-zinc-500 mt-2 mb-4">Add your weekly spots once, then use them as defaults for future sessions.</p><Button onClick={createVenue} className="gradient-btn">Add First Venue</Button></CardContent></Card>}
          {venues.map((venue) => (
            <Card key={venue.id} className={`glass-card transition ${selectedVenueId === venue.id ? "border-[#71E0DC]/40" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-black text-white truncate">{venue.name}</h3>
                      {activeVenueId === venue.id && <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">Default</Badge>}
                    </div>
                    <p className="text-sm text-zinc-400 truncate">{venue.nightName || "Trivia Night"}</p>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-zinc-500">
                      <span className="flex items-center gap-2"><CalendarDays size={14} />{venue.dayOfWeek}</span>
                      <span className="flex items-center gap-2"><Clock size={14} />{formatTime(venue.startTime)}</span>
                      <span className="flex items-center gap-2"><Trophy size={14} />{venue.roundCount} rounds</span>
                      <span className="flex items-center gap-2"><Users size={14} />{venue.questionsPerRound} per round</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="rounded-full bg-zinc-900 px-2 py-1">{updatedLabel(venue.updatedAt)}</span>
                      {venue.website && <span className="rounded-full bg-zinc-900 px-2 py-1 flex items-center gap-1"><Globe size={11} />Website</span>}
                      {venue.instagram && <span className="rounded-full bg-zinc-900 px-2 py-1 flex items-center gap-1"><Instagram size={11} />Social</span>}
                      {venue.houseRules && <span className="rounded-full bg-zinc-900 px-2 py-1">Rules saved</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">{venue.logoUrl && <img src={venue.logoUrl} alt={venue.name} className="h-14 w-14 rounded-lg bg-white object-contain p-1" />}<div className="flex gap-1"><span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: venue.primaryColor }} /><span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: venue.accentColor }} /></div></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => editVenue(venue)} className="border-white/10 text-zinc-300 hover:text-white">Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => setAsActive(venue.id)} className="border-white/10 text-zinc-300 hover:text-white">Set Default</Button>
                  <Button size="sm" onClick={() => startBuild(venue)} className="bg-[#71E0DC] text-zinc-950 hover:bg-[#AEEBFF]">Start Build</Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteVenue(venue.id)} className="text-red-300 hover:text-red-200"><Trash2 size={15} /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <VenueEditor form={form} selectedVenue={selectedVenue} updateForm={updateForm} saveVenue={saveVenue} saving={saving} />
      </div>
    </div>
  );
};

const Metric = ({ icon: Icon, label, value }) => <div className="rounded-md border border-white/10 bg-zinc-950/50 p-3"><div className="flex items-center gap-2 text-zinc-500"><Icon size={14} /><span className="text-xs">{label}</span></div><p className="mt-1 text-lg font-black text-white">{value}</p></div>;

const VenueEditor = ({ form, selectedVenue, updateForm, saveVenue, saving }) => (
  <Card className="glass-card xl:sticky xl:top-6">
    <CardHeader><CardTitle className="text-white flex items-center gap-2"><MapPin className="text-[#71E0DC]" />{selectedVenue ? "Edit Venue" : "New Venue"}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4">
        <div className="flex items-center gap-4">
          {form.logoUrl ? <img src={form.logoUrl} alt={form.name || "Venue logo"} className="h-20 w-20 rounded-lg bg-white object-contain p-2" /> : <div className="h-20 w-20 rounded-lg border border-white/10 bg-zinc-900 flex items-center justify-center text-zinc-500"><MapPin size={28} /></div>}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Build preview</p>
            <h3 className="text-xl font-black text-white truncate">{form.name || "Venue name"}</h3>
            <p className="text-sm text-zinc-400 truncate">{form.nightName || "Trivia Night"} / {form.dayOfWeek} at {formatTime(form.startTime)}</p>
            <div className="mt-3 flex gap-2"><span className="h-5 w-12 rounded-full border border-white/20" style={{ backgroundColor: form.primaryColor }} /><span className="h-5 w-12 rounded-full border border-white/20" style={{ backgroundColor: form.accentColor }} /></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Venue name" value={form.name} onChange={(value) => updateForm("name", value)} placeholder="AJ's Bar" />
        <Field label="Trivia night name" value={form.nightName} onChange={(value) => updateForm("nightName", value)} placeholder="AJ's Trivia" />
        <label className="text-xs text-zinc-400">Day<select value={form.dayOfWeek} onChange={(event) => updateForm("dayOfWeek", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{weekdays.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
        <Field label="Start time" type="time" value={form.startTime} onChange={(value) => updateForm("startTime", value)} />
        <Field label="Address" value={form.address} onChange={(value) => updateForm("address", value)} placeholder="Street, city" />
        <Field label="Host name" value={form.hostName} onChange={(value) => updateForm("hostName", value)} placeholder="Julie" />
      </div>

      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4 space-y-3">
        <h3 className="font-bold text-white flex items-center gap-2"><Palette size={17} className="text-[#71E0DC]" />Default Branding</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Logo URL" value={form.logoUrl} onChange={(value) => updateForm("logoUrl", value)} placeholder="https://..." />
          <ColorField label="Primary" value={form.primaryColor} onChange={(value) => updateForm("primaryColor", value)} />
          <ColorField label="Accent" value={form.accentColor} onChange={(value) => updateForm("accentColor", value)} />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4 space-y-3">
        <h3 className="font-bold text-white flex items-center gap-2"><Trophy size={17} className="text-[#AEB2EF]" />Session Defaults</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Field label="Rounds" type="number" value={form.roundCount} onChange={(value) => updateForm("roundCount", value)} />
          <Field label="Per round" type="number" value={form.questionsPerRound} onChange={(value) => updateForm("questionsPerRound", value)} />
          <Field label="Points" type="number" value={form.defaultPoints} onChange={(value) => updateForm("defaultPoints", value)} />
          <Field label="Timer" type="number" value={form.defaultTimer} onChange={(value) => updateForm("defaultTimer", value)} />
          <Field label="Wager cap" type="number" value={form.defaultWagerLimit} onChange={(value) => updateForm("defaultWagerLimit", value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Facebook" value={form.facebook} onChange={(value) => updateForm("facebook", value)} placeholder="Page URL" />
        <Field label="Instagram" value={form.instagram} onChange={(value) => updateForm("instagram", value)} placeholder="Profile URL" />
        <Field label="Website" value={form.website} onChange={(value) => updateForm("website", value)} placeholder="Website URL" />
      </div>

      <TextArea label="House rules" value={form.houseRules} onChange={(value) => updateForm("houseRules", value)} placeholder="Wager rules, phone policy, tie breakers, venue-specific reminders..." />
      <TextArea label="Host notes" value={form.hostNotes} onChange={(value) => updateForm("hostNotes", value)} placeholder="Sponsor shoutouts, regular teams, categories that work here, categories to avoid..." />

      <div className="flex justify-between gap-3 flex-wrap">
        {form.website && <Button type="button" variant="outline" onClick={() => window.open(form.website, "_blank", "noopener,noreferrer")} className="border-white/10 text-zinc-300 hover:text-white"><ExternalLink size={16} className="mr-2" />Open Website</Button>}
        <Button onClick={saveVenue} disabled={saving} className="gradient-btn ml-auto"><Save size={16} className="mr-2" />{saving ? "Saving..." : "Save Venue"}</Button>
      </div>
    </CardContent>
  </Card>
);

const Field = ({ label, value, onChange, type = "text", placeholder = "" }) => <label className="text-xs text-zinc-400">{label}<input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label>;

const TextArea = ({ label, value, onChange, placeholder }) => <label className="text-xs text-zinc-400">{label}<textarea value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 min-h-24 w-full resize-none rounded-md bg-zinc-950 border border-white/10 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /></label>;

const ColorField = ({ label, value, onChange }) => <label className="text-xs text-zinc-400">{label}<div className="mt-1 flex h-10 rounded-md border border-white/10 bg-zinc-950 overflow-hidden focus-within:border-[#71E0DC]/60"><input type="color" value={value || "#71E0DC"} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 border-0 bg-transparent p-1" /><input value={value || ""} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-white outline-none" /></div></label>;

export default Venues;
