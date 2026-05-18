import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import {
  CheckCircle,
  List,
  MessageSquare,
  Image,
  Loader2,
  Save,
  Search,
  X,
  Check,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "all", label: "All", icon: List, color: "text-zinc-300" },
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400" },
];

const defaultRounds = [
  { id: "round-1", name: "Round 1", questionIds: [] },
  { id: "round-2", name: "Round 2", questionIds: [] },
  { id: "round-3", name: "Round 3", questionIds: [] },
];

const BUILD_STORAGE_KEY = "trivia-flex-round-builder-state-v1";

const parseAnswerOptions = (value) => {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(";").map((x) => x.trim()).filter(Boolean);
};

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const fingerprint = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeType = (question, fallbackType = "written") => {
  if (fallbackType === "picture") return "picture";
  if (question?.question_type === "picture") return "picture";
  if (question?.has_image || question?.image_url) return "picture";
  return question?.question_type || fallbackType || "written";
};

const normalizeQuestion = (q, fallbackType) => ({
  ...q,
  id: q.id || q.local_id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  question_text: normalizeText(q.question_text || q.question),
  correct_answer: normalizeText(q.correct_answer || q.answer),
  question_type: normalizeType(q, fallbackType),
  category: normalizeText(q.category) || "General",
  incorrect_answers: q.incorrect_answers ?? null,
  options: parseAnswerOptions(q.incorrect_answers ?? q.options),
  fun_fact: normalizeText(q.fun_fact),
  image_url: q.image_url || "",
  isGenerated: Boolean(q.isGenerated),
});

const collectSessionQuestions = (session) => {
  const arrays = [
    session?.true_false_questions,
    session?.multiple_choice_questions,
    session?.written_questions,
    session?.picture_questions,
  ];
  return arrays.flatMap((value) => (Array.isArray(value) ? value : []));
};

const toSessionQuestion = (question, round, roundIndex, sourceOrder) => ({
  category: question.category || "General",
  round_name: round.name,
  round_order: roundIndex + 1,
  source_order: sourceOrder + 1,
  question_text: question.question_text,
  correct_answer: question.correct_answer,
  question_type: question.question_type,
  incorrect_answers: Array.isArray(question.options) && question.options.length ? question.options.join("; ") : question.incorrect_answers || null,
  fun_fact: question.fun_fact || null,
  image_url: question.image_url || null,
});

