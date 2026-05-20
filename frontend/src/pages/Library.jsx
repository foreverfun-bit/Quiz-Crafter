import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  CheckCircle,
  Image,
  Library as LibraryIcon,
  List,
  Loader2,
  MessageSquare,
  Pencil,
  Save,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

const typeConfig = {
  all: { label: "All", icon: LibraryIcon, color: "text-white" },
  true_false: { label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  multiple_choice: { label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  written: { label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  picture: { label: "Picture", icon: Image, color: "text-amber-400" },
};

const typeOrder = ["all", "true_false", "multiple_choice", "written", "picture"];
const editableTypes = ["true_false", "multiple_choice", "written", "picture"];
const USED_QUESTIONS_KEY = "quiz-crafter-used-question-ids";

const parseOptions = (value) => {
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : item?.text || "")).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
};

const optionsToString = (value) => parseOptions(value).join("; ");
const formatType = (type) => typeConfig[type]?.label || "Question";
const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const readUsedIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(USED_QUESTIONS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
};

const writeUsedIds = (ids) => {
  localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify([...ids]));
};

const isQuestionMarkedUsed = (question, usedIds) => {
  const id = String(question?.id || "");
  return (
    usedIds.has(id) ||
    question?.is_used === true ||
    question?.used === true ||
    Boolean(question?.used_at) ||
    Number(question?.times_used || 0) > 0
  );
};

const toEditForm = (question) => ({
  category: question.category || "",
  question_text: question.question_text || "",
  question_type: question.question_type || "written",
  correct_answer: question.correct_answer || "",
  incorrect_answers: optionsToString(question.incorrect_answers),
  fun_fact: question.fun_fact || "",
  image_url: question.image_url || "",
});

