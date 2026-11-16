import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Bot, Check, ChevronDown, ExternalLink, GripHorizontal, Loader2, Maximize2, Minimize2, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { supabase } from "../lib/supabase";
import { loadHostSetupSettings } from "../lib/profileState";
import { readHostStyleProfile, rememberStyleFeedback } from "../lib/hostStyleMemory";
import { readLocalTemplates, readLocalVenues } from "../lib/venues";
import { fetchVenueInsights } from "../lib/venueInsights";
import { useCopilot } from "../context/CopilotContext";

const COPILOT_OPEN_KEY = "quiz-crafter-copilot-open-v1";
const COPILOT_SIZE_KEY = "quiz-crafter-copilot-size-v1";
const COPILOT_MESSAGES_KEY = "quiz-crafter-copilot-messages-v1";
const COPILOT_STATE_KEY = "quiz-crafter-copilot-working-state-v1";
const BUILD_STATE_KEYS = [
  "trivia-flex-round-builder-state-v5",
  "trivia-flex-round-builder-state-v4",
  "trivia-flex-round-builder-state-v3",
  "trivia-flex-round-builder-state-v2",
];

const readJson = (key, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort UI persistence only.
  }
};

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const limitList = (value, limit = 8) => Array.isArray(value) ? value.slice(0, limit) : [];
const routeTitle = (pathname) => {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/build")) return "Build";
  if (pathname.startsWith("/library")) return "Question Bank";
  if (pathname.startsWith("/past-sessions") || pathname.startsWith("/session/")) return "Sessions";
  if (pathname.startsWith("/host-session")) return "Live Hosting";
  if (pathname.startsWith("/host-tools")) return "Host Hub";
  if (pathname.startsWith("/venues")) return "Manage venues/templates";
  if (pathname.startsWith("/style-memory")) return "Manage style memory";
  if (pathname.startsWith("/manage")) return "Manage";
  if (pathname.startsWith("/import")) return "Import";
  return "Quiz Crafter";
};

const currentBuildState = () => {
  for (const key of BUILD_STATE_KEYS) {
    const state = readJson(key, null);
    if (state?.sessionName || state?.rounds?.length || state?.questions?.length) return state;
  }
  return null;
};

const summarizeBuild = (build) => {
  if (!build) return null;
  const rounds = limitList(build.rounds, 6).map((round) => ({
    name: round?.name,
    questionCount: Array.isArray(round?.questionIds) ? round.questionIds.length : 0,
    target: Number(round?.targetCount || round?.questionCount || 0) || undefined,
  }));
  return {
    sessionName: build.sessionName || build.name || "",
    sessionDate: build.sessionDate || build.date || "",
    venueId: build.venueId || "",
    activeRoundId: build.activeRoundId || "",
    questionCount: Array.isArray(build.questions) ? build.questions.length : 0,
    rounds,
  };
};

const nextVenueDate = (venue) => {
  if (!venue?.dayOfWeek) return null;
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const target = days.indexOf(String(venue.dayOfWeek).toLowerCase());
  if (target < 0) return null;
  const now = new Date();
  const date = new Date(now);
  const diff = (target - now.getDay() + 7) % 7 || 7;
  date.setDate(now.getDate() + diff);
  return date.toISOString();
};

