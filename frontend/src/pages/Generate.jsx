import { useState, useEffect } from "react";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { 
  Sparkles, 
  RefreshCw, 
  Heart, 
  ThumbsDown,
  CheckCircle,
  List,
  MessageSquare,
  Image,
  Loader2,
  Shuffle,
  Search
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written Answer", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture Round", icon: Image, color: "text-amber-400" },
];

const Generate = () => {
  const [category, setCategory] = useState("");
  const [questionType, setQuestionType] = useState("multiple_choice");
  const [count, setCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState([]);
  const [suggestedCategories, setSuggestedCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [searchCategory, setSearchCategory] = useState("");

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoadingCategories(true);
    try {
      const response = await api.post("/generate/categories");
      setSuggestedCategories(response.data.categories);
    } catch (error) {
      toast.error("Failed to load category suggestions");
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleGenerate = async () => {
    if (!category.trim()) {
      toast.error("Please enter or select a category");
      return;
    }

    setGenerating(true);
    try {
      const response = await api.post("/generate/questions", {
        category: category.trim(),
        question_type: questionType,
        count: count
      });
      setGeneratedQuestions(response.data);
      toast.success(`Generated ${response.data.length} questions!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to generate questions");
    } finally {
      setGenerating(false);
    }
  };

  const handleLike = async (questionId) => {
    try {
      await api.patch(`/questions/${questionId}/like`);
      setGeneratedQuestions(prev => 
        prev.map(q => q.id === questionId ? { ...q, status: "liked" } : q)
      );
      toast.success("Question liked!");
    } catch (error) {
      toast.error("Failed to like question");
    }
  };

  const handleDislike = async (questionId) => {
    try {
      await api.patch(`/questions/${questionId}/dislike`);
      setGeneratedQuestions(prev => 
        prev.filter(q => q.id !== questionId)
      );
      toast.success("Question hidden from future suggestions");
    } catch (error) {
      toast.error("Failed to dislike question");
    }
  };

  const filteredCategories = suggestedCategories.filter(cat =>
    cat.toLowerCase().includes(searchCategory.toLowerCase())
  );

  const TypeIcon = questionTypes.find(t => t.value === questionType)?.icon || CheckCircle;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="generate-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Generate</span> Questions
        </h1>
        <p className="text-zinc-500">Use AI to create trivia questions for any category</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Generation Form */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-white">Question Settings</CardTitle>
              <CardDescription className="text-zinc-500">
                Configure your question generation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Question Type */}
              <div className="space-y-2">
                <Label className="text-zinc-300">Question Type</Label>
                <Select value={questionType} onValueChange={setQuestionType}>
                  <SelectTrigger 
                    className="bg-zinc-950/50 border-white/10 text-white"
                    data-testid="question-type-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    {questionTypes.map((type) => (
                      <SelectItem 
                        key={type.value} 
                        value={type.value}
                        className="text-white hover:bg-zinc-800"
                      >
                        <div className="flex items-center gap-2">
                          <type.icon size={16} className={type.color} />
                          {type.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Category Input */}
              <div className="space-y-2">
                <Label className="text-zinc-300">Category</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g., 90s Music, Ancient Rome"
                  className="bg-zinc-950/50 border-white/10 text-white"
                  data-testid="category-input"
                />
              </div>

              {/* Count */}
              <div className="space-y-2">
                <Label className="text-zinc-300">Number of Questions</Label>
                <Select value={count.toString()} onValueChange={(v) => setCount(parseInt(v))}>
                  <SelectTrigger 
                    className="bg-zinc-950/50 border-white/10 text-white"
                    data-testid="count-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    {[3, 5, 9, 10].map((num) => (
                      <SelectItem 
                        key={num} 
                        value={num.toString()}
                        className="text-white hover:bg-zinc-800"
                      >
                        {num} questions
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Generate Button */}
              <Button
                onClick={handleGenerate}
                disabled={generating || !category.trim()}
                className="w-full gradient-btn"
                data-testid="generate-btn"
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
            </CardContent>
          </Card>

          {/* Category Suggestions */}
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-lg">Category Ideas</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchCategories}
                  disabled={loadingCategories}
                  className="text-zinc-400 hover:text-white"
                  data-testid="refresh-categories-btn"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingCategories ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value)}
                  placeholder="Search categories..."
                  className="pl-9 bg-zinc-950/50 border-white/10 text-white text-sm"
                  data-testid="search-categories-input"
                />
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                {loadingCategories ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {filteredCategories.map((cat, index) => (
                      <button
                        key={index}
                        onClick={() => setCategory(cat)}
                        className={`category-pill ${category === cat ? 'selected' : ''}`}
                        data-testid={`category-pill-${index}`}
                      >
                        {cat}
                      </button>
                    ))}
                    {filteredCategories.length === 0 && (
                      <p className="text-zinc-500 text-sm py-4 text-center w-full">
                        No categories match your search
                      </p>
                    )}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Generated Questions */}
        <div className="lg:col-span-2">
          <Card className="glass-card h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">Generated Questions</CardTitle>
                  <CardDescription className="text-zinc-500">
                    {generatedQuestions.length > 0 
                      ? `${generatedQuestions.length} questions generated`
                      : "Questions will appear here"}
                  </CardDescription>
                </div>
                {generatedQuestions.length > 0 && (
                  <Badge className="bg-[#71E0DC]/20 text-[#71E0DC] border-[#71E0DC]/30">
                    <TypeIcon size={14} className="mr-1" />
                    {questionTypes.find(t => t.value === questionType)?.label}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {generatedQuestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                    <Sparkles className="text-zinc-600" size={32} />
                  </div>
                  <p className="text-zinc-500 mb-2">No questions generated yet</p>
                  <p className="text-zinc-600 text-sm">
                    Select a category and click "Generate Questions" to get started
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[600px] pr-4">
                  <div className="space-y-4">
                    {generatedQuestions.map((question, index) => (
                      <div 
                        key={question.id}
                        className="trivia-card animate-slide-up"
                        style={{ animationDelay: `${index * 50}ms` }}
                        data-testid={`generated-question-${index}`}
                      >
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <span className="text-zinc-500 text-sm font-mono">#{index + 1}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleLike(question.id)}
                              className={`p-2 rounded-lg transition-colors ${
                                question.status === 'liked'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400'
                              }`}
                              data-testid={`like-btn-${index}`}
                            >
                              <Heart size={18} />
                            </button>
                            <button
                              onClick={() => handleDislike(question.id)}
                              className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                              data-testid={`dislike-btn-${index}`}
                            >
                              <ThumbsDown size={18} />
                            </button>
                          </div>
                        </div>

                        <p className="text-white font-medium mb-3">{question.question}</p>

                        {question.options && (
                          <div className="space-y-2 mb-3">
                            {question.options.map((option, optIndex) => (
                              <div 
                                key={optIndex}
                                className={`px-3 py-2 rounded-md text-sm ${
                                  option.startsWith(question.answer.charAt(0))
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-zinc-800/50 text-zinc-400'
                                }`}
                              >
                                {option}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="pt-3 border-t border-white/10">
                          <p className="text-sm">
                            <span className="text-zinc-500">Answer: </span>
                            <span className="text-emerald-400 font-medium">{question.answer}</span>
                          </p>
                          {question.fun_fact && (
                            <p className="text-sm mt-2">
                              <span className="text-zinc-500">Fun Fact: </span>
                              <span className="text-zinc-300">{question.fun_fact}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Generate;
