import { useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sparkles,
  CheckCircle,
  List,
  MessageSquare,
  Loader2,
  Trash2,
  Layers,
  Wand2,
  RefreshCw,
  Ban,
  Upload,
  Lock,
  X,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", round: "Round 1" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", round: "Round 2" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400", round: "Round 3" },
];

const emptyGroupedCandidates = {
  true_false: [],
  multiple_choice: [],
  written: [],
};

const standardCounts = {
  true_false: 9,
  multiple_choice: 9,
  written: 9,
};

const difficultyLabels = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  host_hard: "Host Hard",
};

const CATEGORY_PREF_KEY = "quiz-crafter-category-preferences";
const REJECTED_AI_KEY = "quiz-crafter-rejected-ai-questions";
const GENERATED_HISTORY_KEY = "quiz-crafter-recent-ai-suggestions";
const LOCKED_CATEGORY_KEY = "quiz-crafter-locked-generator-categories";

const cleanList = (values) => values.map((value) => String(value || "").trim()).filter(Boolean);
const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const fingerprint = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const candidateFingerprint = (candidate) => fingerprint(`${candidate?.question_text || ""} ${candidate?.correct_answer || ""}`);

const readJsonArray = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeJsonArray = (key, values) => {
  localStorage.setItem(key, JSON.stringify([...new Set(values.filter(Boolean))]));
};

const rememberGenerated = (groupedCandidates) => {
  const current = readJsonArray(GENERATED_HISTORY_KEY);
  const next = Object.values(groupedCandidates).flatMap((items) => items.map(candidateFingerprint)).filter(Boolean);
  writeJsonArray(GENERATED_HISTORY_KEY, [...next, ...current].slice(0, 500));
};

const readCategoryPrefs = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATEGORY_PREF_KEY) || "{}");
    return {
      approved: Array.isArray(parsed.approved) ? parsed.approved : [],
      rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
    };
  } catch {
    return { approved: [], rejected: [] };
  }
};

