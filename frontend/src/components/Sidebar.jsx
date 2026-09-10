import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Button } from "./ui/button";
import {
  LayoutDashboard,
  Library,
  PlusCircle,
  LogOut,
  X,
  History,
  MessageSquare,
  MapPin,
  Gamepad2,
} from "lucide-react";

// Restyled to match TrivNow's "My Content" nav: a short list of primary
// content-type links (each with a colored icon badge), a prominent
// "Create Event" CTA, and a secondary "Practice Hosting" CTA below it.
// Dashboard, Host Hub, and Manage stay as a secondary group underneath --
// real functionality (stats/todos, host utilities, categories/venues/
// templates) with no TrivNow equivalent to fold into, not dropped.
const PRIMARY_NAV_ITEMS = [
  { path: "/past-sessions", icon: History, label: "Events", activePaths: ["/", "/past-sessions", "/sessions", "/session", "/game-history"], testId: "nav-sessions", badgeClass: "bg-emerald-500/20 text-emerald-300" },
  { path: "/library", icon: Library, label: "Questions", activePaths: ["/library", "/import"], testId: "nav-question-bank", badgeClass: "bg-[#AEB2EF]/20 text-[#AEB2EF]" },
];

const SECONDARY_NAV_ITEMS = [
  { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard", testId: "nav-dashboard" },
  { path: "/host-tools", icon: MessageSquare, label: "Host Hub", activePaths: ["/host-tools", "/host-session"], testId: "nav-host-hub" },
  { path: "/manage", icon: MapPin, label: "Manage", activePaths: ["/manage", "/categories", "/venues", "/show-templates", "/style-memory", "/reset-data"], testId: "nav-manage" },
];

const Sidebar = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = SECONDARY_NAV_ITEMS;

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

          <nav className="flex-1 px-4 py-5 overflow-y-auto">
            <div className="space-y-1.5 mb-4">
              {PRIMARY_NAV_ITEMS.map((item) => {
                const ItemIcon = item.icon;
                const active = isPathActive(item.path, item.activePaths);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={onClose}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      active ? "border-[#71E0DC]/30 bg-zinc-900 text-white" : "border-white/10 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-900"
                    }`}
                    data-testid={item.testId}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-md ${item.badgeClass}`}>
                      <ItemIcon size={15} />
                    </span>
                    <span className="flex-1 font-medium">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
            <div className="space-y-2 mb-5">
              <Button asChild className="w-full gradient-btn justify-center">
                <NavLink to="/build" onClick={onClose} data-testid="nav-build"><PlusCircle size={16} className="mr-2" />Create Event</NavLink>
              </Button>
              <Button asChild variant="outline" className="w-full justify-center border-white/10 text-zinc-300 hover:text-white">
                <NavLink to="/host-tools" onClick={onClose}><Gamepad2 size={16} className="mr-2" />Practice Hosting</NavLink>
              </Button>
            </div>
            <div className="h-px bg-white/10 mb-3" />
            <div className="space-y-2">
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
            </div>
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
