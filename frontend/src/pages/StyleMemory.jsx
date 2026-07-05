import { useEffect, useMemo, useState } from "react";
import { Save, RefreshCw, RotateCcw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { defaultHostStyleProfile, normalizeHostStyleProfile, saveHostStyleProfile, syncHostStyleProfile } from "../lib/hostStyleMemory";
import { dedupeCategories } from "../lib/categories";

const splitList = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
const joinList = (value) => (Array.isArray(value) ? value : []).join(", ");
const collectSessionQuestions = (session) => [
  session?.true_false_questions,
  session?.multiple_choice_questions,
  session?.written_questions,
  session?.picture_questions,
].flatMap((items) => Array.isArray(items) ? items : []);
const questionText = (question) => question?.question_text || question?.question || "";
const answerText = (question) => question?.correct_answer || question?.answer || "";
const categoryText = (question) => question?.category || "";

export default function StyleMemory() {
  const [profile, setProfile] = useState(defaultHostStyleProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [goodDraft, setGoodDraft] = useState({ question_text: "", correct_answer: "", category: "", fun_fact: "" });
  const [badDraft, setBadDraft] = useState({ question_text: "", correct_answer: "", category: "", note: "" });

  useEffect(() => {
    syncHostStyleProfile()
      .then(setProfile)
      .catch((error) => {
        console.warn("Style memory sync unavailable:", error);
        setProfile(normalizeHostStyleProfile(defaultHostStyleProfile));
      })
      .finally(() => setLoading(false));
  }, []);

  const feedbackTotal = useMemo(() => Object.values(profile.feedbackCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0), [profile.feedbackCounts]);
  const update = (key, value) => setProfile((current) => normalizeHostStyleProfile({ ...current, [key]: value }));
  const updateList = (key, value) => update(key, splitList(value));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveHostStyleProfile(profile);
      setProfile(saved);
      toast.success("Style memory saved");
    } catch (error) {
      console.error("Style memory save error:", error);
      toast.error(error.message || "Failed to save style memory");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const saved = await saveHostStyleProfile(defaultHostStyleProfile);
      setProfile(saved);
      toast.success("Style memory reset");
    } catch (error) {
      toast.error(error.message || "Failed to reset style memory");
    } finally {
      setSaving(false);
    }
  };

  const addExample = async (kind) => {
    const draft = kind === "good" ? goodDraft : badDraft;
    if (!questionText(draft) || !answerText(draft)) return toast.error("Add a question and answer first");
    const key = kind === "good" ? "examplesOfGoodQuestions" : "examplesOfBadQuestions";
    const next = normalizeHostStyleProfile({ ...profile, [key]: [{ ...draft, addedAt: new Date().toISOString() }, ...(profile[key] || [])].slice(0, 12) });
    setProfile(next);
    await saveHostStyleProfile(next).catch((error) => console.warn("Example save unavailable:", error));
    if (kind === "good") setGoodDraft({ question_text: "", correct_answer: "", category: "", fun_fact: "" });
    else setBadDraft({ question_text: "", correct_answer: "", category: "", note: "" });
    toast.success(kind === "good" ? "Saved as sounds-like-me" : "Saved as avoid-this-style");
  };

  const retrain = async () => {
    setRetraining(true);
    try {
      const [questionsResult, sessionsResult] = await Promise.all([
        supabase.from("questions").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("sessions").select("*").order("created_at", { ascending: false }).limit(75),
      ]);
      if (questionsResult.error) throw questionsResult.error;
      if (sessionsResult.error) throw sessionsResult.error;
      const questions = Array.isArray(questionsResult.data) ? questionsResult.data : [];
      const sessionQuestions = (Array.isArray(sessionsResult.data) ? sessionsResult.data : []).flatMap(collectSessionQuestions);
      const allQuestions = [...questions, ...sessionQuestions].filter((question) => questionText(question) && answerText(question));
      const categoryCounts = new Map();
      const typeCounts = new Map();
      const liked = [];
      const disliked = [];
      allQuestions.forEach((question) => {
        const category = categoryText(question);
        const type = question?.question_type || question?.type || "written";
        if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
        if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        const rating = String(question?.rating || question?.status || "").toLowerCase();
        if (question?.is_liked || question?.liked || ["liked", "approved", "favorite"].includes(rating)) liked.push(question);
        if (question?.is_disliked || question?.disliked || ["disliked", "rejected", "retired", "too_common"].includes(rating)) disliked.push(question);
      });
      const favoriteCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([category]) => category);
      const commonQuestionTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type).slice(0, 4);
      const goodExamples = (liked.length ? liked : allQuestions).slice(0, 8).map((question) => ({
        category: categoryText(question),
        question_type: question.question_type || question.type,
        question_text: questionText(question),
        correct_answer: answerText(question),
        fun_fact: question.fun_fact || "",
        note: liked.includes(question) ? "liked or approved" : "from imported/manual history",
      }));
      const badExamples = disliked.slice(0, 8).map((question) => ({
        category: categoryText(question),
        question_type: question.question_type || question.type,
        question_text: questionText(question),
        correct_answer: answerText(question),
        fun_fact: question.fun_fact || "",
        note: "disliked, rejected, retired, or too common",
      }));
      const trained = normalizeHostStyleProfile({
        ...profile,
        favoriteCategories: dedupeCategories([...profile.favoriteCategories, ...favoriteCategories]),
        commonQuestionTypes: commonQuestionTypes.length ? commonQuestionTypes : profile.commonQuestionTypes,
        examplesOfGoodQuestions: [...goodExamples, ...profile.examplesOfGoodQuestions].slice(0, 12),
        examplesOfBadQuestions: [...badExamples, ...profile.examplesOfBadQuestions].slice(0, 12),
        writingStyleNotes: profile.writingStyleNotes || defaultHostStyleProfile.writingStyleNotes,
      });
      const saved = await saveHostStyleProfile(trained);
      setProfile(saved);
      toast.success(`Retrained from ${allQuestions.length} questions`);
    } catch (error) {
      console.error("Style retrain error:", error);
      toast.error(error.message || "Failed to retrain style memory");
    } finally {
      setRetraining(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="spinner" /></div>;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="style-memory-page">
      <div className="mb-6 flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Host Style Memory</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">Teach Quiz Crafter your voice</h1>
          <p className="text-zinc-500 mt-2 max-w-3xl">This profile quietly guides generation, rewrites, replacements, fun facts, and co-host feedback.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={retrain} disabled={retraining} variant="outline" className="border-white/15 text-zinc-300 hover:text-white">{retraining ? <RefreshCw size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}Retrain from questions</Button>
          <Button onClick={save} disabled={saving} className="gradient-btn">{saving ? <RefreshCw size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}Save</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_.95fr] gap-5">
        <Card className="glass-card">
          <CardHeader><CardTitle className="text-white">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Preferred difficulty"><Input value={profile.preferredDifficulty} onChange={(event) => update("preferredDifficulty", event.target.value)} className="bg-zinc-950 border-white/10 text-white" /></Field>
            <Field label="Writing style notes"><Textarea value={profile.writingStyleNotes} onChange={(event) => update("writingStyleNotes", event.target.value)} className="min-h-28 bg-zinc-950 border-white/10 text-white" /></Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Favorite categories"><Input value={joinList(profile.favoriteCategories)} onChange={(event) => updateList("favoriteCategories", event.target.value)} className="bg-zinc-950 border-white/10 text-white" /></Field>
              <Field label="Avoided categories"><Input value={joinList(profile.avoidedCategories)} onChange={(event) => updateList("avoidedCategories", event.target.value)} className="bg-zinc-950 border-white/10 text-white" /></Field>
            </div>
            <Field label="Preferred round structure"><Textarea value={profile.preferredRoundStructure} onChange={(event) => update("preferredRoundStructure", event.target.value)} className="min-h-20 bg-zinc-950 border-white/10 text-white" /></Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Fun fact style"><Textarea value={profile.funFactStyle} onChange={(event) => update("funFactStyle", event.target.value)} className="min-h-24 bg-zinc-950 border-white/10 text-white" /></Field>
              <Field label="Wrong answer style"><Textarea value={profile.wrongAnswerStyle} onChange={(event) => update("wrongAnswerStyle", event.target.value)} className="min-h-24 bg-zinc-950 border-white/10 text-white" /></Field>
            </div>
            <Field label="Venue preferences"><Textarea value={profile.venuePreferences} onChange={(event) => update("venuePreferences", event.target.value)} placeholder="Room-specific notes, regular crowd, categories that play well..." className="min-h-24 bg-zinc-950 border-white/10 text-white" /></Field>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="glass-card">
            <CardHeader><CardTitle className="text-white">Learning Signals</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Signal label="Feedback actions" value={feedbackTotal} />
                <Signal label="Good examples" value={profile.examplesOfGoodQuestions.length} />
                <Signal label="Avoid examples" value={profile.examplesOfBadQuestions.length} />
                <Signal label="Updated" value={profile.updatedAt ? new Date(profile.updatedAt).toLocaleDateString() : "Not yet"} />
              </div>
              <Button onClick={reset} variant="outline" className="mt-4 border-red-500/30 text-red-200 hover:bg-red-500/10"><RotateCcw size={16} className="mr-2" />Reset Style Memory</Button>
            </CardContent>
          </Card>

          <ExampleEditor title="Sounds Like Me" icon={ThumbsUp} draft={goodDraft} setDraft={setGoodDraft} onAdd={() => addExample("good")} />
          <ExampleEditor title="Does Not Sound Like Me" icon={ThumbsDown} draft={badDraft} setDraft={setBadDraft} onAdd={() => addExample("bad")} bad />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ExampleList title="Sounds-like-me examples" examples={profile.examplesOfGoodQuestions} />
        <ExampleList title="Avoid-this-style examples" examples={profile.examplesOfBadQuestions} />
      </div>
    </div>
  );
}

