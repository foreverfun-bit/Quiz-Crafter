import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
  Printer,
  Copy
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", field: "true_false_questions" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", field: "multiple_choice_questions" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400", field: "written_questions" },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400", field: "picture_questions" },
];

const SessionDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("true_false");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchSession();
  }, [id]);

  const fetchSession = async () => {
    try {
      const response = await api.get(`/sessions/${id}`);
      setSession(response.data);
    } catch (error) {
      toast.error("Failed to load session");
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this session?")) return;
    
    setDeleting(true);
    try {
      await api.delete(`/sessions/${id}`);
      toast.success("Session deleted");
      navigate("/");
    } catch (error) {
      toast.error("Failed to delete session");
    } finally {
      setDeleting(false);
    }
  };

  const copyToClipboard = () => {
    if (!session) return;

    let text = `TRIVIA SESSION: ${session.name}\n`;
    text += `Created: ${new Date(session.created_at).toLocaleDateString()}\n\n`;

    questionTypes.forEach(type => {
      const questionIds = session[type.field] || [];
      if (questionIds.length === 0) return;

      text += `\n=== ${type.label.toUpperCase()} ===\n\n`;
      
      questionIds.forEach((qId, index) => {
        const question = session.questions?.[qId];
        if (!question) return;

        text += `${index + 1}. [${question.category}]\n`;
        text += `   Q: ${question.question}\n`;
        text += `   A: ${question.answer}\n`;
        if (question.fun_fact) {
          text += `   Fun Fact: ${question.fun_fact}\n`;
        }
        text += '\n';
      });
    });

    navigator.clipboard.writeText(text);
    toast.success("Session copied to clipboard!");
  };

  const getQuestionsForType = (type) => {
    if (!session) return [];
    const questionIds = session[type.field] || [];
    return questionIds.map(id => session.questions?.[id]).filter(Boolean);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
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

  const totalQuestions = questionTypes.reduce((sum, type) => 
    sum + (session[type.field]?.length || 0), 0
  );

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="session-detail-page">
      {/* Header */}
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
              {session.name}
            </h1>
            <p className="text-zinc-500 text-sm">
              {totalQuestions} questions · Created {new Date(session.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {questionTypes.map((type) => {
          const TypeIcon = type.icon;
          const count = session[type.field]?.length || 0;
          return (
            <Card 
              key={type.value}
              className={`glass-card cursor-pointer transition-all ${
                activeTab === type.value ? 'border-[#71E0DC]/50' : ''
              }`}
              onClick={() => setActiveTab(type.value)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TypeIcon className={type.color} size={20} />
                  <Badge className="bg-zinc-800 text-zinc-300">{count}</Badge>
                </div>
                <p className="text-white font-medium">{type.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Questions by Type */}
      <Card className="glass-card">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader className="pb-0">
            <TabsList className="bg-zinc-800/50">
              {questionTypes.map((type) => {
                const TypeIcon = type.icon;
                const count = session[type.field]?.length || 0;
                return (
                  <TabsTrigger 
                    key={type.value} 
                    value={type.value}
                    className="data-[state=active]:bg-zinc-700"
                    data-testid={`session-tab-${type.value}`}
                  >
                    <TypeIcon size={16} className={`mr-2 ${type.color}`} />
                    {type.label}
                    <Badge className="ml-2 bg-zinc-700 text-zinc-300">{count}</Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </CardHeader>

          <CardContent className="pt-4">
            {questionTypes.map((type) => {
              const questions = getQuestionsForType(type);
              return (
                <TabsContent key={type.value} value={type.value} className="mt-0">
                  <ScrollArea className="h-[500px]">
                    {questions.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-zinc-500">No {type.label.toLowerCase()} questions in this session</p>
                      </div>
                    ) : (
                      <div className="space-y-4 pr-4">
                        {questions.map((question, index) => (
                          <Card 
                            key={question.id}
                            className="bg-zinc-900/50 border-white/10"
                            data-testid={`session-question-${type.value}-${index}`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-4 mb-3">
                                <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                                  {question.category}
                                </Badge>
                                <span className="text-zinc-600 text-sm font-mono">#{index + 1}</span>
                              </div>

                              <p className="text-white font-medium mb-3">{question.question}</p>

                              {question.options && question.options.length > 0 && (
                                <div className="grid grid-cols-2 gap-2 mb-3">
                                  {question.options.map((option, optIndex) => (
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
                                  <span className="text-emerald-400 font-medium">{question.answer}</span>
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
    </div>
  );
};

export default SessionDetail;
