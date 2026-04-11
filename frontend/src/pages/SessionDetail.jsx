import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
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
  X, //
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400" },
];

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
  const [generatingTF, setGeneratingTF] = useState(false);
  const [tfCandidates, setTfCandidates] = useState([]);
  const [showCandidateDrawer, setShowCandidateDrawer] = useState(false);

  useEffect(() => {
    fetchSessionData();
  }, [id]);

  const normalizeType = (q) => {
    if (!q) return null;
    if (q.has_image) return "picture";
    return q.question_type;
  };

  const safeDate = (value) => {
    if (!value) return "No date";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "No date" : d.toLocaleDateString();
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

      const { data: roundData, error: roundsError } = await supabase
        .from("session_rounds")
        .select("*")
        .eq("session_id", id)
        .order("round_order", { ascending: true });

      if (roundsError) throw roundsError;

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

      const firstFilledType =
        slotData
          .map((s) => questionMap[s.question_id])
          .map((q) => normalizeType(q))
          .find(Boolean) || "true_false";

      setActiveTab(firstFilledType);
    } catch (error) {
      console.error("Failed to load session:", error);
      toast.error(error.message || "Failed to load session");
      navigate("/");
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
      navigate("/");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Failed to delete session");
    } finally {
      setDeleting(false);
    }
  };

  const copyToClipboard = async () => {
    if (!session) return;

    let text = `TRIVIA SESSION: ${session.title || session.session_name || "Untitled Session"}\n`;
    text += `Created: ${safeDate(session.created_at)}\n\n`;

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

    await navigator.clipboard.writeText(text);
    toast.success("Session copied to clipboard!");
  };

  const handleExportCSV = async () => {
    const rows = [];

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
    a.download = `${(session?.title || session?.session_name || "session")
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

const handleSaveAndInsertTFCandidate = async (candidate, candidateIndex) => {
  try {
    const { data: insertedQuestion, error: insertQuestionError } = await supabase
      .from("questions")
      .insert({
        user_id: (await supabase.auth.getUser()).data.user.id,
        question_text: candidate.question_text,
        question_type: "true_false",
        has_image: false,
        image_url: null,
        category: candidate.category,
        theme: null,
        correct_answer: candidate.correct_answer,
        incorrect_answers: null,
        fun_fact: candidate.fun_fact,
        difficulty: candidate.difficulty || "medium",
        source: "ai",
        status: "saved",
        notes: null,
      })
      .select()
      .single();

    if (insertQuestionError) throw insertQuestionError;

    const tfRound = rounds.find((r) =>
      (r.round_name || "").toLowerCase().includes("round 1")
    ) || rounds[0];

    if (!tfRound) throw new Error("No round found for true/false");

    const openSlots = slots
      .filter((s) => s.session_round_id === tfRound.id && !s.question_id)
      .sort((a, b) => a.question_order - b.question_order);

    if (openSlots.length === 0) {
      throw new Error("No open true/false slots available");
    }

    const nextOpenSlot = openSlots[0];

    const { error: updateSlotError } = await supabase
      .from("session_questions")
      .update({ question_id: insertedQuestion.id })
      .eq("id", nextOpenSlot.id);

    if (updateSlotError) throw updateSlotError;

    setTfCandidates((prev) => {
  const updated = prev.filter((_, i) => i !== candidateIndex);
  if (updated.length === 0) {
    setShowCandidateDrawer(false);
  }
  return updated;
});
    toast.success("Question saved and inserted!");
    fetchSessionData();
  } catch (error) {
    console.error(error);
    toast.error(error.message || "Failed to save and insert");
  }
};
  
const handleGenerateTFCandidates = async () => {
  setGeneratingTF(true);
  try {
    const res = await fetch("/api/generate-session-candidates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: id,
        questionType: "true_false",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to generate candidates");
    }

    setTfCandidates(data.candidates || []);
    setShowCandidateDrawer(true);
    toast.success("True/False candidates generated!");
  } catch (error) {
    console.error(error);
    toast.error(error.message || "Failed to generate candidates");
  } finally {
    setGeneratingTF(false);
  }
};

const handleDiscardTFCandidate = (candidateIndex) => {
  setTfCandidates((prev) => {
    const updated = prev.filter((_, i) => i !== candidateIndex);
    if (updated.length === 0) {
      setShowCandidateDrawer(false);
    }
    return updated;
  });
};
  
  const handleGoLive = () => {
    toast.info("Live hosting will be wired next.");
  };

  const getQuestionsForType = (type) => {
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
            onClick={() => navigate("/")}
            className="text-zinc-400 hover:text-white"
            data-testid="back-btn"
          >
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">
              {session.title || session.session_name || "Untitled Session"}
            </h1>
            <p className="text-zinc-500 text-sm">
              {totalQuestions} questions · Created {safeDate(session.created_at)}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
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

<div className="mb-4">
  <Button
    onClick={handleGenerateTFCandidates}
    disabled={generatingTF}
    className="bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900 font-bold hover:opacity-90"
  >
    {generatingTF ? "Generating..." : "Generate True/False Candidates"}
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
                      </div>
                    ) : (
                      <div className="space-y-4 pr-4">
                        {entries.map(({ question, round, slot }, index) => (
                          <Card
                            key={`${slot.id}-${question.id}`}
                            className="bg-zinc-900/50 border-white/10"
                            data-testid={`session-question-${type.value}-${index}`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-4 mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                                    {question.category || "Uncategorized"}
                                  </Badge>
                                  <Badge variant="outline" className="border-zinc-700 text-zinc-500">
                                    {round?.round_name || `Round ${round?.round_order || ""}`}
                                  </Badge>
                                </div>
                                <span className="text-zinc-600 text-sm font-mono">
                                  #{slot.question_order}
                                </span>
                              </div>

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
                                  {question.incorrect_answers
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
          <h2 className="text-white text-xl font-bold">Generated T/F Candidates</h2>
          <p className="text-zinc-500 text-sm">
            Review and insert only the ones you want
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
        {tfCandidates.map((candidate, index) => (
          <Card key={index} className="bg-zinc-900/70 border-white/10">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                  {candidate.category}
                </Badge>
                <span className="text-zinc-600 text-sm font-mono">#{index + 1}</span>
              </div>

              <p className="text-white font-medium mb-3">{candidate.question_text}</p>

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
                  className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  onClick={() => handleSaveAndInsertTFCandidate(candidate, index)}
                >
                  Save + Insert
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700 text-zinc-300"
                  onClick={() => handleDiscardTFCandidate(index)}
                >
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  </div>
)}
    </div>
  );
};

export default SessionDetail;
