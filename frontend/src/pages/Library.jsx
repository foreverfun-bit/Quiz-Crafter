import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
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
  Plus,
  RotateCcw,
  Save,
  Search,
  Star,
  Upload,
  MoreHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { getQuestionMemory, isMemoryBlocked, isMemoryUsed, memoryStatuses, readQuestionMemory, saveQuestionMemoryToProfile, syncQuestionMemoryFromProfile, upsertQuestionMemory } from "../lib/questionMemory";
import { profileKeys, saveProfileValue, syncProfileJson } from "../lib/profileState";

const typeConfig = {
  all: { label: "All", icon: LibraryIcon, color: "text-white" },
  true_false: { label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  multiple_choice: { label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  written: { label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  picture: { label: "Picture", icon: Image, color: "text-amber-400" },
  // Not a real question_type -- filters by category (see isBonusCategory)
  // the same way bonus questions are already recognized during live
  // hosting, so this tab doesn't require a schema change or a second,
  // conflicting definition of "bonus".
  bonus: { label: "Bonus", icon: Star, color: "text-amber-300" },
};

// Drives the tab list (bonus replaces picture as the 4th tab, though
// picture questions are untouched and still filterable via All/search).
const typeOrder = ["all", "true_false", "multiple_choice", "written", "bonus"];
const editableTypes = ["true_false", "multiple_choice", "written", "picture"];
const isBonusCategory = (question) => String(question?.category || "").trim().toUpperCase() === "BONUS";
const memoryFilters = [
  { value: "all", label: "All Memory" },
  { value: "available", label: "Available" },
  { value: "used_recently", label: "Used Recently" },
];
const USED_QUESTIONS_KEY = "quiz-crafter-used-question-ids";
const UNUSED_QUESTIONS_KEY = "quiz-crafter-unused-question-ids";

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
const fingerprint = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const collectSessionQuestions = (session) => [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions].flatMap((value) => (Array.isArray(value) ? value : []));

const readUsedIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(USED_QUESTIONS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
};

const readUnusedIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNUSED_QUESTIONS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
};

const writeUsedIds = (ids) => {
  const values = [...ids];
  localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify(values));
  saveProfileValue(profileKeys.usedQuestionIds, values).catch((error) => console.warn("Used question profile save unavailable:", error));
};

const writeUnusedIds = (ids) => {
  const values = [...ids];
  localStorage.setItem(UNUSED_QUESTIONS_KEY, JSON.stringify(values));
  saveProfileValue(profileKeys.unusedQuestionIds, values).catch((error) => console.warn("Unused question profile save unavailable:", error));
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [memoryFilter, setMemoryFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [usedIds, setUsedIds] = useState(readUsedIds);
  const [unusedIds, setUnusedIds] = useState(readUnusedIds);
  const [usedFingerprints, setUsedFingerprints] = useState(new Set());
  const [questionMemory, setQuestionMemory] = useState(readQuestionMemory);

  useEffect(() => {
    const syncLibraryProfileState = async () => {
      try {
        const [used, unused, memory] = await Promise.all([
          syncProfileJson({ localKey: USED_QUESTIONS_KEY, profileKey: profileKeys.usedQuestionIds, fallback: [], merge: "array" }),
          syncProfileJson({ localKey: UNUSED_QUESTIONS_KEY, profileKey: profileKeys.unusedQuestionIds, fallback: [], merge: "array" }),
          syncQuestionMemoryFromProfile(supabase),
        ]);
        setUsedIds(new Set(Array.isArray(used) ? used.map(String) : []));
        setUnusedIds(new Set(Array.isArray(unused) ? unused.map(String) : []));
        setQuestionMemory(memory);
      } catch (error) {
        console.warn("Library profile sync unavailable:", error);
      }
    };
    syncLibraryProfileState();
  }, []);

  const fetchQuestions = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [questionsResult, sessionsResult] = await Promise.all([
        supabase.from("questions").select("*").eq("user_id", user?.id).order("created_at", { ascending: false }),
        supabase.from("sessions").select("*").eq("user_id", user?.id),
      ]);

      if (questionsResult.error) throw questionsResult.error;
      if (sessionsResult.error) throw sessionsResult.error;

      const sessionFingerprints = new Set();
      (sessionsResult.data || []).forEach((session) => {
        collectSessionQuestions(session).forEach((question) => {
          const text = question?.question_text || question?.question;
          if (text) sessionFingerprints.add(fingerprint(text));
        });
      });

      setUsedFingerprints(sessionFingerprints);
      setQuestions(questionsResult.data || []);
    } catch (error) {
      console.error("Library load error:", error);
      toast.error(error.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const counts = useMemo(() => {
    return questions.reduce(
      (acc, question) => {
        acc.all += 1;
        const type = question.question_type || "written";
        acc[type] = (acc[type] || 0) + 1;
        if (isBonusCategory(question)) acc.bonus = (acc.bonus || 0) + 1;
        return acc;
      },
      { all: 0 }
    );
  }, [questions]);

  const isUsed = useCallback((question) => {
    const id = String(question?.id || "");
    if (unusedIds.has(id)) return false;
    return isMemoryUsed(question, questionMemory) || isQuestionMarkedUsed(question, usedIds) || usedFingerprints.has(fingerprint(question.question_text));
  }, [questionMemory, unusedIds, usedIds, usedFingerprints]);
  const usedCount = useMemo(() => questions.filter((question) => isUsed(question)).length, [questions, isUsed]);
  const blockedMemoryCount = useMemo(() => questions.filter((question) => isMemoryBlocked(question, questionMemory)).length, [questionMemory, questions]);

  const filteredQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return questions.filter((question) => {
      const type = question.question_type || "written";
      if (activeType === "bonus") {
        if (!isBonusCategory(question)) return false;
      } else if (activeType !== "all" && type !== activeType) {
        return false;
      }
      const memory = getQuestionMemory(question, questionMemory);
      if (memoryFilter === "available" && (isUsed(question) || isMemoryBlocked(question, questionMemory))) return false;
      if (memoryFilter !== "all" && memoryFilter !== "available" && memory.status !== memoryFilter) return false;
      if (!query) return true;

      return [question.question_text, question.correct_answer, question.category, question.fun_fact]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeType, isUsed, memoryFilter, questionMemory, questions, searchQuery]);

  const toggleUsed = async (question) => {
    const id = String(question.id);
    const nextUsed = new Set(usedIds);
    const nextUnused = new Set(unusedIds);
    const willBeUsed = !isUsed(question);

    if (willBeUsed) {
      nextUsed.add(id);
      nextUnused.delete(id);
    } else {
      nextUsed.delete(id);
      nextUnused.add(id);
    }

    setUsedIds(nextUsed);
    setUnusedIds(nextUnused);
    writeUsedIds(nextUsed);
    writeUnusedIds(nextUnused);
    const nextMemory = upsertQuestionMemory(question, { status: willBeUsed ? "used_recently" : "available" }, readQuestionMemory());
    setQuestionMemory(nextMemory);
    saveQuestionMemoryToProfile(supabase, nextMemory).catch((error) => console.warn("Question memory profile save unavailable:", error));
    setQuestions((prev) => prev.map((item) => item.id === question.id ? {
      ...item,
      is_used: willBeUsed,
      used: willBeUsed,
      used_at: willBeUsed ? (item.used_at || new Date().toISOString()) : null,
      times_used: willBeUsed ? Math.max(1, Number(item.times_used || 0)) : 0,
    } : item));

    // If matching columns exist in Supabase, keep them in sync. Local override still wins in the UI.
    const possiblePayloads = [
      { is_used: willBeUsed, used: willBeUsed, used_at: willBeUsed ? new Date().toISOString() : null, times_used: willBeUsed ? 1 : 0 },
      { is_used: willBeUsed, used_at: willBeUsed ? new Date().toISOString() : null, times_used: willBeUsed ? 1 : 0 },
      { is_used: willBeUsed, used_at: willBeUsed ? new Date().toISOString() : null },
      { is_used: willBeUsed },
      { used: willBeUsed, used_at: willBeUsed ? new Date().toISOString() : null },
      { used: willBeUsed },
      { used_at: willBeUsed ? new Date().toISOString() : null },
    ];

    for (const payload of possiblePayloads) {
      const { error } = await supabase.from("questions").update(payload).eq("id", question.id).eq("user_id", user?.id);
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
      let result = await supabase.from("questions").update(payload).eq("id", questionId).eq("user_id", user?.id).select("*").single();

      if (result.error && /image_url/i.test(result.error.message || "")) {
        const { image_url, ...withoutImage } = payload;
        payload = withoutImage;
        result = await supabase.from("questions").update(payload).eq("id", questionId).eq("user_id", user?.id).select("*").single();
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
            Question <span className="gradient-text">Bank</span>
          </h1>
          <p className="text-zinc-500">Find, import, edit, and organize trivia questions for future sessions.</p>
          <p className="text-zinc-600 text-sm mt-1">{usedCount} marked used / {blockedMemoryCount} blocked by memory</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button onClick={() => navigate("/import")} className="gradient-btn">
            <Upload size={16} className="mr-2" />
            Import
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="border-white/15 text-zinc-300 hover:text-white hover:bg-zinc-800" aria-label="More question bank actions">
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-white/10 bg-zinc-950 text-zinc-200">
              <DropdownMenuItem onClick={() => navigate("/build")} className="cursor-pointer focus:bg-zinc-800">
                <MessageSquare size={15} className="mr-2" />
                Write or Generate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={fetchQuestions} className="cursor-pointer focus:bg-zinc-800">
                <RotateCcw size={15} className="mr-2" />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
          <div className="flex flex-wrap gap-2">
            {memoryFilters.map((filter) => <Button key={filter.value} size="sm" variant={memoryFilter === filter.value ? "default" : "outline"} onClick={() => setMemoryFilter(filter.value)} className={memoryFilter === filter.value ? "gradient-btn" : "border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-800"}>{filter.label}</Button>)}
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
                <QuestionCard key={question.id} question={question} used={isUsed(question)} memory={getQuestionMemory(question, questionMemory)} onEdit={() => startEditing(question)} onToggleUsed={() => toggleUsed(question)} onAddToBuild={() => navigate(`/build?addQuestionId=${question.id}`)} />
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

const QuestionCard = ({ question, used, memory, onEdit, onToggleUsed, onAddToBuild }) => {
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
            {memory?.status && memory.status !== "available" && <Badge className={memory.status === "retired" || memory.status === "too_common" ? "bg-red-500/10 text-red-300 border border-red-500/20" : memory.status === "needs_rewrite" ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-[#AEB2EF]/10 text-[#AEB2EF] border border-[#AEB2EF]/20"}>{memoryStatuses[memory.status]?.label || memory.status}</Badge>}
            {question.image_url && <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20">Image</Badge>}
            {isBonusCategory(question) && <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20"><Star size={12} className="mr-1" />Bonus</Badge>}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button size="sm" onClick={onAddToBuild} className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/25 hover:bg-[#71E0DC]/20">
              <Plus size={14} className="mr-2" />Add to Build
            </Button>
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
