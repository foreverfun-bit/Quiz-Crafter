import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { 
  CheckCircle,
  List,
  MessageSquare,
  Image,
  Loader2,
  Save,
  Search,
  X,
  Check
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", target: 9 },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", target: 9 },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400", target: 9 },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400", target: 3 },
];

const BUILD_STORAGE_KEY = "trivia-build-session-state";

const BuildSession = () => {
  const navigate = useNavigate();
  
  // Load saved state from localStorage
  const loadSavedState = () => {
    try {
      const saved = localStorage.getItem(BUILD_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to load saved state:", e);
    }
    return null;
  };

  const savedState = loadSavedState();

  const [sessionName, setSessionName] = useState(savedState?.sessionName || "");
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(savedState?.activeTab || "true_false");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [selected, setSelected] = useState(savedState?.selected || {
    true_false: [],
    multiple_choice: [],
    written: [],
    picture: []
  });

  // Save state to localStorage whenever it changes
  useEffect(() => {
    const stateToSave = {
      sessionName,
      selected,
      activeTab
    };
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(stateToSave));
  }, [sessionName, selected, activeTab]);

  // Clear saved state after successful save
  const clearSavedState = () => {
    localStorage.removeItem(BUILD_STORAGE_KEY);
  };

  // Clear session manually
  const handleClearSession = () => {
    clearSavedState();
    setSessionName("");
    setSelected({ true_false: [], multiple_choice: [], written: [], picture: [] });
    setActiveTab("true_false");
    toast.success("Selection cleared!");
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  const fetchQuestions = async () => {
    try {
      const response = await api.get("/questions");
      setQuestions(response.data);
    } catch (error) {
      toast.error("Failed to load questions");
    } finally {
      setLoading(false);
    }
  };

  const toggleQuestion = (questionId, type) => {
    setSelected(prev => {
      const currentSelected = prev[type];
      const target = questionTypes.find(t => t.value === type)?.target || 9;
      
      if (currentSelected.includes(questionId)) {
        return {
          ...prev,
          [type]: currentSelected.filter(id => id !== questionId)
        };
      } else if (currentSelected.length < target) {
        return {
          ...prev,
          [type]: [...currentSelected, questionId]
        };
      } else {
        toast.error(`Maximum ${target} questions for ${type.replace('_', ' ')}`);
        return prev;
      }
    });
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

    setSaving(true);
    try {
      const response = await api.post("/sessions", {
        name: sessionName,
        true_false_questions: selected.true_false,
        multiple_choice_questions: selected.multiple_choice,
        written_questions: selected.written,
        picture_questions: selected.picture,
        is_past: true
      });
      clearSavedState();
      toast.success("Session created and saved to Past Sessions!");
      navigate(`/session/${response.data.id}`);
    } catch (error) {
      toast.error("Failed to create session");
    } finally {
      setSaving(false);
    }
  };

  const getFilteredQuestions = (type) => {
    return questions.filter(q => {
      if (q.question_type !== type) return false;
      if (searchQuery && 
          !q.question.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !q.category.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  };

  const getUsedCategories = (type) => {
    const selectedIds = selected[type];
    return questions
      .filter(q => selectedIds.includes(q.id))
      .map(q => q.category);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
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
          <p className="text-zinc-500">
            Select questions for your trivia night (9 T/F, 9 MC, 9 Written, 3 Picture)
          </p>
        </div>
        <div className="flex gap-2">
          {(sessionName || Object.values(selected).flat().length > 0) && (
            <Button
              variant="outline"
              onClick={handleClearSession}
              className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
              data-testid="clear-build-btn"
            >
              <X size={16} className="mr-2" />
              Clear
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gradient-btn"
            data-testid="save-session-btn"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2" size={18} />
                Save Session
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Session Name */}
      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label className="text-zinc-300">Session Name</Label>
              <Input
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="e.g., Thursday Night Trivia - Week 42"
                className="bg-zinc-950/50 border-white/10 text-white"
                data-testid="session-name-input"
              />
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search questions..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                data-testid="session-search-input"
              />
            </div>
          </div>
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
              className={`glass-card cursor-pointer transition-all ${
                activeTab === type.value ? 'border-[#71E0DC]/50' : ''
              } ${isComplete ? 'border-emerald-500/50' : ''}`}
              onClick={() => setActiveTab(type.value)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <TypeIcon className={type.color} size={20} />
                  {isComplete && <Check className="text-emerald-400" size={16} />}
                </div>
                <p className="text-white font-semibold">{type.label}</p>
                <p className={`text-sm ${isComplete ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {count}/{type.target} selected
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Question Selection Tabs */}
      <Card className="glass-card">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader className="pb-0">
            <TabsList className="bg-zinc-800/50 w-full justify-start">
              {questionTypes.map((type) => {
                const TypeIcon = type.icon;
                return (
                  <TabsTrigger 
                    key={type.value} 
                    value={type.value}
                    className="data-[state=active]:bg-zinc-700"
                    data-testid={`tab-${type.value}`}
                  >
                    <TypeIcon size={16} className={`mr-2 ${type.color}`} />
                    {type.label}
                    <Badge className="ml-2 bg-zinc-700 text-zinc-300">
                      {selected[type.value].length}/{type.target}
                    </Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </CardHeader>

          <CardContent className="pt-4">
            {questionTypes.map((type) => (
              <TabsContent key={type.value} value={type.value} className="mt-0">
                {/* Used Categories Warning */}
                {getUsedCategories(type.value).length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-amber-400 text-sm">
                      <strong>Categories used:</strong> {getUsedCategories(type.value).join(", ")}
                    </p>
                    <p className="text-amber-400/70 text-xs mt-1">
                      Remember: Each category should be unique across all questions
                    </p>
                  </div>
                )}

                <ScrollArea className="h-[500px]">
                  {getFilteredQuestions(type.value).length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-zinc-500">No {type.label.toLowerCase()} questions available</p>
                      <p className="text-zinc-600 text-sm">Generate some questions first!</p>
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
                            className={`session-question-card ${isSelected ? 'selected' : ''} ${
                              categoryUsed ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                            data-testid={`question-${type.value}-${index}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="outline" className={`text-xs ${
                                    categoryUsed ? 'border-amber-500/50 text-amber-400' : 'border-zinc-700 text-zinc-400'
                                  }`}>
                                    {question.category}
                                    {categoryUsed && " (used)"}
                                  </Badge>
                                  {question.status === 'liked' && (
                                    <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
                                      Liked
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-white text-sm">{question.question}</p>
                                <p className="text-zinc-500 text-xs mt-1">
                                  Answer: <span className="text-emerald-400">{question.answer}</span>
                                </p>
                              </div>
                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                isSelected 
                                  ? 'bg-[#71E0DC] border-[#71E0DC]' 
                                  : 'border-zinc-600'
                              }`}>
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

export default BuildSession;
