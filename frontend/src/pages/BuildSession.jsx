import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
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
  Plus,
  ChevronDown,
  ChevronUp,
  Coins,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", target: 9 },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", target: 9 },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400", target: 9 },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400", target: 3 },
];

const DEFAULT_SCORING = {
  true_false: 10,
  multiple_choice: 10,
  written: 10,
  picture: 0,
};

const BUILD_STORAGE_KEY = "trivia-build-session-state";

const BuildSession = () => {
  const navigate = useNavigate();

  const loadSavedState = () => {
    try {
      const saved = localStorage.getItem(BUILD_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  };

  const savedState = loadSavedState();

  const [sessionName, setSessionName] = useState(savedState?.sessionName || "");
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(savedState?.activeTab || "true_false");
  const [searchQuery, setSearchQuery] = useState("");
  const [showScoring, setShowScoring] = useState(savedState?.showScoring || false);
  const [scoring, setScoring] = useState(savedState?.scoring || { ...DEFAULT_SCORING });
  const [showWriteForm, setShowWriteForm] = useState(null);
  const [creatingQuestion, setCreatingQuestion] = useState(false);

  const [selected, setSelected] = useState(savedState?.selected || {
    true_false: [],
    multiple_choice: [],
    written: [],
    picture: [],
  });

  // Write question form state
  const emptyForm = { question: "", answer: "", category: "", fun_fact: "", options: ["", "", "", ""], image_url: "" };
  const [writeForm, setWriteForm] = useState({ ...emptyForm });

  useEffect(() => {
    const stateToSave = { sessionName, selected, activeTab, scoring, showScoring };
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [sessionName, selected, activeTab, scoring, showScoring]);

  const clearSavedState = () => localStorage.removeItem(BUILD_STORAGE_KEY);

  const handleClearSession = () => {
    clearSavedState();
    setSessionName("");
    setSelected({ true_false: [], multiple_choice: [], written: [], picture: [] });
    setScoring({ ...DEFAULT_SCORING });
    setActiveTab("true_false");
    setShowWriteForm(null);
    toast.success("Selection cleared!");
  };

  useEffect(() => { fetchQuestions(); }, []);

 const fetchQuestions = async () => {
  try {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const normalized = (data || []).map((q) => ({
      ...q,
      question: q.question_text,
      answer: q.correct_answer,
      options: q.incorrect_answers
        ? q.incorrect_answers.split(";").map((x) => x.trim()).filter(Boolean)
        : [],
      image_url: q.image_url,
    }));

    setQuestions(normalized);
  } catch (error) {
    console.error(error);
    toast.error("Failed to load questions");
  } finally {
    setLoading(false);
  }
};

  const toggleQuestion = (questionId, type) => {
    setSelected((prev) => {
      const cur = prev[type];
      const target = questionTypes.find((t) => t.value === type)?.target || 9;
      if (cur.includes(questionId)) {
        return { ...prev, [type]: cur.filter((id) => id !== questionId) };
      } else if (cur.length < target) {
        return { ...prev, [type]: [...cur, questionId] };
      } else {
        toast.error(`Maximum ${target} questions for ${type.replace("_", " ")}`);
        return prev;
      }
    });
  };

  const handleWriteQuestion = async () => {
    const type = activeTab;
    if (!writeForm.question.trim() || !writeForm.answer.trim() || !writeForm.category.trim()) {
      toast.error("Question, answer, and category are required");
      return;
    }

    setCreatingQuestion(true);
    try {
      const payload = {
        category: writeForm.category.trim(),
        question: writeForm.question.trim(),
        answer: writeForm.answer.trim(),
        question_type: type,
        fun_fact: writeForm.fun_fact.trim() || null,
      };
      if (type === "multiple_choice") {
        const opts = writeForm.options.filter((o) => o.trim());
        if (opts.length < 2) {
          toast.error("At least 2 options required for multiple choice");
          setCreatingQuestion(false);
          return;
        }
        payload.options = opts.map((o) => o.trim());
      }
      if (type === "picture" && writeForm.image_url.trim()) {
        payload.image_url = writeForm.image_url.trim();
      }

      const res = await api.post("/questions", payload);
      const newQ = res.data;

      // Add to questions list and auto-select
      setQuestions((prev) => [newQ, ...prev]);
      const target = questionTypes.find((t) => t.value === type)?.target || 9;
      setSelected((prev) => {
        if (prev[type].length < target) {
          return { ...prev, [type]: [...prev[type], newQ.id] };
        }
        return prev;
      });

      setWriteForm({ ...emptyForm });
      setShowWriteForm(null);
      toast.success("Question created and added!");
    } catch {
      toast.error("Failed to create question");
    } finally {
      setCreatingQuestion(false);
    }
  };

  const handleSave = async () => {
    if (!sessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }
    const totalSelected = Object.values(selected).flat().length;
    if (totalSelected === 0) {
      toast.error("Please select at least one question");
      return;
    }

    // Build scoring config (only include non-default)
    const scoringConfig = {};
    let hasCustomScoring = false;
    for (const type of questionTypes) {
      const val = parseInt(scoring[type.value]) || 0;
      scoringConfig[type.value] = val;
      if (val !== DEFAULT_SCORING[type.value]) hasCustomScoring = true;
    }

    setSaving(true);
    try {
      const response = await api.post("/sessions", {
        name: sessionName,
        true_false_questions: selected.true_false,
        multiple_choice_questions: selected.multiple_choice,
        written_questions: selected.written,
        picture_questions: selected.picture,
        scoring: hasCustomScoring ? scoringConfig : null,
        is_past: true,
      });
      clearSavedState();
      toast.success("Session created!");
      navigate(`/session/${response.data.id}`);
    } catch {
      toast.error("Failed to create session");
    } finally {
      setSaving(false);
    }
  };

  const getFilteredQuestions = (type) => {
    return questions.filter((q) => {
      if (q.question_type !== type) return false;
      if (searchQuery && !q.question.toLowerCase().includes(searchQuery.toLowerCase()) && !q.category.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  };

  const getUsedCategories = (type) => {
    return questions.filter((q) => selected[type].includes(q.id)).map((q) => q.category);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="text-[#71E0DC] animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="build-session-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Build <span className="gradient-text">Trivia Session</span>
          </h1>
          <p className="text-zinc-500">Select from your library, write custom questions, and set scoring</p>
        </div>
        <div className="flex gap-2">
          {(sessionName || Object.values(selected).flat().length > 0) && (
            <Button variant="outline" onClick={handleClearSession} className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800" data-testid="clear-build-btn">
              <X size={16} className="mr-2" /> Clear
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="gradient-btn" data-testid="save-session-btn">
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : <><Save className="mr-2" size={18} /> Save Session</>}
          </Button>
        </div>
      </div>

      {/* Session Name + Search */}
      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label className="text-zinc-300">Session Name</Label>
              <Input value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g., Thursday Night Trivia - Week 42" className="bg-zinc-950/50 border-white/10 text-white" data-testid="session-name-input" />
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search questions..." className="pl-9 bg-zinc-950/50 border-white/10 text-white" data-testid="session-search-input" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scoring Options */}
      <Card className="glass-card mb-6">
        <CardContent className="p-0">
          <button
            onClick={() => setShowScoring(!showScoring)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors rounded-lg"
            data-testid="scoring-toggle-btn"
          >
            <div className="flex items-center gap-3">
              <Coins className="text-amber-400" size={20} />
              <div>
                <p className="text-white font-semibold">Scoring Options</p>
                <p className="text-zinc-500 text-sm">
                  {Object.entries(scoring).filter(([k, v]) => v !== DEFAULT_SCORING[k]).length > 0
                    ? "Custom scoring configured"
                    : "Default: 10 pts per question, Picture = Wager"}
                </p>
              </div>
            </div>
            {showScoring ? <ChevronUp className="text-zinc-400" size={20} /> : <ChevronDown className="text-zinc-400" size={20} />}
          </button>

          {showScoring && (
            <div className="px-4 pb-4 pt-0">
              <div className="border-t border-white/5 pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {questionTypes.map((type) => {
                    const TypeIcon = type.icon;
                    const isPicture = type.value === "picture";
                    return (
                      <div key={type.value} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <TypeIcon className={type.color} size={16} />
                          <Label className="text-zinc-300 text-sm">{type.label}</Label>
                        </div>
                        {isPicture ? (
                          <div className="h-10 px-3 flex items-center rounded-md bg-purple-500/10 border border-purple-500/20">
                            <span className="text-purple-300 text-sm">Wager-based</span>
                          </div>
                        ) : (
                          <div className="relative">
                            <Input
                              type="number"
                              min="1"
                              max="100"
                              value={scoring[type.value]}
                              onChange={(e) => setScoring((prev) => ({ ...prev, [type.value]: parseInt(e.target.value) || 0 }))}
                              className="bg-zinc-950/50 border-white/10 text-white pr-10 h-10"
                              data-testid={`scoring-${type.value}`}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">pts</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-zinc-600 text-xs mt-3">Picture rounds use player wagering instead of fixed points. Points can also be adjusted per-question during a live game.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {questionTypes.map((type) => {
          const TypeIcon = type.icon;
          const count = selected[type.value].length;
          const isComplete = count === type.target;
          return (
            <Card
              key={type.value}
              className={`glass-card cursor-pointer transition-all ${activeTab === type.value ? "border-[#71E0DC]/50" : ""} ${isComplete ? "border-emerald-500/50" : ""}`}
              onClick={() => setActiveTab(type.value)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TypeIcon className={type.color} size={20} />
                  {isComplete && <Check className="text-emerald-400" size={16} />}
                </div>
                <p className="text-white font-semibold">{type.label}</p>
                <p className={`text-sm ${isComplete ? "text-emerald-400" : "text-zinc-500"}`}>{count}/{type.target} selected</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Question Selection Tabs */}
      <Card className="glass-card">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <TabsList className="bg-zinc-800/50 justify-start">
                {questionTypes.map((type) => {
                  const TypeIcon = type.icon;
                  return (
                    <TabsTrigger key={type.value} value={type.value} className="data-[state=active]:bg-zinc-700" data-testid={`tab-${type.value}`}>
                      <TypeIcon size={16} className={`mr-2 ${type.color}`} />
                      <span className="hidden sm:inline">{type.label}</span>
                      <Badge className="ml-2 bg-zinc-700 text-zinc-300">{selected[type.value].length}/{type.target}</Badge>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowWriteForm(showWriteForm === activeTab ? null : activeTab);
                  setWriteForm({ ...emptyForm });
                }}
                className="border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10"
                data-testid="write-question-btn"
              >
                <Plus size={16} className="mr-1" /> Write Custom
              </Button>
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            {questionTypes.map((type) => (
              <TabsContent key={type.value} value={type.value} className="mt-0">
                {/* Write Custom Question Form */}
                {showWriteForm === type.value && (
                  <WriteQuestionForm
                    type={type.value}
                    form={writeForm}
                    setForm={setWriteForm}
                    onSubmit={handleWriteQuestion}
                    onCancel={() => { setShowWriteForm(null); setWriteForm({ ...emptyForm }); }}
                    creating={creatingQuestion}
                  />
                )}

                {/* Used Categories Warning */}
                {getUsedCategories(type.value).length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-amber-400 text-sm">
                      <strong>Categories used:</strong> {getUsedCategories(type.value).join(", ")}
                    </p>
                    <p className="text-amber-400/70 text-xs mt-1">Each category should be unique across all questions</p>
                  </div>
                )}

                <ScrollArea className="h-[500px]">
                  {getFilteredQuestions(type.value).length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-zinc-500">No {type.label.toLowerCase()} questions available</p>
                      <p className="text-zinc-600 text-sm mt-1">Generate or write some questions first!</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 border-[#71E0DC]/30 text-[#71E0DC]"
                        onClick={() => { setShowWriteForm(type.value); setWriteForm({ ...emptyForm }); }}
                        data-testid="write-first-question-btn"
                      >
                        <Plus size={16} className="mr-1" /> Write One
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 pr-4">
                      {getFilteredQuestions(type.value).map((question, index) => {
                        const isSelected = selected[type.value].includes(question.id);
                        const categoryUsed = !isSelected && getUsedCategories(type.value).includes(question.category);

                        return (
                          <div
                            key={question.id}
                            onClick={() => !categoryUsed && toggleQuestion(question.id, type.value)}
                            className={`session-question-card ${isSelected ? "selected" : ""} ${categoryUsed ? "opacity-50 cursor-not-allowed" : ""}`}
                            data-testid={`question-${type.value}-${index}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <Badge variant="outline" className={`text-xs ${categoryUsed ? "border-amber-500/50 text-amber-400" : "border-zinc-700 text-zinc-400"}`}>
                                    {question.category}{categoryUsed && " (used)"}
                                  </Badge>
                                  {question.status === "liked" && <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">Liked</Badge>}
                                  {question.source === "manual" && <Badge className="bg-zinc-700/50 text-zinc-400 text-xs">Custom</Badge>}
                                </div>
                                <p className="text-white text-sm">{question.question}</p>
                                <p className="text-zinc-500 text-xs mt-1">Answer: <span className="text-emerald-400">{question.answer}</span></p>
                                {question.options && question.options.length > 0 && (
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    {question.options.map((o, i) => (
                                      <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400">{o}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-[#71E0DC] border-[#71E0DC]" : "border-zinc-600"}`}>
                                {isSelected && <Check size={14} className="text-zinc-900" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            ))}
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
};

/* ──────────── Write Question Form Component ──────────── */
const WriteQuestionForm = ({ type, form, setForm, onSubmit, onCancel, creating }) => {
  const isMC = type === "multiple_choice";
  const isTF = type === "true_false";
  const isPicture = type === "picture";

  const updateOption = (idx, val) => {
    setForm((prev) => {
      const opts = [...prev.options];
      opts[idx] = val;
      return { ...prev, options: opts };
    });
  };

  return (
    <div className="mb-6 p-4 rounded-xl bg-zinc-900/80 border border-[#71E0DC]/20" data-testid="write-question-form">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Plus size={18} className="text-[#71E0DC]" /> Write Custom Question
        </h3>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-zinc-500 hover:text-white h-8" data-testid="cancel-write-btn">
          <X size={16} />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-zinc-400 text-sm">Category *</Label>
            <Input
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              placeholder="e.g., Science, History, Pop Culture"
              className="bg-zinc-950/50 border-white/10 text-white"
              data-testid="write-category-input"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400 text-sm">Fun Fact (optional)</Label>
            <Input
              value={form.fun_fact}
              onChange={(e) => setForm((p) => ({ ...p, fun_fact: e.target.value }))}
              placeholder="An interesting fact about the answer"
              className="bg-zinc-950/50 border-white/10 text-white"
              data-testid="write-funfact-input"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-zinc-400 text-sm">Question *</Label>
          <Textarea
            value={form.question}
            onChange={(e) => setForm((p) => ({ ...p, question: e.target.value }))}
            placeholder="Type your question here..."
            className="bg-zinc-950/50 border-white/10 text-white min-h-[80px] resize-none"
            data-testid="write-question-input"
          />
        </div>

        {isTF ? (
          <div className="space-y-2">
            <Label className="text-zinc-400 text-sm">Answer *</Label>
            <div className="flex gap-3">
              <Button
                type="button"
                variant={form.answer === "True" ? "default" : "outline"}
                onClick={() => setForm((p) => ({ ...p, answer: "True" }))}
                className={form.answer === "True" ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "border-zinc-700 text-zinc-400"}
                data-testid="write-answer-true"
              >
                True
              </Button>
              <Button
                type="button"
                variant={form.answer === "False" ? "default" : "outline"}
                onClick={() => setForm((p) => ({ ...p, answer: "False" }))}
                className={form.answer === "False" ? "bg-red-500/20 border-red-500/40 text-red-300" : "border-zinc-700 text-zinc-400"}
                data-testid="write-answer-false"
              >
                False
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-zinc-400 text-sm">Answer *</Label>
            <Input
              value={form.answer}
              onChange={(e) => setForm((p) => ({ ...p, answer: e.target.value }))}
              placeholder={isMC ? "The correct option (must match one of the options below)" : "The correct answer"}
              className="bg-zinc-950/50 border-white/10 text-white"
              data-testid="write-answer-input"
            />
          </div>
        )}

        {isMC && (
          <div className="space-y-2">
            <Label className="text-zinc-400 text-sm">Options (at least 2, max 4)</Label>
            <div className="grid grid-cols-2 gap-2">
              {form.options.map((opt, i) => (
                <Input
                  key={i}
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className={`bg-zinc-950/50 border-white/10 text-white ${opt && opt === form.answer ? "border-emerald-500/50" : ""}`}
                  data-testid={`write-option-${i}`}
                />
              ))}
            </div>
            <p className="text-zinc-600 text-xs">The answer should match one of these options exactly.</p>
          </div>
        )}

        {isPicture && (
          <div className="space-y-2">
            <Label className="text-zinc-400 text-sm">Image URL (optional)</Label>
            <Input
              value={form.image_url}
              onChange={(e) => setForm((p) => ({ ...p, image_url: e.target.value }))}
              placeholder="https://example.com/image.jpg"
              className="bg-zinc-950/50 border-white/10 text-white"
              data-testid="write-image-url-input"
            />
            <p className="text-zinc-600 text-xs">You can also upload images from the Question Library later.</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} className="border-zinc-700 text-zinc-400" data-testid="cancel-write-btn-bottom">
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={creating} className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold" data-testid="submit-write-btn">
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus size={16} className="mr-2" />}
            Create & Select
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BuildSession;
