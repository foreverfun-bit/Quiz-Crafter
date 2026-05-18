import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  CheckCircle,
  Image,
  Library as LibraryIcon,
  List,
  Loader2,
  MessageSquare,
  Search,
} from "lucide-react";
import { toast } from "sonner";

const typeConfig = {
  all: { label: "All", icon: LibraryIcon, color: "text-white" },
  true_false: { label: "True/False", icon: CheckCircle, color: "text-[#71E0DC]" },
  multiple_choice: { label: "Multiple Choice", icon: List, color: "text-[#AEB2EF]" },
  written: { label: "Written", icon: MessageSquare, color: "text-emerald-400" },
  picture: { label: "Picture", icon: Image, color: "text-amber-400" },
};

const typeOrder = ["all", "true_false", "multiple_choice", "written", "picture"];

const parseOptions = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
};

const formatType = (type) => typeConfig[type]?.label || "Question";

export default function Library() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeType, setActiveType] = useState("all");

  useEffect(() => {
    fetchQuestions();
  }, []);

  async function fetchQuestions() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("questions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setQuestions(data || []);
    } catch (error) {
      console.error("Library load error:", error);
      toast.error(error.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    return questions.reduce(
      (acc, question) => {
        acc.all += 1;
        const type = question.question_type || "written";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      { all: 0 }
    );
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return questions.filter((question) => {
      const type = question.question_type || "written";
      if (activeType !== "all" && type !== activeType) return false;
      if (!query) return true;

      return [
        question.question_text,
        question.correct_answer,
        question.category,
        question.fun_fact,
        question.source,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeType, questions, searchQuery]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="library-page">
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Question <span className="gradient-text">Library</span>
          </h1>
          <p className="text-zinc-500">Browse saved questions from imports, generated sets, and custom writing.</p>
        </div>
        <Button onClick={fetchQuestions} variant="outline" className="border-zinc-700 text-zinc-300 hover:text-white">
          Refresh
        </Button>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search questions, answers, categories..."
              className="pl-9 bg-zinc-950/50 border-white/10 text-white"
              data-testid="library-search"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {typeOrder.map((type) => {
              const config = typeConfig[type];
              const Icon = config.icon;
              const active = activeType === type;

              return (
                <Button
                  key={type}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setActiveType(type)}
                  className={active ? "gradient-btn" : "border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-800"}
                >
                  <Icon size={14} className="mr-2" />
                  {config.label} ({counts[type] || 0})
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="min-h-[320px] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#71E0DC]" />
        </div>
      ) : filteredQuestions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <LibraryIcon className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500">No questions match this view.</p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[calc(100vh-270px)] pr-2">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredQuestions.map((question) => {
              const type = question.question_type || "written";
              const config = typeConfig[type] || typeConfig.written;
              const Icon = config.icon;
              const options = parseOptions(question.incorrect_answers);

              return (
                <Card key={question.id} className="bg-zinc-900/70 border-white/10">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <Badge className="bg-zinc-800 text-zinc-300 border border-white/10">
                        <Icon size={13} className={`mr-1 ${config.color}`} />
                        {formatType(type)}
                      </Badge>
                      <span className="text-xs text-zinc-600">{question.source || "library"}</span>
                    </div>

                    <div>
                      <p className="text-white font-semibold leading-relaxed">{question.question_text}</p>
                      <p className="text-zinc-500 text-sm mt-2">{question.category || "Uncategorized"}</p>
                    </div>

                    {options.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {options.map((option) => (
                          <div key={option} className="px-3 py-2 rounded-md bg-zinc-950/50 text-zinc-400 text-sm">
                            {option}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="pt-3 border-t border-white/10 space-y-2">
                      <p className="text-sm">
                        <span className="text-zinc-500">Answer: </span>
                        <span className="text-emerald-300 font-medium">{question.correct_answer}</span>
                      </p>
                      {question.fun_fact && (
                        <p className="text-sm text-zinc-400 leading-relaxed">{question.fun_fact}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
