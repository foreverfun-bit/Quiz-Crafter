import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { CalendarDays, ClipboardList, MapPin, Plus, Save, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { ACTIVE_VENUE_STORAGE_KEY, PROFILE_ACTIVE_VENUE_KEY, PROFILE_VENUES_KEY, VENUES_STORAGE_KEY, defaultVenue, mergeProfileRecords, normalizeVenue, readActiveVenueId, readLocalVenues, recordsChanged, writeActiveVenueId, writeLocalVenues } from "../lib/venues";
import { loadHostSetupSettings, saveHostSetupSettings, updateUserMetadata } from "../lib/profileState";
import ShowTemplates from "./ShowTemplates";

const metadataVenuesKey = PROFILE_VENUES_KEY;
const metadataActiveVenueKey = PROFILE_ACTIVE_VENUE_KEY;
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Varies"];
const frequencies = [
  { value: "weekly", label: "Weekly" },
  { value: "bi_weekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
];
const monthlyWeeks = [
  { value: "first", label: "1st week" },
  { value: "second", label: "2nd week" },
  { value: "third", label: "3rd week" },
  { value: "fourth", label: "4th week" },
  { value: "last", label: "Last week" },
];
const timeZones = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];
const formatTime = (value) => {
  if (!value) return "Time TBD";
  const [hours, minutes = "00"] = String(value).split(":");
  const date = new Date();
  date.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const scheduleLabel = (venue) => {
  const frequency = frequencies.find((item) => item.value === venue?.frequency)?.label || "Weekly";
  const week = venue?.frequency === "monthly"
    ? `${monthlyWeeks.find((item) => item.value === venue?.monthlyWeek)?.label || "1st week"} / `
    : "";
  const zone = timeZones.find((item) => item.value === venue?.timeZone)?.label || "Central";
  return `${frequency} / ${week}${venue?.dayOfWeek || "Day TBD"} at ${formatTime(venue?.startTime)} ${zone}`;
};
const updatedLabel = (value) => {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not saved yet" : `Updated ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
};

const Venues = ({ initialTab = "venues" }) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [venues, setVenues] = useState([]);
  const [activeVenueId, setActiveVenueId] = useState(readActiveVenueId);
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [form, setForm] = useState(() => normalizeVenue(defaultVenue));
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Loading");

  const selectedVenue = useMemo(() => venues.find((venue) => venue.id === selectedVenueId) || null, [venues, selectedVenueId]);

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
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupVenues = Array.isArray(setupSettings.venues) ? setupSettings.venues.map(normalizeVenue) : [];
        const normalizedRemote = Array.isArray(remoteVenues) ? remoteVenues.map(normalizeVenue) : [];
        const normalized = mergeProfileRecords([...setupVenues, ...normalizedRemote], localVenues, normalizeVenue);
        setVenues(normalized);
        writeLocalVenues(normalized);
        const nextActive = normalized.some((venue) => venue.id === remoteActive)
          ? remoteActive
          : normalized.some((venue) => venue.id === activeVenueId)
            ? activeVenueId
            : normalized[0]?.id || "";
        if (nextActive) {
          setActiveVenueId(nextActive);
          writeActiveVenueId(nextActive);
        }
        const firstVenue = normalized[0] || null;
        if (firstVenue && !selectedVenueId) {
          setSelectedVenueId(firstVenue.id);
          setForm(normalizeVenue(firstVenue));
        }
        if (normalized.length && (recordsChanged(normalizedRemote, normalized) || remoteActive !== nextActive)) updateUserMetadata({ [metadataVenuesKey]: normalized, [metadataActiveVenueKey]: nextActive }).catch((error) => console.warn("Venue metadata repair unavailable:", error));
        if (normalized.length && recordsChanged(setupVenues, normalized)) {
          saveHostSetupSettings({ venues: normalized, activeVenueId: nextActive }).catch((error) => console.warn("Venue setup mirror unavailable:", error));
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
    const normalized = nextVenues.map(normalizeVenue);
    writeLocalVenues(normalized);
    writeActiveVenueId(nextActiveVenueId);
    setVenues(normalized);
    setActiveVenueId(nextActiveVenueId);
    try {
      await updateUserMetadata({ [metadataVenuesKey]: normalized, [metadataActiveVenueKey]: nextActiveVenueId });
      saveHostSetupSettings({ venues: normalized, activeVenueId: nextActiveVenueId }).catch((error) => console.warn("Venue setup mirror unavailable:", error));
      localStorage.setItem(VENUES_STORAGE_KEY, JSON.stringify(normalized));
      localStorage.setItem(ACTIVE_VENUE_STORAGE_KEY, nextActiveVenueId || "");
      setSyncStatus("Synced");
      return true;
    } catch (error) {
      console.warn("Venue metadata save unavailable:", error);
      try {
        await saveHostSetupSettings({ venues: normalized, activeVenueId: nextActiveVenueId });
        setSyncStatus("Synced");
        return true;
      } catch (mirrorError) {
        console.warn("Venue setup mirror unavailable:", mirrorError);
        setSyncStatus("Local only");
        return false;
      }
    }
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value, updatedAt: new Date().toISOString() }));

  const createVenue = () => {
    const venue = normalizeVenue({ ...defaultVenue, name: "New Venue" });
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
    const synced = await persistVenues(nextVenues, nextActive);
    setSelectedVenueId(venue.id);
    setForm(venue);
    setSaving(false);
    if (synced) toast.success("Venue saved to your account");
    else toast.error("Venue saved only on this browser. Account sync failed.");
  };

  const setDefaultVenue = async (venueId) => {
    await persistVenues(venues, venueId);
    toast.success("Set as default venue");
  };

  const deleteVenue = async (venueId) => {
    const venueToDelete = venues.find((venue) => venue.id === venueId);
    if (!window.confirm(`Delete ${venueToDelete?.name || "this venue"}? Its schedule and logistics info will be removed.`)) return;
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

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="venues-page">
      <div className="mb-5 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Host Setup</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">Venues & Templates</h1>
          <p className="text-zinc-500 mt-2">Keep venue logistics and show templates in one setup area without mixing them together.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge className={syncStatus === "Synced" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{syncStatus}</Badge>
          {activeTab === "venues" && <Button onClick={createVenue} className="gradient-btn"><Plus size={16} className="mr-2" />New Venue</Button>}
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-zinc-950/60 p-2">
        <button type="button" onClick={() => setActiveTab("venues")} className={`h-11 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition ${activeTab === "venues" ? "text-zinc-950" : "text-zinc-300 hover:bg-white/5 hover:text-white"}`} style={activeTab === "venues" ? { background: "linear-gradient(90deg, #71E0DC, #AEB2EF)" } : undefined}><MapPin size={17} />Venues</button>
        <button type="button" onClick={() => setActiveTab("templates")} className={`h-11 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition ${activeTab === "templates" ? "text-zinc-950" : "text-zinc-300 hover:bg-white/5 hover:text-white"}`} style={activeTab === "templates" ? { background: "linear-gradient(90deg, #71E0DC, #AEB2EF)" } : undefined}><ClipboardList size={17} />Templates</button>
      </div>

      {activeTab === "templates" ? <ShowTemplates embedded /> : <>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <section className="space-y-4">
          {!venues.length && <Card className="glass-card"><CardContent className="p-8 text-center"><MapPin className="mx-auto text-[#71E0DC] mb-3" size={38} /><h2 className="text-xl font-bold text-white">No venues yet</h2><p className="text-zinc-500 mt-2 mb-4">Add the places you host with their schedule, address, and host details.</p><Button onClick={createVenue} className="gradient-btn">Add First Venue</Button></CardContent></Card>}
          {venues.map((venue) => (
            <Card key={venue.id} className={`glass-card transition ${selectedVenueId === venue.id ? "border-[#71E0DC]/40" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-black text-white truncate">{venue.name}</h3>
                      {activeVenueId === venue.id && <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">Default</Badge>}
                    </div>
                    <p className="text-sm text-zinc-400 truncate">{scheduleLabel(venue)}</p>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-zinc-500">
                      <span className="flex items-center gap-2"><MapPin size={14} />{venue.address || "Address TBD"}</span>
                      <span className="flex items-center gap-2"><UserRound size={14} />{venue.hostName || "Host TBD"}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="rounded-full bg-zinc-900 px-2 py-1">{updatedLabel(venue.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => editVenue(venue)} className="border-white/10 text-zinc-300 hover:text-white">Edit</Button>
                  {activeVenueId !== venue.id && <Button size="sm" variant="outline" onClick={() => setDefaultVenue(venue.id)} className="border-white/10 text-zinc-300 hover:text-white">Set Default</Button>}
                  <Button size="sm" variant="ghost" onClick={() => deleteVenue(venue.id)} className="text-red-300 hover:text-red-200"><Trash2 size={15} /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <VenueEditor form={form} selectedVenue={selectedVenue} updateForm={updateForm} saveVenue={saveVenue} saving={saving} />
      </div>
      </>}
    </div>
  );
};

const VenueEditor = ({ form, selectedVenue, updateForm, saveVenue, saving }) => (
  <Card className="glass-card xl:sticky xl:top-6">
    <CardHeader><CardTitle className="text-white flex items-center gap-2"><MapPin className="text-[#71E0DC]" />{selectedVenue ? "Edit Venue" : "New Venue"}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-lg border border-white/10 bg-zinc-900 flex items-center justify-center text-[#71E0DC]"><MapPin size={24} /></div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Venue logistics</p>
            <h3 className="text-xl font-black text-white truncate">{form.name || "Venue name"}</h3>
            <p className="text-sm text-zinc-400">{scheduleLabel(form)}</p>
            <p className="text-sm text-zinc-500 truncate">{form.address || "Address TBD"}{form.hostName ? ` / Hosted by ${form.hostName}` : ""}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Venue name" value={form.name} onChange={(value) => updateForm("name", value)} placeholder="AJ's Bar" />
        <Field label="Host name" value={form.hostName} onChange={(value) => updateForm("hostName", value)} placeholder="Julie" />
        <Field label="Address" value={form.address} onChange={(value) => updateForm("address", value)} placeholder="Street, city" />
      </div>

      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4 space-y-3">
        <h3 className="font-bold text-white flex items-center gap-2"><CalendarDays size={17} className="text-[#71E0DC]" />Schedule</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-zinc-400">Day<select value={form.dayOfWeek} onChange={(event) => updateForm("dayOfWeek", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{weekdays.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
          <label className="text-xs text-zinc-400">Frequency<select value={form.frequency} onChange={(event) => updateForm("frequency", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{frequencies.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {form.frequency === "monthly" && <label className="text-xs text-zinc-400">Week of month<select value={form.monthlyWeek} onChange={(event) => updateForm("monthlyWeek", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{monthlyWeeks.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
          <Field label="Time" type="time" value={form.startTime} onChange={(value) => updateForm("startTime", value)} />
          <label className="text-xs text-zinc-400">Time zone<select value={form.timeZone} onChange={(event) => updateForm("timeZone", event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{timeZones.map((zone) => <option key={zone.value} value={zone.value}>{zone.label}</option>)}</select></label>
        </div>
      </div>

      <div className="flex justify-between gap-3 flex-wrap">
        <Button onClick={saveVenue} disabled={saving} className="gradient-btn ml-auto"><Save size={16} className="mr-2" />{saving ? "Saving..." : "Save Venue"}</Button>
      </div>
    </CardContent>
  </Card>
);

const Field = ({ label, value, onChange, type = "text", placeholder = "" }) => <label className="text-xs text-zinc-400">{label}<input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label>;

export default Venues;
