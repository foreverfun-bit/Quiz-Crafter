import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { CalendarDays, Clock, Copy, Layers, MapPin, Plus, Save, Sparkles, Trash2, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { PROFILE_SHOW_TEMPLATES_KEY, PROFILE_VENUES_KEY, SHOW_TEMPLATES_STORAGE_KEY, defaultShowTemplates, mergeProfileRecords, normalizeTemplate, normalizeVenue, readLocalTemplates, readLocalVenues, recordsChanged, writeLocalTemplates, writeLocalVenues, writeTemplateBuildDraft } from "../lib/venues";
import { loadHostSetupSettings, saveHostSetupSettings, updateUserMetadata } from "../lib/profileState";

const metadataTemplatesKey = PROFILE_SHOW_TEMPLATES_KEY;
const metadataVenuesKey = PROFILE_VENUES_KEY;
const updatedLabel = (value) => {
  if (!value) return "Starter template";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Starter template" : `Updated ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
};
const questionTypeOptions = [
  { value: "mixed", label: "Mixed" },
  { value: "true_false", label: "True/False" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "written", label: "Written" },
];
const questionTypeLabel = (value) => questionTypeOptions.find((option) => option.value === value)?.label || "Mixed";
const resizeTemplateDraft = (template) => {
  const count = Math.max(1, Math.min(12, Number(template.roundCount) || 1));
  const existingNames = Array.isArray(template.roundNames) ? template.roundNames : [];
  const existingDescriptions = Array.isArray(template.roundDescriptions) ? template.roundDescriptions : [];
  const existingPoints = Array.isArray(template.roundPoints) ? template.roundPoints : [];
  const existingTimers = Array.isArray(template.roundTimers) ? template.roundTimers : [];
  const existingWagers = Array.isArray(template.roundWagerLimits) ? template.roundWagerLimits : [];
  return {
    ...template,
    roundNames: Array.from({ length: count }, (_, index) => existingNames[index] ?? (index === count - 1 ? "Final Round" : `Round ${index + 1}`)),
    roundDescriptions: Array.from({ length: count }, (_, index) => existingDescriptions[index] ?? ""),
    roundPoints: Array.from({ length: count }, (_, index) => existingPoints[index] ?? template.defaultPoints ?? 25),
    roundTimers: Array.from({ length: count }, (_, index) => existingTimers[index] ?? template.defaultTimer ?? 30),
    roundWagerLimits: Array.from({ length: count }, (_, index) => existingWagers[index] ?? template.defaultWagerLimit ?? 0),
  };
};

const ShowTemplates = ({ embedded = false }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState(readLocalTemplates);
  const [venues, setVenues] = useState(readLocalVenues);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [form, setForm] = useState(() => normalizeTemplate(defaultShowTemplates[0]));
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Loading");

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === selectedTemplateId) || null, [templates, selectedTemplateId]);
  const selectedVenue = useMemo(() => venues.find((venue) => venue.id === selectedVenueId) || null, [venues, selectedVenueId]);

  useEffect(() => {
    const localTemplates = readLocalTemplates();
    const localVenues = readLocalVenues();
    setTemplates(localTemplates);
    setVenues(localVenues);
    setSelectedVenueId(localVenues[0]?.id || "");
    setSelectedTemplateId(localTemplates[0]?.id || "");
    setForm(normalizeTemplate(localTemplates[0] || defaultShowTemplates[0]));

    const loadRemote = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const remoteTemplates = data?.user?.user_metadata?.[metadataTemplatesKey];
        const remoteVenues = data?.user?.user_metadata?.[metadataVenuesKey];
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupTemplates = Array.isArray(setupSettings.templates) ? setupSettings.templates.map(normalizeTemplate) : [];
        const setupVenues = Array.isArray(setupSettings.venues) ? setupSettings.venues.map(normalizeVenue) : [];
        const normalizedRemoteTemplates = Array.isArray(remoteTemplates) ? remoteTemplates.map(normalizeTemplate) : [];
        const normalizedRemoteVenues = Array.isArray(remoteVenues) ? remoteVenues.map(normalizeVenue) : [];
        const normalized = mergeProfileRecords([...setupTemplates, ...normalizedRemoteTemplates], localTemplates, normalizeTemplate);
        const profileVenues = mergeProfileRecords([...setupVenues, ...normalizedRemoteVenues], localVenues, normalizeVenue);
        setTemplates(normalized);
        setVenues(profileVenues);
        writeLocalTemplates(normalized);
        writeLocalVenues(profileVenues);
        setSelectedTemplateId(normalized[0]?.id || "");
        setSelectedVenueId(profileVenues[0]?.id || "");
        setForm(normalizeTemplate(normalized[0] || defaultShowTemplates[0]));
        const profilePatch = {};
        if (normalized.length && recordsChanged(normalizedRemoteTemplates, normalized)) {
          profilePatch[metadataTemplatesKey] = normalized;
        }
        if (profileVenues.length && recordsChanged(normalizedRemoteVenues, profileVenues)) {
          profilePatch[metadataVenuesKey] = profileVenues;
        }
        if (Object.keys(profilePatch).length) {
          await updateUserMetadata(profilePatch);
        }
        if ((normalized.length && recordsChanged(setupTemplates, normalized)) || (profileVenues.length && recordsChanged(setupVenues, profileVenues))) {
          await saveHostSetupSettings({ templates: normalized, venues: profileVenues });
        }
        setSyncStatus("Synced");
      } catch (error) {
        console.warn("Template metadata sync unavailable:", error);
        setSyncStatus("Local only");
      }
    };
    loadRemote();
  }, []);

  const persistTemplates = async (nextTemplates) => {
    const normalized = nextTemplates.map(normalizeTemplate);
    setTemplates(normalized);
    writeLocalTemplates(normalized);
    try {
      await updateUserMetadata({ [metadataTemplatesKey]: normalized });
      await saveHostSetupSettings({ templates: normalized });
      localStorage.setItem(SHOW_TEMPLATES_STORAGE_KEY, JSON.stringify(normalized));
      setSyncStatus("Synced");
      return true;
    } catch (error) {
      console.warn("Template metadata save unavailable:", error);
      setSyncStatus("Local only");
      return false;
    }
  };

  const editTemplate = (template) => {
    setSelectedTemplateId(template.id);
    setForm(normalizeTemplate(template));
  };

  const createTemplate = () => {
    const next = normalizeTemplate({ name: "New Show Template", description: "Custom reusable trivia format." });
    setSelectedTemplateId("");
    setForm(next);
  };

  const cloneTemplate = (template) => {
    const copy = normalizeTemplate({ ...template, id: undefined, name: `${template.name} Copy`, updatedAt: new Date().toISOString() });
    setSelectedTemplateId("");
    setForm(copy);
    toast.success("Template copied");
  };

  const saveTemplate = async () => {
    const clean = normalizeTemplate({ ...form, updatedAt: new Date().toISOString() });
    if (!clean.name) return toast.error("Template name is required");
    setSaving(true);
    const nextTemplates = templates.some((template) => template.id === clean.id)
      ? templates.map((template) => template.id === clean.id ? clean : template)
      : [clean, ...templates];
    const synced = await persistTemplates(nextTemplates);
    setSelectedTemplateId(clean.id);
    setForm(clean);
    setSaving(false);
    if (synced) toast.success("Template saved to your account");
    else toast.error("Template saved only on this browser. Account sync failed.");
  };

  const deleteTemplate = async (templateId) => {
    const nextTemplates = templates.filter((template) => template.id !== templateId);
    await persistTemplates(nextTemplates);
    const nextSelected = nextTemplates[0] || normalizeTemplate(defaultShowTemplates[0]);
    setSelectedTemplateId(nextSelected.id || "");
    setForm(nextSelected);
    toast.success("Template removed");
  };

  const startBuild = (template = form) => {
    writeTemplateBuildDraft(normalizeTemplate(template), selectedVenue);
    navigate("/build");
  };

  const updateForm = (key, value) => setForm((current) => {
    const next = { ...current, [key]: value, updatedAt: new Date().toISOString() };
    return key === "roundCount" ? resizeTemplateDraft(next) : next;
  });
  const updateRound = (index, key, value) => {
    setForm((current) => {
      const next = resizeTemplateDraft(current);
      const names = [...next.roundNames];
      const descriptions = [...next.roundDescriptions];
      const points = [...next.roundPoints];
      const timers = [...next.roundTimers];
      const wagers = [...next.roundWagerLimits];
      if (key === "name") names[index] = value;
      if (key === "description") descriptions[index] = value;
      if (key === "points") points[index] = value;
      if (key === "timer") timers[index] = value;
      if (key === "wager") wagers[index] = value;
      return { ...next, roundNames: names, roundDescriptions: descriptions, roundPoints: points, roundTimers: timers, roundWagerLimits: wagers, updatedAt: new Date().toISOString() };
    });
  };

  return (
    <div className={`${embedded ? "" : "p-6 lg:p-8 max-w-7xl mx-auto"} animate-fade-in`} data-testid="show-templates-page">
      {!embedded && <div className="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Reusable Formats</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">Show Templates</h1>
          <p className="text-zinc-500 mt-2">Save your usual trivia formats once, then start a new build with the rounds, pacing, and scoring already set.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge className={syncStatus === "Synced" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{syncStatus}</Badge>
          <Button onClick={createTemplate} className="gradient-btn"><Plus size={16} className="mr-2" />New Template</Button>
        </div>
      </div>}
      {embedded && <div className="mb-5 flex items-center justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Reusable Formats</p><h2 className="text-2xl font-black text-white mt-1">Show Templates</h2><p className="text-zinc-500 mt-1">Pair a reusable show format with a venue and start building.</p></div><div className="flex gap-2 flex-wrap"><Badge className={syncStatus === "Synced" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-zinc-800 text-zinc-300"}>{syncStatus}</Badge><Button onClick={createTemplate} className="gradient-btn"><Plus size={16} className="mr-2" />New Template</Button></div></div>}

      <Card className="glass-card mb-6"><CardContent className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-3 items-end"><div><p className="text-xs uppercase tracking-wide text-zinc-500 font-bold">Selected format</p><p className="text-lg font-black text-white truncate">{form.name}</p><p className="text-sm text-zinc-500 truncate">{form.roundCount} rounds / {form.questionsPerRound} questions each / {questionTypeLabel(form.questionType)} / {form.defaultTimer}s timer</p></div><label className="text-sm text-zinc-400">Venue name for this build<select value={selectedVenueId} onChange={(event) => setSelectedVenueId(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60"><option value="">No venue selected</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label><Button onClick={() => startBuild(form)} className="gradient-btn h-11"><Sparkles size={16} className="mr-2" />Start Build</Button></CardContent></Card>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <section className="space-y-4">
          {!templates.length && <Card className="glass-card"><CardContent className="p-8 text-center"><Layers className="mx-auto text-[#71E0DC] mb-3" size={38} /><h2 className="text-xl font-bold text-white">No templates yet</h2><p className="text-zinc-500 mt-2 mb-4">Create a reusable show format for your regular trivia nights.</p><Button onClick={createTemplate} className="gradient-btn">Create Template</Button></CardContent></Card>}
          {templates.map((template) => (
            <Card key={template.id} className={`glass-card transition ${selectedTemplateId === template.id ? "border-[#71E0DC]/40" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-black text-white">{template.name}</h3>
                    <p className="text-sm text-zinc-400 mt-1">{template.description || "Reusable trivia show format"}</p>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-zinc-500">
                      <span className="flex items-center gap-2"><Layers size={14} />{template.roundCount} rounds</span>
                      <span className="flex items-center gap-2"><Trophy size={14} />{template.defaultPoints} pts</span>
                      <span className="flex items-center gap-2"><Clock size={14} />{template.defaultTimer}s</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">{template.roundNames.slice(0, 5).map((name, index) => <span key={`${template.id}-${index}`} className="rounded-full bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400">{name}</span>)}{template.roundNames.length > 5 && <span className="rounded-full bg-zinc-900 px-2 py-1 text-[11px] text-zinc-500">+{template.roundNames.length - 5}</span>}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2"><Badge className="bg-zinc-800 text-zinc-300">{template.questionsPerRound} each</Badge><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{questionTypeLabel(template.questionType)}</Badge><span className="text-[11px] text-zinc-600 whitespace-nowrap">{updatedLabel(template.updatedAt)}</span></div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => editTemplate(template)} className="border-white/10 text-zinc-300 hover:text-white">Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => cloneTemplate(template)} className="border-white/10 text-zinc-300 hover:text-white"><Copy size={14} className="mr-1" />Copy</Button>
                  <Button size="sm" onClick={() => startBuild(template)} className="bg-[#71E0DC] text-zinc-950 hover:bg-[#AEEBFF]">Start Build</Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteTemplate(template.id)} className="text-red-300 hover:text-red-200"><Trash2 size={15} /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <TemplateEditor form={form} selectedTemplate={selectedTemplate} selectedVenue={selectedVenue} updateForm={updateForm} updateRound={updateRound} saveTemplate={saveTemplate} saving={saving} startBuild={startBuild} />
      </div>
    </div>
  );
};

const TemplateEditor = ({ form, selectedTemplate, selectedVenue, updateForm, updateRound, saveTemplate, saving, startBuild }) => (
  <Card className="glass-card xl:sticky xl:top-6">
    <CardHeader><CardTitle className="text-white flex items-center gap-2"><Layers className="text-[#71E0DC]" />{selectedTemplate ? "Edit Template" : "New Template"}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-[#71E0DC] font-bold">Build preview</p>
            <h3 className="text-2xl font-black text-white truncate">{form.name}</h3>
            <p className="mt-1 text-sm text-zinc-400">{form.description || "Reusable trivia show format"}</p>
          </div>
          <Badge className="bg-zinc-800 text-zinc-300">{form.roundCount} rounds</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
          <Metric icon={Users} label="Questions" value={form.roundCount * form.questionsPerRound} />
          <Metric icon={Layers} label="Per round" value={form.questionsPerRound} />
          <Metric icon={CalendarDays} label="Venue" value={selectedVenue?.name || "Optional"} />
        </div>
        {selectedVenue && <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500"><MapPin size={13} />This build will be tagged with {selectedVenue.name}.</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Template name" value={form.name} onChange={(value) => updateForm("name", value)} />
        <Field label="Short description" value={form.description} onChange={(value) => updateForm("description", value)} />
      </div>
      <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-4 space-y-3">
        <h3 className="font-bold text-white">Format Defaults</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Rounds" type="number" value={form.roundCount} onChange={(value) => updateForm("roundCount", value)} />
          <Field label="Per round" type="number" value={form.questionsPerRound} onChange={(value) => updateForm("questionsPerRound", value)} />
          <SelectField label="Question type" value={form.questionType || "mixed"} onChange={(value) => updateForm("questionType", value)} options={questionTypeOptions} />
          <Field label="Base wager cap" type="number" value={form.defaultWagerLimit} onChange={(value) => updateForm("defaultWagerLimit", value)} />
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="font-bold text-white">Round Plan</h3>
        {form.roundNames.map((roundName, index) => <div key={`round-${index}`} className="rounded-lg border border-white/10 bg-zinc-950/50 p-3 space-y-3"><div className="grid grid-cols-1 md:grid-cols-[1fr_90px_90px_110px] gap-3"><Field label={`Round ${index + 1} name`} value={roundName} onChange={(value) => updateRound(index, "name", value)} /><Field label="Points" type="number" value={form.roundPoints[index]} onChange={(value) => updateRound(index, "points", value)} /><Field label="Timer" type="number" value={form.roundTimers[index]} onChange={(value) => updateRound(index, "timer", value)} /><Field label="Wager cap" type="number" value={form.roundWagerLimits[index]} onChange={(value) => updateRound(index, "wager", value)} /></div><TextArea label="Description / category direction" value={form.roundDescriptions[index] || ""} onChange={(value) => updateRound(index, "description", value)} placeholder="What this round should feel like, include, or avoid." /></div>)}
      </div>
      <TextArea label="Host notes" value={form.hostNotes} onChange={(value) => updateForm("hostNotes", value)} placeholder="Scoring notes, wager rules, pacing, category mix, or host reminders..." />
      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="outline" onClick={() => startBuild(form)} className="border-white/10 text-zinc-300 hover:text-white"><Sparkles size={16} className="mr-2" />Start Build</Button>
        <Button onClick={saveTemplate} disabled={saving} className="gradient-btn"><Save size={16} className="mr-2" />{saving ? "Saving..." : "Save Template"}</Button>
      </div>
    </CardContent>
  </Card>
);

const Metric = ({ icon: Icon, label, value }) => <div className="rounded-md border border-white/10 bg-zinc-950/60 p-3"><div className="flex items-center gap-2 text-zinc-500"><Icon size={14} /><span className="text-xs">{label}</span></div><p className="mt-1 text-lg font-black text-white truncate">{value}</p></div>;

const Field = ({ label, value, onChange, type = "text" }) => <label className="text-xs text-zinc-400">{label}<input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60" /></label>;

const SelectField = ({ label, value, onChange, options }) => <label className="text-xs text-zinc-400">{label}<select value={value || ""} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;

const TextArea = ({ label, value, onChange, placeholder }) => <label className="text-xs text-zinc-400">{label}<textarea value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 min-h-20 w-full resize-none rounded-md bg-zinc-950 border border-white/10 px-3 py-3 text-white outline-none focus:border-[#71E0DC]/60" /></label>;

export default ShowTemplates;
