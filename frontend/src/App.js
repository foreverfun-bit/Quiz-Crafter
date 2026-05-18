import { supabase } from "./lib/supabase";
import { useState, useEffect, createContext, useContext } from "react";
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
import PresentView from "./pages/PresentView";
import PlayerView from "./pages/PlayerView";
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

const protectedPage = (children) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

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
            <Route path="/" element={protectedPage(<Dashboard />)} />
            <Route path="/generate" element={protectedPage(<Generate />)} />
            <Route path="/write-question" element={protectedPage(<WriteQuestion />)} />
            <Route path="/library" element={protectedPage(<Library />)} />
            <Route path="/build" element={protectedPage(<BuildSession />)} />
            <Route path="/past-sessions" element={protectedPage(<PastSessions />)} />
            <Route path="/import" element={protectedPage(<ImportCSV />)} />
            <Route path="/session/:id" element={protectedPage(<SessionDetail />)} />
            <Route path="/categories" element={protectedPage(<Categories />)} />
            <Route path="/reset-data" element={protectedPage(<ResetData />)} />

            <Route path="/join" element={<JoinGame />} />
            <Route path="/play/:gameId" element={<PlayerView />} />
            <Route path="/present/:code" element={<PresentView />} />

            <Route
              path="/host/:gameId"
              element={
                <ProtectedRoute>
                  <HostControl />
                </ProtectedRoute>
              }
            />

            <Route path="/game-history" element={protectedPage(<GameHistory />)} />
            <Route path="/game-history/:historyId" element={protectedPage(<GameHistoryDetail />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </div>
    </AuthContext.Provider>
  );
}

export default App;
