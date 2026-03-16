import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { 
  FolderOpen,
  Search,
  ThumbsDown,
  ArrowLeft,
  Loader2
} from "lucide-react";
import { toast } from "sonner";

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
      const [catResponse, dislikedResponse] = await Promise.all([
        api.get("/categories"),
        api.get("/categories/disliked")
      ]);
      setCategories(catResponse.data);
      setDislikedCategories(dislikedResponse.data);
    } catch (error) {
      toast.error("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  const handleDislike = async (category) => {
    try {
      await api.post("/categories/dislike", { category });
      setCategories(prev => prev.filter(c => c !== category));
      setDislikedCategories(prev => [...prev, category]);
      toast.success(`"${category}" hidden from future suggestions`);
    } catch (error) {
      toast.error("Failed to hide category");
    }
  };

  const handleRestore = async (category) => {
    try {
      await api.delete(`/categories/dislike/${encodeURIComponent(category)}`);
      setDislikedCategories(prev => prev.filter(c => c !== category));
      toast.success(`"${category}" restored`);
    } catch (error) {
      toast.error("Failed to restore category");
    }
  };

  const filteredCategories = (showDisliked ? dislikedCategories : categories).filter(cat =>
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
      {/* Header */}
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
            {categories.length} active categories from your questions
          </p>
        </div>
      </div>

      {/* Tabs & Search */}
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
                Active ({categories.length})
              </Button>
              <Button
                variant={showDisliked ? "default" : "outline"}
                onClick={() => setShowDisliked(true)}
                className={showDisliked ? "bg-red-500/20 text-red-400 border-red-500/30" : "border-white/20 text-white hover:bg-zinc-800"}
                data-testid="hidden-tab"
              >
                Hidden ({dislikedCategories.length})
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

      {/* Categories List */}
      {filteredCategories.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500">
              {searchQuery ? "No categories match your search" : showDisliked ? "No hidden categories" : "No categories yet"}
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
                    key={index}
                    className={`group flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${
                      showDisliked
                        ? 'bg-red-500/10 border-red-500/30 text-red-400'
                        : 'bg-zinc-800/50 border-white/10 text-white hover:border-[#71E0DC]/50'
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
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                          <path d="M3 3v5h5"/>
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDislike(category)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
                        title="Hide category"
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

      {/* Info */}
      <Card className="glass-card mt-6">
        <CardContent className="p-4">
          <p className="text-zinc-500 text-sm">
            <strong className="text-zinc-300">Tip:</strong> Hidden categories won't appear when generating random categories. 
            Hover over a category and click the thumbs down to hide it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Categories;
