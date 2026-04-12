import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Search,
  CheckCircle,
  List,
  MessageSquare,
  Image,
  Loader2,
  Filter,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const questionTypes = [
  { value: "all", label: "All Types", icon: null },
  { value: "true_false", label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  { value: "picture", label: "Picture", icon: Image, color: "text-amber-400" },
];

const sourceOptions = [
  { value: "all", label: "All Sources" },
  { value: "ai", label: "AI Generated" },
  { value: "imported", label: "Imported" },
  { value: "manual", label: "Manual" },
];

const difficultyOptions = [
  { value: "all", label: "All Difficulty" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const Library = () => {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    fetchQuestions();
  }, []);

  const fetchQuestions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("questions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setQuestions(data || []);
    } catch (error) {
      console.error("Failed to load questions:", error);
      toast.error(error.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (questionId) => {
    if (!window.confirm("Delete this question?")) return;

    setDeletingId(questionId);
    try {
      const { error } = await supabase.from("questions").delete().eq("id", questionId);
      if (error) throw error;

      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      toast.success("Question deleted");
    } catch (error) {
      console.error("Delete failed:", error);
      toast.error(error.message || "Failed to delete question");
    } finally {
      setDeletingId(null);
    }
  };

  const categories = useMemo(() => {
    return [...new Set(questions.map((q) => q.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const normalizedType = q.has_image ? "picture" : q.question_type;

      const matchesSearch =
        !searchQuery ||
        q.question_text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.correct_answer?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType = typeFilter === "all" || normalizedType === typeFilter;
      const matchesSource = sourceFilter === "all" || (q.source || "manual") === sourceFilter;
      const matchesDifficulty =
        difficultyFilter === "all" || (q.difficulty || "medium") === difficultyFilter;
      const matchesCategory = categoryFilter === "all" || q.category === categoryFilter;

      return matchesSearch && matchesType && matchesSource && matchesDifficulty && matchesCategory;
    });
  }, [questions, searchQuery, typeFilter, sourceFilter, difficultyFilter, categoryFilter]);

  const getTypeMeta = (question) => {
    const normalizedType = question.has_image ? "picture" : question.question_type;
    return (
      questionTypes.find((t) => t.value === normalizedType) || questionTypes.find((t) => t.value === "written")
    );
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="library-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Question <span className="gradient-text">Library</span>
          </h1>
          <p className="text-zinc-500">
            {filteredQuestions.length} question{filteredQuestions.length !== 1 ? "s" : ""} in your library
          </p>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search questions, categories, answers..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full lg:w-44 bg-zinc-950/50 border-white/10 text-white">
                <SelectValue placeholder="Question Type" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                {questionTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value} className="text-white">
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-full lg:w-40 bg-zinc-950/50 border-white/10 text-white">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                {sourceOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-white">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
              <SelectTrigger className="w-full lg:w-40 bg-zinc-950/50 border-white/10 text-white">
                <SelectValue placeholder="Difficulty" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                {difficultyOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-white">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full lg:w-44 bg-zinc-950/50 border-white/10 text-white">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                <SelectItem value="all" className="text-white">
                  All Categories
                </SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat} className="text-white">
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filteredQuestions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Filter className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No questions found</p>
            <p className="text-zinc-600 text-sm">Try adjusting your filters or generate some questions first</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredQuestions.map((question, index) => {
            const typeMeta = getTypeMeta(question);
            const TypeIcon = typeMeta?.icon || CheckCircle;

            return (
              <Card
                key={question.id}
                className="glass-card animate-slide-up"
                style={{ animationDelay: `${index * 25}ms` }}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge className="bg-zinc-800 text-zinc-200 border border-white/10">
                        <TypeIcon size={12} className={`mr-1 ${typeMeta?.color || "text-zinc-400"}`} />
                        {typeMeta?.label || question.question_type}
                      </Badge>

                      {question.category && (
                        <Badge variant="outline" className="text-zinc-400 border-zinc-700">
                          {question.category}
                        </Badge>
                      )}

                      <Badge className="bg-zinc-900 text-zinc-400 border border-white/10">
                        {question.source || "manual"}
                      </Badge>

                      {question.difficulty && (
                        <Badge className="bg-zinc-900 text-zinc-400 border border-white/10">
                          {question.difficulty}
                        </Badge>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      onClick={() => handleDelete(question.id)}
                      disabled={deletingId === question.id}
                      className="text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
                    >
                      {deletingId === question.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </Button>
                  </div>

                  <p className="text-white font-medium mb-3">{question.question_text}</p>

                  {question.image_url && (
                    <div className="mb-3">
                      <img
                        src={question.image_url}
                        alt="Question"
                        className="w-full max-w-xs rounded-lg border border-white/10"
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
                      <span className="text-emerald-400 font-medium">{question.correct_answer}</span>
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
    </div>
  );
};

export default Library;
