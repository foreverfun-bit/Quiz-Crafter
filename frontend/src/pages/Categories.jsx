import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  FolderOpen,
  Search,
  ThumbsDown,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "quiz-crafter-category-preferences";
const rejectedValues = new Set(["rejected", "reject", "hidden", "hide", "disliked", "dislike", "bad"]);
const approvedValues = new Set(["approved", "approve", "active", "accepted", "accept", "good"]);

const Categories = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [dislikedCategories, setDislikedCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDisliked, setShowDisliked] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [questionsResult, categoryState] = await Promise.all([
        supabase.from("questions").select("*"),
        fetchCategoryState(),
      ]);

      if (questionsResult.error) throw questionsResult.error;

      const active = new Set(categoryState.approved);
      const rejected = new Set(categoryState.rejected);

      (questionsResult.data || []).forEach((question) => {
        const category = cleanCategory(question.category);
        if (!category) return;

        if (isRejectedQuestionCategory(question)) {
          rejected.add(category);
          active.delete(category);
        } else if (!rejected.has(category)) {
          active.add(category);
        }
      });

      setCategories(sortCategories([...active]));
      setDislikedCategories(sortCategories([...rejected]));
    } catch (error) {
      console.error("Failed to load categories:", error);
      toast.error("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  const handleDislike = async (category) => {
    const clean = cleanCategory(category);
    if (!clean) return;

    setCategories((prev) => prev.filter((c) => c !== clean));
    setDislikedCategories((prev) => sortCategories([...new Set([...prev, clean])]));

    const saved = await saveCategoryPreference(clean, "rejected");
    toast.success(saved ? `"${clean}" hidden from future suggestions` : `"${clean}" hidden on this device`);
  };

  const handleRestore = async (category) => {
    const clean = cleanCategory(category);
    if (!clean) return;

    setDislikedCategories((prev) => prev.filter((c) => c !== clean));
    setCategories((prev) => sortCategories([...new Set([...prev, clean])]));

    const saved = await saveCategoryPreference(clean, "approved");
    toast.success(saved ? `"${clean}" restored` : `"${clean}" restored on this device`);
  };

  const filteredCategories = (showDisliked ? dislikedCategories : categories).filter((cat) =>
    cat.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="categories-page">
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="text-zinc-400 hover:text-white"
          data-testid="back-btn"
        >
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white">
            Your <span className="gradient-text">Categories</span>
          </h1>
          <p className="text-zinc-500">
            {categories.length} approved and {dislikedCategories.length} rejected categories
          </p>
        </div>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="flex gap-2">
              <Button
                variant={!showDisliked ? "default" : "outline"}
                onClick={() => setShowDisliked(false)}
                className={!showDisliked ? "gradient-btn" : "border-white/20 text-white hover:bg-zinc-800"}
                data-testid="active-tab"
              >
                Approved ({categories.length})
              </Button>
              <Button
                variant={showDisliked ? "default" : "outline"}
                onClick={() => setShowDisliked(true)}
                className={showDisliked ? "bg-red-500/20 text-red-400 border-red-500/30" : "border-white/20 text-white hover:bg-zinc-800"}
                data-testid="hidden-tab"
              >
                Rejected ({dislikedCategories.length})
              </Button>
            </div>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search categories..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                data-testid="search-categories"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredCategories.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500">
              {searchQuery ? "No categories match your search" : showDisliked ? "No rejected categories" : "No approved categories yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card">
          <CardContent className="p-6">
            <ScrollArea className="h-[500px]">
              <div className="flex flex-wrap gap-3">
                {filteredCategories.map((category, index) => (
                  <div
                    key={category}
                    className={`group flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                      showDisliked
                        ? "bg-red-500/10 border-red-500/30 text-red-400"
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:border-[#71E0DC]/50"
                    }`}
                    data-testid={`category-${index}`}
                  >
                    <span>{category}</span>
                    {showDisliked ? (
                      <button
                        onClick={() => handleRestore(category)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-emerald-500/20 text-emerald-400 transition-all"
                        title="Restore category"
                        data-testid={`restore-${index}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDislike(category)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
                        title="Reject category"
                        data-testid={`hide-${index}`}
                      >
                        <ThumbsDown size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card mt-6">
        <CardContent className="p-4">
          <p className="text-zinc-500 text-sm">
            <strong className="text-zinc-300">Tip:</strong> Rejected categories are kept out of future category planning. Hover over a category to reject or restore it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

async function fetchCategoryState() {
  const local = loadLocalPreferences();
  const approved = new Set(local.approved);
  const rejected = new Set(local.rejected);

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

async function saveCategoryPreference(category, status) {
  const local = loadLocalPreferences();
  const target = status === "rejected" ? local.rejected : local.approved;
  const opposite = status === "rejected" ? local.approved : local.rejected;
  target.add(category);
  opposite.delete(category);
  saveLocalPreferences(local);

  const session = await supabase.auth.getSession();
  const userId = session.data?.session?.user?.id;
  const basePayload = { category, status };
  const payloads = userId ? [{ ...basePayload, user_id: userId }, basePayload] : [basePayload];

  for (const payload of payloads) {
    const { error } = await supabase.from("category_preferences").upsert(payload);
    if (!error) return true;
  }

  if (status === "rejected") {
    for (const payload of payloads) {
      const { error } = await supabase.from("rejected_categories").upsert(payload);
      if (!error) return true;
    }
  } else {
    for (const payload of payloads) {
      const { error } = await supabase.from("categories").upsert(payload);
      if (!error) return true;
    }
  }

  return false;
}

function loadLocalPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      approved: new Set(Array.isArray(saved.approved) ? saved.approved : []),
      rejected: new Set(Array.isArray(saved.rejected) ? saved.rejected : []),
    };
  } catch {
    return { approved: new Set(), rejected: new Set() };
  }
}

function saveLocalPreferences(preferences) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      approved: [...preferences.approved],
      rejected: [...preferences.rejected],
    })
  );
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

function sortCategories(value) {
  return value.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export default Categories;
