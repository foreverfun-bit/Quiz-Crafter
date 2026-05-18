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
} from "lucide-react";
import { toast } from "sonner";

const rounds = [
  {
    id: "round1",
    label: "Round 1",
    shortLabel: "R1",
    type: "true_false",
    storageKey: "true_false_questions",
    title: "True/False",
    target: 9,
    bonusTarget: 1,
    icon: CheckCircle,
    color: "text-[#71E0DC]",
  },
  {
    id: "round2",
    label: "Round 2",
    shortLabel: "R2",
    type: "multiple_choice",
    storageKey: "multiple_choice_questions",
    title: "Multiple Choice",
    target: 9,
    bonusTarget: 1,
    icon: List,
    color: "text-[#AEB2EF]",
  },
  {
    id: "round3",
    label: "Round 3",
    shortLabel: "R3",
    type: "written",
    storageKey: "written_questions",
    title: "Written Answer",
    target: 9,
    bonusTarget: 1,
    icon: MessageSquare,
    color: "text-emerald-400",
  },
];

const emptySelected = {
  round1: [],
  round2: [],
  round3: [],
  picture: [],
};

const BUILD_STORAGE_KEY = "trivia-round-builder-state-v2";

const parseAnswerOptions = (value) => {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(";").map((x) => x.trim()).filter(Boolean);
};

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const fingerprint = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeQuestion = (q, fallbackType) => ({
  ...q,
  id: q.id || q.local_id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  question_text: normalizeText(q.question_text || q.question),
  correct_answer: normalizeText(q.correct_answer || q.answer),
  question_type: q.question_type || fallbackType || "written",
  category: normalizeText(q.category) || "General",
  incorrect_answers: q.incorrect_answers ?? null,
  options: parseAnswerOptions(q.incorrect_answers ?? q.options),
  fun_fact: normalizeText(q.fun_fact),
  image_url: q.image_url || "",
  isGenerated: Boolean(q.isGenerated),
});

