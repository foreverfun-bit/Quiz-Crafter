import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { 
  LayoutDashboard, 
  Sparkles, 
  Library, 
  PlusCircle, 
  Upload, 
  LogOut,
  X,
  History
} from "lucide-react";

const Sidebar = ({ isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/generate", icon: Sparkles, label: "Generate" },
    { path: "/library", icon: Library, label: "Library" },
    { path: "/build", icon: PlusCircle, label: "Build Session" },
    { path: "/past-sessions", icon: History, label: "Past Sessions" },
    { path: "/import", icon: Upload, label: "Import CSV" },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="https://customer-assets.emergentagent.com/job_trivia-forge-2/artifacts/pdn53z7h_4ever-full-gradient.svg"
                alt="4EVER Trivia"
                className="w-10 h-10"
              />
              <span className="text-xl font-bold gradient-text">Trivia Forge</span>
            </div>
            <button 
              onClick={onClose}
              className="lg:hidden p-1 text-zinc-400 hover:text-white"
              data-testid="close-sidebar-btn"
            >
              <X size={20} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-[#71E0DC]/20 to-[#AEB2EF]/20 text-white border border-[#71E0DC]/30"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                  }`
                }
                data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* User section */}
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
