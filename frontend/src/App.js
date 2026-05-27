import { supabase } from "./lib/supabase";
import { Component, useState, useEffect, createContext, useContext } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster, toast } from "sonner";

// Pages
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Generate from "./pages/Generate";
import WriteQuestion from "./pages/WriteQuestion";
import Library from "./pages/Library";
import BuildSession from "./pages/BuildSession";
import ImportCSV from "./pages/ImportCSV";
import SessionDetail from "./pages/SessionDetail";
import PastSessions from "./pages/PastSessions";
import Categories from "./pages/Categories";
import ResetData from "./pages/ResetData";
import JoinGame from "./pages/JoinGame";
import HostControl from "./pages/HostControl";
import HostSession from "./pages/HostSession";
import PresentSession from "./pages/PresentSession";
import PlayerSession from "./pages/PlayerSession";
import PresentView from "./pages/PresentView";
import PlayerView from "./pages/PlayerView";
import HostTools from "./pages/HostTools";
import { GameHistory } from "./pages/GameHistory";
import GameHistoryDetail from "./pages/GameHistory";

// Components
import Sidebar from "./components/Sidebar";

export const api = {
  get: async () => {
    throw new Error("Legacy api client removed. This page must be migrated to Supabase.");
  },
  post: async () => {
    throw new Error("Legacy api client removed. This page must be migrated to Supabase.");
  },
  delete: async () => {
    throw new Error("Legacy api client removed. This page must be migrated to Supabase.");
  },
  put: async () => {
    throw new Error("Legacy api client removed. This page must be migrated to Supabase.");
  },
};

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

// Layout Component
const AppLayout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-content">
        <div className="lg:hidden fixed top-4 left-4 z-50">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg bg-zinc-900 border border-white/10 text-white"
            data-testid="mobile-menu-btn"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

class BuildErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Build screen crashed:", error);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  handleResetAndRetry = () => {
    ["trivia-flex-round-builder-state-v5", "trivia-flex-round-builder-state-v4", "trivia-flex-round-builder-state-v3", "trivia-flex-round-builder-state-v2"].forEach((key) => localStorage.removeItem(key));
    this.handleRetry();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="p-4 lg:p-6 max-w-3xl mx-auto min-h-[70vh] flex items-center">
        <div className="w-full rounded-xl border border-white/10 bg-zinc-950/80 p-6 shadow-2xl shadow-black/30">
          <h1 className="text-2xl font-bold text-white mb-2">Build Session Had Trouble Loading</h1>
          <p className="text-zinc-400 mb-5">The builder ran into a saved-state issue. Retry first; if it keeps happening, clear the temporary build cache and reload the builder.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={this.handleRetry} className="rounded-md bg-[#71E0DC] px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-[#AEEBFF]">Retry</button>
            <button type="button" onClick={this.handleResetAndRetry} className="rounded-md border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">Clear Build Cache</button>
          </div>
        </div>
      </div>
    );
  }
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name:
            session.user.user_metadata?.name ||
            session.user.user_metadata?.full_name ||
            session.user.email,
        });
      } else {
        setUser(null);
      }

      setLoading(false);
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name:
            session.user.user_metadata?.name ||
            session.user.user_metadata?.full_name ||
            session.user.email,
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const openHostSession = (event) => {
      const button = event.target?.closest?.('[data-testid="go-live-btn"]');
      const match = window.location.pathname.match(/^\/session\/([^/]+)/);
      if (!button || !match) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/host-session/${match[1]}`);
    };

    document.addEventListener("click", openHostSession, true);
    return () => document.removeEventListener("click", openHostSession, true);
  }, []);

  const login = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message || "Login failed");
        return { success: false, error: error.message };
      }

      if (!data.session?.user) {
        toast.error("Login failed");
        return { success: false, error: "No active session returned" };
      }

      const supaUser = data.session.user;

      setUser({
        id: supaUser.id,
        email: supaUser.email,
        name:
          supaUser.user_metadata?.name ||
          supaUser.user_metadata?.full_name ||
          supaUser.email,
      });

      toast.success("Welcome back!");
      return { success: true };
    } catch (error) {
      toast.error("Login failed");
      return { success: false, error: "Login failed" };
    }
  };

  const register = async (email, password, name) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            full_name: name,
          },
        },
      });

      if (error) {
        toast.error(error.message || "Registration failed");
        return { success: false, error: error.message };
      }

      if (data.session?.user) {
        const supaUser = data.session.user;

        setUser({
          id: supaUser.id,
          email: supaUser.email,
          name:
            supaUser.user_metadata?.name ||
            supaUser.user_metadata?.full_name ||
            supaUser.email,
        });

        toast.success("Account created successfully!");
        return { success: true };
      }

      toast.success("Account created. Please check your email to confirm your account.");
      return { success: true, needsEmailConfirmation: true };
    } catch (error) {
      toast.error("Registration failed");
      return { success: false, error: "Registration failed" };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    toast.success("Logged out successfully");
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      <div className="App min-h-screen bg-[#09090B]">
        <BrowserRouter>
          <Toaster
            position="top-right"
            theme="dark"
            toastOptions={{
              style: {
                background: "#18181B",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#FAFAFA",
              },
            }}
          />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
            <Route path="/generate" element={<ProtectedRoute><AppLayout><Generate /></AppLayout></ProtectedRoute>} />
            <Route path="/write-question" element={<ProtectedRoute><AppLayout><Generate initialCreateMode="write" /></AppLayout></ProtectedRoute>} />
            <Route path="/library" element={<ProtectedRoute><AppLayout><Library /></AppLayout></ProtectedRoute>} />
            <Route path="/build" element={<ProtectedRoute><AppLayout><BuildErrorBoundary><BuildSession /></BuildErrorBoundary></AppLayout></ProtectedRoute>} />
            <Route path="/build/:sessionId" element={<ProtectedRoute><AppLayout><BuildErrorBoundary><BuildSession /></BuildErrorBoundary></AppLayout></ProtectedRoute>} />
            <Route path="/past-sessions" element={<ProtectedRoute><AppLayout><PastSessions /></AppLayout></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><AppLayout><ImportCSV /></AppLayout></ProtectedRoute>} />
            <Route path="/session/:id" element={<ProtectedRoute><AppLayout><SessionDetail /></AppLayout></ProtectedRoute>} />
            <Route path="/host-session/:id" element={<ProtectedRoute><HostSession /></ProtectedRoute>} />
            <Route path="/present-session/:id" element={<ProtectedRoute><PresentSession /></ProtectedRoute>} />
            <Route path="/categories" element={<ProtectedRoute><AppLayout><Categories /></AppLayout></ProtectedRoute>} />
            <Route path="/reset-data" element={<ProtectedRoute><AppLayout><ResetData /></AppLayout></ProtectedRoute>} />

            <Route path="/join" element={<JoinGame />} />
            <Route path="/play-session/:id" element={<PlayerSession />} />
            <Route path="/play/:gameId" element={<PlayerView />} />
            <Route path="/present/:code" element={<PresentView />} />
            <Route path="/host/:gameId" element={<ProtectedRoute><HostControl /></ProtectedRoute>} />
            <Route path="/game-history" element={<ProtectedRoute><AppLayout><GameHistory /></AppLayout></ProtectedRoute>} />
            <Route path="/host-tools" element={<ProtectedRoute><AppLayout><HostTools /></AppLayout></ProtectedRoute>} />
            <Route path="/game-history/:historyId" element={<ProtectedRoute><AppLayout><GameHistoryDetail /></AppLayout></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </div>
    </AuthContext.Provider>
  );
}

export default App;
