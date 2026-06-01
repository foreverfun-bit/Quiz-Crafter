import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Calendar,
  Eye,
  Pencil,
  Trash2,
  FileText,
  Search,
  PlusCircle,
} from "lucide-react";
import { toast } from "sonner";

const PastSessions = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [allSessions, setAllSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const fetchSessions = useCallback(async (authUserId = user?.id) => {
    try {
      setLoading(true);

      const userId = authUserId;
      if (!userId) {
        setAllSessions([]);
        return;
      }

      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setAllSessions(data || []);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      toast.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) fetchSessions(user.id);
  }, [fetchSessions, user?.id]);

  const handleDelete = async (sessionId, e) => {
    e.stopPropagation();

    if (!window.confirm("Are you sure you want to delete this session?")) return;

    try {
      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", sessionId);

      if (error) throw error;

      setAllSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast.success("Session deleted");
    } catch (error) {
      console.error("Delete session error:", error);
      toast.error("Failed to delete session");
    }
  };

  const safeArray = (value) => (Array.isArray(value) ? value : []);

  const getTotalQuestions = (session) => {
    return (
      safeArray(session.true_false_questions).length +
      safeArray(session.multiple_choice_questions).length +
      safeArray(session.written_questions).length +
      safeArray(session.picture_questions).length
    );
  };

  const builtCount = useMemo(
    () => allSessions.filter((s) => !s.is_past).length,
    [allSessions]
  );

  const importedCount = useMemo(
    () => allSessions.filter((s) => !!s.is_past).length,
    [allSessions]
  );

  const filteredSessions = useMemo(() => {
    return allSessions.filter((session) => {
      if (activeTab === "built" && session.is_past) return false;
      if (activeTab === "imported" && !session.is_past) return false;

      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      return (
        String(session.name || "").toLowerCase().includes(query) ||
        String(session.venue || "").toLowerCase().includes(query)
      );
    });
  }, [allSessions, activeTab, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="past-sessions-page">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            <span className="gradient-text">Sessions</span>
          </h1>
          <p className="text-zinc-500">
            Continue builds, review past games, or reopen imported sessions.
          </p>
        </div>

        <Button
          onClick={() => navigate("/build")}
          className="gradient-btn"
          data-testid="new-session-btn"
        >
          <PlusCircle size={18} className="mr-2" />
          New Session
        </Button>
      </div>

      <Card className="glass-card mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
              <TabsList className="bg-zinc-800/50">
                <TabsTrigger value="all" className="data-[state=active]:bg-zinc-700">
                  All ({allSessions.length})
                </TabsTrigger>
                <TabsTrigger value="built" className="data-[state=active]:bg-zinc-700">
                  Built ({builtCount})
                </TabsTrigger>
                <TabsTrigger value="imported" className="data-[state=active]:bg-zinc-700">
                  Imported ({importedCount})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sessions..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                data-testid="search-sessions-input"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {allSessions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Calendar className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No sessions yet</p>
            <p className="text-zinc-600 text-sm mb-6">
              Build a new session or import a CSV to create one
            </p>
            <div className="flex gap-4 justify-center">
              <Button onClick={() => navigate("/build")} className="gradient-btn">
                Build Session
              </Button>
              <Button
                onClick={() => navigate("/import")}
                variant="outline"
                className="border-white/20 text-white hover:bg-zinc-800"
              >
                Import CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : filteredSessions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Search className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No sessions match your search</p>
            <p className="text-zinc-600 text-sm">
              Try a different search term or filter
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSessions.map((session, index) => (
            <Card
              key={session.id}
              className="glass-card cursor-pointer transition-all hover:scale-[1.02]"
              onClick={() => navigate(`/session/${session.id}`)}
              data-testid={`session-${index}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-white font-semibold mb-2 line-clamp-2">
                      {session.name || "Untitled Session"}
                    </h3>

                    <div className="flex flex-wrap gap-2">
                      <Badge
                        className={
                          session.is_past
                            ? "bg-[#AEB2EF]/20 text-[#AEB2EF] border-[#AEB2EF]/30"
                            : "bg-[#71E0DC]/20 text-[#71E0DC] border-[#71E0DC]/30"
                        }
                      >
                        {session.is_past ? "Imported" : "Built"}
                      </Badge>

                      <Badge className="bg-zinc-800 text-zinc-300">
                        <FileText size={12} className="mr-1" />
                        {getTotalQuestions(session)} questions
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">T/F:</span>
                    <span className="text-white">{safeArray(session.true_false_questions).length}</span>
                    <span className="text-zinc-500">MC:</span>
                    <span className="text-white">{safeArray(session.multiple_choice_questions).length}</span>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">Written:</span>
                    <span className="text-white">{safeArray(session.written_questions).length}</span>
                    <span className="text-zinc-500">Picture:</span>
                    <span className="text-white">{safeArray(session.picture_questions).length}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-zinc-600 text-xs">
                    {session.created_at
                      ? new Date(session.created_at).toLocaleDateString()
                      : "No date"}
                  </span>

                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10 px-2"
                      onClick={(e) => handleDelete(session.id, e)}
                      data-testid={`delete-session-${index}`}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-400 hover:text-white hover:bg-zinc-800 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/session/${session.id}`);
                      }}
                      data-testid={`view-session-${index}`}
                      title="View"
                    >
                      <Eye size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#71E0DC] hover:text-white hover:bg-[#71E0DC]/10 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/build/${session.id}`);
                      }}
                      data-testid={`build-session-${index}`}
                      title="Open in Builder"
                    >
                      <Pencil size={14} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default PastSessions;