const newRoundId = () => `round-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const BuildSession = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const loadSavedState = () => {
    try {
      const saved = localStorage.getItem(BUILD_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  };

  const savedState = loadSavedState();

  const [sessionName, setSessionName] = useState(savedState?.sessionName || "");
  const [rounds, setRounds] = useState(savedState?.rounds || defaultRounds);
  const [activeRoundId, setActiveRoundId] = useState(savedState?.activeRoundId || (savedState?.rounds?.[0]?.id || "round-1"));
  const [questions, setQuestions] = useState([]);
  const [usedFingerprints, setUsedFingerprints] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState(savedState?.theme || "");
  const [difficulty, setDifficulty] = useState(savedState?.difficulty || "host_hard");
  const [typeFilter, setTypeFilter] = useState(savedState?.typeFilter || "all");
  const [generateType, setGenerateType] = useState(savedState?.generateType || "multiple_choice");
  const [generateCount, setGenerateCount] = useState(savedState?.generateCount || "3");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    localStorage.setItem(
      BUILD_STORAGE_KEY,
      JSON.stringify({ sessionName, rounds, activeRoundId, theme, difficulty, typeFilter, generateType, generateCount })
    );
  }, [sessionName, rounds, activeRoundId, theme, difficulty, typeFilter, generateType, generateCount]);

  useEffect(() => {
    fetchBuilderData();
  }, []);

  const clearSavedState = () => localStorage.removeItem(BUILD_STORAGE_KEY);

  const fetchBuilderData = async () => {
    try {
      setLoading(true);

      const [questionsResult, sessionsResult] = await Promise.all([
        supabase.from("questions").select("*").order("created_at", { ascending: false }),
        user?.id ? supabase.from("sessions").select("*").eq("user_id", user.id) : supabase.from("sessions").select("*").limit(0),
      ]);

      if (questionsResult.error) throw questionsResult.error;
      if (sessionsResult.error) throw sessionsResult.error;

      const used = new Set();
      (sessionsResult.data || []).forEach((session) => {
        collectSessionQuestions(session).forEach((question) => {
          const text = question?.question_text || question?.question;
          if (text) used.add(fingerprint(text));
        });
      });

      setUsedFingerprints(used);
      setQuestions((questionsResult.data || []).map((q) => normalizeQuestion(q)));
    } catch (error) {
      console.error("Build session load error:", error);
      toast.error(error.message || "Failed to load builder");
    } finally {
      setLoading(false);
    }
  };

  const questionById = useMemo(() => new Map(questions.map((q) => [String(q.id), q])), [questions]);
  const activeRound = rounds.find((round) => round.id === activeRoundId) || rounds[0] || defaultRounds[0];
  const selectedIds = useMemo(() => new Set(rounds.flatMap((round) => round.questionIds || []).map(String)), [rounds]);

  const activeRoundQuestions = useMemo(() => {
    return (activeRound?.questionIds || []).map((id) => questionById.get(String(id))).filter(Boolean);
  }, [activeRound, questionById]);

  const availableQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return questions.filter((question) => {
      const type = normalizeType(question);
      const id = String(question.id);
      if (typeFilter !== "all" && type !== typeFilter) return false;
      if (usedFingerprints.has(fingerprint(question.question_text)) && !selectedIds.has(id)) return false;
      if (!query) return true;
      return [question.question_text, question.correct_answer, question.category, question.fun_fact]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [questions, searchQuery, selectedIds, typeFilter, usedFingerprints]);

  const handleAddRound = () => {
    const round = { id: newRoundId(), name: `Round ${rounds.length + 1}`, questionIds: [] };
    setRounds((prev) => [...prev, round]);
    setActiveRoundId(round.id);
  };

  const handleDeleteRound = (roundId) => {
    if (rounds.length === 1) {
      toast.error("Keep at least one round");
      return;
    }
    setRounds((prev) => prev.filter((round) => round.id !== roundId));
    if (activeRoundId === roundId) {
      const next = rounds.find((round) => round.id !== roundId);
      if (next) setActiveRoundId(next.id);
    }
  };

  const handleRenameRound = (roundId, name) => {
    setRounds((prev) => prev.map((round) => (round.id === roundId ? { ...round, name } : round)));
  };

  const toggleQuestion = (question) => {
    setRounds((prev) =>
      prev.map((round) => {
        if (round.id !== activeRound.id) return round;
        const current = round.questionIds || [];
        if (current.includes(question.id)) {
          return { ...round, questionIds: current.filter((id) => id !== question.id) };
        }
        return { ...round, questionIds: [...current, question.id] };
      })
    );
  };

  const removeFromRound = (roundId, questionId) => {
    setRounds((prev) =>
      prev.map((round) =>
        round.id === roundId ? { ...round, questionIds: (round.questionIds || []).filter((id) => id !== questionId) } : round
      )
    );
  };

  const handleGenerateForRound = async () => {
    const count = Math.max(1, Math.min(20, Number(generateCount) || 3));
    setGenerating(true);

    try {
      const { data } = await axios.post("/api/generate-session-candidates", {
        sessionId: `build-${activeRound.id}`,
        questionType: generateType,
        count,
        difficulty,
        theme,
        excludeUsed: true,
        avoidDuplicates: true,
        excludeCategories: activeRoundQuestions.map((q) => q.category).filter(Boolean),
      });

      const generated = (Array.isArray(data.candidates) ? data.candidates : []).map((candidate, index) =>
        normalizeQuestion(
          {
            ...candidate,
            id: `ai-${activeRound.id}-${Date.now()}-${index}`,
            question_type: generateType === "picture" ? "picture" : candidate.question_type,
            isGenerated: true,
          },
          generateType
        )
      );

      if (!generated.length) throw new Error("No candidates returned");

      setQuestions((prev) => [...generated, ...prev]);
      setRounds((prev) =>
        prev.map((round) =>
          round.id === activeRound.id
            ? { ...round, questionIds: [...(round.questionIds || []), ...generated.map((q) => q.id)] }
            : round
        )
      );
      toast.success(`Added ${generated.length} generated question${generated.length === 1 ? "" : "s"} to ${activeRound.name}`);
    } catch (error) {
      console.error("Round generate error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to generate questions");
    } finally {
      setGenerating(false);
    }
  };

  const handleClearSession = () => {
    clearSavedState();
    setSessionName("");
    setRounds(defaultRounds);
    setActiveRoundId("round-1");
    setTheme("");
    setTypeFilter("all");
    toast.success("Session cleared");
  };

  const handleSave = async () => {
    if (!user?.id) {
      toast.error("You must be signed in");
      return;
    }

    const builtName = sessionName.trim() || `${new Date().toLocaleDateString()} Trivia`;
    const grouped = {
      true_false_questions: [],
      multiple_choice_questions: [],
      written_questions: [],
      picture_questions: [],
    };

    rounds.forEach((round, roundIndex) => {
      (round.questionIds || []).forEach((id, sourceOrder) => {
        const question = questionById.get(String(id));
        if (!question) return;
        const type = normalizeType(question);
        const sessionQuestion = toSessionQuestion(question, round, roundIndex, sourceOrder);
        if (type === "true_false") grouped.true_false_questions.push(sessionQuestion);
        else if (type === "multiple_choice") grouped.multiple_choice_questions.push(sessionQuestion);
        else if (type === "picture") grouped.picture_questions.push(sessionQuestion);
        else grouped.written_questions.push(sessionQuestion);
      });
    });

    const total = Object.values(grouped).reduce((sum, items) => sum + items.length, 0);
    if (!total) {
      toast.error("Add at least one question before saving");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          user_id: user.id,
          name: builtName,
          session_name: builtName,
          is_past: false,
          ...grouped,
        })
        .select("id")
        .single();

      if (error) throw error;
      clearSavedState();
      toast.success("Session saved");
      navigate(`/session/${data.id}`);
    } catch (error) {
      console.error("Save built session error:", error);
      toast.error(error.message || "Failed to save session");
    } finally {
      setSaving(false);
    }
  };

  const selectedTotal = rounds.reduce((sum, round) => sum + (round.questionIds?.length || 0), 0);
  const ActiveIcon = questionTypes.find((type) => type.value === typeFilter)?.icon || List;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="text-[#71E0DC] animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="build-session-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Build <span className="gradient-text">Session</span>
          </h1>
          <p className="text-zinc-500">Create flexible rounds with any mix of question types, including picture prompts.</p>
        </div>
        <div className="flex gap-2">
          {selectedTotal > 0 && (
            <Button variant="outline" onClick={handleClearSession} className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800">
              <X size={16} className="mr-2" /> Clear
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="gradient-btn" data-testid="save-session-btn">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : <><Save className="mr-2" size={18} />Save Session</>}
          </Button>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_180px] gap-4 items-end">
            <div className="space-y-2">
              <Label className="text-zinc-300">Session Name</Label>
              <Input value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g., Tuesday Night Trivia" className="bg-zinc-950/50 border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">AI Direction</Label>
              <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. 90s night, no sports, cozy nerd trivia" className="bg-zinc-950/50 border-white/10 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Difficulty</Label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="host_hard">Host Hard</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-white">Rounds</CardTitle>
                <CardDescription className="text-zinc-500">Add, rename, and fill freely.</CardDescription>
              </div>
              <Button size="sm" onClick={handleAddRound} className="gradient-btn"><Plus size={15} /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {rounds.map((round, index) => {
              const active = activeRoundId === round.id;
              const count = round.questionIds?.length || 0;
              return (
                <div key={round.id} className={`rounded-lg border p-3 transition-all ${active ? "border-[#71E0DC]/50 bg-[#71E0DC]/10" : "border-white/10 bg-zinc-950/30"}`}>
                  <button className="w-full text-left" onClick={() => setActiveRoundId(round.id)}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-white font-semibold">{round.name || `Round ${index + 1}`}</span>
                      <Badge className="bg-zinc-800 text-zinc-300">{count}</Badge>
                    </div>
                  </button>
                  <div className="flex gap-2">
                    <Input value={round.name} onChange={(e) => handleRenameRound(round.id, e.target.value)} className="h-8 bg-zinc-950/50 border-white/10 text-white text-sm" />
                    <Button size="sm" variant="outline" onClick={() => handleDeleteRound(round.id)} className="h-8 border-zinc-700 text-zinc-400"><Trash2 size={13} /></Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-white flex items-center gap-2"><Pencil size={20} className="text-[#71E0DC]" />{activeRound.name}</CardTitle>
                  <CardDescription className="text-zinc-500">Selected questions stay in this round in the order added.</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <select value={generateType} onChange={(e) => setGenerateType(e.target.value)} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3 text-sm">
                    <option value="true_false">T/F</option>
                    <option value="multiple_choice">Multiple Choice</option>
                    <option value="written">Written</option>
                    <option value="picture">Picture</option>
                  </select>
                  <Input value={generateCount} onChange={(e) => setGenerateCount(e.target.value)} className="w-20 h-10 bg-zinc-950/50 border-white/10 text-white" />
                  <Button onClick={handleGenerateForRound} disabled={generating} className="gradient-btn">
                    {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                    Generate
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <SelectedRoundList
                questions={(activeRound.questionIds || []).map((id) => questionById.get(String(id))).filter(Boolean)}
                onRemove={(questionId) => removeFromRound(activeRound.id, questionId)}
              />
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-white flex items-center gap-2"><ActiveIcon size={20} className="text-zinc-300" />Unused Question Library</CardTitle>
                  <CardDescription className="text-zinc-500">Past-session questions are hidden unless already selected here.</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3 text-sm">
                    {questionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search unused questions..." className="pl-9 bg-zinc-950/50 border-white/10 text-white" />
              </div>

              <ScrollArea className="h-[520px] pr-3">
                {availableQuestions.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-zinc-500">No unused questions match this view.</p>
                    <Button onClick={handleGenerateForRound} disabled={generating} className="gradient-btn mt-4">
                      {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                      Generate For {activeRound.name}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {availableQuestions.map((question) => (
                      <QuestionRow key={question.id} question={question} selected={(activeRound.questionIds || []).includes(question.id)} alreadyInSession={selectedIds.has(String(question.id)) && !(activeRound.questionIds || []).includes(question.id)} onClick={() => toggleQuestion(question)} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

const SelectedRoundList = ({ questions, onRemove }) => {
  if (!questions.length) {
    return <p className="text-zinc-500 text-sm">No questions in this round yet. Browse below or generate directly into this round.</p>;
  }

  return (
    <div className="space-y-2">
      {questions.map((question, index) => (
        <div key={question.id} className="flex items-start gap-3 rounded-lg bg-zinc-950/40 border border-white/10 p-3">
          <span className="text-zinc-500 text-sm font-mono mt-0.5">{index + 1}</span>
          <div className="flex-1 min-w-0">
            <QuestionMeta question={question} />
            <p className="text-white text-sm mt-1">{question.question_text}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onRemove(question.id)} className="text-zinc-500 hover:text-white"><X size={15} /></Button>
        </div>
      ))}
    </div>
  );
};

const QuestionMeta = ({ question }) => {
  const type = normalizeType(question);
  const typeConfig = questionTypes.find((item) => item.value === type) || questionTypes[0];
  const Icon = typeConfig.icon;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-400">{question.category}</Badge>
      <Badge className="bg-zinc-800 text-zinc-300 text-xs"><Icon size={12} className={`mr-1 ${typeConfig.color}`} />{typeConfig.label}</Badge>
      {question.isGenerated && <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] text-xs">AI</Badge>}
    </div>
  );
};

const QuestionRow = ({ question, selected, alreadyInSession, onClick }) => (
  <div onClick={onClick} className={`session-question-card ${selected ? "selected" : ""} ${alreadyInSession ? "opacity-60" : ""}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <QuestionMeta question={question} />
        <p className="text-white text-sm mt-2">{question.question_text}</p>
        <p className="text-zinc-500 text-xs mt-1">Answer: <span className="text-emerald-400">{question.correct_answer}</span></p>
        {question.options?.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {question.options.map((option, index) => (
              <span key={index} className="text-xs px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400">{option}</span>
            ))}
          </div>
        )}
      </div>
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? "bg-[#71E0DC] border-[#71E0DC]" : "border-zinc-600"}`}>
        {selected && <Check size={14} className="text-zinc-900" />}
      </div>
    </div>
  </div>
);

export default BuildSession;
