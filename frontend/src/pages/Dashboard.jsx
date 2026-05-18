import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { supabase } from "../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Sparkles,
  Library,
  PlusCircle,
  Upload,
  HelpCircle,
  Heart,
  ThumbsDown,
  FolderOpen,
  Bot,
  FileText,
  CheckCircle,
  List,
  MessageSquare,
  Image,
} from "lucide-react";
import { toast } from "sonner";

const emptyStats = {
  total_questions: 0,
  liked_count: 0,
  disliked_count: 0,
  categories_count: 0,
  sessions_count: 0,
  ai_generated_count: 0,
  imported_count: 0,
  by_type: {},
  approved_categories: [],
  rejected_categories: [],
};

const rejectedValues = new Set(["rejected", "reject", "hidden", "hide", "disliked", "dislike", "bad"]);
const approvedValues = new Set(["approved", "approve", "active", "accepted", "accept", "good"]);

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(emptyStats);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [questionsResult, sessionsResult, categoryState] = await Promise.all([
        supabase.from("questions").select("*"),
        supabase.from("sessions").select("id", { count: "exact", head: true }),
        fetchCategoryState(),
      ]);

      if (questionsResult.error) throw questionsResult.error;

      const questions = Array.isArray(questionsResult.data) ? questionsResult.data : [];
      const nextStats = buildStats(questions, sessionsResult.count || 0, categoryState);
      setStats(nextStats);
    } catch (error) {
      console.error("Dashboard stats error:", error);
      toast.error("Failed to load dashboard stats");
      setStats(emptyStats);
    } finally {
      setLoading(false);
    }
  };

  const quickActions = [
    {
      icon: Sparkles,
      label: "Generate Questions",
      description: "AI-powered question generation",
      path: "/generate",
      gradient: true,
    },
    {
      icon: Library,
      label: "Question Library",
      description: "Browse your saved questions",
      path: "/library",
    },
    {
      icon: PlusCircle,
      label: "Build Session",
      description: "Create a new trivia session",
      path: "/build",
    },
    {
      icon: Upload,
      label: "Import CSV",
      description: "Import questions from CSV",
      path: "/import",
    },
  ];

  const typeStats = [
    { icon: CheckCircle, label: "True/False", key: "true_false", color: "text-[#71E0DC]" },
    { icon: List, label: "Multiple Choice", key: "multiple_choice", color: "text-[#AEB2EF]" },
    { icon: MessageSquare, label: "Written", key: "written", color: "text-emerald-400" },
    { icon: Image, label: "Picture", key: "picture", color: "text-amber-400" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  const approvedCategories = stats.approved_categories || [];
  const rejectedCategories = stats.rejected_categories || [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="dashboard-page">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          Welcome back, <span className="gradient-text">{user?.name?.split(" ")[0]}</span>
        </h1>
        <p className="text-zinc-500">Your trivia command center awaits</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {quickActions.map((action) => (
          <Card
            key={action.path}
            className={`glass-card cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
              action.gradient ? "border-[#71E0DC]/30" : ""
            }`}
            onClick={() => navigate(action.path)}
            data-testid={`quick-action-${action.label.toLowerCase().replace(" ", "-")}`}
          >
            <CardContent className="p-6">
              <div
                className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                  action.gradient ? "bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF]" : "bg-zinc-800"
                }`}
              >
                <action.icon className={action.gradient ? "text-zinc-900" : "text-zinc-400"} size={24} />
              </div>
              <h3 className="text-white font-semibold mb-1">{action.label}</h3>
              <p className="text-zinc-500 text-sm">{action.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-500 text-sm mb-1">Total Questions</p>
                <p className="text-3xl font-bold text-white">{stats.total_questions || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center">
                <HelpCircle className="text-zinc-400" size={24} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-500 text-sm mb-1">Liked Questions</p>
                <p className="text-3xl font-bold text-emerald-400">{stats.liked_count || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Heart className="text-emerald-400" size={24} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className="glass-card cursor-pointer hover:border-[#AEB2EF]/50 transition-all"
          onClick={() => navigate("/categories")}
          data-testid="categories-card"
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-500 text-sm mb-1">Categories</p>
                <p className="text-3xl font-bold text-[#AEB2EF]">{stats.categories_count || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-[#AEB2EF]/20 flex items-center justify-center">
                <FolderOpen className="text-[#AEB2EF]" size={24} />
              </div>
            </div>
            <p className="text-zinc-600 text-xs mt-2">
              {approvedCategories.length} approved / {rejectedCategories.length} rejected
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-500 text-sm mb-1">Sessions</p>
                <p className="text-3xl font-bold text-[#71E0DC]">{stats.sessions_count || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-[#71E0DC]/20 flex items-center justify-center">
                <FileText className="text-[#71E0DC]" size={24} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card mb-8" data-testid="dashboard-categories-section">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-white text-lg">Categories</CardTitle>
              <p className="text-zinc-500 text-sm mt-1">Approved and rejected categories from your library</p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate("/categories")}
              className="border-white/20 text-white hover:bg-zinc-800"
            >
              Manage
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CategoryList
              title="Approved"
              count={approvedCategories.length}
              categories={approvedCategories}
              emptyText="No approved categories yet"
              tone="approved"
            />
            <CategoryList
              title="Rejected"
              count={rejectedCategories.length}
              categories={rejectedCategories}
              emptyText="No rejected categories yet"
              tone="rejected"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white text-lg">Questions by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {typeStats.map((type) => (
                <div key={type.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <type.icon className={type.color} size={20} />
                    <span className="text-zinc-300">{type.label}</span>
                  </div>
                  <span className="text-white font-semibold">{stats.by_type?.[type.key] || 0}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white text-lg">Questions by Source</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bot className="text-[#71E0DC]" size={20} />
                  <span className="text-zinc-300">AI Generated</span>
                </div>
                <span className="text-white font-semibold">{stats.ai_generated_count || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Upload className="text-[#AEB2EF]" size={20} />
                  <span className="text-zinc-300">Imported</span>
                </div>
                <span className="text-white font-semibold">{stats.imported_count || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="text-zinc-400" size={20} />
                  <span className="text-zinc-300">Manual</span>
                </div>
                <span className="text-white font-semibold">
                  {(stats.total_questions || 0) - (stats.ai_generated_count || 0) - (stats.imported_count || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <div className="flex items-center gap-3">
                  <ThumbsDown className="text-red-400" size={20} />
                  <span className="text-zinc-300">Disliked (hidden)</span>
                </div>
                <span className="text-red-400 font-semibold">{stats.disliked_count || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {stats.total_questions === 0 && (
        <Card className="glass-card mt-8 border-[#71E0DC]/30">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] flex items-center justify-center mx-auto mb-4">
              <Sparkles className="text-zinc-900" size={32} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Get Started</h3>
            <p className="text-zinc-500 mb-6 max-w-md mx-auto">
              Generate your first batch of questions using AI, or import your existing trivia questions from a CSV file.
            </p>
            <div className="flex gap-4 justify-center">
              <Button className="gradient-btn" onClick={() => navigate("/generate")} data-testid="cta-generate-btn">
                <Sparkles className="mr-2" size={18} />
                Generate Questions
              </Button>
              <Button
                variant="outline"
                className="border-white/20 text-white hover:bg-zinc-800"
                onClick={() => navigate("/import")}
                data-testid="cta-import-btn"
              >
                <Upload className="mr-2" size={18} />
                Import CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const CategoryList = ({ title, count, categories, emptyText, tone }) => {
  const visibleCategories = categories.slice(0, 48);
  const hiddenCount = Math.max(categories.length - visibleCategories.length, 0);
  const rejected = tone === "rejected";

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold">{title}</h3>
        <Badge className={rejected ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}>
          {count}
        </Badge>
      </div>

      {visibleCategories.length === 0 ? (
        <p className="text-zinc-600 text-sm">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleCategories.map((category) => (
            <span
              key={category}
              className={`px-3 py-1 rounded-full border text-sm ${
                rejected
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              }`}
            >
              {category}
            </span>
          ))}
          {hiddenCount > 0 && <span className="text-zinc-500 text-sm px-2 py-1">+{hiddenCount} more</span>}
        </div>
      )}
    </div>
  );
};

function buildStats(questions, sessionsCount, categoryState) {
  const byType = {};
  const approvedCategories = new Set(categoryState.approved);
  const rejectedCategories = new Set(categoryState.rejected);
  let likedCount = 0;
  let dislikedCount = 0;
  let aiGeneratedCount = 0;
  let importedCount = 0;

  questions.forEach((question) => {
    const type = question.question_type || (question.has_image ? "picture" : "written");
    byType[type] = (byType[type] || 0) + 1;

    if (isTruthy(question.is_liked) || approvedValues.has(normalizeStatus(question.rating))) likedCount += 1;
    if (isTruthy(question.is_disliked) || rejectedValues.has(normalizeStatus(question.rating))) dislikedCount += 1;

    if (normalizeStatus(question.source) === "ai") aiGeneratedCount += 1;
    if (["import", "imported", "csv", "crowdpurr"].includes(normalizeStatus(question.source))) importedCount += 1;

    const category = cleanCategory(question.category);
    if (!category) return;

    if (isRejectedQuestionCategory(question)) {
      rejectedCategories.add(category);
      approvedCategories.delete(category);
    } else if (!rejectedCategories.has(category)) {
      approvedCategories.add(category);
    }
  });

  return {
    total_questions: questions.length,
    liked_count: likedCount,
    disliked_count: dislikedCount,
    categories_count: approvedCategories.size + rejectedCategories.size,
    sessions_count: sessionsCount,
    ai_generated_count: aiGeneratedCount,
    imported_count: importedCount,
    by_type: byType,
    approved_categories: sortCategories([...approvedCategories]),
    rejected_categories: sortCategories([...rejectedCategories]),
  };
}

async function fetchCategoryState() {
  const approved = new Set();
  const rejected = new Set();

  const results = await Promise.allSettled([
    supabase.from("categories").select("*"),
    supabase.from("disliked_categories").select("*"),
    supabase.from("rejected_categories").select("*"),
    supabase.from("category_preferences").select("*"),
  ]);

  results.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error || !Array.isArray(result.value.data)) return;

    result.value.data.forEach((row) => {
      const category = cleanCategory(row.category || row.name || row.category_name || row.value);
      if (!category) return;

      const status = normalizeStatus(row.status || row.state || row.approval_status || row.preference || row.rating);
      const rejectedByFlag = isTruthy(row.rejected) || isTruthy(row.is_rejected) || isTruthy(row.hidden) || isTruthy(row.is_hidden) || isTruthy(row.disliked) || isTruthy(row.is_disliked);
      const approvedByFlag = isTruthy(row.approved) || isTruthy(row.is_approved) || isTruthy(row.active) || isTruthy(row.is_active);

      if (rejectedValues.has(status) || rejectedByFlag) {
        rejected.add(category);
        approved.delete(category);
      } else if (approvedValues.has(status) || approvedByFlag || !status) {
        if (!rejected.has(category)) approved.add(category);
      }
    });
  });

  return { approved, rejected };
}

function isRejectedQuestionCategory(question) {
  const status = normalizeStatus(
    question.category_status || question.category_state || question.approval_status || question.status || question.rating
  );

  return (
    rejectedValues.has(status) ||
    isTruthy(question.rejected) ||
    isTruthy(question.is_rejected) ||
    isTruthy(question.category_rejected) ||
    isTruthy(question.hidden) ||
    isTruthy(question.is_hidden) ||
    isTruthy(question.disliked) ||
    isTruthy(question.is_disliked)
  );
}

function cleanCategory(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeStatus(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isTruthy(value) {
  return value === true || value === 1 || value === "1" || normalizeStatus(value) === "true";
}

function sortCategories(categories) {
  return categories.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export default Dashboard;