const Field = ({ label, children }) => <label className="block"><Label className="text-zinc-300">{label}</Label><div className="mt-2">{children}</div></label>;
const Signal = ({ label, value }) => <div className="rounded-xl border border-white/10 bg-zinc-950/55 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p></div>;
const ExampleEditor = ({ title, icon: Icon, draft, setDraft, onAdd, bad }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white flex items-center gap-2"><Icon size={18} className={bad ? "text-red-300" : "text-[#71E0DC]"} />{title}</CardTitle></CardHeader><CardContent className="space-y-2"><Input value={draft.category || ""} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Category" className="bg-zinc-950 border-white/10 text-white" /><Textarea value={draft.question_text || ""} onChange={(event) => setDraft((current) => ({ ...current, question_text: event.target.value }))} placeholder="Question text" className="min-h-20 bg-zinc-950 border-white/10 text-white" /><Input value={draft.correct_answer || ""} onChange={(event) => setDraft((current) => ({ ...current, correct_answer: event.target.value }))} placeholder="Correct answer" className="bg-zinc-950 border-white/10 text-white" /><Input value={bad ? (draft.note || "") : (draft.fun_fact || "")} onChange={(event) => setDraft((current) => ({ ...current, [bad ? "note" : "fun_fact"]: event.target.value }))} placeholder={bad ? "Why this is not your style" : "Fun fact"} className="bg-zinc-950 border-white/10 text-white" /><Button onClick={onAdd} className="w-full gradient-btn">Add Example</Button></CardContent></Card>;
const ExampleList = ({ title, examples }) => <Card className="glass-card"><CardHeader><CardTitle className="text-white">{title}</CardTitle></CardHeader><CardContent className="space-y-3">{examples.length ? examples.map((example, index) => <div key={`${example.question_text}-${index}`} className="rounded-xl border border-white/10 bg-zinc-950/55 p-4"><div className="flex flex-wrap gap-2 mb-2"><Badge className="bg-[#71E0DC]/15 text-[#71E0DC]">{example.category || "Category"}</Badge>{example.question_type && <Badge className="bg-zinc-800 text-zinc-300">{example.question_type}</Badge>}</div><p className="text-white font-semibold">{example.question_text}</p><p className="mt-2 text-sm text-zinc-400">Answer: <span className="text-emerald-300">{example.correct_answer}</span></p>{example.fun_fact && <p className="mt-2 text-sm text-zinc-500">{example.fun_fact}</p>}{example.note && <p className="mt-2 text-xs text-zinc-500">{example.note}</p>}</div>) : <p className="rounded-xl border border-dashed border-white/10 bg-zinc-950/35 p-5 text-center text-zinc-500">No examples saved yet.</p>}</CardContent></Card>;
