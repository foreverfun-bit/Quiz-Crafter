import { useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
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
  Image,
  Loader2,
  Trash2,
  Layers,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", round: "Round 1" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", round: "Round 2" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400", round: "Round 3" },
  { value: "picture", label: "Picture Bonus", icon: Image, color: "text-amber-400", round: "Bonus" },
];

const emptyGroupedCandidates = {
  true_false: [],
  multiple_choice: [],
  written: [],
  picture: [],
};

const standardCounts = {
  true_false: 9,
  multiple_choice: 9,
  written: 9,
  picture: 3,
};

const difficultyLabels = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  host_hard: "Host Hard",
};

const cleanList = (values) => values.map((value) => String(value || "").trim()).filter(Boolean);

const Generate = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState("standard");

  const [difficulty, setDifficulty] = useState("host_hard");
  const [theme, setTheme] = useState("");
  const [excludeUsed, setExcludeUsed] = useState(true);
  const [avoidDuplicates, setAvoidDuplicates] = useState(true);

  const [roundThemeSubject, setRoundThemeSubject] = useState("");
  const [freeBuildType, setFreeBuildType] = useState("multiple_choice");
  const [freeBuildCount, setFreeBuildCount] = useState("5");

  const [groupedCandidates, setGroupedCandidates] = useState(emptyGroupedCandidates);
  const [generating, setGenerating] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  const totalGenerated = useMemo(() => {
    return Object.values(groupedCandidates).reduce((sum, arr) => sum + arr.length, 0);
  }, [groupedCandidates]);

  const clearCandidates = () => {
    setGroupedCandidates(emptyGroupedCandidates);
  };

  const callGenerateRoute = async ({ questionType, count, themeValue, excludeCategories = [] }) => {
    const { data } = await axios.post("/api/generate-session-candidates", {
      sessionId: `generate-${mode}`,
      questionType,
      difficulty,
      theme: themeValue,
      excludeUsed,
      avoidDuplicates,
      excludeCategories,
      count,
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
        const [tf, mc, written, picture] = await Promise.all([
          callGenerateRoute({ questionType: "true_false", count: standardCounts.true_false, themeValue: theme || "" }),
          callGenerateRoute({ questionType: "multiple_choice", count: standardCounts.multiple_choice, themeValue: theme || "" }),
          callGenerateRoute({ questionType: "written", count: standardCounts.written, themeValue: theme || "" }),
          callGenerateRoute({ questionType: "picture", count: standardCounts.picture, themeValue: theme || "" }),
        ]);

        next = { true_false: tf, multiple_choice: mc, written, picture };
      } else if (mode === "theme") {
        const [tf, mc, written, picture] = await Promise.all([
          callGenerateRoute({ questionType: "true_false", count: 3, themeValue: roundThemeSubject }),
          callGenerateRoute({ questionType: "multiple_choice", count: 3, themeValue: roundThemeSubject }),
          callGenerateRoute({ questionType: "written", count: 3, themeValue: roundThemeSubject }),
          callGenerateRoute({ questionType: "picture", count: 1, themeValue: roundThemeSubject }),
        ]);

        next = { true_false: tf, multiple_choice: mc, written, picture };
      } else {
        const generated = await callGenerateRoute({
          questionType: freeBuildType,
          count: Number(freeBuildCount),
          themeValue: theme || "",
        });

        next = { ...emptyGroupedCandidates, [freeBuildType]: generated };
      }

      setGroupedCandidates(next);
      const total = Object.values(next).reduce((sum, arr) => sum + arr.length, 0);
      toast.success(`${total} candidates generated`);
    } catch (error) {
      console.error("Generate error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to generate questions");
    } finally {
      setGenerating(false);
    }
  };

  const handleDiscardQuestion = (type, index) => {
    setGroupedCandidates((prev) => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }));
  };

  const handleDiscardSection = (type) => {
    setGroupedCandidates((prev) => ({ ...prev, [type]: [] }));
  };

  const handleDiscardAll = () => {
    clearCandidates();
    toast.success("Candidates cleared");
  };

  const handleUpdateCandidateCategory = (type, index, value) => {
    setGroupedCandidates((prev) => ({
      ...prev,
      [type]: prev[type].map((candidate, i) => (i === index ? { ...candidate, category: value } : candidate)),
    }));
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
        question_type: candidate.question_type || (type === "picture" ? "written" : type),
        correct_answer: candidate.correct_answer,
        incorrect_answers: cleanList(candidate.incorrect_answers || []),
        fun_fact: candidate.fun_fact || null,
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

          <div className="pt-3 border-t border-white/10 space-y-1">
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

            {type === "picture" && <p className="text-xs text-amber-300 mt-2">Picture bonus prompt</p>}
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              size="sm"
              disabled={savingKey === saveId}
              className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              onClick={() => handleSaveToLibrary(candidate, type, index)}
            >
              {savingKey === saveId ? "Saving..." : "Save to Library"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="border-zinc-700 text-zinc-300"
              onClick={() => handleDiscardQuestion(type, index)}
            >
              Discard
            </Button>
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
          <p className="text-zinc-500">Build fresh trivia candidates for your three-round hosting format</p>
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
          <button
            onClick={() => setMode("standard")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === "standard" ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" : "text-zinc-400 hover:text-white"}`}
          >
            <Sparkles size={14} className="inline mr-2" />
            Full Show
          </button>

          <button
            onClick={() => setMode("theme")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === "theme" ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" : "text-zinc-400 hover:text-white"}`}
          >
            <Layers size={14} className="inline mr-2" />
            Theme Sampler
          </button>

          <button
            onClick={() => setMode("free_build")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === "free_build" ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" : "text-zinc-400 hover:text-white"}`}
          >
            <Wand2 size={14} className="inline mr-2" />
            Custom Batch
          </button>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white">
            {mode === "standard" ? "Full Show Generator" : mode === "theme" ? "Theme Sampler" : "Custom Batch Generator"}
          </CardTitle>
          <CardDescription className="text-zinc-500">
            {mode === "standard"
              ? "Creates 9 true/false, 9 multiple choice, 9 written, and 3 picture bonus prompts"
              : mode === "theme"
              ? "Creates a smaller themed batch across all question types"
              : "Creates a custom batch for one selected question type"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {mode === "theme" && (
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Theme</label>
              <Input
                value={roundThemeSubject}
                onChange={(e) => setRoundThemeSubject(e.target.value)}
                placeholder="e.g. weird science, 90s sitcoms, songs with numbers"
                className="bg-zinc-950/50 border-white/10 text-white"
              />
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
                    <SelectItem value="picture" className="text-white">Picture Bonus</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-zinc-300 text-sm font-medium">Quantity</label>
                <Input value={freeBuildCount} onChange={(e) => setFreeBuildCount(e.target.value)} placeholder="5" className="bg-zinc-950/50 border-white/10 text-white" />
              </div>
            </div>
          )}

          {(mode === "standard" || mode === "free_build") && (
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Theme, vibe, or category direction <span className="text-zinc-500">(optional)</span></label>
              <Input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="e.g. cozy nerd trivia, no sports, local bar crowd, weird facts"
                className="bg-zinc-950/50 border-white/10 text-white"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
              <input type="checkbox" checked={excludeUsed} onChange={(e) => setExcludeUsed(e.target.checked)} className="accent-[#71E0DC]" />
              Avoid saved questions
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
              <input type="checkbox" checked={avoidDuplicates} onChange={(e) => setAvoidDuplicates(e.target.checked)} className="accent-[#71E0DC]" />
              Avoid duplicate angles
            </label>
          </div>

          <div className="pt-2">
            <Button onClick={handleGenerate} disabled={generating} className="gradient-btn">
              {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</> : <><Sparkles className="mr-2" size={18} />Generate Questions</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {totalGenerated === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No questions generated yet</p>
            <p className="text-zinc-600 text-sm">Use Full Show for your normal 3-round format, or build a custom themed batch.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sectionsToRender.map((type) => {
            const TypeIcon = type.icon;
            const section = groupedCandidates[type.value];

            return (
              <Card key={type.value} className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <TypeIcon className={type.color} size={20} />
                      <div>
                        <CardTitle className="text-white text-lg">{type.label}</CardTitle>
                        <CardDescription className="text-zinc-500">
                          {type.round} • {section.length} candidate{section.length !== 1 ? "s" : ""}
                        </CardDescription>
                      </div>
                    </div>

                    <Button variant="outline" onClick={() => handleDiscardSection(type.value)} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                      <Trash2 size={16} className="mr-2" />
                      Discard Section
                    </Button>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">{section.map((candidate, index) => renderQuestionCard(candidate, type.value, index))}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Generate;