const isPreviewRequest = (text) => {
  const lower = clean(text).toLowerCase();
  if (!lower) return false;
  const questionRef = /\b(question|q)\s*#?\s*\d+\b/.test(lower) || /\b(replace|rewrite|make|improve)\s*#?\s*\d+\b/.test(lower);
  return questionRef && /\b(replace|rewrite|improve|make harder|make easier|harder|easier|fun fact)\b/.test(lower);
};
// Mirrors classifyBuildIntent() in BuildSession.jsx -- requests that engine already knows
// how to turn into real draft candidates in the active build, not just a chat reply.
const isBuildDraftRequest = (text) => {
  const lower = clean(text).toLowerCase();
  if (!lower) return false;
  if (/\bfull session|finish (?:the )?(?:session|game)|complete (?:the )?(?:session|game)\b/.test(lower)) return true;
  if (/\b(?:build|fill|finish)\s+(?:\w+\s+){0,3}round\b/.test(lower)) return true;
  if (/\b(add|generate|give me|make|draft)\b/.test(lower) && /\b(question|questions|candidate|candidates)\b/.test(lower)) return true;
  if (/\b(replace|replacement|replacements)\b/.test(lower)) return true;
  if (/\b(write my own|manual|manually write|create my own)\b/.test(lower)) return true;
  return false;
};
const isConfirmedApplicationAction = (text, state = {}) => {
  const lower = clean(text).toLowerCase();
  if (!lower) return false;
  if (state?.awaitingConfirmation && isConfirmFollowUp(lower)) return true;
  if (/\b(save build|save session)\b/.test(lower)) return true;
  if (/\b(use|apply)\b.*\btemplate\b/.test(lower)) return true;
  if (/\b(import|upload)\b/.test(lower) && /\b(pdf|csv|file)\b/.test(lower)) return true;
  if (/\b(export)\b/.test(lower) && /\b(csv|session|results|questions)\b/.test(lower)) return true;
  return false;
};
const emptyWorkingState = {
  currentTask: "",
  activeSession: null,
  activeRound: null,
  activeQuestion: null,
  pendingGeneratedQuestion: null,
  awaitingConfirmation: false,
  lastAiSuggestion: null,
  lastUserFeedback: "",
};
const normalizeWorkingState = (state = {}) => ({ ...emptyWorkingState, ...(state && typeof state === "object" ? state : {}) });
const isFollowUpForPendingTask = (text, state) => {
  const lower = clean(text).toLowerCase();
  if (!state?.currentTask && !state?.awaitingConfirmation && !state?.pendingGeneratedQuestion) return false;
  return /^(try again|again|another|give me another|harder|make it harder|easier|make it easier|rewrite it|improve it|cancel|nevermind|never mind)$/i.test(lower) || isConfirmFollowUp(lower);
};
const isConfirmFollowUp = (text) => {
  const lower = clean(text).toLowerCase();
  return /^(yes|yep|yeah|correct|looks good|use it|use this|apply it|apply this|replace it)$/.test(lower)
    || /\b(yes|yep|yeah|use|apply|replace)\b.*\b(this|it)\b/.test(lower)
    || /\b(yes|yep|yeah)\b.*\b(question|q)\s*#?\s*\d+\b/.test(lower)
    || /\breplace\s*(question|q)?\s*#?\s*\d+\s*(with)?\s*(this|it)\b/.test(lower);
};
const isCancelFollowUp = (text) => /^(cancel|nevermind|never mind)$/i.test(clean(text));
const applyWorkingStateFromResult = (current, request, result = {}) => {
  if (!result?.ok) return normalizeWorkingState({ ...current, lastUserFeedback: request });
  const next = normalizeWorkingState({
    ...current,
    currentTask: result.task?.type || current.currentTask || "",
    activeSession: result.task?.session || current.activeSession,
    activeRound: result.task?.round || current.activeRound,
    activeQuestion: result.task?.question || current.activeQuestion,
    pendingGeneratedQuestion: result.preview || current.pendingGeneratedQuestion,
    awaitingConfirmation: Boolean(result.awaitingConfirmation || result.preview),
    lastAiSuggestion: result.preview || result.lastAiSuggestion || current.lastAiSuggestion,
    lastUserFeedback: request,
  });
  if (result.taskComplete) return normalizeWorkingState({ ...emptyWorkingState, lastAiSuggestion: result.lastAiSuggestion || current.lastAiSuggestion, lastUserFeedback: request });
  return next;
};
const buildProgressText = (text) => {
  const lower = text.toLowerCase();
  if (/\breplace\b/.test(lower)) return `Preparing a replacement preview for ${clean(text.match(/question\s*#?\s*\d+/i)?.[0]) || "that question"}...`;
  if (/\b(rewrite|make|harder|easier|fun fact|convert)\b/.test(lower)) return `Preparing an edit preview for ${clean(text.match(/question\s*#?\s*\d+/i)?.[0]) || "that question"}...`;
  if (/\b(build|finish)\b/.test(lower)) return "Drafting candidates for review...";
  if (/\b(search|library|find)\b/.test(lower)) return "Searching the active workspace...";
  return "Preparing a preview...";
};
const formatBuildResult = (result = {}) => {
  if (!result.ok) return result.message || "I couldn't complete that action in the active Build session.";
  const lines = [result.message || "Done."];
  if (result.preview?.question_text) {
    lines.push("", `Preview: ${result.preview.question_text}`, `Answer: ${result.preview.correct_answer || "TBD"}`);
  }
  if (result.undoAvailable) lines.push("", "Undo is available in the Build helper strip.");
  return lines.join("\n");
};
// BuildSession.jsx's runBuilderChat returns drafted candidates as `new_value`
// (matching its other action_type results); HostSession.jsx's askCoHost
// returns them as `candidates`. Normalizing both here means neither page's
// existing shape has to change.
const resultCandidates = (result = {}) => (Array.isArray(result.candidates) ? result.candidates : Array.isArray(result.new_value) ? result.new_value : []);
// Pages whose own listener (BuildSession.jsx) or (HostSession.jsx, the
// merged workspace) turns a quiz-crafter-copilot-command event into real
// AI-drafted questions the host can add, not just a chat reply.
const isBuildToolPage = (pathname) => pathname.startsWith("/build") || pathname.startsWith("/session/");

