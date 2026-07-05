import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import {
  LayoutDashboard,
  Library,
  PlusCircle,
  LogOut,
  X,
  History,
  MessageSquare,
  MapPin,
} from "lucide-react";

const Sidebar = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Dashboard", end: true, testId: "nav-dashboard" },
    { path: "/build", icon: PlusCircle, label: "Build", testId: "nav-build" },
    { path: "/library", icon: Library, label: "Question Bank", activePaths: ["/library", "/import"], testId: "nav-question-bank" },
    { path: "/past-sessions", icon: History, label: "Sessions", activePaths: ["/past-sessions", "/sessions", "/session", "/game-history"], testId: "nav-sessions" },
    { path: "/host-tools", icon: MessageSquare, label: "Host Hub", activePaths: ["/host-tools", "/host-session"], testId: "nav-host-hub" },
    { path: "/manage", icon: MapPin, label: "Manage", activePaths: ["/manage", "/categories", "/venues", "/show-templates", "/style-memory", "/reset-data"], testId: "nav-manage" },
  ];

  const isPathActive = (path, activePaths = []) => {
    if (path === "/") return location.pathname === "/";
    if (activePaths.some((activePath) => location.pathname === activePath || location.pathname.startsWith(`${activePath}/`))) return true;
    if (path === "/venues" && location.pathname.startsWith("/show-templates")) return true;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="h-full flex flex-col">
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/quiz-crafter-logo.svg"
                alt="Quiz Crafter"
                className="h-16 w-44 object-contain object-left"
              />
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1 text-zinc-400 hover:text-white"
              data-testid="close-sidebar-btn"
            >
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 px-4 py-5 space-y-2 overflow-y-auto">
            {navItems.map((item) => {
              const ItemIcon = item.icon;
              const active = isPathActive(item.path, item.activePaths);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-r from-[#71E0DC]/20 to-[#AEB2EF]/20 text-white border border-[#71E0DC]/30"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                  }`}
                  data-testid={item.testId}
                >
                  <ItemIcon size={20} />
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#71E0DC] to-[#AEB2EF] flex items-center justify-center">
                <span className="text-zinc-900 font-bold">
                  {user?.name?.charAt(0).toUpperCase() || "U"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.name}</p>
                <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-red-400 transition-colors"
                data-testid="logout-btn"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