const toSessionQuestion = (question, type) => ({
  category: question.category || "General",
  question_text: question.question_text,
  correct_answer: question.correct_answer,
  question_type: type === "picture" ? "picture" : type,
  incorrect_answers: Array.isArray(question.options) && question.options.length ? question.options.join("; ") : question.incorrect_answers || null,
  fun_fact: question.fun_fact || null,
  image_url: question.image_url || null,
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
  const [questions, setQuestions] = useState([]);
  const [usedFingerprints, setUsedFingerprints] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeRoundId, setActiveRoundId] = useState(savedState?.activeRoundId || "round1");
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState(savedState?.theme || "");
  const [difficulty, setDifficulty] = useState(savedState?.difficulty || "host_hard");
  const [generatingRound, setGeneratingRound] = useState(null);
  const [selected, setSelected] = useState(savedState?.selected || emptySelected);

  useEffect(() => {
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify({ sessionName, selected, activeRoundId, theme, difficulty }));
  }, [sessionName, selected, activeRoundId, theme, difficulty]);

  useEffect(() => {
    fetchBuilderData();
  }, []);

  const clearSavedState = () => localStorage.removeItem(BUILD_STORAGE_KEY);

  const fetchBuilderData = async () => {
    try {
      setLoading(true);

      const [questionsResult, sessionsResult] = await Promise.all([
        supabase.from("questions").select("*").order("created_at", { ascending: false }),
        user?.id
          ? supabase.from("sessions").select("*").eq("user_id", user.id)
          : supabase.from("sessions").select("*").limit(0),
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

  const activeRound = rounds.find((round) => round.id === activeRoundId) || rounds[0];

  const selectedQuestionsByRound = useMemo(() => {
    const all = [...questions];
    const byId = new Map(all.map((q) => [String(q.id), q]));

    return {
      round1: (selected.round1 || []).map((id) => byId.get(String(id))).filter(Boolean),
      round2: (selected.round2 || []).map((id) => byId.get(String(id))).filter(Boolean),
      round3: (selected.round3 || []).map((id) => byId.get(String(id))).filter(Boolean),
      picture: (selected.picture || []).map((id) => byId.get(String(id))).filter(Boolean),
    };
  }, [questions, selected]);

  const activeSelected = selected[activeRound.id] || [];
  const selectedPictures = selected.picture || [];

  const availableQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedIds = new Set([...(selected[activeRound.id] || []), ...(selected.picture || [])].map(String));

    return questions.filter((question) => {
      const isPicture = question.question_type === "picture" || Boolean(question.image_url);
      if (isPicture) return false;
      if (question.question_type !== activeRound.type) return false;
      if (usedFingerprints.has(fingerprint(question.question_text)) && !selectedIds.has(String(question.id))) return false;
      if (!query) return true;
      return [question.question_text, question.correct_answer, question.category, question.fun_fact]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeRound, questions, searchQuery, selected, usedFingerprints]);

  const availablePictures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedIds = new Set((selected.picture || []).map(String));

    return questions.filter((question) => {
      const isPicture = question.question_type === "picture" || Boolean(question.image_url);
      if (!isPicture) return false;
      if (usedFingerprints.has(fingerprint(question.question_text)) && !selectedIds.has(String(question.id))) return false;
      if (!query) return true;
      return [question.question_text, question.correct_answer, question.category, question.fun_fact]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [questions, searchQuery, selected.picture, usedFingerprints]);

  const toggleMainQuestion = (question) => {
    setSelected((prev) => {
      const current = prev[activeRound.id] || [];
      const key = question.id;
      if (current.includes(key)) {
        return { ...prev, [activeRound.id]: current.filter((id) => id !== key) };
      }
      if (current.length >= activeRound.target) {
        toast.error(`${activeRound.label} already has ${activeRound.target} questions`);
        return prev;
      }
      return { ...prev, [activeRound.id]: [...current, key] };
    });
  };

  const togglePictureQuestion = (question) => {
    setSelected((prev) => {
      const current = prev.picture || [];
      const key = question.id;
      if (current.includes(key)) return { ...prev, picture: current.filter((id) => id !== key) };
      if (current.length >= 3) {
        toast.error("The standard format has 3 picture bonus questions");
        return prev;
      }
      return { ...prev, picture: [...current, key] };
    });
  };

  const handleGenerateForActiveRound = async () => {
    const needed = Math.max(1, activeRound.target - activeSelected.length);
    setGeneratingRound(activeRound.id);

    try {
      const { data } = await axios.post("/api/generate-session-candidates", {
        sessionId: `build-${activeRound.id}`,
        questionType: activeRound.type,
        count: Math.min(needed, 5),
        difficulty,
        theme,
        excludeUsed: true,
        avoidDuplicates: true,
        excludeCategories: selectedQuestionsByRound[activeRound.id].map((q) => q.category).filter(Boolean),
      });

      const generated = (Array.isArray(data.candidates) ? data.candidates : []).map((candidate, index) =>
        normalizeQuestion(
          {
            ...candidate,
            id: `ai-${activeRound.id}-${Date.now()}-${index}`,
            isGenerated: true,
          },
          activeRound.type
        )
      );

      if (!generated.length) throw new Error("No candidates returned");

      setQuestions((prev) => [...generated, ...prev]);
      setSelected((prev) => ({
        ...prev,
        [activeRound.id]: [...(prev[activeRound.id] || []), ...generated.map((q) => q.id)].slice(0, activeRound.target),
      }));
      toast.success(`Added ${generated.length} generated question${generated.length === 1 ? "" : "s"} to ${activeRound.label}`);
    } catch (error) {
      console.error("Round generate error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to generate round questions");
    } finally {
      setGeneratingRound(null);
    }
  };

  const handleGeneratePictureBonus = async () => {
    const needed = Math.max(1, 3 - selectedPictures.length);
    setGeneratingRound("picture");

    try {
      const { data } = await axios.post("/api/generate-session-candidates", {
        sessionId: "build-picture",
        questionType: "picture",
        count: Math.min(needed, 3),
        difficulty,
        theme,
        excludeUsed: true,
        avoidDuplicates: true,
      });

      const generated = (Array.isArray(data.candidates) ? data.candidates : []).map((candidate, index) =>
        normalizeQuestion(
          {
            ...candidate,
            id: `ai-picture-${Date.now()}-${index}`,
            question_type: "picture",
            isGenerated: true,
          },
          "picture"
        )
      );

      if (!generated.length) throw new Error("No picture candidates returned");

      setQuestions((prev) => [...generated, ...prev]);
      setSelected((prev) => ({ ...prev, picture: [...(prev.picture || []), ...generated.map((q) => q.id)].slice(0, 3) }));
      toast.success(`Added ${generated.length} picture bonus prompt${generated.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Picture generate error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to generate picture bonuses");
    } finally {
      setGeneratingRound(null);
    }
  };

  const handleClearSession = () => {
    clearSavedState();
    setSessionName("");
    setSelected(emptySelected);
    setActiveRoundId("round1");
    setTheme("");
    toast.success("Session cleared");
  };

  const handleSave = async () => {
    if (!user?.id) {
      toast.error("You must be signed in");
      return;
    }

    const builtName = sessionName.trim() || `${new Date().toLocaleDateString()} Trivia`;
    const trueFalseQuestions = selectedQuestionsByRound.round1.map((q) => toSessionQuestion(q, "true_false"));
    const multipleChoiceQuestions = selectedQuestionsByRound.round2.map((q) => toSessionQuestion(q, "multiple_choice"));
    const writtenQuestions = selectedQuestionsByRound.round3.map((q) => toSessionQuestion(q, "written"));
    const pictureQuestions = selectedQuestionsByRound.picture.map((q) => toSessionQuestion(q, "picture"));

    if (!trueFalseQuestions.length && !multipleChoiceQuestions.length && !writtenQuestions.length && !pictureQuestions.length) {
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
          true_false_questions: trueFalseQuestions,
          multiple_choice_questions: multipleChoiceQuestions,
          written_questions: writtenQuestions,
          picture_questions: pictureQuestions,
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

  const selectedTotal = Object.values(selected).flat().length;

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
          <p className="text-zinc-500">Assemble rounds, browse unused questions, and generate fresh gaps in place.</p>
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
              <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. weird science, no sports, cozy nerd trivia" className="bg-zinc-950/50 border-white/10 text-white" />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {rounds.map((round) => {
          const Icon = round.icon;
          const count = selected[round.id]?.length || 0;
          const complete = count >= round.target;
          return (
            <Card key={round.id} onClick={() => setActiveRoundId(round.id)} className={`glass-card cursor-pointer transition-all ${activeRoundId === round.id ? "border-[#71E0DC]/50" : ""} ${complete ? "border-emerald-500/40" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Icon className={round.color} size={22} />
                  {complete && <Check className="text-emerald-400" size={18} />}
                </div>
                <p className="text-white font-semibold">{round.label}: {round.title}</p>
                <p className={`text-sm ${complete ? "text-emerald-400" : "text-zinc-500"}`}>{count}/{round.target} main questions</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <activeRound.icon className={activeRound.color} size={20} />
                  {activeRound.label}: {activeRound.title}
                </CardTitle>
                <CardDescription className="text-zinc-500">Only unused saved questions are shown here.</CardDescription>
              </div>
              <Button onClick={handleGenerateForActiveRound} disabled={generatingRound === activeRound.id || activeSelected.length >= activeRound.target} className="gradient-btn">
                {generatingRound === activeRound.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                Generate For Round
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search unused questions..." className="pl-9 bg-zinc-950/50 border-white/10 text-white" />
            </div>

            <SelectedStrip questions={selectedQuestionsByRound[activeRound.id]} onRemove={(id) => toggleMainQuestion({ id })} />

            <ScrollArea className="h-[520px] pr-3">
              {availableQuestions.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-zinc-500">No unused {activeRound.title.toLowerCase()} questions found.</p>
                  <Button onClick={handleGenerateForActiveRound} disabled={generatingRound === activeRound.id} className="gradient-btn mt-4">
                    {generatingRound === activeRound.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                    Generate Some
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {availableQuestions.map((question) => (
                    <QuestionRow key={question.id} question={question} selected={(selected[activeRound.id] || []).includes(question.id)} onClick={() => toggleMainQuestion(question)} />
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-white flex items-center gap-2"><Image className="text-amber-400" size={20} />Picture Bonuses</CardTitle>
                <CardDescription className="text-zinc-500">One bonus per round, 3 total.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={handleGeneratePictureBonus} disabled={generatingRound === "picture" || selectedPictures.length >= 3} className="border-amber-500/30 text-amber-300">
                {generatingRound === "picture" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus size={15} />}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <p className="text-sm text-zinc-400">Selected: <span className="text-amber-300">{selectedPictures.length}/3</span></p>
            </div>
            <SelectedStrip questions={selectedQuestionsByRound.picture} onRemove={(id) => togglePictureQuestion({ id })} compact />
            <ScrollArea className="h-[500px] pr-2">
              {availablePictures.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-zinc-500 text-sm">No unused picture prompts found.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {availablePictures.map((question) => (
                    <QuestionRow key={question.id} question={question} selected={(selected.picture || []).includes(question.id)} onClick={() => togglePictureQuestion(question)} compact />
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const SelectedStrip = ({ questions, onRemove, compact = false }) => {
  if (!questions.length) return null;
  return (
    <div className="mb-4 p-3 rounded-lg bg-[#71E0DC]/10 border border-[#71E0DC]/20">
      <p className="text-[#71E0DC] text-sm font-medium mb-2">Selected</p>
      <div className="flex flex-wrap gap-2">
        {questions.map((question, index) => (
          <button key={question.id} onClick={() => onRemove(question.id)} className="inline-flex items-center gap-2 rounded-full bg-zinc-900/80 border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:text-white">
            <span>{compact ? index + 1 : `${index + 1}. ${question.category}`}</span>
            <X size={12} />
          </button>
        ))}
      </div>
    </div>
  );
};

const QuestionRow = ({ question, selected, onClick, compact = false }) => (
  <div onClick={onClick} className={`session-question-card ${selected ? "selected" : ""}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-400">{question.category}</Badge>
          {question.isGenerated && <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] text-xs">AI</Badge>}
        </div>
        <p className={`text-white ${compact ? "text-xs" : "text-sm"}`}>{question.question_text}</p>
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
