import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Brain, FolderOpen, MapPin, Palette, Settings, Trash2, Trophy } from "lucide-react";

const setupTools = [
  {
    title: "Categories",
    description: "Approve, merge, hide, and organize the category list that guides AI generation.",
    path: "/categories",
    icon: FolderOpen,
    badge: "Generator memory",
  },
  {
    title: "Venues",
    description: "Save venue name, schedule, address, and host details for your regular nights.",
    path: "/venues",
    icon: MapPin,
    badge: "Schedule",
  },
  {
    title: "Templates",
    description: "Configure round plans, question counts, timers, points, wagers, and question types.",
    path: "/show-templates",
    icon: Trophy,
    badge: "Build defaults",
  },
  {
    title: "Branding",
    description: "Set the default logo and colors used by host, presentation, and player screens.",
    path: "/branding",
    icon: Palette,
    badge: "Host profile",
  },
  {
    title: "Style Memory",
    description: "Teach Quiz Crafter your host voice, difficulty, examples, fun fact style, and what to avoid.",
    path: "/style-memory",
    icon: Brain,
    badge: "AI voice",
  },
  {
    title: "Settings",
    description: "Account-level setup and workspace controls live here as they are added.",
    path: "/manage",
    icon: Settings,
    badge: "Workspace",
    disabled: true,
  },
];

const advancedTools = [
  {
    title: "Reset Data",
    description: "Danger-zone cleanup for local or account data when you explicitly need it.",
    path: "/reset-data",
    icon: Trash2,
    tone: "danger",
  },
];

export default function Manage() {
  const navigate = useNavigate();

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in" data-testid="manage-page">
      <div className="mb-7">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71E0DC]">Manage Workspace</p>
          <h1 className="text-3xl md:text-4xl font-bold text-white mt-2">Configure the host setup</h1>
          <p className="text-zinc-500 mt-2 max-w-3xl">
            Categories, venues, templates, branding, and settings live here so the sidebar stays focused on destinations.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {setupTools.map((tool) => (
          <ManageCard key={tool.title} tool={tool} onOpen={() => !tool.disabled && navigate(tool.path)} />
        ))}
      </section>

      <section className="mt-7">
        <div className="mb-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Advanced</p>
          <h2 className="text-xl font-bold text-white mt-1">Workspace controls</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {advancedTools.map((tool) => (
            <ManageCard key={tool.title} tool={tool} onOpen={() => navigate(tool.path)} />
          ))}
        </div>
      </section>
    </div>
  );
}

const ManageCard = ({ tool, onOpen }) => {
  const Icon = tool.icon;
  const danger = tool.tone === "danger";

  return (
    <Card className={`glass-card h-full ${tool.disabled ? "opacity-75" : "cursor-pointer hover:border-[#71E0DC]/40"} ${danger ? "hover:border-red-400/40" : ""}`} onClick={onOpen}>
      <CardContent className="p-5 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className={`h-11 w-11 rounded-lg flex items-center justify-center ${danger ? "bg-red-500/15 text-red-300" : "bg-[#71E0DC]/15 text-[#71E0DC]"}`}>
            <Icon size={22} />
          </div>
          <Badge className={danger ? "bg-red-500/15 text-red-300" : "bg-zinc-800 text-zinc-300"}>{tool.badge || "Tool"}</Badge>
        </div>
        <h3 className="mt-5 text-xl font-black text-white">{tool.title}</h3>
        <p className="mt-2 text-sm text-zinc-500 flex-1">{tool.description}</p>
        <Button
          type="button"
          disabled={tool.disabled}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          variant={danger ? "outline" : "default"}
          className={danger ? "mt-5 border-red-500/30 text-red-200 hover:bg-red-500/10" : "mt-5 gradient-btn"}
        >
          {tool.disabled ? "Coming Soon" : "Open"}
        </Button>
      </CardContent>
    </Card>
  );
};
