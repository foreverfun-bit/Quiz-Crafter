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
  X,
  Upload,
  Wand2
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]", count: 9 },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]", count: 9 },
  { value: "written", label: "Written Answer", icon: MessageSquare, color: "text-emerald-400", count: 9 },
  { value: "picture", label: "Picture Round", icon: Image, color: "text-amber-400", count: 3 },
];

const STORAGE_KEY = "trivia-generate-state";

const Generate = () => {
  // Load saved state from localStorage
  const loadSavedState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to load saved state:", e);
    }
    return null;
  };

  const savedState = loadSavedState();

  // Step management
  const [step, setStep] = useState(savedState?.step || 1);
  
  // Category state for each type
  const [categories, setCategories] = useState(savedState?.categories || {
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
  const [generatedQuestions, setGeneratedQuestions] = useState(savedState?.generatedQuestions || {});
  
  // Active tab
  const [activeTab, setActiveTab] = useState(savedState?.activeTab || "true_false");
  
  // Questions per category setting
  const [questionsPerCategory, setQuestionsPerCategory] = useState(savedState?.questionsPerCategory || 5);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    const stateToSave = {
      step,
      categories,
      generatedQuestions,
      activeTab,
      questionsPerCategory
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [step, categories, generatedQuestions, activeTab, questionsPerCategory]);

  // Clear saved state (for starting fresh)
  const handleClearSession = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStep(1);
    setCategories({ true_false: [], multiple_choice: [], written: [], picture: [] });
    setGeneratedQuestions({});
    setActiveTab("true_false");
    toast.success("Session cleared!");
  };

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
  // Like = Save question to library
  const handleLike = async (questionId, key) => {
    try {
      const question = generatedQuestions[key]?.find(q => q.id === questionId);
      if (!question) {
        toast.error("Question not found");
        return;
      }
      
      await api.post("/questions/save", {
        id: question.id,
        category: question.category,
        question: question.question,
        answer: question.answer,
        question_type: question.question_type,
        options: question.options,
        fun_fact: question.fun_fact,
        image_url: question.image_url
      });
      
      setGeneratedQuestions(prev => ({
        ...prev,
        [key]: prev[key].map(q => q.id === questionId ? { ...q, status: "liked" } : q)
      }));
      toast.success("Question saved to library!");
    } catch (error) {
      toast.error("Failed to save question");
    }
  };

  // Dislike = Just remove from view (not saved to DB)
  const handleDislike = async (questionId, key) => {
    setGeneratedQuestions(prev => ({
      ...prev,
      [key]: prev[key].filter(q => q.id !== questionId)
    }));
    toast.success("Question removed");
  };

  // Image upload for picture questions
  const handleImageUpload = async (questionId, key, file) => {
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      const response = await api.post("/upload/image", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      setGeneratedQuestions(prev => ({
        ...prev,
        [key]: prev[key].map(q => 
          q.id === questionId ? { ...q, image_url: response.data.image_url } : q
        )
      }));
      toast.success("Image uploaded!");
    } catch (error) {
      toast.error("Failed to upload image");
    }
  };

  // AI image generation for picture questions
  const [generatingImageFor, setGeneratingImageFor] = useState(null);
  
  const handleGenerateImage = async (questionId, key, question) => {
    setGeneratingImageFor(questionId);
    try {
      const response = await api.post("/generate/image", {
        prompt: `A clear, high-quality image for a trivia question about: ${question.question}. Category: ${question.category}. The image should be identifiable but not contain any text or labels.`,
        category: question.category
      });
      
      setGeneratedQuestions(prev => ({
        ...prev,
        [key]: prev[key].map(q => 
          q.id === questionId ? { ...q, image_url: response.data.image_url } : q
        )
      }));
      toast.success("Image generated!");
    } catch (error) {
      toast.error("Failed to generate image");
    } finally {
      setGeneratingImageFor(null);
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
      <div className="flex items-start justify-between mb-8">
        <div>
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
        {(categories.true_false.length > 0 || Object.keys(generatedQuestions).length > 0) && (
          <Button
            variant="outline"
            onClick={handleClearSession}
            className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
            data-testid="clear-session-btn"
          >
            <X size={16} className="mr-2" />
            Start Fresh
          </Button>
        )}
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

                                          {/* Picture question image section */}
                                          {type.value === "picture" && (
                                            <div className="my-3">
                                              {question.image_url ? (
                                                <div className="relative group">
                                                  <img 
                                                    src={question.image_url.startsWith("/api") 
                                                      ? `${process.env.REACT_APP_BACKEND_URL}${question.image_url}` 
                                                      : question.image_url} 
                                                    alt="Question" 
                                                    className="w-full max-w-xs rounded-lg border border-white/10"
                                                    data-testid={`question-image-${catIndex}-${qIndex}`}
                                                  />
                                                  <div className="mt-2 flex gap-2">
                                                    <label className="cursor-pointer">
                                                      <input 
                                                        type="file" 
                                                        accept="image/*" 
                                                        className="hidden"
                                                        onChange={(e) => e.target.files[0] && handleImageUpload(question.id, key, e.target.files[0])}
                                                      />
                                                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors">
                                                        <Upload size={12} /> Replace
                                                      </span>
                                                    </label>
                                                  </div>
                                                </div>
                                              ) : (
                                                <div className="flex gap-2">
                                                  <label className="cursor-pointer">
                                                    <input 
                                                      type="file" 
                                                      accept="image/*" 
                                                      className="hidden"
                                                      onChange={(e) => e.target.files[0] && handleImageUpload(question.id, key, e.target.files[0])}
                                                    />
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors border border-white/10">
                                                      <Upload size={14} /> Upload Image
                                                    </span>
                                                  </label>
                                                  <button
                                                    onClick={() => handleGenerateImage(question.id, key, question)}
                                                    disabled={generatingImageFor === question.id}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors border border-amber-500/20 disabled:opacity-50"
                                                    data-testid={`generate-image-${catIndex}-${qIndex}`}
                                                  >
                                                    {generatingImageFor === question.id ? (
                                                      <><Loader2 size={14} className="animate-spin" /> Generating...</>
                                                    ) : (
                                                      <><Wand2 size={14} /> AI Generate</>
                                                    )}
                                                  </button>
                                                </div>
                                              )}
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
