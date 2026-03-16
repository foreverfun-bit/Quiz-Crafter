import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../App";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { 
  Calendar,
  MapPin,
  Loader2,
  Eye,
  Trash2,
  FileText,
  Search
} from "lucide-react";
import { toast } from "sonner";

const PastSessions = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await api.get("/sessions?is_past=true");
      setSessions(response.data);
    } catch (error) {
      toast.error("Failed to load past sessions");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sessionId, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this past session?")) return;
    
    try {
      await api.delete(`/sessions/${sessionId}`);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      toast.success("Session deleted");
    } catch (error) {
      toast.error("Failed to delete session");
    }
  };

  const getTotalQuestions = (session) => {
    return (
      (session.true_false_questions?.length || 0) +
      (session.multiple_choice_questions?.length || 0) +
      (session.written_questions?.length || 0) +
      (session.picture_questions?.length || 0)
    );
  };

  // Filter sessions by search query
  const filteredSessions = sessions.filter(session => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return session.name.toLowerCase().includes(query);
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="past-sessions-page">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
          <span className="gradient-text">Past</span> Sessions
        </h1>
        <p className="text-zinc-500">
          Previously used trivia sessions imported from your CSV files
        </p>
      </div>

      {/* Search */}
      {sessions.length > 0 && (
        <Card className="glass-card mb-6">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by venue or date..."
                className="pl-9 bg-zinc-950/50 border-white/10 text-white"
                data-testid="search-sessions-input"
              />
            </div>
            {searchQuery && (
              <p className="text-zinc-500 text-sm mt-2">
                Found {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''} matching "{searchQuery}"
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {sessions.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <Calendar className="text-zinc-600" size={32} />
            </div>
            <p className="text-zinc-500 mb-2">No past sessions found</p>
            <p className="text-zinc-600 text-sm mb-6">
              Import a CSV file with Date Used and Venue columns to create past sessions
            </p>
            <Button
              onClick={() => navigate("/import")}
              className="gradient-btn"
              data-testid="import-btn"
            >
              Import CSV
            </Button>
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
              Try a different search term
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
              data-testid={`past-session-${index}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-white font-semibold mb-2 line-clamp-2">
                      {session.name}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="bg-[#71E0DC]/20 text-[#71E0DC] border-[#71E0DC]/30">
                        <FileText size={12} className="mr-1" />
                        {getTotalQuestions(session)} questions
                      </Badge>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(session.id, e)}
                    className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                    data-testid={`delete-session-${index}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">T/F:</span>
                    <span className="text-white">{session.true_false_questions?.length || 0}</span>
                    <span className="text-zinc-500">MC:</span>
                    <span className="text-white">{session.multiple_choice_questions?.length || 0}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">Written:</span>
                    <span className="text-white">{session.written_questions?.length || 0}</span>
                    <span className="text-zinc-500">Picture:</span>
                    <span className="text-white">{session.picture_questions?.length || 0}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                  <span className="text-zinc-600 text-xs">
                    Imported {new Date(session.created_at).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[#71E0DC] hover:text-[#71E0DC] hover:bg-[#71E0DC]/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/session/${session.id}`);
                    }}
                    data-testid={`view-session-${index}`}
                  >
                    <Eye size={14} className="mr-1" />
                    View
                  </Button>
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
