import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { CheckCircle, List, Loader2, MessageSquare, Save, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

const typeConfig = {
  true_false: { label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  multiple_choice: { label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  written: { label: "Written Answer", icon: MessageSquare, color: "text-emerald-400" },
};

const initialForm = {
  question_text: "",
  question_type: "written",
  category: "",
  correct_answer: "",
  incorrect_answers: ["", "", ""],
  fun_fact: "",
};

const cleanList = (values) => values.map((value) => value.trim()).filter(Boolean);

const buildIncorrectAnswers = (type, correctAnswer, wrongAnswers) => {
  if (type === "true_false") {
    return correctAnswer.toLowerCase() === "false" ? "True" : "False";
  }

  if (type === "multiple_choice") {
    return wrongAnswers.join("; ");
  }

  return null;
};

const WriteQuestion = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [assisting, setAssisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assistantNotes, setAssistantNotes] = useState("");
  const [confidence, setConfidence] = useState(null);

  const selectedType = typeConfig[form.question_type] || typeConfig.written;
  const TypeIcon = selectedType.icon;

  const allMcOptions = useMemo(() => {
    if (form.question_type !== "multiple_choice") return [];
    return [form.correct_answer, ...form.incorrect_answers].map((value) => value.trim()).filter(Boolean);
  }, [form.correct_answer, form.incorrect_answers, form.question_type]);

  const updateForm = (patch) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const updateWrongAnswer = (index, value) => {
    setForm((prev) => ({
      ...prev,
      incorrect_answers: prev.incorrect_answers.map((answer, i) => (i === index ? value : answer)),
    }));
  };

  const handleAssist = async () => {
    if (!form.question_text.trim()) {
      toast.error("Type the question first");
      return;
    }

    setAssisting(true);
    try {
      const { data } = await axios.post("/api/assist-custom-question", {
        question_text: form.question_text.trim(),
        category: form.category.trim(),
      });

      setForm((prev) => ({
        ...prev,
        question_text: data.clean_question_text || prev.question_text,
        question_type: data.question_type || prev.question_type,
        category: data.category || prev.category,
        correct_answer: data.correct_answer || prev.correct_answer,
        incorrect_answers: [
          ...(Array.isArray(data.incorrect_answers) ? data.incorrect_answers : []),
          "",
          "",
          "",
        ].slice(0, 3),
        fun_fact: data.fun_fact || prev.fun_fact,
      }));
      setAssistantNotes(data.notes || "");
      setConfidence(typeof data.confidence === "number" ? data.confidence : null);
      toast.success("Suggestion ready");
    } catch (error) {
      console.error("Assist question error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to assist question");
    } finally {
      setAssisting(false);
    }
  };

  const handleSave = async () => {
    const questionText = form.question_text.trim();
    const category = form.category.trim();
    const correctAnswer = form.correct_answer.trim();
    const wrongAnswers = cleanList(form.incorrect_answers).filter(
      (answer) => answer.toLowerCase() !== correctAnswer.toLowerCase()
    );

    if (!questionText || !category || !correctAnswer) {
      toast.error("Question, category, and answer are required");
      return;
    }

    if (form.question_type === "multiple_choice" && wrongAnswers.length < 2) {
      toast.error("Add at least two wrong answers for multiple choice");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session?.user?.id) throw new Error("You must be signed in");

      const payload = {
        user_id: session.user.id,
        category,
        question_text: questionText,
        question_type: form.question_type,
        correct_answer: form.question_type === "true_false" ? (correctAnswer.toLowerCase() === "false" ? "False" : "True") : correctAnswer,
        incorrect_answers: buildIncorrectAnswers(form.question_type, correctAnswer, wrongAnswers),
        fun_fact: form.fun_fact.trim() || null,
        source: "manual",
        has_image: false,
        image_url: null,
      };

      const { error } = await supabase.from("questions").insert(payload);
      if (error) throw error;

      toast.success("Question saved to library");
      setForm(initialForm);
      setAssistantNotes("");
      setConfidence(null);
    } catch (error) {
      console.error("Save custom question error:", error);
      toast.error(error.message || "Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in" data-testid="write-question-page">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          Write <span className="gradient-text">Custom Question</span>
        </h1>
        <p className="text-zinc-500">Draft a question, let the app suggest the best format, then save it to your library.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr] gap-6">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-white flex items-center gap-2">
                <Wand2 className="text-[#71E0DC]" size={20} /> Question Draft
              </CardTitle>
              <Button onClick={handleAssist} disabled={assisting} className="gradient-btn" data-testid="assist-question-btn">
                {assisting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2" size={16} />}
                Assist
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label className="text-zinc-300">Question</Label>
              <Textarea
                value={form.question_text}
                onChange={(e) => updateForm({ question_text: e.target.value })}
                placeholder="Type the question you want to add..."
                className="bg-zinc-950/50 border-white/10 text-white min-h-[120px] resize-none"
                data-testid="custom-question-input"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">Suggested Type</Label>
                <Select value={form.question_type} onValueChange={(value) => updateForm({ question_type: value })}>
                  <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white" data-testid="question-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white">
                    <SelectItem value="true_false">True/False</SelectItem>
                    <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                    <SelectItem value="written">Written Answer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-300">Category</Label>
                <Input
                  value={form.category}
                  onChange={(e) => updateForm({ category: e.target.value })}
                  placeholder="Science, Music, History..."
                  className="bg-zinc-950/50 border-white/10 text-white"
                  data-testid="custom-category-input"
                />
              </div>
            </div>

            {form.question_type === "true_false" ? (
              <div className="space-y-2">
                <Label className="text-zinc-300">Answer</Label>
                <div className="flex gap-3">
                  {['True', 'False'].map((answer) => (
                    <Button
                      key={answer}
                      type="button"
                      variant={form.correct_answer === answer ? "default" : "outline"}
                      onClick={() => updateForm({ correct_answer: answer })}
                      className={form.correct_answer === answer ? "bg-[#71E0DC]/20 border-[#71E0DC]/40 text-[#71E0DC]" : "border-zinc-700 text-zinc-400"}
                    >
                      {answer}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-zinc-300">Correct Answer</Label>
                <Input
                  value={form.correct_answer}
                  onChange={(e) => updateForm({ correct_answer: e.target.value })}
                  placeholder="Correct answer"
                  className="bg-zinc-950/50 border-white/10 text-white"
                  data-testid="custom-answer-input"
                />
              </div>
            )}

            {form.question_type === "multiple_choice" && (
              <div className="space-y-2">
                <Label className="text-zinc-300">Wrong Answers</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {form.incorrect_answers.map((answer, index) => (
                    <Input
                      key={index}
                      value={answer}
                      onChange={(e) => updateWrongAnswer(index, e.target.value)}
                      placeholder={`Wrong answer ${index + 1}`}
                      className="bg-zinc-950/50 border-white/10 text-white"
                      data-testid={`custom-wrong-answer-${index}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-zinc-300">Fun Fact</Label>
              <Input
                value={form.fun_fact}
                onChange={(e) => updateForm({ fun_fact: e.target.value })}
                placeholder="Optional context for the host"
                className="bg-zinc-950/50 border-white/10 text-white"
                data-testid="custom-fun-fact-input"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate("/library")} className="border-zinc-700 text-zinc-400 hover:text-white">
                Library
              </Button>
              <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold" data-testid="save-custom-question-btn">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2" size={16} />}
                Save Question
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-white text-lg">Current Shape</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                  <TypeIcon className={selectedType.color} size={20} />
                </div>
                <div>
                  <p className="text-white font-semibold">{selectedType.label}</p>
                  <p className="text-zinc-500 text-sm">{form.category || "No category yet"}</p>
                </div>
              </div>

              {confidence !== null && (
                <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">
                  {Math.round(confidence * 100)}% suggestion confidence
                </Badge>
              )}

              {assistantNotes && <p className="text-zinc-400 text-sm leading-relaxed">{assistantNotes}</p>}

              {allMcOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-zinc-500 text-sm">Multiple choice set</p>
                  <div className="space-y-2">
                    {allMcOptions.map((option) => (
                      <div key={option} className={`px-3 py-2 rounded-md text-sm ${option === form.correct_answer.trim() ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800/60 text-zinc-300"}`}>
                        {option}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-5">
              <p className="text-zinc-400 text-sm leading-relaxed">
                The assistant can suggest structure, but you stay in control. Edit the type, category, answer, and wrong answers before saving.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default WriteQuestion;
