import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, useAuth } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
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
  Image
} from "lucide-react";
import { toast } from "sonner";

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get("/stats");
      setStats(response.data);
    } catch (error) {
      toast.error("Failed to load stats");
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
      gradient: true
    },
    { 
      icon: Library, 
      label: "Question Library", 
      description: "Browse your saved questions",
      path: "/library"
    },
    { 
      icon: PlusCircle, 
      label: "Build Session", 
      description: "Create a new trivia session",
      path: "/build"
    },
    { 
      icon: Upload, 
      label: "Import CSV", 
      description: "Import questions from CSV",
      path: "/import"
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

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="dashboard-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          Welcome back, <span className="gradient-text">{user?.name?.split(' ')[0]}</span>
        </h1>
        <p className="text-zinc-500">Your trivia command center awaits</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {quickActions.map((action) => (
          <Card 
            key={action.path}
            className={`glass-card cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
              action.gradient ? 'border-[#71E0DC]/30' : ''
            }`}
            onClick={() => navigate(action.path)}
            data-testid={`quick-action-${action.label.toLowerCase().replace(' ', '-')}`}
          >
            <CardContent className="p-6">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                action.gradient 
                  ? 'bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF]' 
                  : 'bg-zinc-800'
              }`}>
                <action.icon className={action.gradient ? 'text-zinc-900' : 'text-zinc-400'} size={24} />
              </div>
              <h3 className="text-white font-semibold mb-1">{action.label}</h3>
              <p className="text-zinc-500 text-sm">{action.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-500 text-sm mb-1">Total Questions</p>
                <p className="text-3xl font-bold text-white">{stats?.total_questions || 0}</p>
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
                <p className="text-3xl font-bold text-emerald-400">{stats?.liked_count || 0}</p>
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
                <p className="text-3xl font-bold text-[#AEB2EF]">{stats?.categories_count || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-[#AEB2EF]/20 flex items-center justify-center">
                <FolderOpen className="text-[#AEB2EF]" size={24} />
              </div>
            </div>
            <p className="text-zinc-600 text-xs mt-2">Click to view all →</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-500 text-sm mb-1">Sessions</p>
                <p className="text-3xl font-bold text-[#71E0DC]">{stats?.sessions_count || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-[#71E0DC]/20 flex items-center justify-center">
                <FileText className="text-[#71E0DC]" size={24} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Question Types & Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Type */}
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
                  <span className="text-white font-semibold">
                    {stats?.by_type?.[type.key] || 0}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By Source */}
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
                <span className="text-white font-semibold">{stats?.ai_generated_count || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Upload className="text-[#AEB2EF]" size={20} />
                  <span className="text-zinc-300">Imported</span>
                </div>
                <span className="text-white font-semibold">{stats?.imported_count || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="text-zinc-400" size={20} />
                  <span className="text-zinc-300">Manual</span>
                </div>
                <span className="text-white font-semibold">
                  {(stats?.total_questions || 0) - (stats?.ai_generated_count || 0) - (stats?.imported_count || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <div className="flex items-center gap-3">
                  <ThumbsDown className="text-red-400" size={20} />
                  <span className="text-zinc-300">Disliked (hidden)</span>
                </div>
                <span className="text-red-400 font-semibold">{stats?.disliked_count || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CTA */}
      {stats?.total_questions === 0 && (
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
              <Button 
                className="gradient-btn"
                onClick={() => navigate("/generate")}
                data-testid="cta-generate-btn"
              >
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

export default Dashboard;
