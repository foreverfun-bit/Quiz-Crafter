import { useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../App";
import { Button } from "./ui/button";
import NewEventModal from "./NewEventModal";
import {
  Library,
  PlusCircle,
  LogOut,
  X,
  History,
  Gamepad2,
  BarChart3,
  TrendingUp,
  Mail,
  Sparkles,
  FolderOpen,
  MapPin,
  Trophy,
  Palette,
  Brain,
  Trash2,
} from "lucide-react";

// Each top-level tab in TopNav (Content/Host Hub/Manage) gets its own
// sidebar list here, matching TrivNow's own pattern (its top tabs each have
// their own left sidebar underneath, not one shared list). Which group
// renders is driven entirely by the current URL -- see getActiveGroup --
// so following a link from anywhere always lands on the matching sidebar.
const CONTENT_NAV_ITEMS = [
  { path: "/past-sessions", icon: History, label: "Events", activePaths: ["/", "/past-sessions", "/sessions", "/session", "/game-history"], testId: "nav-sessions", badgeClass: "bg-emerald-500/20 text-emerald-300" },
  { path: "/library", icon: Library, label: "Questions", activePaths: ["/library", "/import"], testId: "nav-question-bank", badgeClass: "bg-[#AEB2EF]/20 text-[#AEB2EF]" },
];

// These all live on the single /host-tools route (HostTools.jsx switches
// panels off the ?tab= query param, same as it always did) -- a sidebar
// link just navigates to that route with the matching tab param instead of
// the in-page pill row HostTools used to render for the same job.
const HOST_HUB_NAV_ITEMS = [
  { path: "/host-tools?tab=feedback", tabParam: "feedback", icon: BarChart3, label: "Session Review", testId: "nav-host-feedback", badgeClass: "bg-amber-500/20 text-amber-300" },
  { path: "/host-tools?tab=game", tabParam: "game", icon: TrendingUp, label: "Game Data", testId: "nav-host-game", badgeClass: "bg-amber-500/20 text-amber-300" },
  { path: "/host-tools?tab=communications", tabParam: "communications", icon: Mail, label: "Communications", testId: "nav-host-comms", badgeClass: "bg-amber-500/20 text-amber-300" },
  { path: "/host-tools?tab=clues", tabParam: "clues", icon: Sparkles, label: "Clues", testId: "nav-host-clues", badgeClass: "bg-amber-500/20 text-amber-300" },
];

// Mirrors Manage.jsx's own card grid (its page stays as the Manage tab's
// default landing view) -- these just give direct one-click access to the
// same six destinations from anywhere in the Manage section.
const MANAGE_NAV_ITEMS = [
  { path: "/categories", icon: FolderOpen, label: "Categories", testId: "nav-manage-categories", badgeClass: "bg-sky-500/20 text-sky-300" },
  { path: "/venues", icon: MapPin, label: "Venues", testId: "nav-manage-venues", badgeClass: "bg-sky-500/20 text-sky-300" },
  { path: "/show-templates", icon: Trophy, label: "Templates", testId: "nav-manage-templates", badgeClass: "bg-sky-500/20 text-sky-300" },
  { path: "/branding", icon: Palette, label: "Branding", testId: "nav-manage-branding", badgeClass: "bg-sky-500/20 text-sky-300" },
  { path: "/style-memory", icon: Brain, label: "Style Memory", testId: "nav-manage-style", badgeClass: "bg-sky-500/20 text-sky-300" },
  { path: "/reset-data", icon: Trash2, label: "Reset Data", testId: "nav-manage-reset", badgeClass: "bg-red-500/20 text-red-300" },
];

const HOST_HUB_PATHS = ["/host-tools"];
const MANAGE_PATHS = ["/manage", "/categories", "/venues", "/show-templates", "/branding", "/style-memory", "/reset-data"];

const matchesPath = (pathname, paths) => paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

// Anything that isn't clearly Host Hub or Manage (including the orphaned
// /dashboard route, and "/" itself) falls back to Content -- the same
// default the old single-list sidebar effectively had.
const getActiveGroup = (pathname) => {
  if (matchesPath(pathname, HOST_HUB_PATHS)) return "hostHub";
  if (matchesPath(pathname, MANAGE_PATHS)) return "manage";
  return "content";
};

const Sidebar = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [newEventOpen, setNewEventOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const activeGroup = getActiveGroup(location.pathname);
  const activeHostHubTab = searchParams.get("tab") || "feedback";

  const isPathActive = (path, activePaths = []) => {
    if (path === "/") return location.pathname === "/";
    if (activePaths.some((activePath) => location.pathname === activePath || location.pathname.startsWith(`${activePath}/`))) return true;
    if (path === "/venues" && location.pathname.startsWith("/show-templates")) return true;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const navItems = activeGroup === "hostHub" ? HOST_HUB_NAV_ITEMS : activeGroup === "manage" ? MANAGE_NAV_ITEMS : CONTENT_NAV_ITEMS;

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
              {navItems.map((item) => {
                const ItemIcon = item.icon;
                const active = activeGroup === "hostHub" ? activeHostHubTab === item.tabParam : isPathActive(item.path, item.activePaths);
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
            {activeGroup === "content" && <div className="space-y-2 mb-5">
              <Button
                className="w-full gradient-btn justify-center"
                onClick={() => { onClose(); setNewEventOpen(true); }}
                data-testid="nav-build"
              >
                <PlusCircle size={16} className="mr-2" />Create Event
              </Button>
              <Button asChild variant="outline" className="w-full justify-center border-white/10 text-zinc-300 hover:text-white">
                <NavLink to="/host-tools" onClick={onClose}><Gamepad2 size={16} className="mr-2" />Practice Hosting</NavLink>
              </Button>
            </div>}
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
      {newEventOpen && <NewEventModal onClose={() => setNewEventOpen(false)} />}
    </>
  );
};

export default Sidebar;