export default function Library() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [usedIds, setUsedIds] = useState(readUsedIds);

  useEffect(() => {
    fetchQuestions();
  }, []);

  async function fetchQuestions() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("questions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setQuestions(data || []);
    } catch (error) {
      console.error("Library load error:", error);
      toast.error(error.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    return questions.reduce(
      (acc, question) => {
        acc.all += 1;
        const type = question.question_type || "written";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      { all: 0 }
    );
  }, [questions]);

  const usedCount = useMemo(() => questions.filter((question) => isQuestionMarkedUsed(question, usedIds)).length, [questions, usedIds]);

  const filteredQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return questions.filter((question) => {
      const type = question.question_type || "written";
      if (activeType !== "all" && type !== activeType) return false;
      if (!query) return true;

      return [question.question_text, question.correct_answer, question.category, question.fun_fact]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeType, questions, searchQuery]);

  const toggleUsed = async (question) => {
    const id = String(question.id);
    const next = new Set(usedIds);
    const willBeUsed = !isQuestionMarkedUsed(question, usedIds);
    if (willBeUsed) next.add(id);
    else next.delete(id);

    setUsedIds(next);
    writeUsedIds(next);
    setQuestions((prev) => prev.map((item) => item.id === question.id ? { ...item, is_used_local: willBeUsed } : item));

    // If a matching column exists in Supabase, keep it in sync. If not, local storage still drives the app today.
    const possiblePayloads = [
      { is_used: willBeUsed },
      { used: willBeUsed },
      { used_at: willBeUsed ? new Date().toISOString() : null },
    ];

    for (const payload of possiblePayloads) {
      const { error } = await supabase.from("questions").update(payload).eq("id", question.id);
      if (!error) break;
      if (!/schema cache|column|could not find/i.test(error.message || "")) break;
    }

    toast.success(willBeUsed ? "Marked used" : "Marked unused");
  };

  const startEditing = (question) => {
    setEditingId(question.id);
    setEditForm(toEditForm(question));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const updateEditForm = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const buildPayload = () => {
    const type = editForm.question_type || "written";
    const correct = normalizeText(editForm.correct_answer);
    const wrongAnswers = parseOptions(editForm.incorrect_answers).filter((answer) => answer.toLowerCase() !== correct.toLowerCase());

    if (!normalizeText(editForm.question_text) || !correct) {
      throw new Error("Question and answer are required");
    }

    if (type === "multiple_choice" && wrongAnswers.length < 2) {
      throw new Error("Multiple choice questions need at least two wrong answers");
    }

    return {
      category: normalizeText(editForm.category) || "General",
      question_text: normalizeText(editForm.question_text),
      question_type: type,
      correct_answer: type === "true_false" ? (correct.toLowerCase() === "false" ? "False" : "True") : correct,
      incorrect_answers:
        type === "multiple_choice"
          ? wrongAnswers.join("; ")
          : type === "true_false"
            ? correct.toLowerCase() === "false" ? "True" : "False"
            : null,
      fun_fact: normalizeText(editForm.fun_fact) || null,
      image_url: normalizeText(editForm.image_url) || null,
    };
  };

  const saveQuestion = async (questionId) => {
    setSavingId(questionId);
    try {
      let payload = buildPayload();
      let result = await supabase.from("questions").update(payload).eq("id", questionId).select("*").single();

      if (result.error && /image_url/i.test(result.error.message || "")) {
        const { image_url, ...withoutImage } = payload;
        payload = withoutImage;
        result = await supabase.from("questions").update(payload).eq("id", questionId).select("*").single();
      }

      if (result.error) throw result.error;

      setQuestions((prev) => prev.map((question) => (question.id === questionId ? result.data : question)));
      setEditingId(null);
      setEditForm(null);
      toast.success("Question updated");
    } catch (error) {
      console.error("Library save error:", error);
      toast.error(error.message || "Failed to update question");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="library-page">
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Question <span className="gradient-text">Library</span>
          </h1>
          <p className="text-zinc-500">Browse and edit saved questions from imports, generated sets, and custom writing.</p>
          <p className="text-zinc-600 text-sm mt-1">{usedCount} marked used</p>
        </div>
        <Button onClick={fetchQuestions} variant="outline" className="border-zinc-700 text-zinc-300 hover:text-white">
          Refresh
        </Button>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search questions, answers, categories..."
              className="pl-9 bg-zinc-950/50 border-white/10 text-white"
              data-testid="library-search"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {typeOrder.map((type) => {
              const config = typeConfig[type];
              const Icon = config.icon;
              const active = activeType === type;

              return (
                <Button
                  key={type}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setActiveType(type)}
                  className={active ? "gradient-btn" : "border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-800"}
                >
                  <Icon size={14} className="mr-2" />
                  {config.label} ({counts[type] || 0})
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="min-h-[320px] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#71E0DC]" />
        </div>
      ) : filteredQuestions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <LibraryIcon className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500">No questions match this view.</p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-270px)] pr-2">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredQuestions.map((question) => {
              const isEditing = editingId === question.id;
              return isEditing ? (
                <EditableQuestionCard
                  key={question.id}
                  form={editForm}
                  saving={savingId === question.id}
                  onChange={updateEditForm}
                  onSave={() => saveQuestion(question.id)}
                  onCancel={cancelEditing}
                />
              ) : (
                <QuestionCard key={question.id} question={question} used={isQuestionMarkedUsed(question, usedIds)} onEdit={() => startEditing(question)} onToggleUsed={() => toggleUsed(question)} />
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

const QuestionCard = ({ question, used, onEdit, onToggleUsed }) => {
  const type = question.question_type || "written";
  const config = typeConfig[type] || typeConfig.written;
  const Icon = config.icon;
  const options = parseOptions(question.incorrect_answers);

  return (
    <Card className={`bg-zinc-900/70 border-white/10 ${used ? "opacity-75" : ""}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-zinc-800 text-zinc-300 border border-white/10">
              <Icon size={13} className={`mr-1 ${config.color}`} />
              {formatType(type)}
            </Badge>
            {used && <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Used</Badge>}
            {question.image_url && <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20">Image</Badge>}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button size="sm" variant="outline" onClick={onToggleUsed} className={used ? "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10" : "border-zinc-700 text-zinc-300 hover:text-white"}>
              <CheckCircle size={14} className="mr-2" />{used ? "Used" : "Mark Used"}
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit} className="border-zinc-700 text-zinc-300 hover:text-white">
              <Pencil size={14} className="mr-2" />Edit
            </Button>
          </div>
        </div>

        <div>
          <p className="text-white font-semibold leading-relaxed">{question.question_text}</p>
          <p className="text-zinc-500 text-sm mt-2">{question.category || "Uncategorized"}</p>
        </div>

        {question.image_url && <img src={question.image_url} alt="Question" className="max-h-40 rounded-md border border-white/10" />}

        {options.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {options.map((option) => (
              <div key={option} className="px-3 py-2 rounded-md bg-zinc-950/50 text-zinc-400 text-sm">
                {option}
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-white/10 space-y-2">
          <p className="text-sm">
            <span className="text-zinc-500">Answer: </span>
            <span className="text-emerald-300 font-medium">{question.correct_answer}</span>
          </p>
          {question.fun_fact && <p className="text-sm text-zinc-400 leading-relaxed">{question.fun_fact}</p>}
        </div>
      </CardContent>
    </Card>
  );
};

const EditableQuestionCard = ({ form, saving, onChange, onSave, onCancel }) => (
  <Card className="bg-zinc-900/80 border-[#71E0DC]/30">
    <CardContent className="p-5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-3">
        <select value={form.question_type} onChange={(event) => onChange("question_type", event.target.value)} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3">
          {editableTypes.map((type) => <option key={type} value={type}>{formatType(type)}</option>)}
        </select>
        <Input value={form.category} onChange={(event) => onChange("category", event.target.value)} placeholder="Category" className="bg-zinc-950/50 border-white/10 text-white" />
      </div>

      <textarea value={form.question_text} onChange={(event) => onChange("question_text", event.target.value)} placeholder="Question" className="w-full min-h-[100px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3" />

      {form.question_type === "true_false" ? (
        <select value={form.correct_answer || "True"} onChange={(event) => onChange("correct_answer", event.target.value)} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3">
          <option value="True">True</option>
          <option value="False">False</option>
        </select>
      ) : (
        <Input value={form.correct_answer} onChange={(event) => onChange("correct_answer", event.target.value)} placeholder="Correct answer" className="bg-zinc-950/50 border-white/10 text-white" />
      )}

      {form.question_type === "multiple_choice" && (
        <textarea value={form.incorrect_answers} onChange={(event) => onChange("incorrect_answers", event.target.value)} placeholder="Wrong answers separated by semicolons" className="w-full min-h-[80px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3" />
      )}

      <Input value={form.image_url} onChange={(event) => onChange("image_url", event.target.value)} placeholder="Image/media URL" className="bg-zinc-950/50 border-white/10 text-white" />
      <textarea value={form.fun_fact} onChange={(event) => onChange("fun_fact", event.target.value)} placeholder="Fun fact" className="w-full min-h-[70px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3" />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving} className="border-zinc-700 text-zinc-300">
          <X size={14} className="mr-2" />Cancel
        </Button>
        <Button onClick={onSave} disabled={saving} className="gradient-btn">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save size={14} className="mr-2" />}
          Save
        </Button>
      </div>
    </CardContent>
  </Card>
);
