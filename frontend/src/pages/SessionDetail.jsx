import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import {
  CheckCircle,
  List,
  MessageSquare,
  Image,
  Loader2,
  ArrowLeft,
  Trash2,
  Copy,
  Download,
  Radio,
  X,
  Pencil,
  Save,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400" },
];

const emptyQuestionForType = (type) => {
  if (type === "true_false") {
    return {
      category: "Imported",
      question_text: "",
      correct_answer: "True",
      question_type: "true_false",
      incorrect_answers: "False",
      fun_fact: "",
      image_url: "",
    };
  }

  if (type === "multiple_choice") {
    return {
      category: "Imported",
      question_text: "",
      correct_answer: "",
      question_type: "multiple_choice",
      incorrect_answers: "",
      fun_fact: "",
      image_url: "",
    };
  }

  if (type === "picture") {
    return {
      category: "Imported",
      question_text: "",
      correct_answer: "",
      question_type: "picture",
      incorrect_answers: "",
      fun_fact: "",
      image_url: "",
    };
  }

  return {
    category: "Imported",
    question_text: "",
    correct_answer: "",
    question_type: "written",
    incorrect_answers: "",
    fun_fact: "",
    image_url: "",
  };
};

const SessionDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [slots, setSlots] = useState([]);
  const [questionsById, setQuestionsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("true_false");
  const [deleting, setDeleting] = useState(false);

  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [currentGenerateType, setCurrentGenerateType] = useState("true_false");
  const [candidates, setCandidates] = useState([]);
  const [showCandidateDrawer, setShowCandidateDrawer] = useState(false);
  const [savingCandidateIndex, setSavingCandidateIndex] = useState(null);

  const [isEditingImported, setIsEditingImported] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [editableSessionName, setEditableSessionName] = useState("");
  const [editableQuestions, setEditableQuestions] = useState({
    true_false_questions: [],
    multiple_choice_questions: [],
    written_questions: [],
    picture_questions: [],
  });

  useEffect(() => {
    fetchSessionData();
  }, [id]);

  const isImportedSession = !!session?.is_past;

  const normalizeType = (q) => {
    if (!q) return null;
    if (q.question_type === "picture") return "picture";
    if (q.image_url && !q.question_type) return "picture";
    return q.question_type || "written";
  };

  const safeDate = (value) => {
    if (!value) return "No date";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString();
  };

  const getTypeLabel = (type) => {
    return questionTypes.find((q) => q.value === type)?.label || type;
  };

  const normalizeImportedArrays = (sessionData) => {
    return {
      true_false_questions: Array.isArray(sessionData?.true_false_questions)
        ? sessionData.true_false_questions
        : [],
      multiple_choice_questions: Array.isArray(sessionData?.multiple_choice_questions)
        ? sessionData.multiple_choice_questions
        : [],
      written_questions: Array.isArray(sessionData?.written_questions)
        ? sessionData.written_questions
        : [],
      picture_questions: Array.isArray(sessionData?.picture_questions)
        ? sessionData.picture_questions
        : [],
    };
  };

  const fetchSessionData = async () => {
    setLoading(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", id)
        .single();

      if (sessionError) throw sessionError;

      const importedArrays = normalizeImportedArrays(sessionData);
      setEditableSessionName(sessionData.name || sessionData.session_name || "Untitled Session");
      setEditableQuestions(importedArrays);

      const { data: roundData, error: roundsError } = await supabase
        .from("session_rounds")
        .select("*")
        .eq("session_id", id)
        .order("round_order", { ascending: true });

      if (roundsError && roundsError.code !== "PGRST116") {
        throw roundsError;
      }

      const roundIds = (roundData || []).map((r) => r.id);

      let slotData = [];
      if (roundIds.length > 0) {
        const { data: sessionQuestionData, error: slotsError } = await supabase
          .from("session_questions")
          .select("*")
          .in("session_round_id", roundIds)
          .order("question_order", { ascending: true });

        if (slotsError) throw slotsError;
        slotData = sessionQuestionData || [];
      }

      const questionIds = [...new Set(slotData.map((s) => s.question_id).filter(Boolean))];

      let questionMap = {};
      if (questionIds.length > 0) {
        const { data: questionData, error: questionsError } = await supabase
          .from("questions")
          .select("*")
          .in("id", questionIds);

        if (questionsError) throw questionsError;

        questionMap = Object.fromEntries((questionData || []).map((q) => [q.id, q]));
      }

      setSession(sessionData);
      setRounds(roundData || []);
      setSlots(slotData);
      setQuestionsById(questionMap);

      let firstFilledType = "true_false";

      if (sessionData.is_past) {
        firstFilledType =
          (importedArrays.true_false_questions.length > 0 && "true_false") ||
          (importedArrays.multiple_choice_questions.length > 0 && "multiple_choice") ||
          (importedArrays.written_questions.length > 0 && "written") ||
          (importedArrays.picture_questions.length > 0 && "picture") ||
          "true_false";
      } else {
        firstFilledType =
          slotData
            .map((s) => questionMap[s.question_id])
            .map((q) => normalizeType(q))
            .find(Boolean) || "true_false";
      }

      setActiveTab(firstFilledType);
    } catch (error) {
      console.error("Failed to load session:", error);
      toast.error(error.message || "Failed to load session");
      navigate("/past-sessions");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this session?")) return;

    setDeleting(true);
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      toast.success("Session deleted");
      navigate("/past-sessions");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to delete session");
    } finally {
      setDeleting(false);
    }
  };

  const copyToClipboard = async () => {
    if (!session) return;

    const currentName = isImportedSession
      ? editableSessionName || session.name || session.session_name || "Untitled Session"
      : session.name || "Untitled Session";

    let text = `TRIVIA SESSION: ${currentName}\n`;
    text += `Created: ${safeDate(session.created_at)}\n\n`;

    if (isImportedSession) {
      const grouped = [
        ...editableQuestions.true_false_questions,
        ...editableQuestions.multiple_choice_questions,
        ...editableQuestions.written_questions,
        ...editableQuestions.picture_questions,
      ];

      grouped.forEach((q, index) => {
        text += `${index + 1}. [${q.category || "Uncategorized"}]\n`;
        text += `   Q: ${q.question_text}\n`;
        text += `   A: ${q.correct_answer}\n`;
        if (q.fun_fact) text += `   Fun Fact: ${q.fun_fact}\n`;
        text += "\n";
      });
    } else {
      rounds.forEach((round) => {
        text += `=== ${round.round_name || `Round ${round.round_order}`} ===\n\n`;

        const roundSlots = slots
          .filter((s) => s.session_round_id === round.id)
          .sort((a, b) => a.question_order - b.question_order);

        roundSlots.forEach((slot, index) => {
          const q = questionsById[slot.question_id];
          if (!q) {
            text += `${index + 1}. [Empty Slot]\n\n`;
            return;
          }

          text += `${index + 1}. [${q.category || "Uncategorized"}]\n`;
          text += `   Q: ${q.question_text}\n`;
          text += `   A: ${q.correct_answer}\n`;
          if (q.fun_fact) text += `   Fun Fact: ${q.fun_fact}\n`;
          text += "\n";
        });
      });
    }

    await navigator.clipboard.writeText(text);
    toast.success("Session copied to clipboard!");
  };

  const handleExportCSV = async () => {
    const rows = [];

    if (isImportedSession) {
      const grouped = [
        ...editableQuestions.true_false_questions.map((q, i) => ({ ...q, round: "Imported", order: i + 1 })),
        ...editableQuestions.multiple_choice_questions.map((q, i) => ({ ...q, round: "Imported", order: i + 1 })),
        ...editableQuestions.written_questions.map((q, i) => ({ ...q, round: "Imported", order: i + 1 })),
        ...editableQuestions.picture_questions.map((q, i) => ({ ...q, round: "Imported", order: i + 1 })),
      ];

      grouped.forEach((q) => {
        rows.push({
          round: q.round,
          order: q.order,
          type: normalizeType(q),
          category: q.category || "",
          question: q.question_text || "",
          correct_answer: q.correct_answer || "",
          incorrect_answers: q.incorrect_answers || "",
          fun_fact: q.fun_fact || "",
          image_url: q.image_url || "",
        });
      });
    } else {
      rounds.forEach((round) => {
        const roundSlots = slots
          .filter((s) => s.session_round_id === round.id)
          .sort((a, b) => a.question_order - b.question_order);

        roundSlots.forEach((slot) => {
          const q = questionsById[slot.question_id];
          rows.push({
            round: round.round_name || `Round ${round.round_order}`,
            order: slot.question_order,
            type: q ? normalizeType(q) : "",
            category: q?.category || "",
            question: q?.question_text || "",
            correct_answer: q?.correct_answer || "",
            incorrect_answers: q?.incorrect_answers || "",
            fun_fact: q?.fun_fact || "",
            image_url: q?.image_url || "",
          });
        });
      });
    }

    const header = [
      "round",
      "order",
      "type",
      "category",
      "question",
      "correct_answer",
      "incorrect_answers",
      "fun_fact",
      "image_url",
    ];

    const csv = [
      header.join(","),
      ...rows.map((row) =>
        header
          .map((key) => `"${String(row[key] ?? "").replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(isImportedSession ? editableSessionName : session?.name || "session")
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleGenerateCandidates = async (type) => {
    setGeneratingCandidates(true);
    setCurrentGenerateType(type);

    try {
      const response = await fetch("/api/generate-session-candidates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: id,
          questionType: type,
        }),
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate candidates");
      }

      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setShowCandidateDrawer(true);
      toast.success(`${getTypeLabel(type)} candidates generated!`);
    } catch (error) {
      console.error("Generate candidates error:", error);
      toast.error(error?.message || "Failed to generate candidates");
    } finally {
      setGeneratingCandidates(false);
    }
  };

  const handleDiscardCandidate = (candidateIndex) => {
    setCandidates((prev) => {
      const updated = prev.filter((_, i) => i !== candidateIndex);
      if (updated.length === 0) {
        setShowCandidateDrawer(false);
      }
      return updated;
    });
  };

  const handleSaveToLibrary = async (candidate, candidateIndex) => {
    setSavingCandidateIndex(candidateIndex);

    try {
      if (!session?.user_id) {
        throw new Error("Session user not found");
      }

      const response = await fetch("/api/save-candidate-to-library", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionUserId: session.user_id,
          category: candidate.category || null,
          question_text: candidate.question_text,
          question_type: candidate.question_type || currentGenerateType,
          correct_answer: candidate.correct_answer,
          incorrect_answers: candidate.incorrect_answers || [],
          fun_fact: candidate.fun_fact || null,
        }),
      });

      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        throw new Error(data.error || "Failed to save to library");
      }

      const savedQuestion = data.question;
      if (!savedQuestion?.id) {
        throw new Error("Question was not saved");
      }

      setQuestionsById((prev) => ({
        ...prev,
        [savedQuestion.id]: savedQuestion,
      }));

      setCandidates((prev) => {
        const updated = prev.filter((_, i) => i !== candidateIndex);
        if (updated.length === 0) {
          setShowCandidateDrawer(false);
        }
        return updated;
      });

      toast.success("Saved to library!");
    } catch (error) {
      console.error("Save to library error:", error);
      toast.error(error?.message || "Failed to save to library");
    } finally {
      setSavingCandidateIndex(null);
    }
  };

  const handleGoLive = () => {
    toast.info("Live hosting will be wired next.");
  };

  const getQuestionsForType = (type) => {
    if (isImportedSession) {
      const map = {
        true_false: editableQuestions.true_false_questions,
        multiple_choice: editableQuestions.multiple_choice_questions,
        written: editableQuestions.written_questions,
        picture: editableQuestions.picture_questions,
      };

      return (map[type] || []).map((question, index) => ({
        slot: { id: `imported-${type}-${index}`, question_order: index + 1 },
        round: { round_name: "Imported Session", round_order: 1 },
        question,
        importedIndex: index,
      }));
    }

    return slots
      .map((slot) => ({
        slot,
        round: rounds.find((r) => r.id === slot.session_round_id),
        question: questionsById[slot.question_id] || null,
      }))
      .filter(({ question }) => {
        if (!question) return false;
        return normalizeType(question) === type;
      })
      .sort((a, b) => {
        const roundA = a.round?.round_order || 0;
        const roundB = b.round?.round_order || 0;
        if (roundA !== roundB) return roundA - roundB;
        return (a.slot?.question_order || 0) - (b.slot?.question_order || 0);
      });
  };

  const counts = questionTypes.reduce((acc, type) => {
    acc[type.value] = getQuestionsForType(type.value).length;
    return acc;
  }, {});

  const totalQuestions = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const updateImportedQuestionField = (type, index, field, value) => {
    setEditableQuestions((prev) => {
      const updated = [...prev[`${type}_questions`]];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };

      if (field === "correct_answer" && type === "true_false") {
        updated[index].incorrect_answers = value === "True" ? "False" : "True";
      }

      if (field === "question_type") {
        updated[index].question_type = value;
      }

      return {
        ...prev,
        [`${type}_questions`]: updated,
      };
    });
  };

  const removeImportedQuestion = (type, index) => {
    setEditableQuestions((prev) => ({
      ...prev,
      [`${type}_questions`]: prev[`${type}_questions`].filter((_, i) => i !== index),
    }));
  };

  const addImportedQuestion = (type) => {
    setEditableQuestions((prev) => ({
      ...prev,
      [`${type}_questions`]: [
        ...prev[`${type}_questions`],
        emptyQuestionForType(type),
      ],
    }));
  };

  const moveImportedQuestionToType = (fromType, index, toType) => {
    if (fromType === toType) return;

    setEditableQuestions((prev) => {
      const source = [...prev[`${fromType}_questions`]];
      const target = [...prev[`${toType}_questions`]];
      const moved = { ...source[index] };

      source.splice(index, 1);
      moved.question_type = toType;

      if (toType === "true_false") {
        moved.correct_answer =
          moved.correct_answer === "False" ? "False" : "True";
        moved.incorrect_answers =
          moved.correct_answer === "True" ? "False" : "True";
        moved.image_url = "";
      } else if (toType === "written") {
        moved.incorrect_answers = "";
        moved.image_url = "";
      } else if (toType === "multiple_choice") {
        moved.incorrect_answers = moved.incorrect_answers || "";
        moved.image_url = "";
      } else if (toType === "picture") {
        moved.incorrect_answers = moved.incorrect_answers || "";
      }

      target.push(moved);

      return {
        ...prev,
        [`${fromType}_questions`]: source,
        [`${toType}_questions`]: target,
      };
    });
  };

  const handleCancelImportedEdits = () => {
    setEditableSessionName(session.name || session.session_name || "Untitled Session");
    setEditableQuestions(normalizeImportedArrays(session));
    setIsEditingImported(false);
  };

  const handleSaveImportedSession = async () => {
    setSavingImported(true);

    try {
      const cleaned = {
        true_false_questions: editableQuestions.true_false_questions.map((q) => ({
          category: q.category || "Imported",
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "True",
          question_type: "true_false",
          incorrect_answers: "False",
          fun_fact: q.fun_fact || "",
          image_url: "",
        })),
        multiple_choice_questions: editableQuestions.multiple_choice_questions.map((q) => ({
          category: q.category || "Imported",
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "",
          question_type: "multiple_choice",
          incorrect_answers: q.incorrect_answers || "",
          fun_fact: q.fun_fact || "",
          image_url: "",
        })),
        written_questions: editableQuestions.written_questions.map((q) => ({
          category: q.category || "Imported",
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "",
          question_type: "written",
          incorrect_answers: "",
          fun_fact: q.fun_fact || "",
          image_url: "",
        })),
        picture_questions: editableQuestions.picture_questions.map((q) => ({
          category: q.category || "Imported",
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "",
          question_type: "picture",
          incorrect_answers: q.incorrect_answers || "",
          fun_fact: q.fun_fact || "",
          image_url: q.image_url || "",
        })),
      };

      const { error } = await supabase
        .from("sessions")
        .update({
          name: editableSessionName || "Imported Session",
          session_name: editableSessionName || "Imported Session",
          true_false_questions: cleaned.true_false_questions,
          multiple_choice_questions: cleaned.multiple_choice_questions,
          written_questions: cleaned.written_questions,
          picture_questions: cleaned.picture_questions,
        })
        .eq("id", id);

      if (error) throw error;

      setSession((prev) => ({
        ...prev,
        name: editableSessionName || "Imported Session",
        session_name: editableSessionName || "Imported Session",
        ...cleaned,
      }));

      setEditableQuestions(cleaned);
      setIsEditingImported(false);
      toast.success("Session updated!");
    } catch (error) {
      console.error("Save imported session error:", error);
      toast.error(error.message || "Failed to save session");
    } finally {
      setSavingImported(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="text-[#71E0DC] animate-spin" size={32} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 lg:p-8 text-center">
        <p className="text-zinc-500">Session not found</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="session-detail-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => navigate("/past-sessions")}
            className="text-zinc-400 hover:text-white"
            data-testid="back-btn"
          >
            <ArrowLeft size={20} />
          </Button>
          <div className="min-w-0">
            {isImportedSession && isEditingImported ? (
              <Input
                value={editableSessionName}
                onChange={(e) => setEditableSessionName(e.target.value)}
                className="bg-zinc-950/50 border-white/10 text-white text-2xl md:text-3xl font-bold h-12"
              />
            ) : (
              <h1 className="text-2xl md:text-3xl font-bold text-white">
                {editableSessionName || session.name || session.session_name || "Untitled Session"}
              </h1>
            )}
            <p className="text-zinc-500 text-sm">
              {totalQuestions} questions · Created {safeDate(session.created_at)}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {isImportedSession && !isEditingImported && (
            <Button
              variant="outline"
              onClick={() => setIsEditingImported(true)}
              className="border-[#AEB2EF]/40 text-[#AEB2EF]"
            >
              <Pencil className="mr-2" size={16} />
              Edit Session
            </Button>
          )}

          {isImportedSession && isEditingImported && (
            <>
              <Button
                onClick={handleSaveImportedSession}
                disabled={savingImported}
                className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              >
                {savingImported ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2" size={16} />
                )}
                Save Changes
              </Button>

              <Button
                variant="outline"
                onClick={handleCancelImportedEdits}
                disabled={savingImported}
                className="border-zinc-700 text-zinc-300"
              >
                Cancel
              </Button>
            </>
          )}

          <Button
            onClick={handleGoLive}
            className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold hover:opacity-90"
            data-testid="go-live-btn"
          >
            <Radio size={16} className="mr-2" />
            Go Live
          </Button>

          <Button
            variant="outline"
            onClick={handleExportCSV}
            className="border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10"
            data-testid="export-csv-btn"
          >
            <Download className="mr-2" size={16} />
            Export CSV
          </Button>

          <Button
            variant="outline"
            onClick={copyToClipboard}
            className="border-white/20 text-white hover:bg-zinc-800"
            data-testid="copy-btn"
          >
            <Copy className="mr-2" size={16} />
            Copy
          </Button>

          <Button
            variant="outline"
            onClick={handleDelete}
            disabled={deleting}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            data-testid="delete-session-btn"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Trash2 className="mr-2" size={16} />
                Delete
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex gap-2 flex-wrap">
        <Button
          onClick={() => handleGenerateCandidates("true_false")}
          disabled={generatingCandidates}
          className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold hover:opacity-90"
        >
          {generatingCandidates && currentGenerateType === "true_false" ? "Generating..." : "Generate T/F"}
        </Button>

        <Button
          onClick={() => handleGenerateCandidates("multiple_choice")}
          disabled={generatingCandidates}
          variant="outline"
          className="border-[#AEB2EF]/40 text-[#AEB2EF]"
        >
          {generatingCandidates && currentGenerateType === "multiple_choice" ? "Generating..." : "Generate MC"}
        </Button>

        <Button
          onClick={() => handleGenerateCandidates("written")}
          disabled={generatingCandidates}
          variant="outline"
          className="border-emerald-400/40 text-emerald-400"
        >
          {generatingCandidates && currentGenerateType === "written" ? "Generating..." : "Generate Written"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {questionTypes.map((type) => {
          const TypeIcon = type.icon;
          return (
            <Card
              key={type.value}
              className={`glass-card cursor-pointer transition-all ${
                activeTab === type.value ? "border-[#71E0DC]/50" : ""
              }`}
              onClick={() => setActiveTab(type.value)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TypeIcon className={type.color} size={20} />
                  <Badge className="bg-zinc-800 text-zinc-300">{counts[type.value] || 0}</Badge>
                </div>
                <p className="text-white font-medium">{type.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="glass-card">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader className="pb-0">
            <TabsList className="bg-zinc-800/50">
              {questionTypes.map((type) => {
                const TypeIcon = type.icon;
                return (
                  <TabsTrigger
                    key={type.value}
                    value={type.value}
                    className="data-[state=active]:bg-zinc-700"
                    data-testid={`session-tab-${type.value}`}
                  >
                    <TypeIcon size={16} className={`mr-2 ${type.color}`} />
                    {type.label}
                    <Badge className="ml-2 bg-zinc-700 text-zinc-300">{counts[type.value] || 0}</Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </CardHeader>

          <CardContent className="pt-4">
            {questionTypes.map((type) => {
              const entries = getQuestionsForType(type.value);

              return (
                <TabsContent key={type.value} value={type.value} className="mt-0">
                  <ScrollArea className="h-[500px]">
                    {entries.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-zinc-500">No {type.label.toLowerCase()} questions in this session</p>
                        {isImportedSession && isEditingImported && (
                          <Button
                            className="mt-4 gradient-btn"
                            onClick={() => addImportedQuestion(type.value)}
                          >
                            <Plus className="mr-2" size={16} />
                            Add {type.label}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4 pr-4">
                        {isImportedSession && isEditingImported && (
                          <div className="flex justify-end">
                            <Button
                              className="gradient-btn"
                              onClick={() => addImportedQuestion(type.value)}
                            >
                              <Plus className="mr-2" size={16} />
                              Add {type.label}
                            </Button>
                          </div>
                        )}

                        {entries.map(({ question, round, slot, importedIndex }, index) => (
                          <Card
                            key={`${slot.id}-${index}`}
                            className="bg-zinc-900/50 border-white/10"
                            data-testid={`session-question-${type.value}-${index}`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-4 mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isImportedSession && isEditingImported ? (
                                    <>
                                      <Input
                                        value={question.category || ""}
                                        onChange={(e) =>
                                          updateImportedQuestionField(type.value, importedIndex, "category", e.target.value)
                                        }
                                        placeholder="Category"
                                        className="w-40 bg-zinc-950/50 border-white/10 text-white"
                                      />

                                      <select
                                        value={normalizeType(question)}
                                        onChange={(e) =>
                                          moveImportedQuestionToType(type.value, importedIndex, e.target.value)
                                        }
                                        className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3"
                                      >
                                        {questionTypes.map((qt) => (
                                          <option key={qt.value} value={qt.value}>
                                            {qt.label}
                                          </option>
                                        ))}
                                      </select>
                                    </>
                                  ) : (
                                    <>
                                      <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                                        {question.category || "Uncategorized"}
                                      </Badge>
                                      <Badge variant="outline" className="border-zinc-700 text-zinc-500">
                                        {round?.round_name || `Round ${round?.round_order || ""}`}
                                      </Badge>
                                    </>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-zinc-600 text-sm font-mono">
                                    #{slot.question_order}
                                  </span>

                                  {isImportedSession && isEditingImported && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-400 hover:bg-red-500/10"
                                      onClick={() => removeImportedQuestion(type.value, importedIndex)}
                                    >
                                      <Trash2 size={14} />
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {isImportedSession && isEditingImported ? (
                                <div className="space-y-3">
                                  <textarea
                                    value={question.question_text || ""}
                                    onChange={(e) =>
                                      updateImportedQuestionField(type.value, importedIndex, "question_text", e.target.value)
                                    }
                                    placeholder="Question text"
                                    className="w-full min-h-[90px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3"
                                  />

                                  {type.value === "true_false" ? (
                                    <select
                                      value={question.correct_answer || "True"}
                                      onChange={(e) =>
                                        updateImportedQuestionField(type.value, importedIndex, "correct_answer", e.target.value)
                                      }
                                      className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3"
                                    >
                                      <option value="True">True</option>
                                      <option value="False">False</option>
                                    </select>
                                  ) : (
                                    <>
                                      <Input
                                        value={question.correct_answer || ""}
                                        onChange={(e) =>
                                          updateImportedQuestionField(type.value, importedIndex, "correct_answer", e.target.value)
                                        }
                                        placeholder="Correct answer"
                                        className="bg-zinc-950/50 border-white/10 text-white"
                                      />

                                      {(type.value === "multiple_choice" || type.value === "picture") && (
                                        <Input
                                          value={question.incorrect_answers || ""}
                                          onChange={(e) =>
                                            updateImportedQuestionField(type.value, importedIndex, "incorrect_answers", e.target.value)
                                          }
                                          placeholder="Incorrect answers separated by semicolons"
                                          className="bg-zinc-950/50 border-white/10 text-white"
                                        />
                                      )}

                                      {type.value === "picture" && (
                                        <Input
                                          value={question.image_url || ""}
                                          onChange={(e) =>
                                            updateImportedQuestionField(type.value, importedIndex, "image_url", e.target.value)
                                          }
                                          placeholder="Image URL"
                                          className="bg-zinc-950/50 border-white/10 text-white"
                                        />
                                      )}
                                    </>
                                  )}

                                  <textarea
                                    value={question.fun_fact || ""}
                                    onChange={(e) =>
                                      updateImportedQuestionField(type.value, importedIndex, "fun_fact", e.target.value)
                                    }
                                    placeholder="Fun fact"
                                    className="w-full min-h-[80px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3"
                                  />
                                </div>
                              ) : (
                                <>
                                  <p className="text-white font-medium mb-3">{question.question_text}</p>

                                  {question.image_url && (
                                    <div className="mb-3">
                                      <img
                                        src={question.image_url}
                                        alt="Question"
                                        className="w-full max-w-sm rounded-lg border border-white/10"
                                        data-testid={`session-question-image-${type.value}-${index}`}
                                      />
                                    </div>
                                  )}

                                  {question.incorrect_answers && (
                                    <div className="grid grid-cols-2 gap-2 mb-3">
                                      {String(question.incorrect_answers)
                                        .split(";")
                                        .map((option) => option.trim())
                                        .filter(Boolean)
                                        .map((option, optIndex) => (
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
                                      <span className="text-emerald-400 font-medium">
                                        {question.correct_answer}
                                      </span>
                                    </p>
                                    {question.fun_fact && (
                                      <p className="text-sm">
                                        <span className="text-zinc-500">Fun Fact: </span>
                                        <span className="text-zinc-300">{question.fun_fact}</span>
                                      </p>
                                    )}
                                  </div>
                                </>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              );
            })}
          </CardContent>
        </Tabs>
      </Card>

      {showCandidateDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowCandidateDrawer(false)}
          />

          <div className="relative w-full max-w-xl h-full bg-zinc-950 border-l border-white/10 shadow-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-white text-xl font-bold">
                  Generated {getTypeLabel(currentGenerateType)} Candidates
                </h2>
                <p className="text-zinc-500 text-sm">
                  Review and keep only the ones you want
                </p>
              </div>

              <Button
                variant="ghost"
                onClick={() => setShowCandidateDrawer(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X size={20} />
              </Button>
            </div>

            <div className="space-y-4">
              {candidates.map((candidate, index) => (
                <Card key={index} className="bg-zinc-900/70 border-white/10">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                        {candidate.category}
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
                        <span className="text-emerald-400 font-medium">
                          {candidate.correct_answer}
                        </span>
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
                        disabled={savingCandidateIndex === index}
                        className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        onClick={() => handleSaveToLibrary(candidate, index)}
                      >
                        {savingCandidateIndex === index ? "Saving..." : "Save to Library"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingCandidateIndex === index}
                        className="border-zinc-700 text-zinc-300"
                        onClick={() => handleDiscardCandidate(index)}
                      >
                        Discard
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {candidates.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-zinc-500">No candidates available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionDetail;
