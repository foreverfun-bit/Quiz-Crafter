import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
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
  Wand2,
  Search,
  Plus,
  Trash2,
  Layers,
  Save
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
  const navigate = useNavigate();
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

  // Mode: "standard" or "theme"
  const [mode, setMode] = useState(savedState?.mode || "standard");

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

  // Track disliked question texts per category key to exclude on regeneration
  const [dislikedQuestions, setDislikedQuestions] = useState(savedState?.dislikedQuestions || {});

  // Theme Round state
  const [themeRounds, setThemeRounds] = useState(savedState?.themeRounds || []);
  const [themeSubject, setThemeSubject] = useState("");
  const [generatingTheme, setGeneratingTheme] = useState(null);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    const stateToSave = {
      mode,
      step,
      categories,
      generatedQuestions,
      activeTab,
      questionsPerCategory,
      dislikedQuestions,
      themeRounds
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [mode, step, categories, generatedQuestions, activeTab, questionsPerCategory, dislikedQuestions, themeRounds]);

  // Clear saved state (for starting fresh)
  const handleClearSession = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStep(1);
    setCategories({ true_false: [], multiple_choice: [], written: [], picture: [] });
    setGeneratedQuestions({});
    setDislikedQuestions({});
    setThemeRounds([]);
    setThemeSubject("");
    setActiveTab("true_false");
    toast.success("Session cleared!");
  };

  // Generate all categories at once
