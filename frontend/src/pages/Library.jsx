import { useState, useEffect } from "react";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { 
  Search, 
  Heart, 
  ThumbsDown,
  CheckCircle,
  List,
  MessageSquare,
  Image,
  Loader2,
  Filter,
  Plus,
  Pencil,
  Trash2,
  Bot,
  Upload,
  FileText,
  X
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "all", label: "All Types", icon: null },
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written Answer", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture Round", icon: Image, color: "text-amber-400" },
];

const statusOptions = [
  { value: "all", label: "All Status" },
  { value: "liked", label: "Liked", color: "text-emerald-400" },
  { value: "neutral", label: "Neutral", color: "text-zinc-400" },
  { value: "disliked", label: "Disliked", color: "text-red-400" },
];

const sourceOptions = [
  { value: "all", label: "All Sources" },
  { value: "ai", label: "AI Generated", icon: Bot },
  { value: "imported", label: "Imported", icon: Upload },
  { value: "manual", label: "Manual", icon: FileText },
];

const Library = () => {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categories, setCategories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [formData, setFormData] = useState({
    category: "",
    question: "",
    answer: "",
    question_type: "multiple_choice",
    options: ["", "", "", ""],
    fun_fact: "",
    image_url: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchQuestions();
    fetchCategories();
  }, []);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter === "disliked") {
        // Special case to show disliked
        const response = await api.get("/questions/all?include_disliked=true");
        setQuestions(response.data.filter(q => q.status === "disliked"));
      } else {
        const response = await api.get("/questions/all");
        setQuestions(response.data);
      }
    } catch (error) {
      toast.error("Failed to load questions");
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await api.get("/categories");
      setCategories(response.data);
    } catch (error) {
      console.error("Failed to load categories");
    }
  };

  const handleLike = async (questionId) => {
    try {
      await api.patch(`/questions/${questionId}/like`);
      setQuestions(prev => 
        prev.map(q => q.id === questionId ? { ...q, status: "liked" } : q)
      );
      toast.success("Question liked!");
    } catch (error) {
      toast.error("Failed to update question");
    }
  };

  const handleDislike = async (questionId) => {
    try {
      await api.patch(`/questions/${questionId}/dislike`);
      setQuestions(prev => 
        prev.map(q => q.id === questionId ? { ...q, status: "disliked" } : q)
      );
      toast.success("Question will be hidden from suggestions");
    } catch (error) {
      toast.error("Failed to update question");
    }
  };

  const handleNeutral = async (questionId) => {
    try {
      await api.patch(`/questions/${questionId}/neutral`);
      setQuestions(prev => 
        prev.map(q => q.id === questionId ? { ...q, status: "neutral" } : q)
      );
      toast.success("Status reset");
    } catch (error) {
      toast.error("Failed to update question");
    }
  };

  const handleDelete = async (questionId) => {
    if (!confirm("Are you sure you want to delete this question?")) return;
    
    try {
      await api.delete(`/questions/${questionId}`);
      setQuestions(prev => prev.filter(q => q.id !== questionId));
      toast.success("Question deleted");
    } catch (error) {
      toast.error("Failed to delete question");
    }
  };

  const openEditModal = (question) => {
    setEditingQuestion(question);
    setFormData({
      category: question.category,
      question: question.question,
      answer: question.answer,
      question_type: question.question_type,
      options: question.options || ["", "", "", ""],
      fun_fact: question.fun_fact || "",
      image_url: question.image_url || ""
    });
    setShowAddModal(true);
  };

  const openAddModal = () => {
    setEditingQuestion(null);
    setFormData({
      category: "",
      question: "",
      answer: "",
      question_type: "multiple_choice",
      options: ["", "", "", ""],
      fun_fact: "",
      image_url: ""
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!formData.question.trim() || !formData.answer.trim() || !formData.category.trim()) {
      toast.error("Please fill in required fields");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        options: formData.question_type === "multiple_choice" 
          ? formData.options.filter(o => o.trim())
          : null,
        fun_fact: formData.fun_fact || null,
        image_url: formData.image_url || null
      };

      if (editingQuestion) {
        await api.put(`/questions/${editingQuestion.id}`, payload);
        setQuestions(prev => 
          prev.map(q => q.id === editingQuestion.id ? { ...q, ...payload } : q)
        );
        toast.success("Question updated!");
      } else {
        const response = await api.post("/questions", payload);
        setQuestions(prev => [response.data, ...prev]);
        toast.success("Question created!");
      }
      setShowAddModal(false);
    } catch (error) {
      toast.error("Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  // Filter questions
  const filteredQuestions = questions.filter(q => {
    if (searchQuery && !q.question.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !q.category.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !q.answer.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (typeFilter !== "all" && q.question_type !== typeFilter) return false;
    if (statusFilter !== "all" && statusFilter !== "disliked" && q.status !== statusFilter) return false;
    if (sourceFilter !== "all" && q.source !== sourceFilter) return false;
    if (categoryFilter !== "all" && q.category !== categoryFilter) return false;
    return true;
  });

  const getTypeIcon = (type) => {
    const typeObj = questionTypes.find(t => t.value === type);
    return typeObj?.icon || CheckCircle;
  };

  const getTypeColor = (type) => {
    const typeObj = questionTypes.find(t => t.value === type);
    return typeObj?.color || "text-zinc-400";
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="library-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Question <span className="gradient-text">Library</span>
          </h1>
          <p className="text-zinc-500">
            {filteredQuestions.length} question{filteredQuestions.length !== 1 ? 's' : ''} in your library
          </p>
        </div>
        <Button
          onClick={openAddModal}
          className="gradient-btn"
          data-testid="add-question-btn"
        >
          <Plus className="mr-2" size={18} />
          Add Question
        </Button>
      </div>

      {/* Filters */}
      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search questions, categories, answers..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                data-testid="search-input"
              />
            </div>

            {/* Type Filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full lg:w-44 bg-zinc-950/50 border-white/10 text-white" data-testid="type-filter">
                <SelectValue placeholder="Question Type" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                {questionTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value} className="text-white hover:bg-zinc-800">
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); if (v === "disliked") fetchQuestions(); }}>
              <SelectTrigger className="w-full lg:w-36 bg-zinc-950/50 border-white/10 text-white" data-testid="status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-white hover:bg-zinc-800">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Source Filter */}
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-full lg:w-40 bg-zinc-950/50 border-white/10 text-white" data-testid="source-filter">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                {sourceOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-white hover:bg-zinc-800">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full lg:w-44 bg-zinc-950/50 border-white/10 text-white" data-testid="category-filter">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                <SelectItem value="all" className="text-white hover:bg-zinc-800">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat} className="text-white hover:bg-zinc-800">
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Questions List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      ) : filteredQuestions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Filter className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No questions found</p>
            <p className="text-zinc-600 text-sm">
              Try adjusting your filters or add a new question
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredQuestions.map((question, index) => {
            const TypeIcon = getTypeIcon(question.question_type);
            return (
              <Card 
                key={question.id}
                className="glass-card animate-slide-up"
                style={{ animationDelay: `${index * 30}ms` }}
                data-testid={`question-card-${index}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <Badge className={`${
                        question.question_type === 'true_false' ? 'badge-true-false' :
                        question.question_type === 'multiple_choice' ? 'badge-multiple-choice' :
                        question.question_type === 'written' ? 'badge-written' :
                        'badge-picture'
                      }`}>
                        <TypeIcon size={12} className="mr-1" />
                        {questionTypes.find(t => t.value === question.question_type)?.label}
                      </Badge>
                      <Badge variant="outline" className="text-zinc-400 border-zinc-700">
                        {question.category}
                      </Badge>
                      <Badge className={`${
                        question.source === 'ai' ? 'badge-ai' :
                        question.source === 'imported' ? 'badge-imported' :
                        'badge-manual'
                      }`}>
                        {question.source}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => question.status === 'liked' ? handleNeutral(question.id) : handleLike(question.id)}
                        className={`p-2 rounded-lg transition-colors ${
                          question.status === 'liked'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'hover:bg-zinc-800 text-zinc-500 hover:text-emerald-400'
                        }`}
                        data-testid={`like-btn-${index}`}
                      >
                        <Heart size={18} fill={question.status === 'liked' ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => question.status === 'disliked' ? handleNeutral(question.id) : handleDislike(question.id)}
                        className={`p-2 rounded-lg transition-colors ${
                          question.status === 'disliked'
                            ? 'bg-red-500/20 text-red-400'
                            : 'hover:bg-zinc-800 text-zinc-500 hover:text-red-400'
                        }`}
                        data-testid={`dislike-btn-${index}`}
                      >
                        <ThumbsDown size={18} fill={question.status === 'disliked' ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => openEditModal(question)}
                        className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors"
                        data-testid={`edit-btn-${index}`}
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(question.id)}
                        className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                        data-testid={`delete-btn-${index}`}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
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
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="bg-zinc-900 border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? "Edit Question" : "Add New Question"}
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              {editingQuestion ? "Update the question details" : "Create a new trivia question"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">Category *</Label>
                <Input
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                  placeholder="e.g., 90s Music"
                  className="bg-zinc-950/50 border-white/10 text-white"
                  data-testid="modal-category-input"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">Question Type *</Label>
                <Select 
                  value={formData.question_type} 
                  onValueChange={(v) => setFormData({...formData, question_type: v})}
                >
                  <SelectTrigger className="bg-zinc-950/50 border-white/10 text-white" data-testid="modal-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    {questionTypes.filter(t => t.value !== "all").map((type) => (
                      <SelectItem key={type.value} value={type.value} className="text-white hover:bg-zinc-800">
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">Question *</Label>
              <Textarea
                value={formData.question}
                onChange={(e) => setFormData({...formData, question: e.target.value})}
                placeholder="Enter your question..."
                className="bg-zinc-950/50 border-white/10 text-white min-h-[80px]"
                data-testid="modal-question-input"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">Answer *</Label>
              <Input
                value={formData.answer}
                onChange={(e) => setFormData({...formData, answer: e.target.value})}
                placeholder="Correct answer"
                className="bg-zinc-950/50 border-white/10 text-white"
                data-testid="modal-answer-input"
              />
            </div>

            {formData.question_type === "multiple_choice" && (
              <div className="space-y-2">
                <Label className="text-zinc-300">Options (for multiple choice)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {formData.options.map((opt, idx) => (
                    <Input
                      key={idx}
                      value={opt}
                      onChange={(e) => {
                        const newOptions = [...formData.options];
                        newOptions[idx] = e.target.value;
                        setFormData({...formData, options: newOptions});
                      }}
                      placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                      className="bg-zinc-950/50 border-white/10 text-white"
                      data-testid={`modal-option-${idx}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-zinc-300">Fun Fact (optional)</Label>
              <Textarea
                value={formData.fun_fact}
                onChange={(e) => setFormData({...formData, fun_fact: e.target.value})}
                placeholder="Share an interesting fact about this answer..."
                className="bg-zinc-950/50 border-white/10 text-white min-h-[60px]"
                data-testid="modal-funfact-input"
              />
            </div>

            {formData.question_type === "picture" && (
              <div className="space-y-2">
                <Label className="text-zinc-300">Image URL (for picture questions)</Label>
                <Input
                  value={formData.image_url}
                  onChange={(e) => setFormData({...formData, image_url: e.target.value})}
                  placeholder="https://example.com/image.jpg"
                  className="bg-zinc-950/50 border-white/10 text-white"
                  data-testid="modal-image-input"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddModal(false)}
              className="border-white/20 text-white hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gradient-btn"
              data-testid="modal-save-btn"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                editingQuestion ? "Update Question" : "Create Question"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Library;