const writeCategoryPrefs = ({ approved, rejected }) => {
  localStorage.setItem(
    CATEGORY_PREF_KEY,
    JSON.stringify({
      approved: [...new Set(cleanList(approved || []))],
      rejected: [...new Set(cleanList(rejected || []))],
    })
  );
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const Generate = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState("standard");

  const [difficulty, setDifficulty] = useState("host_hard");
  const [theme, setTheme] = useState("");
  const [excludeUsed, setExcludeUsed] = useState(true);
  const [avoidDuplicates, setAvoidDuplicates] = useState(true);
  const [includeMediaIdeas, setIncludeMediaIdeas] = useState(false);
  const [lockedCategories, setLockedCategories] = useState(() => readJsonArray(LOCKED_CATEGORY_KEY));

  const [roundThemeSubject, setRoundThemeSubject] = useState("");
  const [freeBuildType, setFreeBuildType] = useState("multiple_choice");
  const [freeBuildCount, setFreeBuildCount] = useState("5");

  const [groupedCandidates, setGroupedCandidates] = useState(emptyGroupedCandidates);
  const [generating, setGenerating] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [refreshingKey, setRefreshingKey] = useState(null);

  const totalGenerated = useMemo(() => {
    return Object.values(groupedCandidates).reduce((sum, arr) => sum + arr.length, 0);
  }, [groupedCandidates]);

  const visibleCandidateFingerprints = () => Object.values(groupedCandidates).flatMap((items) => items.map(candidateFingerprint)).filter(Boolean);

  const clearCandidates = () => {
    setGroupedCandidates(emptyGroupedCandidates);
  };

  const getGenerationPreferences = (extraRejectedQuestions = []) => {
    const prefs = readCategoryPrefs();
    const rejectedQuestions = [...readJsonArray(REJECTED_AI_KEY), ...extraRejectedQuestions];

    return {
      approvedCategories: cleanList(prefs.approved),
      rejectedCategories: cleanList(prefs.rejected),
      lockedCategories: cleanList(lockedCategories),
      rejectedQuestions: cleanList(rejectedQuestions),
    };
  };

  const saveLockedCategories = (nextCategories) => {
    const cleaned = [...new Set(cleanList(nextCategories))];
    setLockedCategories(cleaned);
    writeJsonArray(LOCKED_CATEGORY_KEY, cleaned);
  };

  const handleLockCategory = (category) => {
    const cleanCategory = normalizeText(category);
    if (!cleanCategory) return;

    const prefs = readCategoryPrefs();
    const approved = [...prefs.approved.filter((item) => item.toLowerCase() !== cleanCategory.toLowerCase()), cleanCategory];
    const rejected = prefs.rejected.filter((item) => item.toLowerCase() !== cleanCategory.toLowerCase());
    writeCategoryPrefs({ approved, rejected });
    saveLockedCategories([...lockedCategories, cleanCategory]);
    toast.success(`${cleanCategory} locked for generation`);
  };

  const handleUnlockCategory = (category) => {
    const cleanCategory = normalizeText(category);
    saveLockedCategories(lockedCategories.filter((item) => item.toLowerCase() !== cleanCategory.toLowerCase()));
    toast.success(`${cleanCategory} unlocked`);
  };

  const callGenerateRoute = async ({ questionType, count, themeValue, excludeCategories = [], extraRejectedQuestions = [] }) => {
    const preferences = getGenerationPreferences(extraRejectedQuestions);

    const { data } = await axios.post("/api/generate-session-candidates", {
      sessionId: `generate-${mode}`,
      questionType,
      difficulty,
      theme: themeValue,
      excludeUsed,
      avoidDuplicates,
      includeImagePrompt: includeMediaIdeas,
      excludeCategories,
      count,
      currentBatchQuestions: [...readJsonArray(GENERATED_HISTORY_KEY), ...visibleCandidateFingerprints()],
      ...preferences,
    });

    return Array.isArray(data.candidates) ? data.candidates : [];
  };

  const handleGenerate = async () => {
    setGenerating(true);

    try {
      if (mode === "theme" && !roundThemeSubject.trim()) {
        throw new Error("Enter a theme subject first");
      }

      if (mode === "free_build" && !freeBuildType) {
        throw new Error("Choose a question type");
      }

      if (mode === "free_build" && (!freeBuildCount || Number(freeBuildCount) < 1)) {
        throw new Error("Enter a valid quantity");
      }

      let next = { ...emptyGroupedCandidates };

      if (mode === "standard") {
        const [tf, mc, written] = await Promise.all([
          callGenerateRoute({ questionType: "true_false", count: standardCounts.true_false, themeValue: theme || "" }),
          callGenerateRoute({ questionType: "multiple_choice", count: standardCounts.multiple_choice, themeValue: theme || "" }),
          callGenerateRoute({ questionType: "written", count: standardCounts.written, themeValue: theme || "" }),
        ]);

        next = { true_false: tf, multiple_choice: mc, written };
      } else if (mode === "theme") {
        const [tf, mc, written] = await Promise.all([
          callGenerateRoute({ questionType: "true_false", count: 3, themeValue: roundThemeSubject }),
          callGenerateRoute({ questionType: "multiple_choice", count: 3, themeValue: roundThemeSubject }),
          callGenerateRoute({ questionType: "written", count: 3, themeValue: roundThemeSubject }),
        ]);

        next = { true_false: tf, multiple_choice: mc, written };
      } else {
        const generated = await callGenerateRoute({
          questionType: freeBuildType,
          count: Number(freeBuildCount),
          themeValue: theme || "",
        });

        next = { ...emptyGroupedCandidates, [freeBuildType]: generated };
      }

      setGroupedCandidates(next);
      rememberGenerated(next);
      const total = Object.values(next).reduce((sum, arr) => sum + arr.length, 0);
      toast.success(`${total} candidates generated`);
    } catch (error) {
      console.error("Generate error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to generate questions");
    } finally {
      setGenerating(false);
    }
  };

  const handleRefreshQuestion = async (type, index) => {
    const key = `${type}-${index}`;
    const current = groupedCandidates[type]?.[index];
    if (!current) return;

    setRefreshingKey(key);

    try {
      const generated = await callGenerateRoute({
        questionType: type,
        count: 1,
        themeValue: mode === "theme" ? roundThemeSubject : theme || "",
        extraRejectedQuestions: [candidateFingerprint(current)],
      });

      if (!generated.length) {
        toast.error("Could not find a fresh replacement");
        return;
      }

      setGroupedCandidates((prev) => {
        const updated = {
          ...prev,
          [type]: prev[type].map((candidate, i) => (i === index ? generated[0] : candidate)),
        };
        rememberGenerated(updated);
        return updated;
      });

      toast.success("Question refreshed");
    } catch (error) {
      console.error("Refresh error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to refresh question");
    } finally {
      setRefreshingKey(null);
    }
  };

  const updateCandidate = (type, index, patch) => {
    setGroupedCandidates((prev) => ({
      ...prev,
      [type]: prev[type].map((candidate, i) => (i === index ? { ...candidate, ...patch } : candidate)),
    }));
  };

  const handleDropImage = async (event, type, index) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Drop an image file");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    updateCandidate(type, index, { image_url: dataUrl });
    toast.success("Image attached");
  };

  const handleDiscardQuestion = (type, index) => {
    const candidate = groupedCandidates[type]?.[index];
    const rejected = readJsonArray(REJECTED_AI_KEY);
    const rejectedFingerprint = candidateFingerprint(candidate);

    if (rejectedFingerprint) {
      writeJsonArray(REJECTED_AI_KEY, [...rejected, rejectedFingerprint]);
    }

    setGroupedCandidates((prev) => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }));

    toast.success("Question discarded permanently");
  };

  const handleRejectCategory = (type, index) => {
    const category = normalizeText(groupedCandidates[type]?.[index]?.category);
    if (!category) return;

    const prefs = readCategoryPrefs();
    const approved = prefs.approved.filter((item) => item.toLowerCase() !== category.toLowerCase());
    const rejected = [...prefs.rejected, category];
    writeCategoryPrefs({ approved, rejected });
    saveLockedCategories(lockedCategories.filter((item) => item.toLowerCase() !== category.toLowerCase()));

    setGroupedCandidates((prev) => ({
      ...prev,
      [type]: prev[type].filter((candidate) => normalizeText(candidate.category).toLowerCase() !== category.toLowerCase()),
    }));

    toast.success(`${category} added to rejected categories`);
  };

  const handleDiscardSection = (type) => {
    setGroupedCandidates((prev) => ({ ...prev, [type]: [] }));
  };

  const handleDiscardAll = () => {
    clearCandidates();
    toast.success("Candidates cleared");
  };

  const handleUpdateCandidateCategory = (type, index, value) => {
    updateCandidate(type, index, { category: value });
  };

  const handleSaveToLibrary = async (candidate, type, index) => {
    const key = `${type}-${index}`;
    setSavingKey(key);

    try {
      if (!user?.id) throw new Error("You must be signed in");

      await axios.post("/api/save-custom-question?schema=core-v2", {
        user_id: user.id,
        category: candidate.category || "General",
        question_text: candidate.question_text,
        question_type: candidate.question_type || type,
        correct_answer: candidate.correct_answer,
        incorrect_answers: cleanList(candidate.incorrect_answers || []),
        fun_fact: candidate.fun_fact || null,
        image_url: candidate.image_url || null,
      });

      setGroupedCandidates((prev) => ({
        ...prev,
        [type]: prev[type].filter((_, i) => i !== index),
      }));

      toast.success("Saved to library");
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to save question");
    } finally {
      setSavingKey(null);
    }
  };

  const sectionsToRender = questionTypes.filter((t) => groupedCandidates[t.value]?.length > 0);

  const renderQuestionCard = (candidate, type, index) => {
    const saveId = `${type}-${index}`;
    const isRefreshing = refreshingKey === saveId;
    const categoryLocked = lockedCategories.some((item) => item.toLowerCase() === normalizeText(candidate.category).toLowerCase());

    return (
      <Card key={saveId} className="bg-zinc-900/70 border-white/10">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <Input
              value={candidate.category || ""}
              onChange={(e) => handleUpdateCandidateCategory(type, index, e.target.value)}
              placeholder="Category"
              className="max-w-xs bg-zinc-950/50 border-white/10 text-white"
            />
            <span className="text-zinc-600 text-sm font-mono">#{index + 1}</span>
          </div>

          <p className="text-white font-medium mb-3 leading-relaxed">{candidate.question_text}</p>

          {candidate.incorrect_answers?.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              {candidate.incorrect_answers.map((option, optIndex) => (
                <div key={optIndex} className="px-3 py-2 rounded-md text-sm bg-zinc-800/50 text-zinc-400">
                  {option}
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-white/10 space-y-2">
            <p className="text-sm">
              <span className="text-zinc-500">Answer: </span>
              <span className="text-emerald-400 font-medium">{candidate.correct_answer}</span>
            </p>

            {candidate.fun_fact && (
              <p className="text-sm leading-relaxed">
                <span className="text-zinc-500">Fun Fact: </span>
                <span className="text-zinc-300">{candidate.fun_fact}</span>
              </p>
            )}

            {candidate.image_prompt && (
              <p className="text-sm leading-relaxed">
                <span className="text-zinc-500">Image idea: </span>
                <span className="text-amber-200">{candidate.image_prompt}</span>
              </p>
            )}
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDropImage(event, type, index)}
            className="mt-4 rounded-md border border-dashed border-white/10 bg-zinc-950/40 p-3"
          >
            {candidate.image_url ? (
              <div className="flex items-center gap-3">
                <img src={candidate.image_url} alt="Attached trivia media" className="h-16 w-16 rounded object-cover border border-white/10" />
                <Input value={candidate.image_url} onChange={(e) => updateCandidate(type, index, { image_url: e.target.value })} className="bg-zinc-950/50 border-white/10 text-white" />
              </div>
            ) : (
              <div className="flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 text-sm text-zinc-500 flex items-center gap-2"><Upload size={15} />Drop an image here or paste a media URL</div>
                <Input value="" onChange={(e) => updateCandidate(type, index, { image_url: e.target.value })} placeholder="Image/media URL" className="md:max-w-sm bg-zinc-950/50 border-white/10 text-white" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              size="sm"
              disabled={savingKey === saveId || isRefreshing}
              className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              onClick={() => handleSaveToLibrary(candidate, type, index)}
            >
              {savingKey === saveId ? "Saving..." : "Save to Library"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={isRefreshing || savingKey === saveId}
              className="border-sky-500/30 text-sky-300 hover:bg-sky-500/10"
              onClick={() => handleRefreshQuestion(type, index)}
            >
              {isRefreshing ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
              Refresh
            </Button>

            {candidate.category && (
              <Button
                size="sm"
                variant="outline"
                disabled={isRefreshing || savingKey === saveId}
                className={categoryLocked ? "border-[#71E0DC]/40 text-[#71E0DC] bg-[#71E0DC]/10" : "border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10"}
                onClick={() => categoryLocked ? handleUnlockCategory(candidate.category) : handleLockCategory(candidate.category)}
              >
                <Lock size={14} className="mr-2" />
                {categoryLocked ? "Locked" : "Lock Category"}
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              disabled={isRefreshing || savingKey === saveId}
              className="border-red-500/30 text-red-300 hover:bg-red-500/10"
              onClick={() => handleDiscardQuestion(type, index)}
            >
              <Trash2 size={14} className="mr-2" />
              Discard
            </Button>

            {candidate.category && (
              <Button
                size="sm"
                variant="ghost"
                disabled={isRefreshing || savingKey === saveId}
                className="text-zinc-400 hover:text-red-200 hover:bg-red-500/10"
                onClick={() => handleRejectCategory(type, index)}
              >
                <Ban size={14} className="mr-2" />
                Reject Category
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="generate-page">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            <span className="gradient-text">Generate</span> Questions
          </h1>
          <p className="text-zinc-500">Build fresh trivia candidates. Images are media you can attach to any question.</p>
        </div>

        {totalGenerated > 0 && (
          <Button variant="outline" onClick={handleDiscardAll} className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800">
            <Trash2 size={16} className="mr-2" />
            Clear All
          </Button>
        )}
      </div>

      <div className="mb-6">
        <div className="inline-flex rounded-lg bg-zinc-800/50 p-1 border border-white/10 flex-wrap">
          <button onClick={() => setMode("standard")} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === "standard" ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" : "text-zinc-400 hover:text-white"}`}><Sparkles size={14} className="inline mr-2" />Full Show</button>
          <button onClick={() => setMode("theme")} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === "theme" ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" : "text-zinc-400 hover:text-white"}`}><Layers size={14} className="inline mr-2" />Theme Sampler</button>
          <button onClick={() => setMode("free_build")} className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === "free_build" ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" : "text-zinc-400 hover:text-white"}`}><Wand2 size={14} className="inline mr-2" />Custom Batch</button>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white">{mode === "standard" ? "Full Show Generator" : mode === "theme" ? "Theme Sampler" : "Custom Batch Generator"}</CardTitle>
          <CardDescription className="text-zinc-500">
            {mode === "standard" ? "Creates 9 true/false, 9 multiple choice, and 9 written questions" : mode === "theme" ? "Creates a smaller themed batch across normal question types" : "Creates a custom batch for one selected question type"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {lockedCategories.length > 0 && (
            <div className="rounded-lg border border-[#71E0DC]/20 bg-[#71E0DC]/5 p-3">
              <div className="flex items-center gap-2 mb-2 text-sm font-medium text-[#71E0DC]"><Lock size={15} />Locked categories</div>
              <div className="flex flex-wrap gap-2">
                {lockedCategories.map((category) => (
                  <button key={category} type="button" onClick={() => handleUnlockCategory(category)} className="inline-flex items-center gap-2 rounded-full border border-[#71E0DC]/30 bg-zinc-950/60 px-3 py-1 text-sm text-white hover:bg-[#71E0DC]/10">
                    {category}<X size={13} className="text-zinc-400" />
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500 mt-2">New generations will stay inside these categories until you unlock them.</p>
            </div>
          )}

          {mode === "theme" && (
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Theme</label>
              <Input value={roundThemeSubject} onChange={(e) => setRoundThemeSubject(e.target.value)} placeholder="e.g. weird science, 90s sitcoms, songs with numbers" className="bg-zinc-950/50 border-white/10 text-white" />
            </div>
          )}

          {mode === "free_build" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-zinc-300 text-sm font-medium">Question Type</label>
                <Select value={freeBuildType} onValueChange={setFreeBuildType}>
                  <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    <SelectItem value="true_false" className="text-white">True/False</SelectItem>
                    <SelectItem value="multiple_choice" className="text-white">Multiple Choice</SelectItem>
                    <SelectItem value="written" className="text-white">Written</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><label className="text-zinc-300 text-sm font-medium">Quantity</label><Input value={freeBuildCount} onChange={(e) => setFreeBuildCount(e.target.value)} placeholder="5" className="bg-zinc-950/50 border-white/10 text-white" /></div>
            </div>
          )}

          {(mode === "standard" || mode === "free_build") && (
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Theme, vibe, or category direction <span className="text-zinc-500">(optional)</span></label>
              <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. cozy nerd trivia, no sports, local bar crowd, weird facts" className="bg-zinc-950/50 border-white/10 text-white" />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Difficulty</label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10">
                  <SelectItem value="easy" className="text-white">Easy</SelectItem>
                  <SelectItem value="medium" className="text-white">Medium</SelectItem>
                  <SelectItem value="hard" className="text-white">Hard</SelectItem>
                  <SelectItem value="host_hard" className="text-white">Host Hard</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-600">{difficultyLabels[difficulty]} favors fair but less recycled trivia.</p>
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300"><input type="checkbox" checked={excludeUsed} onChange={(e) => setExcludeUsed(e.target.checked)} className="accent-[#71E0DC]" />Avoid saved questions</label>
            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300"><input type="checkbox" checked={avoidDuplicates} onChange={(e) => setAvoidDuplicates(e.target.checked)} className="accent-[#71E0DC]" />Avoid duplicate angles</label>
            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300"><input type="checkbox" checked={includeMediaIdeas} onChange={(e) => setIncludeMediaIdeas(e.target.checked)} className="accent-[#71E0DC]" />Include image ideas</label>
          </div>

          <div className="pt-2"><Button onClick={handleGenerate} disabled={generating} className="gradient-btn">{generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Sparkles className="mr-2" size={18} />Generate Questions</>}</Button></div>
        </CardContent>
      </Card>

      {totalGenerated === 0 ? (
        <Card className="glass-card"><CardContent className="py-16 text-center"><div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4"><Sparkles className="text-zinc-600" size={32} /></div><p className="text-zinc-500 mb-2">No questions generated yet</p><p className="text-zinc-600 text-sm">Use Full Show for your normal 3-round format, or build a custom themed batch.</p></CardContent></Card>
      ) : (
        <div className="space-y-6">
          {sectionsToRender.map((type) => {
            const TypeIcon = type.icon;
            const section = groupedCandidates[type.value];
            return (
              <Card key={type.value} className="glass-card">
                <CardHeader><div className="flex items-center justify-between gap-4 flex-wrap"><div className="flex items-center gap-3"><TypeIcon className={type.color} size={20} /><div><CardTitle className="text-white text-lg">{type.label}</CardTitle><CardDescription className="text-zinc-500">{type.round} • {section.length} candidate{section.length !== 1 ? "s" : ""}</CardDescription></div></div><Button variant="outline" onClick={() => handleDiscardSection(type.value)} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"><Trash2 size={16} className="mr-2" />Discard Section</Button></div></CardHeader>
                <CardContent><div className="space-y-4">{section.map((candidate, index) => renderQuestionCard(candidate, type.value, index))}</div></CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Generate;