const routeForIntent = (text) => {
  const lower = text.toLowerCase();
  if (/\b(import|upload)\b/.test(lower) && /\b(pdf|csv|file)\b/.test(lower)) return "/import";
  if (/\b(open|go to|show me)\b/.test(lower) && /\b(question bank|library)\b/.test(lower)) return "/library";
  if (/\b(open|go to|show me)\b/.test(lower) && /\b(session|past sessions)\b/.test(lower)) return "/past-sessions";
  if (/\bduplicate\b/.test(lower) && /\bsession\b/.test(lower)) return "/past-sessions";
  if (/\b(venue|template|branding|style memory|settings|manage)\b/.test(lower)) return "/manage";
  if (/\b(host|live|run trivia|answers|players)\b/.test(lower)) return "/host-tools";
  if (isPreviewRequest(lower) || isConfirmedApplicationAction(lower) || isBuildDraftRequest(lower)) return "/build";
  return "";
};

export default function FloatingCopilot({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { pageContext } = useCopilot();
  const [open, setOpen] = useState(() => readJson(COPILOT_OPEN_KEY, false));
  const [size, setSize] = useState(() => readJson(COPILOT_SIZE_KEY, { width: 420, height: 620 }));
  const [messages, setMessages] = useState(() => readJson(COPILOT_MESSAGES_KEY, [
    { role: "assistant", content: "I’m here whenever you need me. I’ll use the page you’re on as context." },
  ]));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [baseContext, setBaseContext] = useState({});
  const [workingState, setWorkingState] = useState(() => normalizeWorkingState(readJson(COPILOT_STATE_KEY, emptyWorkingState)));
  const dragRef = useRef(null);
  const messagesEndRef = useRef(null);

  const pageName = routeTitle(location.pathname);
  const hidden = location.pathname === "/login" || location.pathname.startsWith("/join") || location.pathname.startsWith("/play") || location.pathname.startsWith("/play-session") || location.pathname.startsWith("/present") || location.pathname.startsWith("/present-session");

  useEffect(() => writeJson(COPILOT_OPEN_KEY, open), [open]);
  useEffect(() => writeJson(COPILOT_SIZE_KEY, size), [size]);
  useEffect(() => writeJson(COPILOT_MESSAGES_KEY, messages.slice(-24)), [messages]);
  useEffect(() => writeJson(COPILOT_STATE_KEY, workingState), [workingState]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages, loading]);

  useEffect(() => {
    if (!user || hidden) return;
    let cancelled = false;
    const load = async () => {
      const setup = await loadHostSetupSettings().catch(() => ({}));
      const localVenues = readLocalVenues();
      const localTemplates = readLocalTemplates();
      const venues = Array.isArray(setup.venues) && setup.venues.length ? setup.venues : localVenues;
      const templates = Array.isArray(setup.templates) && setup.templates.length ? setup.templates : localTemplates;
      const activeVenueId = setup.activeVenueId || "";
      const activeVenue = venues.find((venue) => venue.id === activeVenueId) || venues[0] || null;
      const upcoming = venues
        .map((venue) => ({ venue, date: nextVenueDate(venue) }))
        .filter((item) => item.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;
      const build = summarizeBuild(currentBuildState());
      // Default-venue fallback so the assistant has venue awareness (and
      // the same "regulars" signal the dedicated co-host chat uses) even
      // on pages that don't push a session-specific venue via
      // updatePageContext (see the `venue` override in the context memo
      // below, which prefers that live page context when present).
      const [counts, activeVenueInsights] = await Promise.all([
        Promise.all([
          supabase.from("questions").select("id", { count: "exact", head: true }),
          supabase.from("sessions").select("id", { count: "exact", head: true }),
        ]).catch(() => []),
        activeVenue ? fetchVenueInsights(activeVenue.id).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setBaseContext({
        route: { path: location.pathname, page: pageName },
        user: { id: user.id, email: user.email, name: user.name },
        dashboard: {
          nextShow: upcoming ? {
            venue: upcoming.venue?.name || upcoming.venue?.nightName,
            nightName: upcoming.venue?.nightName,
            date: upcoming.date,
            startTime: upcoming.venue?.startTime,
            timeZone: upcoming.venue?.timeZone,
          } : null,
          activeVenue: activeVenue ? { id: activeVenue.id, name: activeVenue.name, nightName: activeVenue.nightName } : null,
          questionCount: counts[0]?.count ?? null,
          sessionCount: counts[1]?.count ?? null,
        },
        setup: {
          venues: limitList(venues, 6).map((venue) => ({ id: venue.id, name: venue.name, nightName: venue.nightName, dayOfWeek: venue.dayOfWeek, startTime: venue.startTime })),
          templates: limitList(templates, 6).map((template) => ({ id: template.id, name: template.name, rounds: template.roundCount, perRound: template.questionsPerRound })),
        },
        build,
        venue: activeVenue ? { name: activeVenue.name || activeVenue.nightName || "", insights: activeVenueInsights } : null,
        hostStyleProfile: readHostStyleProfile(),
      });
    };
    load();
    return () => { cancelled = true; };
  }, [hidden, location.pathname, pageName, user]);

  const context = useMemo(() => ({
    ...baseContext,
    // A page in view of one specific session/venue (Build, the merged
    // Host/Build workspace) pushes its own venue + venueInsights via
    // updatePageContext -- prefer that over the account-wide default venue
    // from baseContext, since it's what the host is actually looking at.
    venue: pageContext?.build?.venue
      ? { name: pageContext.build.venue, insights: pageContext.build.venueInsights || null }
      : baseContext.venue || null,
    pageLiveContext: pageContext,
    currentPageGoal: pageContext?.goal || pageName,
    conversationState: workingState,
  }), [baseContext, pageContext, pageName, workingState]);

  const promptHint = useMemo(() => {
    if (isBuildToolPage(location.pathname)) return "Try: Give me question suggestions, build this round, replace question 4...";
    if (location.pathname.startsWith("/library")) return "Try: Find biology questions, mark this reusable, import this PDF...";
    if (location.pathname === "/") return "Try: What should I work on next? Continue my next show...";
    if (location.pathname.startsWith("/host-session")) return "Try: Who has not answered? Show me live feedback...";
    return "Ask Quiz Crafter anything about this page...";
  }, [location.pathname]);

  // On a page that can actually stage/add drafted questions (isBuildToolPage),
  // the chips are worded to match isBuildDraftRequest/isPreviewRequest's
  // phrasing exactly so the first click lands on the real add-to-round path
  // instead of a plain chat reply the host then has to retype more
  // specifically (see the "Use my style memory" chip, which only chats --
  // kept elsewhere since it's not a drafting request).
  const quickChips = useMemo(() => {
    if (isBuildToolPage(location.pathname)) return ["Give me question suggestions for this round", "Build this round", "Find a replacement for a weak question"];
    return ["What should I work on next?", "Open the right tool", "Use my style memory"];
  }, [location.pathname]);

  const runBuildCommand = (request, commandId) => {
    window.dispatchEvent(new CustomEvent("quiz-crafter-copilot-command", { detail: { request, commandId } }));
  };

  const handleSubmit = async (messageOverride = "") => {
    const request = clean(messageOverride || input);
    if (!request || loading) return;
    setInput("");
    const nextMessages = [...messages, { role: "user", content: request }].slice(-24);
    setMessages(nextMessages);

    if (isCancelFollowUp(request)) {
      setWorkingState(emptyWorkingState);
      setMessages((current) => [...current, { role: "assistant", content: "Canceled. What would you like to work on next?" }].slice(-24));
      return;
    }

    const shouldUseBuildTool = isBuildToolPage(location.pathname) && (
      isPreviewRequest(request) ||
      isConfirmedApplicationAction(request, workingState) ||
      isBuildDraftRequest(request) ||
      (workingState.awaitingConfirmation && isFollowUpForPendingTask(request, workingState))
    );
    if (shouldUseBuildTool) {
      const commandId = `build-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const progress = isConfirmFollowUp(request)
        ? "Applying the pending change..."
        : isFollowUpForPendingTask(request, workingState)
          ? `Updating ${workingState.activeQuestion ? `Question ${workingState.activeQuestion.number}` : "the pending suggestion"}...`
          : buildProgressText(request);
      setMessages((current) => [...current, { role: "assistant", content: progress, commandId, pending: true }].slice(-24));
      runBuildCommand(request, commandId);
      return;
    }

    // Off a page that can generate with its own rich context (no round/
    // category state to draw on here), but the host still asked for
    // questions -- draft them directly instead of only chatting about them.
    // Same endpoint/mode askCoHost/handleAskCoHost already use, just with
    // whatever context this component has on hand (venue, style profile,
    // approved categories if a page happened to push any).
    if (!isBuildToolPage(location.pathname) && isBuildDraftRequest(request)) {
      setLoading(true);
      try {
        const { data } = await axios.post("/api/host-assistant", {
          mode: "build_cohost",
          request,
          context: {
            session: { name: context.build?.sessionName || "", activeRound: "" },
            venue: context.venue || null,
            conversation: nextMessages.slice(-10),
            questions: [],
            rejectedQuestions: [],
            hostStyleProfile: context.hostStyleProfile,
          },
        }, { timeout: 90000 });
        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
        setMessages((current) => [...current, { role: "assistant", content: data?.answer || "Here's what I drafted.", candidates }].slice(-24));
      } catch (error) {
        console.error("Copilot draft error:", error);
        toast.error(error.response?.data?.error || error.message || "Quiz Crafter could not draft that");
        setMessages((current) => [...current, { role: "assistant", content: "I couldn't draft anything just now -- try again in a moment." }].slice(-24));
      } finally {
        setLoading(false);
      }
      return;
    }

    const destination = routeForIntent(request);
    setLoading(true);
    try {
      const { data } = await axios.post("/api/host-assistant", {
        mode: "app_copilot",
        request,
        context: {
          ...context,
          conversation: nextMessages.slice(-10),
          suggestedDestination: destination,
        },
      }, { timeout: 90000 });
      setMessages((current) => [...current, { role: "assistant", content: data?.answer || "I’m ready. Tell me what you want to do next." }].slice(-24));
    } catch (error) {
      console.error("Copilot error:", error);
      toast.error(error.response?.data?.error || error.message || "Quiz Crafter could not answer");
      setMessages((current) => [...current, { role: "assistant", content: "I hit a snag answering that. Try a shorter request or open the page you want me to work on." }].slice(-24));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleBuildResult = (event) => {
      const { commandId, result } = event.detail || {};
      if (!commandId) return;
      setMessages((current) => {
        const hasPending = current.some((message) => message.commandId === commandId);
        const formatted = formatBuildResult(result);
        const candidates = resultCandidates(result);
        setWorkingState((state) => applyWorkingStateFromResult(state, result?.request || "", result));
        if (!hasPending) return [...current, { role: "assistant", content: formatted, candidates }].slice(-24);
        return current.map((message) => message.commandId === commandId ? { role: "assistant", content: formatted, commandId, candidates } : message).slice(-24);
      });
    };
    const handleOpenRequest = (event) => {
      const prompt = clean(event.detail?.prompt);
      setOpen(true);
      if (prompt) window.setTimeout(() => handleSubmit(prompt), 0);
    };
    window.addEventListener("quiz-crafter-copilot-result", handleBuildResult);
    window.addEventListener("quiz-crafter-open-copilot", handleOpenRequest);
    return () => {
      window.removeEventListener("quiz-crafter-copilot-result", handleBuildResult);
      window.removeEventListener("quiz-crafter-open-copilot", handleOpenRequest);
    };
  });

  // Immutable per-candidate status flip (added/saved) so a card's buttons
  // reflect what's already been done with it, keyed by its position in a
  // specific message (candidates have no stable id coming back from either
  // generation path, but messages/their candidate lists are never reordered).
  const updateCandidateStatus = (messageIndex, candidateIndex, patch) => {
    setMessages((current) => current.map((message, mi) => {
      if (mi !== messageIndex || !message.candidates) return message;
      return { ...message, candidates: message.candidates.map((candidate, ci) => ci === candidateIndex ? { ...candidate, ...patch } : candidate) };
    }));
  };

  // "Add to Session" only ever renders when isBuildToolPage(location.pathname)
  // is true (see the render below), so a listener is guaranteed to be
  // mounted (BuildSession.jsx/HostSession.jsx) -- no ack needed, they already
  // toast their own success/failure.
  const handleAddToSession = (messageIndex, candidateIndex, candidate) => {
    window.dispatchEvent(new CustomEvent("quiz-crafter-copilot-add-to-session", { detail: { candidate } }));
    updateCandidateStatus(messageIndex, candidateIndex, { _added: true });
  };

  // Library saves are account-wide, not page-specific -- on a build-tool page,
  // let it run through the page's own full save (handleSaveQuestionToLibrary/
  // saveQuestionToLibrary), which also teaches the style profile via
  // rememberStyleFeedback. Off those pages, insert directly: same payload
  // shape BuildSession.jsx's handleSaveQuestionToLibrary uses.
  const handleSaveCandidateToLibrary = async (messageIndex, candidateIndex, candidate) => {
    if (isBuildToolPage(location.pathname)) {
      window.dispatchEvent(new CustomEvent("quiz-crafter-copilot-save-to-library", { detail: { candidate } }));
      updateCandidateStatus(messageIndex, candidateIndex, { _saved: true });
      return;
    }
    if (!user?.id) { toast.error("You must be signed in"); return; }
    const payload = {
      user_id: user.id,
      question_text: candidate.question_text,
      correct_answer: candidate.correct_answer,
      question_type: candidate.question_type || candidate.type || "written",
      category: candidate.category || "",
      incorrect_answers: Array.isArray(candidate.options) && candidate.options.length ? candidate.options.join("; ") : candidate.incorrect_answers || null,
      fun_fact: candidate.fun_fact || null,
      image_url: candidate.image_url || null,
    };
    const { error } = await supabase.from("questions").insert(payload);
    if (error) {
      console.error("Save to library error:", error);
      toast.error(error.message || "Failed to save to library");
      return;
    }
    toast.success("Saved to your library");
    updateCandidateStatus(messageIndex, candidateIndex, { _saved: true });
  };

  // The only difficulty-feedback loop that existed before this (BuildSession.jsx's
  // AiCandidateCard "too easy" rating) never reached this chat -- so a host who
  // only ever drafts through the floating assistant had no way to teach
  // hostStyleMemory that results were coming back too easy, and preferredDifficulty
  // stayed stuck at its generic default. rememberStyleFeedback is page-agnostic
  // (writes straight to the profile), so it works the same here as it does there.
  const handleTooEasy = (messageIndex, candidateIndex, candidate) => {
    rememberStyleFeedback(candidate, "too_easy", "Flagged too easy from the floating assistant").catch((error) => console.warn("Style feedback save unavailable:", error));
    toast.success("Got it -- I'll push harder on difficulty next time");
    updateCandidateStatus(messageIndex, candidateIndex, { _flaggedEasy: true });
  };

  const startResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...size };
    dragRef.current = { startX, startY, start };
    const move = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const deltaY = startY - moveEvent.clientY;
      setSize({
        width: Math.min(720, Math.max(340, start.width + deltaX)),
        height: Math.min(820, Math.max(460, start.height + deltaY)),
      });
    };
    const stop = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  if (hidden || !user) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[90]">
      {open ? (
        <div
          className="overflow-hidden rounded-2xl border border-[#71E0DC]/25 bg-[#101115]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
          style={{ width: `min(${size.width}px, calc(100vw - 24px))`, height: `min(${size.height}px, calc(100vh - 24px))` }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[#71E0DC]" />
                <p className="font-black text-white">Quiz Crafter</p>
                <Badge className="border border-[#71E0DC]/20 bg-[#71E0DC]/12 text-[#71E0DC]">{pageName}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-zinc-500">Aware of this page, your setup, current build, and style memory.</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onMouseDown={startResize} className="hidden md:inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white" aria-label="Resize assistant"><GripHorizontal size={16} /></button>
              <button type="button" onClick={() => setSize(size.width > 500 ? { width: 420, height: 620 } : { width: 680, height: 780 })} className="h-8 w-8 rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Resize assistant">{size.width > 500 ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white" aria-label="Collapse assistant"><ChevronDown size={18} /></button>
            </div>
          </div>

          <div className="flex h-[calc(100%-64px)] flex-col">
            <div className="border-b border-white/10 bg-zinc-950/40 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Current context</p>
              <p className="mt-1 text-sm text-zinc-300">{context.dashboard?.nextShow?.venue ? `Next show: ${context.dashboard.nextShow.venue}` : `You are on ${pageName}`}{context.build?.sessionName ? ` · Build: ${context.build.sessionName}` : ""}</p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "border border-[#71E0DC]/25 bg-[#71E0DC]/15 text-white" : "border border-white/10 bg-zinc-900/90 text-zinc-200"}`}>
                    <div className="whitespace-pre-wrap">
                      {message.pending && <Loader2 size={14} className="mr-2 inline animate-spin text-[#71E0DC]" />}
                      {message.content}
                    </div>
                    {message.candidates?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {message.candidates.map((candidate, candidateIndex) => (
                          <div key={candidateIndex} className="rounded-lg border border-[#AEB2EF]/20 bg-zinc-950/60 p-3">
                            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{candidate.category}</p>
                            <p className="mt-1 text-sm text-white">{candidate.question_text}</p>
                            <p className="mt-1 text-xs text-emerald-300">Answer: {candidate.correct_answer}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {isBuildToolPage(location.pathname) && (
                                <button type="button" disabled={candidate._added} onClick={() => handleAddToSession(index, candidateIndex, candidate)} className="inline-flex items-center gap-1 rounded-full border border-[#71E0DC]/30 bg-[#71E0DC]/10 px-2.5 py-1 text-[11px] font-semibold text-[#71E0DC] disabled:opacity-50">
                                  {candidate._added ? <><Check size={11} />Added</> : "Add to Session"}
                                </button>
                              )}
                              <button type="button" disabled={candidate._saved} onClick={() => handleSaveCandidateToLibrary(index, candidateIndex, candidate)} className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 disabled:opacity-50">
                                {candidate._saved ? <><Check size={11} />Saved</> : "Add to Library"}
                              </button>
                              <button type="button" disabled={candidate._flaggedEasy} onClick={() => handleTooEasy(index, candidateIndex, candidate)} className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 disabled:opacity-50">
                                {candidate._flaggedEasy ? <><Check size={11} />Noted</> : "Too easy"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && <div className="rounded-2xl border border-white/10 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-400"><Loader2 size={14} className="mr-2 inline animate-spin text-[#71E0DC]" />Thinking with page context...</div>}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-white/10 p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {quickChips.map((chip) => (
                  <button key={chip} type="button" onClick={() => handleSubmit(chip)} className="rounded-full border border-white/10 bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 hover:border-[#71E0DC]/35 hover:text-white">{chip}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSubmit(); } }} placeholder={promptHint} className="min-h-[54px] flex-1 resize-none border-white/10 bg-zinc-950 text-white focus:border-[#71E0DC]/60" />
                <Button type="button" onClick={() => handleSubmit()} disabled={loading || !clean(input)} className="h-auto gradient-btn px-3"><Send size={16} /></Button>
              </div>
              {routeForIntent(input) && !location.pathname.startsWith(routeForIntent(input)) && !(routeForIntent(input) === "/build" && isBuildToolPage(location.pathname)) && (
                <button type="button" onClick={() => navigate(routeForIntent(input))} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#71E0DC] hover:text-white">
                  <ExternalLink size={12} /> Open likely page: {routeTitle(routeForIntent(input))}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex h-14 w-14 items-center justify-center rounded-full border border-[#71E0DC]/35 bg-[#101115] text-[#71E0DC] shadow-2xl shadow-[#71E0DC]/20 transition hover:scale-105 hover:bg-[#162326]"
          aria-label="Open Quiz Crafter assistant"
        >
          <Bot size={24} className="transition group-hover:rotate-6" />
        </button>
      )}
    </div>
  );
}
