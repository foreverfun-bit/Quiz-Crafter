import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
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
  Save,
  Trash2,
  Layers,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400" },
];

const emptyGroupedCandidates = {
  true_false: [],
  multiple_choice: [],
  written: [],
  picture: [],
};

const Generate = () => {
  const [mode, setMode] = useState("standard");

  const [difficulty, setDifficulty] = useState("medium");
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

  const callGenerateRoute = async (questionType) => {
    const response = await fetch("/api/generate-session-candidates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: `generate-${mode}`,
        questionType,
        difficulty,
        theme: mode === "standard" ? theme : mode === "theme" ? roundThemeSubject : theme,
        excludeUsed,
        avoidDuplicates,
        count: mode === "free_build" ? Number(freeBuildCount) : undefined,
      }),
    });

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!response.ok) {
      throw new Error(data.error || `Failed to generate ${questionType}`);
    }

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
          callGenerateRoute("true_false"),
          callGenerateRoute("multiple_choice"),
          callGenerateRoute("written"),
        ]);

        next = {
          true_false: tf,
          multiple_choice: mc,
          written,
          picture: [],
        };
      } else if (mode === "theme") {
        const [tf, mc, written] = await Promise.all([
          callGenerateRoute("true_false"),
          callGenerateRoute("multiple_choice"),
          callGenerateRoute("written"),
        ]);

        next = {
          true_false: tf,
          multiple_choice: mc,
          written,
          picture: [],
        };
      } else {
        const generated = await callGenerateRoute(freeBuildType);

        next = {
          ...emptyGroupedCandidates,
          [freeBuildType]: generated,
        };
      }

      setGroupedCandidates(next);
      toast.success("Questions generated!");
    } catch (error) {
      console.error("Generate error:", error);
      toast.error(error.message || "Failed to generate questions");
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
    setGroupedCandidates((prev) => ({
      ...prev,
      [type]: [],
    }));
  };

  const handleDiscardAll = () => {
    clearCandidates();
    toast.success("Candidates cleared");
  };

  const handleSaveToLibrary = async (candidate, type, index) => {
    const key = `${type}-${index}`;
    setSavingKey(key);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (!userId) {
        throw new Error("You must be signed in");
      }

      const payload = {
        user_id: userId,
        category: candidate.category || null,
        question_text: candidate.question_text,
        question_type: candidate.question_type || type,
        has_image: candidate.has_image || false,
        image_url: candidate.image_url || null,
        theme: mode === "theme" ? roundThemeSubject || null : theme || null,
        correct_answer: candidate.correct_answer,
        incorrect_answers:
          Array.isArray(candidate.incorrect_answers) && candidate.incorrect_answers.length > 0
            ? candidate.incorrect_answers.join(";")
            : null,
        fun_fact: candidate.fun_fact || null,
        difficulty: candidate.difficulty || difficulty || "medium",
        source: "ai",
      };

      const { error } = await supabase.from("questions").insert(payload);

      if (error) throw error;

      setGroupedCandidates((prev) => ({
        ...prev,
        [type]: prev[type].filter((_, i) => i !== index),
      }));

      toast.success("Saved to library!");
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error.message || "Failed to save question");
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveSection = async (type) => {
    const section = groupedCandidates[type];
    if (!section.length) return;

    try {
      for (let i = 0; i < section.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await handleSaveToLibrary(section[i], type, i);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const sectionsToRender = questionTypes.filter((t) => groupedCandidates[t.value]?.length > 0);

  const renderQuestionCard = (candidate, type, index) => {
    const saveId = `${type}-${index}`;

    return (
      <Card key={saveId} className="bg-zinc-900/70 border-white/10">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              {candidate.category || "Uncategorized"}
            </Badge>
            <span className="text-zinc-600 text-sm font-mono">#{index + 1}</span>
          </div>

          <p className="text-white font-medium mb-3">{candidate.question_text}</p>

          {candidate.incorrect_answers?.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {candidate.incorrect_answers.map((option, optIndex) => (
                <div
                  key={optIndex}
                  className="px-3 py-2 rounded-md text-sm bg-zinc-800/50 text-zinc-400"
                >
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
              <p className="text-sm">
                <span className="text-zinc-500">Fun Fact: </span>
                <span className="text-zinc-300">{candidate.fun_fact}</span>
              </p>
            )}
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
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            <span className="gradient-text">Generate</span> Questions
          </h1>
          <p className="text-zinc-500">Create grouped trivia candidates and save only the good ones</p>
        </div>

        {totalGenerated > 0 && (
          <Button
            variant="outline"
            onClick={handleDiscardAll}
            className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <Trash2 size={16} className="mr-2" />
            Clear All
          </Button>
        )}
      </div>

      <div className="mb-6">
        <div className="inline-flex rounded-lg bg-zinc-800/50 p-1 border border-white/10">
          <button
            onClick={() => setMode("standard")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === "standard"
                ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Sparkles size={14} className="inline mr-2" />
            Standard
          </button>

          <button
            onClick={() => setMode("theme")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === "theme"
                ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Layers size={14} className="inline mr-2" />
            Round Theme
          </button>

          <button
            onClick={() => setMode("free_build")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === "free_build"
                ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Wand2 size={14} className="inline mr-2" />
            Free Build
          </button>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardHeader>
          <CardTitle className="text-white">
            {mode === "standard"
              ? "Standard Session Generator"
              : mode === "theme"
              ? "Round Theme Generator"
              : "Free Build Generator"}
          </CardTitle>
          <CardDescription className="text-zinc-500">
            {mode === "standard"
              ? "Creates grouped results for True/False, Multiple Choice, and Written"
              : mode === "theme"
              ? "Generate a themed batch grouped by type"
              : "Generate a custom batch for one selected question type"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {mode === "theme" && (
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Round Theme</label>
              <Input
                value={roundThemeSubject}
                onChange={(e) => setRoundThemeSubject(e.target.value)}
                placeholder="e.g. Taylor Swift, 90s Sitcoms, Halloween"
                className="bg-zinc-950/50 border-white/10 text-white"
              />
            </div>
          )}

          {mode === "free_build" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-zinc-300 text-sm font-medium">Question Type</label>
                <Select value={freeBuildType} onValueChange={setFreeBuildType}>
                  <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    <SelectItem value="true_false" className="text-white">True/False</SelectItem>
                    <SelectItem value="multiple_choice" className="text-white">Multiple Choice</SelectItem>
                    <SelectItem value="written" className="text-white">Written</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-zinc-300 text-sm font-medium">Quantity</label>
                <Input
                  value={freeBuildCount}
                  onChange={(e) => setFreeBuildCount(e.target.value)}
                  placeholder="5"
                  className="bg-zinc-950/50 border-white/10 text-white"
                />
              </div>
            </div>
          )}

          {(mode === "standard" || mode === "free_build") && (
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">
                Theme or Category <span className="text-zinc-500">(optional)</span>
              </label>
              <Input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="e.g. Music, Summer, Pop Culture"
                className="bg-zinc-950/50 border-white/10 text-white"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-zinc-300 text-sm font-medium">Difficulty</label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10">
                  <SelectItem value="easy" className="text-white">Easy</SelectItem>
                  <SelectItem value="medium" className="text-white">Medium</SelectItem>
                  <SelectItem value="hard" className="text-white">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={excludeUsed}
                onChange={(e) => setExcludeUsed(e.target.checked)}
                className="accent-[#71E0DC]"
              />
              Exclude used questions
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={avoidDuplicates}
                onChange={(e) => setAvoidDuplicates(e.target.checked)}
                className="accent-[#71E0DC]"
              />
              Avoid duplicates
            </label>
          </div>

          <div className="pt-2">
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="gradient-btn"
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2" size={18} />
                  Generate Questions
                </>
              )}
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
            <p className="text-zinc-600 text-sm">Use the controls above to generate grouped batches</p>
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
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <TypeIcon className={type.color} size={20} />
                      <div>
                        <CardTitle className="text-white text-lg">{type.label}</CardTitle>
                        <CardDescription className="text-zinc-500">
                          {section.length} candidate{section.length !== 1 ? "s" : ""}
                        </CardDescription>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => handleSaveSection(type.value)}
                        className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                      >
                        <Save size={16} className="mr-2" />
                        Save All
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => handleDiscardSection(type.value)}
                        className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      >
                        <Trash2 size={16} className="mr-2" />
                        Discard Section
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    {section.map((candidate, index) => renderQuestionCard(candidate, type.value, index))}
                  </div>
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
