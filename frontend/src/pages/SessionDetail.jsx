import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { Input } from "../components/ui/input";
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  Pencil,
  Plus,
  Radio,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "written", label: "Written" },
  { value: "picture", label: "Picture" },
];

const arrayKeyByType = {
  true_false: "true_false_questions",
  multiple_choice: "multiple_choice_questions",
  written: "written_questions",
  picture: "picture_questions",
};

const STORAGE_BASE = process.env.REACT_APP_SUPABASE_URL ? `${process.env.REACT_APP_SUPABASE_URL}/storage/v1/object/public/` : "";

const buildStorageUrl = (path) => {
  if (!path) return "";
  if (String(path).startsWith("http://") || String(path).startsWith("https://")) return path;
  if (!STORAGE_BASE) return path;
  return `${STORAGE_BASE}${String(path).replace(/^\/+/, "")}`;
};

const emptyQuestionForType = (type, roundName = "Imported Session", order = 1) => ({
  category: "",
  round_name: roundName,
  round_order: 1,
  source_order: order,
  question_text: "",
  correct_answer: type === "true_false" ? "True" : "",
  correct_answer_image: "",
  question_type: type,
  incorrect_answers: type === "true_false" ? JSON.stringify([{ text: "False", image: null }]) : JSON.stringify([]),
  fun_fact: "",
  image_url: "",
});

const parseIncorrectAnswers = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? { text: item, image: null } : { text: item?.text || "", image: item?.image || null }));
  }

  const raw = String(value).trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => (typeof item === "string" ? { text: item, image: null } : { text: item?.text || "", image: item?.image || null }));
      }
    } catch {
      // Fall through to semicolon parsing.
    }
  }

  return raw.split(";").map((item) => item.trim()).filter(Boolean).map((text) => ({ text, image: null }));
};

const normalizeType = (q) => {
  if (!q) return "written";
  if (q.question_type === "true_false" || q.question_type === "multiple_choice" || q.question_type === "picture") return q.question_type;
  return "written";
};

const safeDate = (value) => {
  if (!value) return "No date";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString();
};

const normalizeImportedArrays = (sessionData) => ({
  true_false_questions: Array.isArray(sessionData?.true_false_questions) ? sessionData.true_false_questions : [],
  multiple_choice_questions: Array.isArray(sessionData?.multiple_choice_questions) ? sessionData.multiple_choice_questions : [],
  written_questions: Array.isArray(sessionData?.written_questions) ? sessionData.written_questions : [],
  picture_questions: Array.isArray(sessionData?.picture_questions) ? sessionData.picture_questions : [],
});

const getRoundName = (question, fallbackOrder = 1) => {
  if (question?.round_name) return question.round_name;
  if (question?.round_title) return question.round_title;
  if (question?.round && Number.isNaN(Number(question.round))) return question.round;
  const order = Number(question?.round_order || question?.round_number || question?.round || fallbackOrder) || fallbackOrder;
  return order === 1 && !question?.round_order && !question?.round_number && !question?.round ? "Imported Session" : `Round ${order}`;
};

const getRoundOrder = (question, fallbackOrder = 1) => Number(question?.round_order || question?.round_number || question?.round || fallbackOrder) || fallbackOrder;
const getSourceOrder = (question, fallbackOrder = 1) => Number(question?.import_order || question?.source_order || question?.question_order || question?.order || fallbackOrder) || fallbackOrder;

const makeRoundGroups = (entries) => {
  const groups = new Map();
  entries
    .slice()
    .sort((a, b) => {
      if (a.roundOrder !== b.roundOrder) return a.roundOrder - b.roundOrder;
      return a.sourceOrder - b.sourceOrder;
    })
    .forEach((entry) => {
      const key = `${entry.roundOrder}-${entry.roundName}`;
      if (!groups.has(key)) {
        groups.set(key, { key, name: entry.roundName, order: entry.roundOrder, entries: [] });
      }
      groups.get(key).entries.push(entry);
    });
  return [...groups.values()];
};

const SessionDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [session, setSession] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [slots, setSlots] = useState([]);
  const [questionsById, setQuestionsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isImportedSession = !!session?.is_past;
  const hasArrayQuestions = Object.values(editableQuestions).some((items) => items.length > 0);
  const canEditArrays = isImportedSession || hasArrayQuestions;

  const importedEntries = useMemo(() => {
    return Object.entries(arrayKeyByType).flatMap(([type, key]) =>
      (editableQuestions[key] || []).map((question, index) => {
        const roundOrder = getRoundOrder(question, 1);
        return {
          id: `${key}-${index}`,
          question: { ...question, question_type: normalizeType({ ...question, question_type: question.question_type || type }) },
          storageType: type,
          importedIndex: index,
          sourceOrder: getSourceOrder(question, index + 1),
          roundName: getRoundName(question, roundOrder),
          roundOrder,
        };
      })
    );
  }, [editableQuestions]);

  const structuredEntries = useMemo(() => {
    return slots
      .map((slot) => {
        const round = rounds.find((r) => r.id === slot.session_round_id);
        const question = questionsById[slot.question_id] || null;
        return {
          id: slot.id,
          slot,
          question,
          roundName: round?.round_name || `Round ${round?.round_order || 1}`,
          roundOrder: Number(round?.round_order || 1),
          sourceOrder: Number(slot?.question_order || 1),
        };
      })
      .filter((entry) => entry.question);
  }, [questionsById, rounds, slots]);

  const roundGroups = useMemo(() => makeRoundGroups(hasArrayQuestions ? importedEntries : structuredEntries), [hasArrayQuestions, importedEntries, structuredEntries]);
  const totalQuestions = roundGroups.reduce((sum, round) => sum + round.entries.length, 0);

  const fetchSessionData = async () => {
    setLoading(true);

    try {
      let sessionQuery = supabase.from("sessions").select("*").eq("id", id);
      if (user?.id) sessionQuery = sessionQuery.eq("user_id", user.id);
      const { data: sessionData, error: sessionError } = await sessionQuery.single();
      if (sessionError) throw sessionError;

      const importedArrays = normalizeImportedArrays(sessionData);
      setEditableSessionName(sessionData.name || sessionData.session_name || "Untitled Session");
      setEditableQuestions(importedArrays);

      const importedQuestionCount = Object.values(importedArrays).reduce((sum, items) => sum + items.length, 0);
      if (sessionData.is_past || importedQuestionCount > 0) {
        setSession(sessionData);
        setRounds([]);
        setSlots([]);
        setQuestionsById({});
        return;
      }

      const { data: roundData, error: roundsError } = await supabase
        .from("session_rounds")
        .select("*")
        .eq("session_id", id)
        .order("round_order", { ascending: true });

      if (roundsError && roundsError.code !== "PGRST116") throw roundsError;

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
        const { data: questionData, error: questionsError } = await supabase.from("questions").select("*").in("id", questionIds);
        if (questionsError) throw questionsError;
        questionMap = Object.fromEntries((questionData || []).map((q) => [q.id, q]));
      }

      setSession(sessionData);
      setRounds(roundData || []);
      setSlots(slotData);
      setQuestionsById(questionMap);
    } catch (error) {
      console.error("Failed to load session:", error);
      toast.error(error.message || "Failed to load session");
      navigate("/past-sessions");
    } finally {
      setLoading(false);
    }
  };

  const updateImportedQuestionField = (type, index, field, value) => {
    const key = arrayKeyByType[type];
    setEditableQuestions((prev) => {
      const updated = [...prev[key]];
      updated[index] = { ...updated[index], [field]: value };

      if (field === "correct_answer" && type === "true_false") {
        updated[index].incorrect_answers = JSON.stringify([{ text: value === "True" ? "False" : "True", image: null }]);
      }

      return { ...prev, [key]: updated };
    });
  };

  const removeImportedQuestion = (type, index) => {
    const key = arrayKeyByType[type];
    setEditableQuestions((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const addImportedQuestion = (roundName = "Imported Session") => {
    setEditableQuestions((prev) => ({
      ...prev,
      written_questions: [...prev.written_questions, emptyQuestionForType("written", roundName, totalQuestions + 1)],
    }));
  };

  const moveImportedQuestionToType = (fromType, index, toType) => {
    if (fromType === toType) return;
    const fromKey = arrayKeyByType[fromType];
    const toKey = arrayKeyByType[toType];

    setEditableQuestions((prev) => {
      const source = [...prev[fromKey]];
      const target = [...prev[toKey]];
      const moved = { ...source[index], question_type: toType };
      source.splice(index, 1);

      if (toType === "true_false") {
        moved.correct_answer = moved.correct_answer === "False" ? "False" : "True";
        moved.incorrect_answers = JSON.stringify([{ text: moved.correct_answer === "True" ? "False" : "True", image: null }]);
      } else if (toType === "written") {
        moved.incorrect_answers = JSON.stringify([]);
      } else {
        moved.incorrect_answers = moved.incorrect_answers || JSON.stringify([]);
      }

      target.push(moved);
      return { ...prev, [fromKey]: source, [toKey]: target };
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
        true_false_questions: editableQuestions.true_false_questions.map((q, index) => ({
          category: q.category || "",
          round_name: getRoundName(q, 1),
          round_order: getRoundOrder(q, 1),
          source_order: getSourceOrder(q, index + 1),
          import_order: getSourceOrder(q, index + 1),
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "True",
          correct_answer_image: q.correct_answer_image || "",
          question_type: "true_false",
          incorrect_answers: JSON.stringify([{ text: q.correct_answer === "True" ? "False" : "True", image: null }]),
          fun_fact: q.fun_fact || "",
          image_url: q.image_url || "",
        })),
        multiple_choice_questions: editableQuestions.multiple_choice_questions.map((q, index) => ({
          category: q.category || "",
          round_name: getRoundName(q, 1),
          round_order: getRoundOrder(q, 1),
          source_order: getSourceOrder(q, index + 1),
          import_order: getSourceOrder(q, index + 1),
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "",
          correct_answer_image: q.correct_answer_image || "",
          question_type: "multiple_choice",
          incorrect_answers: q.incorrect_answers || JSON.stringify([]),
          fun_fact: q.fun_fact || "",
          image_url: q.image_url || "",
        })),
        written_questions: editableQuestions.written_questions.map((q, index) => ({
          category: q.category || "",
          round_name: getRoundName(q, 1),
          round_order: getRoundOrder(q, 1),
          source_order: getSourceOrder(q, index + 1),
          import_order: getSourceOrder(q, index + 1),
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "",
          correct_answer_image: q.correct_answer_image || "",
          question_type: "written",
          incorrect_answers: JSON.stringify([]),
          fun_fact: q.fun_fact || "",
          image_url: q.image_url || "",
        })),
        picture_questions: editableQuestions.picture_questions.map((q, index) => ({
          category: q.category || "",
          round_name: getRoundName(q, 1),
          round_order: getRoundOrder(q, 1),
          source_order: getSourceOrder(q, index + 1),
          import_order: getSourceOrder(q, index + 1),
          question_text: q.question_text || "",
          correct_answer: q.correct_answer || "",
          correct_answer_image: q.correct_answer_image || "",
          question_type: "picture",
          incorrect_answers: q.incorrect_answers || JSON.stringify([]),
          fun_fact: q.fun_fact || "",
          image_url: q.image_url || "",
        })),
      };

      const finalName = editableSessionName || "Imported Session";
      const { data: savedSession, error } = await supabase
        .from("sessions")
        .update({ name: finalName, session_name: finalName, ...cleaned })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      setSession((prev) => ({ ...prev, ...savedSession, name: finalName, session_name: finalName, ...cleaned }));
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

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this session?")) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      toast.success("Session deleted");
      navigate("/past-sessions");
    } catch (error) {
      toast.error(error.message || "Failed to delete session");
    } finally {
      setDeleting(false);
    }
  };

  const getFlatEntries = () => roundGroups.flatMap((round) => round.entries.map((entry, index) => ({ ...entry, displayOrder: index + 1, roundName: round.name })));

  const copyToClipboard = async () => {
    if (!session) return;
    const currentName = editableSessionName || session.name || session.session_name || "Untitled Session";
    let text = `TRIVIA SESSION: ${currentName}\n`;
    text += `Created: ${safeDate(session.created_at)}\n\n`;

    roundGroups.forEach((round) => {
      text += `=== ${round.name} ===\n\n`;
      round.entries.forEach((entry, index) => {
        const q = entry.question;
        text += `${index + 1}. [${q.category || "Uncategorized"}] ${q.question_text || ""}\n`;
        text += `   A: ${q.correct_answer || ""}\n`;
        if (q.image_url) text += `   Image: ${q.image_url}\n`;
        const incorrect = parseIncorrectAnswers(q.incorrect_answers);
        if (incorrect.length) text += `   Options: ${incorrect.map((a) => a.text).join(", ")}\n`;
        if (q.fun_fact) text += `   Fun Fact: ${q.fun_fact}\n`;
        text += "\n";
      });
    });

    await navigator.clipboard.writeText(text);
    toast.success("Session copied to clipboard!");
  };

  const handleExportCSV = async () => {
    const header = ["round", "order", "type", "category", "question", "correct_answer", "incorrect_answers", "fun_fact", "image_url", "correct_answer_image"];
    const rows = getFlatEntries().map((entry) => {
      const q = entry.question;
      return {
        round: entry.roundName,
        order: entry.displayOrder,
        type: normalizeType(q),
        category: q?.category || "",
        question: q?.question_text || "",
        correct_answer: q?.correct_answer || "",
        incorrect_answers: q?.incorrect_answers || "",
        fun_fact: q?.fun_fact || "",
        image_url: q?.image_url || "",
        correct_answer_image: q?.correct_answer_image || "",
      };
    });

    const csv = [
      header.join(","),
      ...rows.map((row) => header.map((key) => `"${String(row[key] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(editableSessionName || session?.name || "session").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleGoLive = () => {
    toast.info("Live hosting will be wired next.");
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
          <Button variant="ghost" onClick={() => navigate("/past-sessions")} className="text-zinc-400 hover:text-white" data-testid="back-btn">
            <ArrowLeft size={20} />
          </Button>
          <div className="min-w-0">
            {canEditArrays && isEditingImported ? (
              <Input value={editableSessionName} onChange={(e) => setEditableSessionName(e.target.value)} className="bg-zinc-950/50 border-white/10 text-white text-2xl md:text-3xl font-bold h-12" />
            ) : (
              <h1 className="text-2xl md:text-3xl font-bold text-white">{editableSessionName || session.name || session.session_name || "Untitled Session"}</h1>
            )}
            <p className="text-zinc-500 text-sm">{totalQuestions} questions · Created {safeDate(session.created_at)}</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {canEditArrays && !isEditingImported && (
            <Button variant="outline" onClick={() => setIsEditingImported(true)} className="border-[#AEB2EF]/40 text-[#AEB2EF]">
              <Pencil className="mr-2" size={16} />Edit Session
            </Button>
          )}
          {canEditArrays && !isEditingImported && (
            <Button variant="outline" onClick={() => navigate(`/build/${id}`)} className="border-[#71E0DC]/40 text-[#71E0DC] hover:bg-[#71E0DC]/10">
              <Pencil className="mr-2" size={16} />Open in Builder
            </Button>
          )}

          {canEditArrays && isEditingImported && (
            <>
              <Button onClick={handleSaveImportedSession} disabled={savingImported} className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {savingImported ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2" size={16} />}
                Save Changes
              </Button>
              <Button variant="outline" onClick={handleCancelImportedEdits} disabled={savingImported} className="border-zinc-700 text-zinc-300">Cancel</Button>
            </>
          )}

          <Button onClick={handleGoLive} className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold hover:opacity-90" data-testid="go-live-btn">
            <Radio size={16} className="mr-2" />Go Live
          </Button>
          <Button variant="outline" onClick={handleExportCSV} className="border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10" data-testid="export-csv-btn">
            <Download className="mr-2" size={16} />Export CSV
          </Button>
          <Button variant="outline" onClick={copyToClipboard} className="border-white/20 text-white hover:bg-zinc-800" data-testid="copy-btn">
            <Copy className="mr-2" size={16} />Copy
          </Button>
          <Button variant="outline" onClick={handleDelete} disabled={deleting} className="border-red-500/30 text-red-400 hover:bg-red-500/10" data-testid="delete-session-btn">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trash2 className="mr-2" size={16} />Delete</>}
          </Button>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-white">Rounds</CardTitle>
              <CardDescription className="text-zinc-500">Questions are shown in saved round order.</CardDescription>
            </div>
            {canEditArrays && isEditingImported && (
              <Button className="gradient-btn" onClick={() => addImportedQuestion(roundGroups[0]?.name || "Imported Session")}>
                <Plus className="mr-2" size={16} />Add Question
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[700px] pr-4">
            {roundGroups.length === 0 ? (
              <div className="text-center py-16"><p className="text-zinc-500">No questions in this session.</p></div>
            ) : (
              <div className="space-y-6">
                {roundGroups.map((round) => (
                  <section key={round.key}>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h2 className="text-xl font-bold text-white">{round.name}</h2>
                      <Badge className="bg-zinc-800 text-zinc-300">{round.entries.length} questions</Badge>
                    </div>
                    <div className="space-y-4">
                      {round.entries.map((entry, index) => (
                        <SessionQuestionCard
                          key={entry.id}
                          entry={entry}
                          index={index}
                          canEdit={canEditArrays && isEditingImported && entry.storageType}
                          onUpdate={updateImportedQuestionField}
                          onMove={moveImportedQuestionToType}
                          onRemove={removeImportedQuestion}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

const EditField = ({ label, children }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
    {children}
  </label>
);

const SessionQuestionCard = ({ entry, index, canEdit, onUpdate, onMove, onRemove }) => {
  const { question, storageType, importedIndex } = entry;
  const type = normalizeType(question);
  const parsedIncorrect = parseIncorrectAnswers(question.incorrect_answers);

  return (
    <Card className="bg-zinc-900/50 border-white/10" data-testid={`session-question-${entry.roundOrder}-${index}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-end gap-2 flex-wrap">
            {canEdit ? (
              <>
                <EditField label="Round">
                  <Input value={question.round_name || entry.roundName || ""} onChange={(e) => onUpdate(storageType, importedIndex, "round_name", e.target.value)} placeholder="Round name" className="w-44 bg-zinc-950/50 border-white/10 text-white" />
                </EditField>
                <EditField label="Question Type">
                  <select value={type} onChange={(e) => onMove(storageType, importedIndex, e.target.value)} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3">
                    {questionTypes.map((qt) => <option key={qt.value} value={qt.value}>{qt.label}</option>)}
                  </select>
                </EditField>
                <EditField label="Category">
                  <Input value={question.category || ""} onChange={(e) => onUpdate(storageType, importedIndex, "category", e.target.value)} placeholder="Add category later" className="w-44 bg-zinc-950/50 border-white/10 text-white" />
                </EditField>
              </>
            ) : (
              <>
                <Badge variant="outline" className="border-zinc-700 text-zinc-400">{question.category || "Uncategorized"}</Badge>
                {question.image_url && <Badge className="bg-amber-500/10 text-amber-300 border border-amber-500/20">Image</Badge>}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-sm font-mono">#{index + 1}</span>
            {canEdit && (
              <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-500/10" onClick={() => onRemove(storageType, importedIndex)}>
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        </div>

        {canEdit ? (
          <div className="space-y-3">
            <EditField label="Question">
              <textarea value={question.question_text || ""} onChange={(e) => onUpdate(storageType, importedIndex, "question_text", e.target.value)} placeholder="Question text" className="w-full min-h-[90px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3" />
            </EditField>
            {type === "true_false" ? (
              <EditField label="Correct Answer">
                <select value={question.correct_answer || "True"} onChange={(e) => onUpdate(storageType, importedIndex, "correct_answer", e.target.value)} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3">
                  <option value="True">True</option>
                  <option value="False">False</option>
                </select>
              </EditField>
            ) : (
              <EditField label="Correct Answer">
                <Input value={question.correct_answer || ""} onChange={(e) => onUpdate(storageType, importedIndex, "correct_answer", e.target.value)} placeholder="Correct answer" className="bg-zinc-950/50 border-white/10 text-white" />
              </EditField>
            )}
            <EditField label="Question Image / Media URL">
              <Input value={question.image_url || ""} onChange={(e) => onUpdate(storageType, importedIndex, "image_url", e.target.value)} placeholder="Optional image/media URL" className="bg-zinc-950/50 border-white/10 text-white" />
            </EditField>
            <EditField label="Correct Answer Image URL">
              <Input value={question.correct_answer_image || ""} onChange={(e) => onUpdate(storageType, importedIndex, "correct_answer_image", e.target.value)} placeholder="Optional correct answer image URL" className="bg-zinc-950/50 border-white/10 text-white" />
            </EditField>
            {(type === "multiple_choice" || type === "picture") && (
              <EditField label="Incorrect Answers">
                <textarea value={question.incorrect_answers || ""} onChange={(e) => onUpdate(storageType, importedIndex, "incorrect_answers", e.target.value)} placeholder="Incorrect answers JSON or semicolon list" className="w-full min-h-[90px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3" />
              </EditField>
            )}
            <EditField label="Fun Fact">
              <textarea value={question.fun_fact || ""} onChange={(e) => onUpdate(storageType, importedIndex, "fun_fact", e.target.value)} placeholder="Fun fact" className="w-full min-h-[70px] rounded-md bg-zinc-950/50 border border-white/10 text-white p-3" />
            </EditField>
          </div>
        ) : (
          <>
            <p className="text-white font-medium mb-3">{question.question_text}</p>
            {question.image_url && (
              <div className="mb-3">
                <img src={buildStorageUrl(question.image_url)} alt="Question" className="w-full max-w-sm rounded-lg border border-white/10" data-testid={`session-question-image-${entry.roundOrder}-${index}`} />
              </div>
            )}
            {(parsedIncorrect.length > 0 || question.correct_answer) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {parsedIncorrect.map((option, optIndex) => (
                  <div key={`incorrect-${optIndex}`} className="px-3 py-2 rounded-md text-sm bg-zinc-800/50 text-zinc-300">
                    <div>{option.text}</div>
                    {option.image && <img src={buildStorageUrl(option.image)} alt={option.text || `Option ${optIndex + 1}`} className="mt-2 max-h-24 rounded border border-white/10" />}
                  </div>
                ))}
                {question.correct_answer && (
                  <div className="px-3 py-2 rounded-md text-sm bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    <div>{question.correct_answer}</div>
                    {question.correct_answer_image && <img src={buildStorageUrl(question.correct_answer_image)} alt={question.correct_answer} className="mt-2 max-h-24 rounded border border-white/10" />}
                  </div>
                )}
              </div>
            )}
            <div className="pt-3 border-t border-white/10 space-y-1">
              <p className="text-sm"><span className="text-zinc-500">Answer: </span><span className="text-emerald-400 font-medium">{question.correct_answer}</span></p>
              {question.fun_fact && <p className="text-sm"><span className="text-zinc-500">Fun Fact: </span><span className="text-zinc-300">{question.fun_fact}</span></p>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SessionDetail;
