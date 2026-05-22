import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import {
  LayoutDashboard,
  Sparkles,
  Library,
  PlusCircle,
  Upload,
  LogOut,
  X,
  History,
  Trophy,
  MessageSquare,
  Trash2,
  FolderOpen,
  Layers,
} from "lucide-react";

const Sidebar = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navSections = [
    {
      label: "Create",
      icon: Sparkles,
      paths: ["/generate", "/write-question", "/import"],
      links: [
        { path: "/generate", icon: Sparkles, label: "Questions" },
        { path: "/import", icon: Upload, label: "Import" },
      ],
    },
    {
      label: "Library",
      icon: Library,
      paths: ["/library", "/categories"],
      links: [
        { path: "/library", icon: Library, label: "Questions" },
        { path: "/categories", icon: FolderOpen, label: "Categories" },
      ],
    },
    {
      label: "Sessions",
      icon: Layers,
      paths: ["/build", "/past-sessions", "/session", "/game-history"],
      links: [
        { path: "/build", icon: PlusCircle, label: "Build" },
        { path: "/past-sessions", icon: History, label: "Past Sessions" },
        { path: "/game-history", icon: Trophy, label: "Game History" },
      ],
    },
  ];

  const isPathActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const isSectionActive = (section) => section.paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));

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
                className="h-12 w-40 object-contain object-left"
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

          <nav className="flex-1 px-4 py-5 space-y-4 overflow-y-auto">
            <NavLink
              to="/"
              end
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-[#71E0DC]/20 to-[#AEB2EF]/20 text-white border border-[#71E0DC]/30"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                }`
              }
              data-testid="nav-dashboard"
            >
              <LayoutDashboard size={20} />
              <span className="font-medium">Dashboard</span>
            </NavLink>

            {navSections.map((section) => (
              <NavSection
                key={section.label}
                section={section}
                active={isSectionActive(section)}
                isPathActive={isPathActive}
                onClose={onClose}
              />
            ))}

            <div className="pt-2 border-t border-white/10">
              <NavLink
                to="/host-tools"
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-[#71E0DC]/20 to-[#AEB2EF]/20 text-white border border-[#71E0DC]/30"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                  }`
                }
                data-testid="nav-host-tools"
              >
                <MessageSquare size={20} />
                <span className="font-medium">Host Tools</span>
              </NavLink>

              <NavLink
                to="/reset-data"
                onClick={onClose}
                className={({ isActive }) =>
                  `mt-2 flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-red-500/15 text-red-200 border border-red-500/30"
                      : "text-red-300/70 hover:text-red-200 hover:bg-red-500/10"
                  }`
                }
                data-testid="nav-reset-data"
              >
                <Trash2 size={20} />
                <span className="font-medium">Reset Data</span>
              </NavLink>
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

const NavSection = ({ section, active, isPathActive, onClose }) => {
  const SectionIcon = section.icon;

  return (
    <div className={`rounded-lg border transition-colors ${active ? "border-[#71E0DC]/25 bg-[#71E0DC]/5" : "border-white/5 bg-zinc-950/20"}`}>
      <div className={`flex items-center gap-3 px-4 pt-3 pb-2 ${active ? "text-white" : "text-zinc-500"}`}>
        <SectionIcon size={18} />
        <span className="text-xs font-semibold uppercase tracking-[0.16em]">{section.label}</span>
      </div>

      <div className="px-2 pb-2 space-y-1">
        {section.links.map((item) => {
          const ItemIcon = item.icon;
          const activeLink = isPathActive(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                activeLink
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
              }`}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <ItemIcon size={16} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
};

export default Sidebar;