const handleGenerateAllCategories = async () => {
  setGeneratingCategories(true);
  try {
    const res = await fetch("/api/generate-categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        true_false_count: 9,
        multiple_choice_count: 9,
        written_count: 9,
        picture_count: 3,
      }),
    });

    const cloned = res.clone(); // ✅ KEY FIX

    let data;
    try {
      data = await res.json();
    } catch {
      const text = await cloned.text();
      data = JSON.parse(text);
    }

    if (!res.ok) {
      throw new Error(data.error || "Failed to generate categories");
    }

    setCategories({
      true_false: data.true_false || [],
      multiple_choice: data.multiple_choice || [],
      written: data.written || [],
      picture: data.picture || [],
    });

    toast.success("Categories generated!");
  } catch (error) {
    console.error(error);
    toast.error(error.message || "Failed to generate categories");
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
    
    // Collect disliked + currently visible question texts to exclude
    const existingTexts = (generatedQuestions[key] || []).map(q => q.question);
    const dislikedTexts = dislikedQuestions[key] || [];
    const excludeQuestions = [...new Set([...existingTexts, ...dislikedTexts])];
    
    try {
      const response = await api.post("/generate/questions", {
        category: category,
        question_type: type,
        count: questionsPerCategory,
        exclude_questions: excludeQuestions
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
        
        const dislikedTexts = dislikedQuestions[key] || [];
        
        try {
          const response = await api.post("/generate/questions", {
            category: category,
            question_type: type,
            count: questionsPerCategory,
            exclude_questions: dislikedTexts
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

  // Dislike = Remove from view AND track the text to exclude on regeneration
  const handleDislike = async (questionId, key) => {
    const question = generatedQuestions[key]?.find(q => q.id === questionId);
    if (question) {
      setDislikedQuestions(prev => ({
        ...prev,
        [key]: [...(prev[key] || []), question.question]
      }));
    }
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

  // ========== THEME ROUND HANDLERS ==========

  const handleGenerateThemeRound = async (subject) => {
    if (!subject.trim()) {
      toast.error("Enter a subject for the theme round");
      return;
    }
    
    const roundId = `theme-${Date.now()}`;
    setGeneratingTheme(roundId);
    
    // Collect all disliked questions for this subject across existing rounds
    const allExcluded = themeRounds
      .filter(r => r.subject.toLowerCase() === subject.toLowerCase())
      .flatMap(r => r.disliked || []);
    
    try {
      const response = await api.post("/generate/theme-round", {
        subject: subject.trim(),
        exclude_questions: allExcluded
      });
      
      setThemeRounds(prev => [...prev, {
        id: roundId,
        subject: subject.trim(),
        questions: response.data,
        disliked: []
      }]);
      setThemeSubject("");
      toast.success(`Theme round generated for "${subject}"!`);
    } catch (error) {
      toast.error("Failed to generate theme round");
    } finally {
      setGeneratingTheme(null);
    }
  };

  const handleRegenerateThemeRound = async (roundId) => {
    const round = themeRounds.find(r => r.id === roundId);
    if (!round) return;
    
    setGeneratingTheme(roundId);
    
    // Exclude disliked + all existing questions from all rounds with same subject
    const allExcluded = themeRounds
      .filter(r => r.subject.toLowerCase() === round.subject.toLowerCase())
      .flatMap(r => {
        const allQs = Object.values(r.questions || {}).flat();
        return [...allQs.map(q => q.question), ...(r.disliked || [])];
      });
    
    try {
      const response = await api.post("/generate/theme-round", {
        subject: round.subject,
        exclude_questions: allExcluded
      });
      
      setThemeRounds(prev => prev.map(r => 
        r.id === roundId ? { ...r, questions: response.data } : r
      ));
      toast.success(`Regenerated theme round for "${round.subject}"!`);
    } catch (error) {
      toast.error("Failed to regenerate theme round");
    } finally {
      setGeneratingTheme(null);
    }
  };

  const handleThemeLike = async (roundId, qType, questionId) => {
    const round = themeRounds.find(r => r.id === roundId);
    if (!round) return;
    
    const question = round.questions[qType]?.find(q => q.id === questionId);
    if (!question) return;
    
    try {
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
      
      setThemeRounds(prev => prev.map(r => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          questions: {
            ...r.questions,
            [qType]: r.questions[qType].map(q => 
              q.id === questionId ? { ...q, status: "liked" } : q
            )
          }
        };
      }));
      toast.success("Question saved to library!");
    } catch (error) {
      toast.error("Failed to save question");
    }
  };

  const handleThemeDislike = (roundId, qType, questionId) => {
    setThemeRounds(prev => prev.map(r => {
      if (r.id !== roundId) return r;
      const question = r.questions[qType]?.find(q => q.id === questionId);
      return {
        ...r,
        disliked: [...(r.disliked || []), question?.question].filter(Boolean),
        questions: {
          ...r.questions,
          [qType]: r.questions[qType].filter(q => q.id !== questionId)
        }
      };
    }));
    toast.success("Question removed");
  };

  const handleDeleteThemeRound = (roundId) => {
    setThemeRounds(prev => prev.filter(r => r.id !== roundId));
    toast.success("Theme round removed");
  };

  // Regenerate a single question within a theme round
  const [regeneratingQuestion, setRegeneratingQuestion] = useState(null);
  
  const handleThemeRegenerateQuestion = async (roundId, qType, questionId) => {
    const round = themeRounds.find(r => r.id === roundId);
    if (!round) return;
    
    const oldQuestion = round.questions[qType]?.find(q => q.id === questionId);
    if (!oldQuestion) return;
    
    setRegeneratingQuestion(questionId);
    
    // Exclude all current questions of this type + disliked
    const currentTexts = (round.questions[qType] || []).map(q => q.question);
    const dislikedTexts = round.disliked || [];
    const excludeQuestions = [...new Set([...currentTexts, ...dislikedTexts])];
    
    try {
      const response = await api.post("/generate/questions", {
        category: round.subject,
        question_type: qType,
        count: 1,
        exclude_questions: excludeQuestions
      });
      
      if (response.data && response.data.length > 0) {
        const newQuestion = response.data[0];
        setThemeRounds(prev => prev.map(r => {
          if (r.id !== roundId) return r;
          return {
            ...r,
            disliked: [...(r.disliked || []), oldQuestion.question],
            questions: {
              ...r.questions,
              [qType]: r.questions[qType].map(q =>
                q.id === questionId ? newQuestion : q
              )
            }
          };
        }));
        toast.success("Question regenerated!");
      }
    } catch (error) {
      toast.error("Failed to regenerate question");
    } finally {
      setRegeneratingQuestion(null);
    }
  };

  // Theme round image handlers
  const handleThemeImageUpload = async (roundId, qType, questionId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await api.post("/upload/image", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setThemeRounds(prev => prev.map(r => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          questions: {
            ...r.questions,
            [qType]: r.questions[qType].map(q =>
              q.id === questionId ? { ...q, image_url: response.data.image_url } : q
            )
          }
        };
      }));
      toast.success("Image uploaded!");
    } catch (error) {
      toast.error("Failed to upload image");
    }
  };

  const handleThemeGenerateImage = async (roundId, qType, questionId) => {
    const round = themeRounds.find(r => r.id === roundId);
    const question = round?.questions[qType]?.find(q => q.id === questionId);
    if (!question) return;
    
    setGeneratingImageFor(questionId);
    try {
      const response = await api.post("/generate/image", {
        prompt: `A clear, high-quality image for a trivia question about: ${question.question}. Category: ${question.category}. The image should be identifiable but not contain any text or labels.`,
        category: question.category
      });
      setThemeRounds(prev => prev.map(r => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          questions: {
            ...r.questions,
            [qType]: r.questions[qType].map(q =>
              q.id === questionId ? { ...q, image_url: response.data.image_url } : q
            )
          }
        };
      }));
      toast.success("Image generated!");
    } catch (error) {
      toast.error("Failed to generate image");
    } finally {
      setGeneratingImageFor(null);
    }
  };

  // ========== CREATE SESSION FROM LIKED QUESTIONS ==========
  
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [savingSession, setSavingSession] = useState(false);

  // Collect all liked question IDs from current mode
  const getLikedQuestionIds = () => {
    const ids = { true_false: [], multiple_choice: [], written: [], picture: [] };
    
    if (mode === "standard") {
      Object.entries(generatedQuestions).forEach(([key, questions]) => {
        const type = key.split("-")[0];
        if (ids[type]) {
          questions.filter(q => q.status === "liked").forEach(q => ids[type].push(q.id));
        }
      });
    } else {
      themeRounds.forEach(round => {
        Object.entries(round.questions || {}).forEach(([qType, questions]) => {
          if (ids[qType]) {
            questions.filter(q => q.status === "liked").forEach(q => ids[qType].push(q.id));
          }
        });
      });
    }
    
    return ids;
  };

  const totalLikedCount = () => {
    const ids = getLikedQuestionIds();
    return Object.values(ids).flat().length;
  };

  const handleCreateSession = async () => {
    if (!sessionName.trim()) {
      toast.error("Enter a session name");
      return;
    }
    
    const ids = getLikedQuestionIds();
    const total = Object.values(ids).flat().length;
    if (total === 0) {
      toast.error("No liked questions to save");
      return;
    }
    
    setSavingSession(true);
    try {
      const response = await api.post("/sessions", {
        name: sessionName.trim(),
        true_false_questions: ids.true_false,
        multiple_choice_questions: ids.multiple_choice,
        written_questions: ids.written,
        picture_questions: ids.picture,
        is_past: true
      });
      
      toast.success("Session created!");
      setShowSessionDialog(false);
      setSessionName("");
      navigate(`/session/${response.data.id}`);
    } catch (error) {
      toast.error("Failed to create session");
    } finally {
      setSavingSession(false);
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
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            <span className="gradient-text">Generate</span> Trivia
          </h1>
          <p className="text-zinc-500">
            {mode === "standard"
              ? (step === 1 
                ? "Step 1: Generate and approve categories for your trivia session"
                : "Step 2: Generate and select questions for each category")
              : "Generate themed rounds with all question types on one subject"
            }
          </p>
        </div>
        <div className="flex gap-2">
          {totalLikedCount() > 0 && (
            <Button
              onClick={() => setShowSessionDialog(true)}
              className="gradient-btn"
              data-testid="save-session-btn"
            >
              <Save size={16} className="mr-2" />
              Save as Session ({totalLikedCount()})
            </Button>
          )}
          {(categories.true_false.length > 0 || Object.keys(generatedQuestions).length > 0 || themeRounds.length > 0) && (
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
      </div>

      {/* Save as Session Dialog */}
      <Dialog open={showSessionDialog} onOpenChange={setShowSessionDialog}>
        <DialogContent className="bg-zinc-900 border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Save as Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-zinc-400 text-sm block mb-1.5">Session Name</label>
              <Input
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
                placeholder="e.g., Tuesday Night Trivia"
                className="bg-zinc-950/50 border-white/10 text-white"
                data-testid="session-name-input"
              />
            </div>
            {(() => {
              const ids = getLikedQuestionIds();
              return (
                <div className="space-y-1.5">
                  <p className="text-zinc-500 text-sm">Questions to include:</p>
                  <div className="flex flex-wrap gap-2">
                    {ids.true_false.length > 0 && (
                      <Badge className="bg-[#71E0DC]/10 text-[#71E0DC]">{ids.true_false.length} True/False</Badge>
                    )}
                    {ids.multiple_choice.length > 0 && (
                      <Badge className="bg-[#AEB2EF]/10 text-[#AEB2EF]">{ids.multiple_choice.length} Multiple Choice</Badge>
                    )}
                    {ids.written.length > 0 && (
                      <Badge className="bg-emerald-500/10 text-emerald-400">{ids.written.length} Written</Badge>
                    )}
                    {ids.picture.length > 0 && (
                      <Badge className="bg-amber-500/10 text-amber-400">{ids.picture.length} Picture</Badge>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSessionDialog(false)} className="border-white/10 text-zinc-400">
              Cancel
            </Button>
            <Button
              onClick={handleCreateSession}
              disabled={savingSession || !sessionName.trim()}
              className="gradient-btn"
              data-testid="confirm-save-session-btn"
            >
              {savingSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2" size={16} />}
              Create Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode Toggle */}
      <div className="mb-6">
        <div className="inline-flex rounded-lg bg-zinc-800/50 p-1 border border-white/10">
          <button
            onClick={() => setMode("standard")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              mode === "standard" 
                ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] text-zinc-900" 
                : "text-zinc-400 hover:text-white"
            }`}
            data-testid="mode-standard"
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
            data-testid="mode-theme"
          >
            <Layers size={14} className="inline mr-2" />
            Theme Round
          </button>
        </div>
      </div>

      {/* ========== THEME ROUND MODE ========== */}
      {mode === "theme" && (
        <div className="space-y-6">
          {/* Subject Input */}
          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row items-end gap-4">
                <div className="flex-1 space-y-2">
                  <label className="text-zinc-300 text-sm font-medium">Subject</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <Input
                      value={themeSubject}
                      onChange={(e) => setThemeSubject(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleGenerateThemeRound(themeSubject)}
                      placeholder="e.g., Harry Potter, The Beatles, World War II..."
                      className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                      data-testid="theme-subject-input"
                    />
                  </div>
                  <p className="text-zinc-600 text-xs">Generates 3 T/F + 3 MC + 3 Written + 1 Picture</p>
                </div>
                <Button
                  onClick={() => handleGenerateThemeRound(themeSubject)}
                  disabled={!!generatingTheme || !themeSubject.trim()}
                  className="gradient-btn"
                  data-testid="generate-theme-btn"
                >
                  {generatingTheme && !themeRounds.find(r => r.id === generatingTheme) ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles className="mr-2" size={18} /> Generate Round</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Theme Rounds List */}
          {themeRounds.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
                  <Layers className="text-zinc-600" size={32} />
                </div>
                <p className="text-zinc-500 mb-1">No theme rounds yet</p>
                <p className="text-zinc-600 text-sm">Enter a subject above to generate your first themed round</p>
              </CardContent>
            </Card>
          ) : (
            themeRounds.map((round, roundIndex) => {
              const themeTypes = [
                { key: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
                { key: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
                { key: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400" },
                { key: "picture", label: "Picture", icon: Image, color: "text-amber-400" },
              ];
              const totalLiked = themeTypes.reduce((sum, t) => 
                sum + (round.questions[t.key] || []).filter(q => q.status === "liked").length, 0
              );
              const totalQuestions = themeTypes.reduce((sum, t) => 
                sum + (round.questions[t.key] || []).length, 0
              );
              
              return (
                <Card key={round.id} className="glass-card" data-testid={`theme-round-${roundIndex}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white flex items-center gap-2">
                          <Layers size={18} className="text-[#71E0DC]" />
                          {round.subject}
                        </CardTitle>
                        <CardDescription className="text-zinc-500">
                          {totalLiked} liked / {totalQuestions} total questions
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRegenerateThemeRound(round.id)}
                          disabled={generatingTheme === round.id}
                          className="border-[#71E0DC]/30 text-[#71E0DC] hover:bg-[#71E0DC]/10"
                          data-testid={`regenerate-theme-${roundIndex}`}
                        >
                          {generatingTheme === round.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <><RefreshCw size={14} className="mr-1" /> Regenerate</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteThemeRound(round.id)}
                          className="text-zinc-500 hover:text-red-400"
                          data-testid={`delete-theme-${roundIndex}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {themeTypes.map(({ key: qType, label, icon: TypeIcon, color }) => {
                        const questions = round.questions[qType] || [];
                        if (questions.length === 0) return null;
                        
                        return (
                          <div key={qType}>
                            <div className="flex items-center gap-2 mb-2">
                              <TypeIcon size={16} className={color} />
                              <span className="text-zinc-300 text-sm font-medium">{label}</span>
                              <Badge className="bg-zinc-800 text-zinc-400 text-xs">{questions.length}</Badge>
                            </div>
                            <div className="space-y-2 ml-6">
                              {questions.map((question, qIndex) => (
                                <div 
                                  key={question.id}
                                  className={`p-3 rounded-lg border transition-all ${
                                    question.status === 'liked'
                                      ? 'bg-emerald-500/10 border-emerald-500/30'
                                      : 'bg-zinc-900/50 border-white/10'
                                  }`}
                                  data-testid={`theme-q-${roundIndex}-${qType}-${qIndex}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                      <p className="text-white text-sm mb-1">{question.question}</p>
                                      
                                      {question.options && (
                                        <div className="flex flex-wrap gap-1.5 mb-1">
                                          {question.options.map((opt, i) => (
                                            <span key={i} className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-400">{opt}</span>
                                          ))}
                                        </div>
                                      )}

                                      {/* Picture image section */}
                                      {qType === "picture" && (
                                        <div className="my-2">
                                          {question.image_url ? (
                                            <div>
                                              <img 
                                                src={question.image_url.startsWith("/api") 
                                                  ? `${process.env.REACT_APP_BACKEND_URL}${question.image_url}` 
                                                  : question.image_url}
                                                alt="Question"
                                                className="w-full max-w-xs rounded-lg border border-white/10"
                                              />
                                              <label className="cursor-pointer mt-1 inline-block">
                                                <input type="file" accept="image/*" className="hidden"
                                                  onChange={(e) => e.target.files[0] && handleThemeImageUpload(round.id, qType, question.id, e.target.files[0])} />
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                                                  <Upload size={12} /> Replace
                                                </span>
                                              </label>
                                            </div>
                                          ) : (
                                            <div className="flex gap-2">
                                              <label className="cursor-pointer">
                                                <input type="file" accept="image/*" className="hidden"
                                                  onChange={(e) => e.target.files[0] && handleThemeImageUpload(round.id, qType, question.id, e.target.files[0])} />
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors border border-white/10">
                                                  <Upload size={14} /> Upload Image
                                                </span>
                                              </label>
                                              <button
                                                onClick={() => handleThemeGenerateImage(round.id, qType, question.id)}
                                                disabled={generatingImageFor === question.id}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors border border-amber-500/20 disabled:opacity-50"
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
                                        <p className="text-xs mt-0.5">
                                          <span className="text-zinc-500">Fun Fact: </span>
                                          <span className="text-zinc-400">{question.fun_fact}</span>
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => handleThemeRegenerateQuestion(round.id, qType, question.id)}
                                        disabled={regeneratingQuestion === question.id}
                                        className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-[#71E0DC] transition-colors disabled:opacity-50"
                                        title="Regenerate this question"
                                        data-testid={`theme-regen-q-${roundIndex}-${qType}-${qIndex}`}
                                      >
                                        {regeneratingQuestion === question.id ? (
                                          <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                          <RefreshCw size={14} />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => handleThemeLike(round.id, qType, question.id)}
                                        className={`p-1.5 rounded-lg transition-colors ${
                                          question.status === 'liked'
                                            ? 'bg-emerald-500/20 text-emerald-400'
                                            : 'hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400'
                                        }`}
                                        data-testid={`theme-like-${roundIndex}-${qType}-${qIndex}`}
                                      >
                                        <Heart size={14} fill={question.status === 'liked' ? 'currentColor' : 'none'} />
                                      </button>
                                      <button
                                        onClick={() => handleThemeDislike(round.id, qType, question.id)}
                                        className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                                        data-testid={`theme-dislike-${roundIndex}-${qType}-${qIndex}`}
                                      >
                                        <ThumbsDown size={14} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ========== STANDARD MODE ========== */}
      {mode === "standard" && (
      <>
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
      </>
      )}
    </div>
  );
};

export default Generate;
