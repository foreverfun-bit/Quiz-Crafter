import { useState } from "react";
import { ChevronDown, Loader2, MapPin, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

// Shared between BuildSession.jsx and HostSession.jsx -- both fetch this
// venue's history via lib/venueInsights.js and render the exact same panel,
// so the merged hosting workspace shows the same "what this venue has
// taught the AI" signal as the standalone Build page always has.
const VenueInsightsPanel = ({ venueName, insights, loading }) => {
  const [collapsed, setCollapsed] = useState(false);
  if (loading) return <Card className="glass-card mb-4"><CardContent className="p-4 flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={15} className="animate-spin" />Checking what {venueName} has liked so far...</CardContent></Card>;
  if (!insights || !insights.sessionCount) return <Card className="glass-card mb-4"><CardContent className="p-4 flex items-center gap-2 text-sm text-zinc-500"><MapPin size={15} className="text-zinc-600" />No history yet at {venueName}. The AI will use your general style profile until you've played a session or two here.</CardContent></Card>;
  return <Card className="glass-card mb-4 border-[#71E0DC]/15"><CardContent className="p-4 space-y-3">
    <button type="button" onClick={() => setCollapsed((value) => !value)} className="flex w-full items-center justify-between gap-2 text-left">
      <span className="flex items-center gap-2 text-white font-semibold"><MapPin size={16} className="text-[#71E0DC]" />What {venueName} has taught the AI</span>
      <ChevronDown size={18} className={`flex-shrink-0 text-zinc-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
    </button>
    {!collapsed && <>
    <p className="text-xs text-zinc-500">Played here {insights.sessionCount} time{insights.sessionCount === 1 ? "" : "s"}{insights.mostRecentDate ? `, most recently ${insights.mostRecentDate}` : ""}.{insights.pastNames?.length ? ` Past sessions: ${insights.pastNames.join(", ")}.` : ""} This is automatically folded into generation for this venue.</p>
    {(insights.regularsLoved?.length > 0 || insights.regularsStruggled?.length > 0) && <div className="rounded-lg border border-[#AEB2EF]/25 bg-[#AEB2EF]/8 p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#AEB2EF]"><Users size={13} />{insights.regularCount} regular team{insights.regularCount === 1 ? "" : "s"} here (played 2+ nights)</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {insights.regularsLoved?.length > 0 && <div><p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-300"><ThumbsUp size={12} />Regulars specifically like</p><div className="flex flex-wrap gap-1.5">{insights.regularsLoved.map((row) => <Badge key={row.category} className="bg-emerald-500/15 text-emerald-200 border border-emerald-500/20">{row.category}</Badge>)}</div></div>}
        {insights.regularsStruggled?.length > 0 && <div><p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-300"><ThumbsDown size={12} />Regulars specifically avoid</p><div className="flex flex-wrap gap-1.5">{insights.regularsStruggled.map((row) => <Badge key={row.category} className="bg-red-500/15 text-red-200 border border-red-500/20">{row.category}</Badge>)}</div></div>}
      </div>
    </div>}
    {(insights.loved?.length || insights.struggled?.length) && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {insights.loved?.length > 0 && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3"><p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-300"><ThumbsUp size={13} />Landed well here (whole crowd)</p><div className="flex flex-wrap gap-1.5">{insights.loved.map((row) => <Badge key={row.category} className="bg-emerald-500/15 text-emerald-200 border border-emerald-500/20">{row.category}</Badge>)}</div></div>}
      {insights.struggled?.length > 0 && <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3"><p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-300"><ThumbsDown size={13} />Struggled here (whole crowd)</p><div className="flex flex-wrap gap-1.5">{insights.struggled.map((row) => <Badge key={row.category} className="bg-red-500/15 text-red-200 border border-red-500/20">{row.category}</Badge>)}</div></div>}
    </div>}
    {(insights.likedQuestions?.length > 0 || insights.dislikedQuestions?.length > 0) && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      {insights.likedQuestions?.length > 0 && <div><p className="mb-1 font-bold text-zinc-400">Specific questions this crowd liked</p><ul className="space-y-1 text-zinc-500">{insights.likedQuestions.map((item, index) => <li key={index} className="line-clamp-2">- {item.question_text}</li>)}</ul></div>}
      {insights.dislikedQuestions?.length > 0 && <div><p className="mb-1 font-bold text-zinc-400">Specific questions this crowd disliked</p><ul className="space-y-1 text-zinc-500">{insights.dislikedQuestions.map((item, index) => <li key={index} className="line-clamp-2">- {item.question_text}</li>)}</ul></div>}
    </div>}
    {insights.ideas?.length > 0 && <div className="text-xs"><p className="mb-1 font-bold text-zinc-400">Player-submitted ideas from past nights here</p><ul className="space-y-1 text-zinc-500">{insights.ideas.slice(0, 6).map((idea, index) => <li key={index} className="line-clamp-2">- {[idea.category, idea.question].filter(Boolean).join(": ")}</li>)}</ul></div>}
    </>}
  </CardContent></Card>;
};

export default VenueInsightsPanel;
