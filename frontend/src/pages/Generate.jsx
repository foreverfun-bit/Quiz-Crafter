import { useState, useEffect } from "react";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
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
  ArrowRight,
  ArrowLeft,
  Check,
  X
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", count: 9 },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", count: 9 },
  { value: "written", label: "Written Answer", icon: MessageSquare, color: "text-emerald-400", count: 9 },
  { value: "picture", label: "Picture Round", icon: Image, color: "text-amber-400", count: 3 },
];

const Generate = () => {
  // Step management
  const [step, setStep] = useState(1); // 1 = category selection, 2 = question generation
  
  // Category state for each type
  const [categories, setCategories] = useState({
    true_false: [],
    multiple_choice: [],
    written: [],
    picture: []
  });
  
  // Loading states
  const [generatingCategories, setGeneratingCategories] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [generatingForCategory, setGeneratingForCategory] = useState(null);
  
  // Questions generated per category
  const [generatedQuestions, setGeneratedQuestions] = useState({});
  
  // Active tab
  const [activeTab, setActiveTab] = useState("true_false");
  
  // Questions per category setting
  const [questionsPerCategory, setQuestionsPerCategory] = useState(5);

  // Generate all categories at once
  const handleGenerateAllCategories = async () => {
    setGeneratingCategories(true);
    try {
      const response = await api.post("/generate/categories-batch", {
        true_false_count: 9,
        multiple_choice_count: 9,
        written_count: 9,
        picture_count: 3
      });
      
      setCategories({
        true_false: response.data.true_false || [],
        multiple_choice: response.data.multiple_choice || [],
        written: response.data.written || [],
        picture: response.data.picture || []
      });
      
      toast.success("Categories generated!");
    } catch (error) {
      toast.error("Failed to generate categories");
    } finally {
      setGeneratingCategories(false);
    }
  };

  // Regenerate a single category
  const handleRegenerateCategory = async (type, index) => {
    setRegeneratingIndex(`${type}-${index}`);
    try {
      const usedCategories = [
        ...categories.true_false,
        ...categories.multiple_choice,
        ...categories.written,
        ...categories.picture
      ];
      
      const response = await api.post("/generate/single-category", {
        exclude_categories: usedCategories
      });
      
      setCategories(prev => ({
        ...prev,
        [type]: prev[type].map((cat, i) => i === index ? response.data.category : cat)
      }));
      
      toast.success("Category replaced!");
    } catch (error) {
      toast.error("Failed to regenerate category");
    } finally {
      setRegeneratingIndex(null);
    }
  };

  // Update category manually
  const handleUpdateCategory = (type, index, value) => {
    setCategories(prev => ({
      ...prev,
      [type]: prev[type].map((cat, i) => i === index ? value : cat)
    }));
  };

  // Remove category
  const handleRemoveCategory = (type, index) => {
    setCategories(prev => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index)
    }));
  };

  // Proceed to question generation
  const handleApproveCategories = () => {
    const allCategories = [
      ...categories.true_false,
      ...categories.multiple_choice,
      ...categories.written,
      ...categories.picture
    ];
    
    if (allCategories.length === 0) {
      toast.error("Please generate categories first");
      return;
    }
    
    // Check for duplicates
    const uniqueCategories = new Set(allCategories.map(c => c.toLowerCase().trim()));
    if (uniqueCategories.size !== allCategories.length) {
      toast.error("Please ensure all categories are unique");
      return;
    }
    
    setStep(2);
    toast.success("Categories approved! Now generating questions...");
  };

  // Generate questions for a specific category
  const handleGenerateQuestionsForCategory = async (type, category) => {
    const key = `${type}-${category}`;
    setGeneratingForCategory(key);
    
    try {
      const response = await api.post("/generate/questions", {
        category: category,
        question_type: type,
        count: questionsPerCategory
      });
      
      setGeneratedQuestions(prev => ({
        ...prev,
        [key]: response.data
      }));
      
      toast.success(`Generated ${response.data.length} questions for "${category}"`);
    } catch (error) {
      toast.error(`Failed to generate questions for "${category}"`);
    } finally {
      setGeneratingForCategory(null);
    }
  };

  // Generate questions for all categories of a type
  const handleGenerateAllQuestionsForType = async (type) => {
    setGeneratingQuestions(true);
    const typeCategories = categories[type];
    
    for (const category of typeCategories) {
      const key = `${type}-${category}`;
      if (!generatedQuestions[key]) {
        setGeneratingForCategory(key);
        try {
          const response = await api.post("/generate/questions", {
            category: category,
            question_type: type,
            count: questionsPerCategory
          });
          
          setGeneratedQuestions(prev => ({
            ...prev,
            [key]: response.data
          }));
        } catch (error) {
          console.error(`Failed for ${category}`);
        }
      }
    }
    
    setGeneratingForCategory(null);
    setGeneratingQuestions(false);
    toast.success("Question generation complete!");
  };

  // Like/Dislike handlers
  const handleLike = async (questionId, key) => {
    try {
      await api.patch(`/questions/${questionId}/like`);
      setGeneratedQuestions(prev => ({
        ...prev,
        [key]: prev[key].map(q => q.id === questionId ? { ...q, status: "liked" } : q)
      }));
      toast.success("Question saved to library!");
    } catch (error) {
      toast.error("Failed to like question");
    }
  };

  const handleDislike = async (questionId, key) => {
    try {
      await api.patch(`/questions/${questionId}/dislike`);
      setGeneratedQuestions(prev => ({
        ...prev,
        [key]: prev[key].filter(q => q.id !== questionId)
      }));
      toast.success("Question hidden");
    } catch (error) {
      toast.error("Failed to dislike question");
    }
  };

  // Check if all categories have questions
  const getCategoryStatus = (type) => {
    return categories[type].map(cat => {
      const key = `${type}-${cat}`;
      const questions = generatedQuestions[key] || [];
      return {
        category: cat,
        hasQuestions: questions.length > 0,
        likedCount: questions.filter(q => q.status === "liked").length,
        totalCount: questions.length
      };
    });
  };

  const getTotalProgress = () => {
    let total = 0;
    let completed = 0;
    
    questionTypes.forEach(type => {
      categories[type.value].forEach(cat => {
        total++;
        const key = `${type.value}-${cat}`;
        if (generatedQuestions[key]?.length > 0) completed++;
      });
    });
    
    return { total, completed };
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="generate-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Generate</span> Trivia
        </h1>
        <p className="text-zinc-500">
          {step === 1 
            ? "Step 1: Generate and approve categories for your trivia session"
            : "Step 2: Generate and select questions for each category"
          }
        </p>
      </div>

      {/* Progress Indicator */}
      <div className="flex items-center gap-4 mb-8">
        <div className={`flex items-center gap-2 ${step === 1 ? 'text-[#71E0DC]' : 'text-zinc-500'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            step === 1 ? 'bg-[#71E0DC] text-zinc-900' : 'bg-zinc-800 text-zinc-400'
          }`}>
            {step > 1 ? <Check size={16} /> : '1'}
          </div>
          <span className="font-medium">Categories</span>
        </div>
        <div className="flex-1 h-px bg-zinc-800" />
        <div className={`flex items-center gap-2 ${step === 2 ? 'text-[#71E0DC]' : 'text-zinc-500'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            step === 2 ? 'bg-[#71E0DC] text-zinc-900' : 'bg-zinc-800 text-zinc-400'
          }`}>
            2
          </div>
          <span className="font-medium">Questions</span>
        </div>
      </div>

      {/* STEP 1: Category Generation */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Generate Button */}
          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-white font-semibold mb-1">Generate Categories</h3>
                  <p className="text-zinc-500 text-sm">
                    Generate 9 unique categories for T/F, MC, Written and 3 for Picture rounds
                  </p>
                </div>
                <Button
                  onClick={handleGenerateAllCategories}
                  disabled={generatingCategories}
                  className="gradient-btn"
                  data-testid="generate-categories-btn"
                >
                  {generatingCategories ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2" size={18} />
                      Generate All Categories
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Category Tabs */}
          <Card className="glass-card">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <CardHeader className="pb-0">
                <TabsList className="bg-zinc-800/50 w-full justify-start">
                  {questionTypes.map((type) => {
                    const TypeIcon = type.icon;
                    const count = categories[type.value].length;
                    return (
                      <TabsTrigger 
                        key={type.value} 
                        value={type.value}
                        className="data-[state=active]:bg-zinc-700"
                        data-testid={`tab-${type.value}`}
                      >
                        <TypeIcon size={16} className={`mr-2 ${type.color}`} />
                        {type.label}
                        <Badge className={`ml-2 ${count === type.count ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-300'}`}>
                          {count}/{type.count}
                        </Badge>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </CardHeader>

              <CardContent className="pt-4">
                {questionTypes.map((type) => (
                  <TabsContent key={type.value} value={type.value} className="mt-0">
                    {categories[type.value].length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-zinc-500">No categories generated yet</p>
                        <p className="text-zinc-600 text-sm">Click "Generate All Categories" to start</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {categories[type.value].map((category, index) => (
                          <div 
                            key={index}
                            className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/50 border border-white/10"
                            data-testid={`category-${type.value}-${index}`}
                          >
                            <span className="text-zinc-500 text-sm font-mono w-6">#{index + 1}</span>
                            <Input
                              value={category}
                              onChange={(e) => handleUpdateCategory(type.value, index, e.target.value)}
                              className="flex-1 bg-zinc-950/50 border-white/10 text-white"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRegenerateCategory(type.value, index)}
                              disabled={regeneratingIndex === `${type.value}-${index}`}
                              className="text-zinc-400 hover:text-[#71E0DC]"
                              data-testid={`regenerate-${type.value}-${index}`}
                            >
                              {regeneratingIndex === `${type.value}-${index}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Shuffle size={16} />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveCategory(type.value, index)}
                              className="text-zinc-400 hover:text-red-400"
                              data-testid={`remove-${type.value}-${index}`}
                            >
                              <X size={16} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                ))}
              </CardContent>
            </Tabs>
          </Card>

          {/* Approve Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleApproveCategories}
              disabled={categories.true_false.length === 0}
              className="gradient-btn"
              data-testid="approve-categories-btn"
            >
              Approve Categories
              <ArrowRight className="ml-2" size={18} />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: Question Generation */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Back and Settings */}
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <Button
                  variant="ghost"
                  onClick={() => setStep(1)}
                  className="text-zinc-400 hover:text-white"
                  data-testid="back-to-categories-btn"
                >
                  <ArrowLeft className="mr-2" size={18} />
                  Back to Categories
                </Button>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 text-sm">Questions per category:</span>
                    <Select value={questionsPerCategory.toString()} onValueChange={(v) => setQuestionsPerCategory(parseInt(v))}>
                      <SelectTrigger className="w-20 bg-zinc-950/50 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-white/10">
                        {[3, 5, 7, 10].map((num) => (
                          <SelectItem key={num} value={num.toString()} className="text-white hover:bg-zinc-800">
                            {num}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <Badge className="bg-zinc-800 text-zinc-300">
                    Progress: {getTotalProgress().completed}/{getTotalProgress().total} categories
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Question Generation Tabs */}
          <Card className="glass-card">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <TabsList className="bg-zinc-800/50">
                    {questionTypes.map((type) => {
                      const TypeIcon = type.icon;
                      const status = getCategoryStatus(type.value);
                      const completedCount = status.filter(s => s.hasQuestions).length;
                      return (
                        <TabsTrigger 
                          key={type.value} 
                          value={type.value}
                          className="data-[state=active]:bg-zinc-700"
                        >
                          <TypeIcon size={16} className={`mr-2 ${type.color}`} />
                          {type.label}
                          <Badge className={`ml-2 ${
                            completedCount === categories[type.value].length 
                              ? 'bg-emerald-500/20 text-emerald-400' 
                              : 'bg-zinc-700 text-zinc-300'
                          }`}>
                            {completedCount}/{categories[type.value].length}
                          </Badge>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  
                  <Button
                    onClick={() => handleGenerateAllQuestionsForType(activeTab)}
                    disabled={generatingQuestions}
                    variant="outline"
                    className="border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10"
                    data-testid="generate-all-questions-btn"
                  >
                    {generatingQuestions ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2" size={16} />
                        Generate All for {questionTypes.find(t => t.value === activeTab)?.label}
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="pt-4">
                {questionTypes.map((type) => (
                  <TabsContent key={type.value} value={type.value} className="mt-0">
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-6">
                        {categories[type.value].map((category, catIndex) => {
                          const key = `${type.value}-${category}`;
                          const questions = generatedQuestions[key] || [];
                          const isGenerating = generatingForCategory === key;
                          
                          return (
                            <div key={catIndex} className="space-y-3">
                              {/* Category Header */}
                              <div className="flex items-center justify-between sticky top-0 bg-[#09090B] py-2 z-10">
                                <div className="flex items-center gap-3">
                                  <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                                    #{catIndex + 1}
                                  </Badge>
                                  <h3 className="text-white font-semibold">{category}</h3>
                                  {questions.length > 0 && (
                                    <Badge className="bg-emerald-500/20 text-emerald-400">
                                      {questions.filter(q => q.status === 'liked').length} liked / {questions.length} total
                                    </Badge>
                                  )}
                                </div>
                                <Button
                                  onClick={() => handleGenerateQuestionsForCategory(type.value, category)}
                                  disabled={isGenerating}
                                  size="sm"
                                  variant="outline"
                                  className="border-white/20 text-white hover:bg-zinc-800"
                                  data-testid={`generate-questions-${catIndex}`}
                                >
                                  {isGenerating ? (
                                    <>
                                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                      Generating...
                                    </>
                                  ) : questions.length > 0 ? (
                                    <>
                                      <RefreshCw className="mr-2" size={14} />
                                      Regenerate
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="mr-2" size={14} />
                                      Generate
                                    </>
                                  )}
                                </Button>
                              </div>

                              {/* Questions */}
                              {questions.length === 0 ? (
                                <div className="p-4 rounded-lg bg-zinc-900/30 border border-dashed border-zinc-800 text-center">
                                  <p className="text-zinc-600 text-sm">No questions generated yet</p>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {questions.map((question, qIndex) => (
                                    <div 
                                      key={question.id}
                                      className={`p-4 rounded-lg border transition-all ${
                                        question.status === 'liked'
                                          ? 'bg-emerald-500/10 border-emerald-500/30'
                                          : 'bg-zinc-900/50 border-white/10'
                                      }`}
                                      data-testid={`question-${catIndex}-${qIndex}`}
                                    >
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                          <p className="text-white text-sm mb-2">{question.question}</p>
                                          
                                          {question.options && (
                                            <div className="flex flex-wrap gap-2 mb-2">
                                              {question.options.map((opt, optIdx) => (
                                                <span 
                                                  key={optIdx}
                                                  className="px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-400"
                                                >
                                                  {opt}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                          
                                          <p className="text-xs">
                                            <span className="text-zinc-500">Answer: </span>
                                            <span className="text-emerald-400">{question.answer}</span>
                                          </p>
                                          {question.fun_fact && (
                                            <p className="text-xs mt-1">
                                              <span className="text-zinc-500">Fun Fact: </span>
                                              <span className="text-zinc-400">{question.fun_fact}</span>
                                            </p>
                                          )}
                                        </div>
                                        
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={() => handleLike(question.id, key)}
                                            className={`p-2 rounded-lg transition-colors ${
                                              question.status === 'liked'
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400'
                                            }`}
                                            data-testid={`like-${catIndex}-${qIndex}`}
                                          >
                                            <Heart size={16} fill={question.status === 'liked' ? 'currentColor' : 'none'} />
                                          </button>
                                          <button
                                            onClick={() => handleDislike(question.id, key)}
                                            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                                            data-testid={`dislike-${catIndex}-${qIndex}`}
                                          >
                                            <ThumbsDown size={16} />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                ))}
              </CardContent>
            </Tabs>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Generate;
