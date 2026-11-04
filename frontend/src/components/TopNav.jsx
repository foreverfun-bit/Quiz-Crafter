import { NavLink, useLocation } from "react-router-dom";
import { MessageSquare, MapPin } from "lucide-react";

// A horizontal tab bar across the top of the page, mirroring TrivNow's own
// top nav (Home / My Content / Play / Profile / ...). Host Hub and Manage
// live here rather than in the left sidebar (Events/Questions stay there,
// matching TrivNow's "My Content" sidebar) because the host specifically
// wanted them running across the top like TrivNow's bar, not folded into
// the sidebar's primary list.
const TOP_NAV_ITEMS = [
  { path: "/host-tools", icon: MessageSquare, label: "Host Hub", activePaths: ["/host-tools", "/host-session"], testId: "topnav-host-hub" },
  { path: "/manage", icon: MapPin, label: "Manage", activePaths: ["/manage", "/categories", "/venues", "/show-templates", "/style-memory", "/reset-data"], testId: "topnav-manage" },
];

const TopNav = () => {
  const location = useLocation();

  const isActive = (path, activePaths = []) => {
    if (activePaths.some((activePath) => location.pathname === activePath || location.pathname.startsWith(`${activePath}/`))) return true;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-zinc-950/70 px-6 py-2 pl-16 lg:pl-6" data-testid="top-nav">
      {TOP_NAV_ITEMS.map((item) => {
        const ItemIcon = item.icon;
        const active = isActive(item.path, item.activePaths);
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              active ? "text-[#71E0DC]" : "text-zinc-400 hover:text-white"
            }`}
            data-testid={item.testId}
          >
            <ItemIcon size={16} />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
};

export default TopNav;
