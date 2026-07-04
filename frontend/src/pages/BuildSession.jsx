import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import { useAuth } from "../App";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { ArrowDown, ArrowUp, Ban, Check, CheckCircle, ChevronDown, Clock, Coins, Image, Layers, Link, List, Loader2, MessageSquare, Minus, MoreHorizontal, Pencil, Plus, RefreshCw, Save, Search, Settings, Sparkles, Tag, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { canonicalCategory, categoryKey, dedupeCategories } from "../lib/categories";
import { PROFILE_SHOW_TEMPLATES_KEY, PROFILE_VENUES_KEY, hasSavedLocalTemplates, makeTemplateBuildDraft, mergeProfileRecords, normalizeTemplate, normalizeVenue, readActiveVenueId, readLocalTemplates, readLocalVenues, readVenueBuildDraft, recordsChanged, VENUE_BUILD_DRAFT_KEY, writeLocalTemplates, writeLocalVenues, writeTemplateBuildDraft } from "../lib/venues";
import { isMemoryBlocked, memoryRejectedQuestionTexts, readQuestionMemory, saveQuestionMemoryToProfile, syncQuestionMemoryFromProfile, upsertQuestionMemory } from "../lib/questionMemory";
import { loadHostSetupSettings, profileKeys, saveHostSetupSettings, saveProfileValue, syncProfileJson, updateUserMetadata } from "../lib/profileState";

const questionTypes = [
  { value: "all", label: "All", shortLabel: "All", icon: List, color: "text-zinc-300" },
  { value: "true_false", label: "True/False", shortLabel: "T/F", icon: CheckCircle, color: "text-[#71E0DC]" },
  { value: "multiple_choice", label: "Multiple Choice", shortLabel: "MC", icon: List, color: "text-[#AEB2EF]" },
  { value: "written", label: "Written", shortLabel: "Write", icon: MessageSquare, color: "text-emerald-400" },
];
const convertibleQuestionTypes = questionTypes.filter((type) => type.value !== "all");
const questionTypeLabel = (value) => (questionTypes.find((type) => type.value === value)?.label || "Question");
const defaultRounds = [{ id: "round-1", name: "Round 1", description: "", questionIds: [] }, { id: "round-2", name: "Round 2", description: "", questionIds: [] }, { id: "round-3", name: "Round 3", description: "", questionIds: [] }];
const BUILD_STORAGE_KEY = "trivia-flex-round-builder-state-v5";
const metadataBuildKey = "quiz_crafter_active_build_v1";
const metadataBuildClearedKey = "quiz_crafter_active_build_cleared_at_v1";
const CATEGORY_PREF_KEY = "quiz-crafter-category-preferences";
const REJECTED_AI_KEY = "quiz-crafter-rejected-ai-questions";
const USED_QUESTIONS_KEY = "quiz-crafter-used-question-ids";
const UNUSED_QUESTIONS_KEY = "quiz-crafter-unused-question-ids";
const emptyWriteForm = { question_type: "written", category: "", question_text: "", correct_answer: "", incorrect_answers: ["", "", ""], fun_fact: "", image_url: "", image_timing: "initial" };
const defaultCoHostPrompt = "Look at this active round and suggest more playable, fresh questions using only my approved categories. Avoid obscure answers and give me question candidates I can actually use.";
const parseAnswerOptions = (value) => Array.isArray(value) ? value.map((x) => String(x).trim()).filter(Boolean) : typeof value === "string" ? value.split(";").map((x) => x.trim()).filter(Boolean) : [];
const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const fingerprint = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanList = (values) => values.map((value) => normalizeText(value)).filter(Boolean);
const lowerText = (value) => normalizeText(value).toLowerCase();
const parseQuestionNumber = (value) => {
  const match = lowerText(value).match(/\b(?:q|question)\s*#?\s*(\d+)\b/) || lowerText(value).match(/\breplace\s+(\d+)\b/) || lowerText(value).match(/\b(?:make|rewrite|improve|edit)\s+(?:this\s+)?(?:question\s*)?(\d+)\b/);
  return match ? Math.max(1, Number(match[1]) || 1) : null;
};
const parseRoundNumber = (value) => {
  const match = lowerText(value).match(/\bround\s*(\d+)\b/);
  return match ? Math.max(1, Number(match[1]) || 1) : null;
};
const parseRequestedCount = (value, fallback = 3) => {
  const match = lowerText(value).match(/\b(?:add|build|give|find|generate|make)\s+(\d{1,2})\b/) || lowerText(value).match(/\b(\d{1,2})\s+(?:questions|candidates|replacements)\b/);
  return Math.max(1, Math.min(20, match ? Number(match[1]) || fallback : fallback));
};
const parseRequestedType = (value, fallback = null) => {
  const text = lowerText(value);
  if (/\b(t\/f|true\s*\/?\s*false|true false)\b/.test(text)) return "true_false";
  if (/\b(mc|multiple choice|multiple-choice)\b/.test(text)) return "multiple_choice";
  if (/\b(written|free response|free-response|write in|write-in)\b/.test(text)) return "written";
  return fallback;
};
const classifyBuildIntent = (value) => {
  const text = lowerText(value);
  if (/\b(import|upload|pdf|csv)\b/.test(text)) return "import_file";
  if (/\bfull session|finish (?:the )?(?:session|game)|complete (?:the )?(?:session|game)\b/.test(text)) return "generate_full_session";
  if (/\bbuild\s+(?:this\s+)?round|fill\s+(?:this\s+)?round|finish\s+(?:this\s+)?round\b/.test(text)) return "generate_round";
  if (/\b(replace|replacement|replacements)\b/.test(text)) return "replace_question";
  if (/\b(search|find|library|saved question)\b/.test(text)) return "search_library";
  if (/\bfun fact|funfact\b/.test(text)) return "add_fun_fact";
  if (/\b(harder|more difficult|tougher)\b/.test(text)) return "make_harder";
  if (/\b(easier|less hard|less obscure|more gettable|too hard)\b/.test(text)) return "make_easier";
  if (/\b(rewrite|improve|clean up|polish|wording|make this|convert)\b/.test(text)) return "rewrite_question";
  if (/\b(add|generate|give me|make)\b/.test(text) && /\b(question|questions|candidate|candidates)\b/.test(text)) return "add_questions";
  if (/\b(review|feedback|what feels|missing|repetitive|cohost|co-host|help)\b/.test(text)) return "explain_or_cohost_feedback";
  return "general_help";
};
const createDefaultRounds = () => defaultRounds.map((round) => ({ ...round, questionIds: [...round.questionIds] }));
const normalizeRoundQuestionSettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return {
    points: Math.max(0, Number(source.points ?? source.defaultPoints ?? defaultQuestionSettings.points) || 0),
    timer_seconds: Math.max(0, Number(source.timer_seconds ?? source.timerSeconds ?? source.defaultTimer ?? defaultQuestionSettings.timer_seconds) || 0),
    wager_limit: Math.max(0, Number(source.wager_limit ?? source.wagerLimit ?? source.defaultWagerLimit ?? 0) || 0),
    wager_timing: normalizeWagerTiming(source.wager_timing || source.wagerTiming),
  };
};
const normalizeRounds = (value) => {
  const rounds = (Array.isArray(value) ? value : []).map((round, index) => {
    const questionIds = Array.isArray(round?.questionIds) ? round.questionIds.filter((id) => id !== null && id !== undefined) : [];
    const questionType = ["mixed", "true_false", "multiple_choice", "written"].includes(round?.questionType) ? round.questionType : "mixed";
    return { id: normalizeText(round?.id) || `round-${index + 1}`, name: normalizeText(round?.name) || `Round ${index + 1}`, description: normalizeText(round?.description), questionType, defaultQuestionSettings: round?.defaultQuestionSettings ? normalizeRoundQuestionSettings(round.defaultQuestionSettings) : null, questionIds };
  }).filter((round) => round.id);
  return rounds.length ? rounds : createDefaultRounds();
};
const uniqueCategories = (values, preferred = []) => dedupeCategories(values, preferred);
const readUsedIds = () => { try { const parsed = JSON.parse(localStorage.getItem(USED_QUESTIONS_KEY) || "[]"); return new Set(Array.isArray(parsed) ? parsed.map(String) : []); } catch { return new Set(); } };
const readUnusedIds = () => { try { const parsed = JSON.parse(localStorage.getItem(UNUSED_QUESTIONS_KEY) || "[]"); return new Set(Array.isArray(parsed) ? parsed.map(String) : []); } catch { return new Set(); } };
const writeUsedIds = (ids) => {
  const values = [...ids];
  localStorage.setItem(USED_QUESTIONS_KEY, JSON.stringify(values));
  saveProfileValue(profileKeys.usedQuestionIds, values).catch((error) => console.warn("Used question profile save unavailable:", error));
};
const isQuestionMarkedUsed = (question, usedIds) => usedIds.has(String(question?.id || "")) || question?.is_used === true || question?.used === true || Boolean(question?.used_at) || Number(question?.times_used || 0) > 0;
const normalizeType = (question, fallbackType = "written") => { const type = question?.question_type || fallbackType || "written"; return type === "true_false" || type === "multiple_choice" || type === "written" ? type : "written"; };
const normalizeImageTiming = (value) => value === "after_answer" || value === "after" ? "after_answer" : "initial";
const normalizeWagerTiming = (value) => value === "after_answer" || value === "after" ? "after_answer" : "before_answer";
const defaultQuestionSettings = { points: "", timer_seconds: 30, wager_limit: 0, wager_timing: "before_answer" };
const easierDifficulty = { host_hard: "medium", hard: "medium", medium: "easy", easy: "easy" };
const harderDifficulty = { easy: "medium", medium: "hard", hard: "host_hard", host_hard: "host_hard" };
const getQuestionSettings = (question) => ({ points: question?.points ?? question?.question_points ?? defaultQuestionSettings.points, timer_seconds: question?.timer_seconds ?? question?.time_limit ?? defaultQuestionSettings.timer_seconds, wager_limit: question?.wager_limit ?? question?.free_wager_limit ?? 0, wager_timing: normalizeWagerTiming(question?.wager_timing || question?.wagerTiming) });
const normalizeQuestion = (q, fallbackType, preferredCategories = []) => ({ ...q, id: q.id || q.local_id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`, question_text: normalizeText(q.question_text || q.question), correct_answer: normalizeText(q.correct_answer || q.answer), question_type: normalizeType(q, fallbackType), category: canonicalCategory(q.category, preferredCategories) || "General", incorrect_answers: q.incorrect_answers ?? null, options: parseAnswerOptions(q.incorrect_answers ?? q.options), fun_fact: normalizeText(q.fun_fact), image_url: q.image_url || "", image_prompt: q.image_prompt || "", image_timing: normalizeImageTiming(q.image_timing || q.image_display_timing), ...getQuestionSettings(q), isGenerated: Boolean(q.isGenerated) });
const safeQuestions = (value) => (Array.isArray(value) ? value : []).map((question) => question && typeof question === "object" ? normalizeQuestion(question, question.question_type) : null).filter(Boolean);
const getInitialActiveRoundId = (rounds, preferred) => {
  const preferredId = normalizeText(preferred);
  if (preferredId && rounds.some((round) => round.id === preferredId)) return preferredId;
  return rounds[0]?.id || "round-1";
};
const collectSessionQuestions = (session) => [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions].flatMap((value) => (Array.isArray(value) ? value : []));
const collectRecentSessionCategories = (sessions, limit = 6) => uniqueCategories((Array.isArray(sessions) ? sessions : []).slice(0, limit).flatMap((session) => collectSessionQuestions(session).map((question) => question?.category)));
const toSessionQuestion = (question, round, roundIndex, sourceOrder) => ({ category: question.category || "General", round_name: round.name, round_order: roundIndex + 1, round_description: round.description || "", source_order: sourceOrder + 1, import_order: sourceOrder + 1, question_text: question.question_text, correct_answer: question.correct_answer, question_type: normalizeType(question), incorrect_answers: Array.isArray(question.options) && question.options.length ? question.options.join("; ") : question.incorrect_answers || null, fun_fact: question.fun_fact || null, image_url: question.image_url || null, image_timing: normalizeImageTiming(question.image_timing), ...getQuestionSettings(question) });
const getSessionQuestionOrder = (question, fallback = 1) => Number(question?.import_order || question?.source_order || question?.question_order || question?.order || fallback) || fallback;
const getSessionRoundOrder = (question, fallback = 1) => Number(question?.round_order || question?.round_number || question?.round || fallback) || fallback;
const getSessionRoundName = (question, fallback = 1) => question?.round_name || question?.round_title || `Round ${getSessionRoundOrder(question, fallback)}`;
const getSessionRoundMetadata = (session) => {
  const raw = session?.round_descriptions || session?.rounds_metadata || session?.rounds || [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
};
const getSavedRoundDescription = (session, roundOrder, roundName) => {
  const metadata = getSessionRoundMetadata(session);
  const match = metadata.find((round) => Number(round.order || round.round_order) === Number(roundOrder) || String(round.name || round.round_name || "").toLowerCase() === String(roundName || "").toLowerCase());
  return normalizeText(match?.description || match?.round_description);
};
const buildStateFromSavedSession = (session) => {
  const entries = [
    ["true_false", session?.true_false_questions],
    ["multiple_choice", session?.multiple_choice_questions],
    ["written", session?.written_questions],
    ["picture", session?.picture_questions],
  ].flatMap(([type, items]) => (Array.isArray(items) ? items : []).map((question, index) => {
    const roundOrder = getSessionRoundOrder(question, 1);
    return {
      type,
      question,
      index,
      roundOrder,
      roundName: getSessionRoundName(question, roundOrder),
      sourceOrder: getSessionQuestionOrder(question, index + 1),
    };
  })).sort((a, b) => a.roundOrder - b.roundOrder || a.sourceOrder - b.sourceOrder);
  const roundMap = new Map();
  const questions = entries.map((entry) => {
    const id = `session-${session.id}-${entry.type}-${entry.index}`;
    const roundKey = `${entry.roundOrder}-${entry.roundName}`;
    const roundDescription = normalizeText(entry.question?.round_description) || getSavedRoundDescription(session, entry.roundOrder, entry.roundName);
    if (!roundMap.has(roundKey)) roundMap.set(roundKey, { id: `round-${entry.roundOrder}-${fingerprint(entry.roundName) || entry.roundOrder}`, name: entry.roundName, description: roundDescription, questionIds: [] });
    else if (!roundMap.get(roundKey).description && roundDescription) roundMap.get(roundKey).description = roundDescription;
    roundMap.get(roundKey).questionIds.push(id);
    return normalizeQuestion({ ...entry.question, id, question_type: entry.type === "picture" ? "written" : entry.type, image_url: entry.question?.image_url || entry.question?.media_url || "", image_timing: entry.question?.image_timing || entry.question?.image_display_timing }, entry.type);
  });
  const rounds = [...roundMap.values()];
  return { questions, rounds: rounds.length ? rounds : createDefaultRounds(), activeRoundId: rounds[0]?.id || defaultRounds[0].id };
};
const newRoundId = () => `round-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const loadLocalCategoryPrefs = () => { try { const parsed = JSON.parse(localStorage.getItem(CATEGORY_PREF_KEY) || "{}"); return { approved: uniqueCategories(Array.isArray(parsed.approved) ? parsed.approved : []), rejected: uniqueCategories(Array.isArray(parsed.rejected) ? parsed.rejected : []) }; } catch { return { approved: [], rejected: [] }; } };
const saveLocalCategoryPrefs = (approved, rejected) => {
  const prefs = { approved: uniqueCategories([...approved]), rejected: uniqueCategories([...rejected]) };
  localStorage.setItem(CATEGORY_PREF_KEY, JSON.stringify(prefs));
  saveProfileValue(profileKeys.categoryPrefs, prefs).catch((error) => console.warn("Category profile save unavailable:", error));
};
const loadRejectedAi = () => { try { return new Set(JSON.parse(localStorage.getItem(REJECTED_AI_KEY) || "[]")); } catch { return new Set(); } };
const saveRejectedAi = (values) => {
  const list = [...values];
  localStorage.setItem(REJECTED_AI_KEY, JSON.stringify(list));
  saveProfileValue(profileKeys.rejectedAi, list).catch((error) => console.warn("Rejected AI profile save unavailable:", error));
};
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
const todayInputDate = () => new Date().toISOString().slice(0, 10);
const formatSessionDate = (value) => { const [year, month, day] = String(value || "").split("-"); return year && month && day ? `${Number(month)}.${Number(day)}.${year}` : new Date().toLocaleDateString(); };
const venueDisplayName = (venue) => venue?.nightName || venue?.name || "";
const buildAutoSessionName = (date, venue) => [formatSessionDate(date), venueDisplayName(venue) || "Trivia"].filter(Boolean).join(" ");
const normalizeBuildSavedState = (value) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const savedQuestions = safeQuestions(parsed.questions);
    const savedRounds = normalizeRounds(parsed.rounds);
    const activeRoundId = getInitialActiveRoundId(savedRounds, parsed.activeRoundId);
    return { ...parsed, questions: savedQuestions, rounds: savedRounds, activeRoundId, typeFilter: parsed.typeFilter === "picture" ? "all" : parsed.typeFilter, generateType: parsed.generateType === "picture" ? "written" : parsed.generateType };
  } catch {
    return null;
  }
};
const loadBuildSavedState = () => {
  const saved = localStorage.getItem(BUILD_STORAGE_KEY) || localStorage.getItem("trivia-flex-round-builder-state-v4") || localStorage.getItem("trivia-flex-round-builder-state-v3") || localStorage.getItem("trivia-flex-round-builder-state-v2");
  return saved ? normalizeBuildSavedState(saved) : null;
};
const isDefaultRoundShell = (round, index) => !normalizeText(round?.description)
  && !(round?.questionIds || []).length
  && !round?.defaultQuestionSettings
  && normalizeText(round?.name) === `Round ${index + 1}`;
const hasBuildContent = (state) => {
  const questions = safeQuestions(state?.questions);
  const rounds = normalizeRounds(state?.rounds);
  return Boolean(
    normalizeText(state?.theme)
    || questions.length
    || rounds.some((round, index) => !isDefaultRoundShell(round, index))
  );
};
const buildStateUpdatedAt = (state) => {
  const time = new Date(state?.updatedAt || 0).getTime();
  return Number.isNaN(time) || time <= 0 ? (hasBuildContent(state) ? 1 : 0) : time;
};
const createBuildSnapshot = ({ sessionName, sessionDate, selectedVenueId, rounds, activeRoundId, theme, difficulty, typeFilter, generateType, generateCount, includeImageIdeas, questions }) => {
  const draftRounds = normalizeRounds(rounds);
  const draftQuestions = safeQuestions(questions);
  const selectedIdsForDraft = new Set(draftRounds.flatMap((round) => round.questionIds || []).map(String));
  return {
    sessionName,
    sessionDate,
    venueId: selectedVenueId,
    rounds: draftRounds,
    activeRoundId: getInitialActiveRoundId(draftRounds, activeRoundId),
    theme,
    difficulty,
    typeFilter,
    generateType,
    generateCount,
    includeImageIdeas,
    questions: draftQuestions.filter((question) => selectedIdsForDraft.has(String(question.id))),
    updatedAt: new Date().toISOString(),
  };
};

const BuildSession = () => {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { user } = useAuth();
  const savedState = useMemo(() => (sessionId ? null : loadBuildSavedState()), [sessionId]);
  const venueDraft = useMemo(() => (sessionId || savedState ? null : readVenueBuildDraft()), [sessionId, savedState]);
  const initialRounds = useMemo(() => normalizeRounds(savedState?.rounds || venueDraft?.rounds || createDefaultRounds()), [savedState, venueDraft]);
  const initialQuestions = useMemo(() => safeQuestions(savedState?.questions), [savedState]);
  const draftQuestionDefaults = venueDraft?.defaultQuestionSettings && typeof venueDraft.defaultQuestionSettings === "object" ? venueDraft.defaultQuestionSettings : null;
  const initialPrefs = loadLocalCategoryPrefs();
  const [sessionName, setSessionName] = useState(savedState?.sessionName || venueDraft?.sessionName || "");
  const [sessionDate, setSessionDate] = useState(savedState?.sessionDate || venueDraft?.sessionDate || todayInputDate());
  const [selectedVenueId, setSelectedVenueId] = useState(savedState?.venueId || venueDraft?.venueId || readActiveVenueId() || "");
  const [rounds, setRounds] = useState(initialRounds);
  const [activeRoundId, setActiveRoundId] = useState(getInitialActiveRoundId(initialRounds, savedState?.activeRoundId || venueDraft?.activeRoundId));
  const [roundMenuOpen, setRoundMenuOpen] = useState(false);
  const [questions, setQuestions] = useState(initialQuestions);
  const [usedFingerprints, setUsedFingerprints] = useState(new Set());
  const [usedQuestionIds, setUsedQuestionIds] = useState(readUsedIds);
  const [unusedQuestionIds, setUnusedQuestionIds] = useState(readUnusedIds);
  const [rejectedAi, setRejectedAi] = useState(loadRejectedAi);
  const [questionMemory, setQuestionMemory] = useState(readQuestionMemory);
  const [approvedCategories, setApprovedCategories] = useState(initialPrefs.approved);
  const [rejectedCategories, setRejectedCategories] = useState(initialPrefs.rejected);
  const [recentSessionCategories, setRecentSessionCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState(savedState?.theme || venueDraft?.theme || "");
  const [difficulty, setDifficulty] = useState(savedState?.difficulty || "medium");
  const [typeFilter, setTypeFilter] = useState(savedState?.typeFilter || "all");
  const [generateType, setGenerateType] = useState(savedState?.generateType || "multiple_choice");
  const [generateCount, setGenerateCount] = useState(savedState?.generateCount || "3");
  const [includeImageIdeas, setIncludeImageIdeas] = useState(Boolean(savedState?.includeImageIdeas));
  const [generating, setGenerating] = useState(false);
  const [draftGenerating, setDraftGenerating] = useState(false);
  const [actionQuestionId, setActionQuestionId] = useState(null);
  const [aiActionId, setAiActionId] = useState(null);
  const [aiCandidates, setAiCandidates] = useState([]);
  const [showWriteForm, setShowWriteForm] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showCoHost, setShowCoHost] = useState(false);
  const [cohostPrompt, setCohostPrompt] = useState(defaultCoHostPrompt);
  const [cohostLoading, setCohostLoading] = useState(false);
  const [cohostAnswer, setCohostAnswer] = useState("");
  const [cohostMessages, setCohostMessages] = useState([]);
  const [cohostCandidates, setCohostCandidates] = useState([]);
  const [builderChatInput, setBuilderChatInput] = useState("");
  const [builderChatMessages, setBuilderChatMessages] = useState([]);
  const [builderChatLoading, setBuilderChatLoading] = useState(false);
  const [builderUndoSnapshot, setBuilderUndoSnapshot] = useState(null);
  const [chatPreview, setChatPreview] = useState(null);
  const [writeForm, setWriteForm] = useState(emptyWriteForm);
  const [mediaQuestionId, setMediaQuestionId] = useState(null);
  const [settingsQuestionId, setSettingsQuestionId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(sessionId || null);
  const [editingSessionWasPast, setEditingSessionWasPast] = useState(false);
  const [templates, setTemplates] = useState(() => readLocalTemplates());
  const [venues, setVenues] = useState(() => readLocalVenues());
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => readLocalTemplates()[0]?.id || "");
  const [profileBuildHydrated, setProfileBuildHydrated] = useState(Boolean(sessionId));
  const selectedVenue = useMemo(() => venues.find((venue) => venue.id === selectedVenueId) || null, [venues, selectedVenueId]);

  useEffect(() => { setProfileBuildHydrated(Boolean(sessionId)); }, [sessionId]);
  useEffect(() => {
    const syncHostPreferences = async () => {
      try {
        const [prefs, rejected, used, unused, memory] = await Promise.all([
          syncProfileJson({ localKey: CATEGORY_PREF_KEY, profileKey: profileKeys.categoryPrefs, fallback: { approved: [], rejected: [] }, merge: "categoryPrefs" }),
          syncProfileJson({ localKey: REJECTED_AI_KEY, profileKey: profileKeys.rejectedAi, fallback: [], merge: "array" }),
          syncProfileJson({ localKey: USED_QUESTIONS_KEY, profileKey: profileKeys.usedQuestionIds, fallback: [], merge: "array" }),
          syncProfileJson({ localKey: UNUSED_QUESTIONS_KEY, profileKey: profileKeys.unusedQuestionIds, fallback: [], merge: "array" }),
          syncQuestionMemoryFromProfile(supabase),
        ]);
        setApprovedCategories(uniqueCategories(Array.isArray(prefs.approved) ? prefs.approved : []));
        setRejectedCategories(uniqueCategories(Array.isArray(prefs.rejected) ? prefs.rejected : []));
        setRejectedAi(new Set(Array.isArray(rejected) ? rejected : []));
        setUsedQuestionIds(new Set(Array.isArray(used) ? used.map(String) : []));
        setUnusedQuestionIds(new Set(Array.isArray(unused) ? unused.map(String) : []));
        setQuestionMemory(memory);
      } catch (error) {
        console.warn("Host preference profile sync unavailable:", error);
      }
    };
    syncHostPreferences();
  }, []);
  useEffect(() => {
    if (sessionId || editingSessionId || loading) return;
    const snapshot = createBuildSnapshot({ sessionName, sessionDate, selectedVenueId, rounds, activeRoundId, theme, difficulty, typeFilter, generateType, generateCount, includeImageIdeas, questions });
    if (!hasBuildContent(snapshot)) return;
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(snapshot));
    const saveTimer = window.setTimeout(async () => {
      try {
        await updateUserMetadata({ [metadataBuildKey]: snapshot, [metadataBuildClearedKey]: null });
      } catch (error) {
        console.warn("Build profile autosave unavailable:", error);
      }
    }, 900);
    return () => window.clearTimeout(saveTimer);
  }, [sessionId, editingSessionId, loading, sessionName, sessionDate, selectedVenueId, rounds, activeRoundId, theme, difficulty, typeFilter, generateType, generateCount, includeImageIdeas, questions]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchBuilderData(); }, [sessionId]);
  useEffect(() => { if (!loading) setSessionName((current) => current.trim() ? current : buildAutoSessionName(sessionDate, selectedVenue)); }, [sessionDate, selectedVenue, loading]);
  const clearSavedState = async () => {
    localStorage.removeItem(BUILD_STORAGE_KEY);
    localStorage.removeItem("trivia-flex-round-builder-state-v4");
    localStorage.removeItem("trivia-flex-round-builder-state-v3");
    localStorage.removeItem("trivia-flex-round-builder-state-v2");
    localStorage.removeItem(VENUE_BUILD_DRAFT_KEY);
    try {
      await updateUserMetadata({ [metadataBuildKey]: null, [metadataBuildClearedKey]: new Date().toISOString() });
    } catch (error) {
      console.warn("Build profile clear unavailable:", error);
    }
  };
  const applySavedBuildState = (state) => {
    const cleanState = normalizeBuildSavedState(state);
    if (!cleanState || !hasBuildContent(cleanState)) return false;
    const cleanRounds = normalizeRounds(cleanState.rounds);
    const cleanQuestions = safeQuestions(cleanState.questions);
    setSessionName(cleanState.sessionName || "");
    setSessionDate(cleanState.sessionDate || todayInputDate());
    setSelectedVenueId(cleanState.venueId || "");
    setRounds(cleanRounds);
    setActiveRoundId(getInitialActiveRoundId(cleanRounds, cleanState.activeRoundId));
    setTheme(cleanState.theme || "");
    setDifficulty(cleanState.difficulty || "medium");
    setTypeFilter(cleanState.typeFilter || "all");
    setGenerateType(cleanState.generateType || "multiple_choice");
    setGenerateCount(cleanState.generateCount || "3");
    setIncludeImageIdeas(Boolean(cleanState.includeImageIdeas));
    setQuestions((current) => {
      const restoredIds = new Set(cleanQuestions.map((question) => String(question.id)));
      return [...cleanQuestions, ...current.filter((question) => !restoredIds.has(String(question.id)))];
    });
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(cleanState));
    return true;
  };
  useEffect(() => {
    if (sessionId || loading || profileBuildHydrated) return;
    const hydrateProfileBuild = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const remoteState = normalizeBuildSavedState(data?.user?.user_metadata?.[metadataBuildKey]);
        const clearedAt = new Date(data?.user?.user_metadata?.[metadataBuildClearedKey] || 0).getTime() || 0;
        const localState = loadBuildSavedState();
        const remoteIsFresh = remoteState && hasBuildContent(remoteState) && buildStateUpdatedAt(remoteState) > clearedAt;
        const localIsFresh = localState && hasBuildContent(localState) && buildStateUpdatedAt(localState) > clearedAt;
        if (remoteIsFresh && (!localIsFresh || buildStateUpdatedAt(remoteState) >= buildStateUpdatedAt(localState))) {
          applySavedBuildState(remoteState);
        } else if (localIsFresh) {
          await updateUserMetadata({ [metadataBuildKey]: localState, [metadataBuildClearedKey]: null });
        }
      } catch (error) {
        console.warn("Build profile restore unavailable:", error);
      } finally {
        setProfileBuildHydrated(true);
      }
    };
    hydrateProfileBuild();
  }, [sessionId, loading, profileBuildHydrated]);
  const handleBrowseLibrary = () => { setUsedQuestionIds(readUsedIds()); setUnusedQuestionIds(readUnusedIds()); setQuestionMemory(readQuestionMemory()); setShowLibrary(true); setShowWriteForm(false); setShowAiPanel(false); };
  useEffect(() => { localStorage.removeItem("quiz-crafter-build-recovery-attempted"); }, []);
  useEffect(() => {
    const syncSetup = async () => {
      const localTemplates = readLocalTemplates();
      const localVenues = readLocalVenues();
      setTemplates(localTemplates);
      setVenues(localVenues);
      setSelectedTemplateId((current) => current || localTemplates[0]?.id || "");
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const metadata = data?.user?.user_metadata || {};
        const setupSettings = await loadHostSetupSettings().catch(() => ({}));
        const setupTemplates = Array.isArray(setupSettings.templates) ? setupSettings.templates.map(normalizeTemplate) : [];
        const setupVenues = Array.isArray(setupSettings.venues) ? setupSettings.venues.map(normalizeVenue) : [];
        const remoteTemplates = Array.isArray(metadata[PROFILE_SHOW_TEMPLATES_KEY]) ? metadata[PROFILE_SHOW_TEMPLATES_KEY].map(normalizeTemplate) : [];
        const remoteVenues = Array.isArray(metadata[PROFILE_VENUES_KEY]) ? metadata[PROFILE_VENUES_KEY].map(normalizeVenue) : [];
        const savedLocalTemplates = hasSavedLocalTemplates() ? localTemplates : [];
        const mergedTemplates = mergeProfileRecords([...setupTemplates, ...remoteTemplates], savedLocalTemplates, normalizeTemplate);
        const mergedVenues = mergeProfileRecords([...setupVenues, ...remoteVenues], localVenues, normalizeVenue);
        if (mergedTemplates.length) {
          setTemplates(mergedTemplates);
          writeLocalTemplates(mergedTemplates);
          setSelectedTemplateId((current) => current || mergedTemplates[0]?.id || "");
        }
        if (mergedVenues.length) {
          setVenues(mergedVenues);
          writeLocalVenues(mergedVenues);
        }
        const profilePatch = {};
        if (mergedTemplates.length && recordsChanged(remoteTemplates, mergedTemplates)) profilePatch[PROFILE_SHOW_TEMPLATES_KEY] = mergedTemplates;
        if (mergedVenues.length && recordsChanged(remoteVenues, mergedVenues)) profilePatch[PROFILE_VENUES_KEY] = mergedVenues;
        if (Object.keys(profilePatch).length) await updateUserMetadata(profilePatch);
        if ((mergedTemplates.length && recordsChanged(setupTemplates, mergedTemplates)) || (mergedVenues.length && recordsChanged(setupVenues, mergedVenues))) {
          await saveHostSetupSettings({ templates: mergedTemplates, venues: mergedVenues });
        }
      } catch (error) {
        console.warn("Builder host setup sync unavailable:", error);
      }
    };
    syncSetup();
  }, []);

  const fetchBuilderData = async () => { try { setLoading(true); const [questionsResult, sessionsResult] = await Promise.all([supabase.from("questions").select("*").order("created_at", { ascending: false }), supabase.from("sessions").select("*").order("created_at", { ascending: false })]); if (questionsResult.error) throw questionsResult.error; if (sessionsResult.error) throw sessionsResult.error; const sessions = sessionsResult.data || []; const sessionToEdit = sessionId ? sessions.find((session) => String(session.id) === String(sessionId)) : null; if (sessionId && !sessionToEdit) throw new Error("Saved session not found"); const referenceSessions = sessions.filter((session) => !sessionToEdit || String(session.id) !== String(sessionToEdit.id)); const localUsed = readUsedIds(); const localUnused = readUnusedIds(); const used = new Set(); referenceSessions.forEach((session) => { collectSessionQuestions(session).forEach((question) => { const text = question?.question_text || question?.question; if (text) used.add(fingerprint(text)); }); }); (questionsResult.data || []).forEach((question) => { if (!localUnused.has(String(question.id)) && isQuestionMarkedUsed(question, localUsed)) used.add(fingerprint(question.question_text)); }); const prefs = loadLocalCategoryPrefs(); const approved = new Set(uniqueCategories(prefs.approved)); const rejected = new Set(uniqueCategories(prefs.rejected)); (questionsResult.data || []).forEach((question) => { const category = canonicalCategory(question.category, [...approved, ...rejected]); if (category && ![...rejected].some((item) => categoryKey(item) === categoryKey(category))) approved.add(category); }); setUsedQuestionIds(localUsed); setUnusedQuestionIds(localUnused); setQuestionMemory(readQuestionMemory()); setUsedFingerprints(used); setApprovedCategories(uniqueCategories([...approved]).sort((a, b) => a.localeCompare(b))); setRejectedCategories(uniqueCategories([...rejected])); setRecentSessionCategories(collectRecentSessionCategories(referenceSessions)); const libraryQuestions = safeQuestions(questionsResult.data); if (sessionToEdit) { const builderState = buildStateFromSavedSession(sessionToEdit); setEditingSessionId(sessionToEdit.id); setEditingSessionWasPast(Boolean(sessionToEdit.is_past)); setSessionName(sessionToEdit.name || sessionToEdit.session_name || "Untitled Session"); setSessionDate(String(sessionToEdit.session_date || sessionToEdit.event_date || "").slice(0, 10) || savedState?.sessionDate || todayInputDate()); setSelectedVenueId(sessionToEdit.venue_id || savedState?.venueId || venueDraft?.venueId || ""); setRounds(builderState.rounds); setActiveRoundId(builderState.activeRoundId); setQuestions([...builderState.questions, ...libraryQuestions]); await clearSavedState(); } else { setEditingSessionId(null); setEditingSessionWasPast(false); setQuestions([...safeQuestions(savedState?.questions), ...libraryQuestions]); } } catch (error) { console.error("Build session load error:", error); toast.error(error.message || "Failed to load builder"); if (sessionId) navigate("/past-sessions"); } finally { setLoading(false); } };
  const safeRounds = useMemo(() => normalizeRounds(rounds), [rounds]);
  const normalizedQuestions = useMemo(() => safeQuestions(questions), [questions]);
  const questionById = useMemo(() => new Map(normalizedQuestions.map((q) => [String(q.id), q])), [normalizedQuestions]);
  const activeRound = safeRounds.find((round) => round.id === activeRoundId) || safeRounds[0] || defaultRounds[0];
  const selectedIds = useMemo(() => new Set(safeRounds.flatMap((round) => round.questionIds || []).map(String)), [safeRounds]);
  const activeRoundQuestions = useMemo(() => (activeRound?.questionIds || []).map((id) => questionById.get(String(id))).filter(Boolean), [activeRound, questionById]);
  const selectedSessionCategories = useMemo(() => uniqueCategories(safeRounds.flatMap((round) => (round.questionIds || []).map((id) => questionById.get(String(id))?.category))), [safeRounds, questionById]);
  const mediaQuestion = mediaQuestionId ? questionById.get(String(mediaQuestionId)) : null;
  const settingsQuestion = settingsQuestionId ? questionById.get(String(settingsQuestionId)) : null;
  const availableQuestions = useMemo(() => { const query = searchQuery.trim().toLowerCase(); return normalizedQuestions.filter((question) => { const type = normalizeType(question); const id = String(question.id); const selected = selectedIds.has(id); const manuallyUnused = unusedQuestionIds.has(id); const blockedByMemory = !manuallyUnused && isMemoryBlocked(question, questionMemory); const used = !manuallyUnused && (isQuestionMarkedUsed(question, usedQuestionIds) || usedFingerprints.has(fingerprint(question.question_text))); if (typeFilter !== "all" && type !== typeFilter) return false; if (rejectedAi.has(fingerprint(question.question_text))) return false; if ((used || blockedByMemory) && !selected) return false; if (!query) return true; return [question.question_text, question.correct_answer, question.category, question.fun_fact].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)); }); }, [normalizedQuestions, questionMemory, rejectedAi, searchQuery, selectedIds, typeFilter, usedFingerprints, usedQuestionIds, unusedQuestionIds]);
  const handleAddRound = () => { const round = { id: newRoundId(), name: `Round ${rounds.length + 1}`, description: "", questionIds: [] }; setRounds((prev) => [...prev, round]); setActiveRoundId(round.id); };
  const handleDeleteRound = (roundId) => { if (rounds.length === 1) return toast.error("Keep at least one round"); const nextRound = rounds.find((round) => round.id !== roundId) || rounds[0]; setRounds((prev) => prev.filter((round) => round.id !== roundId)); if (activeRoundId === roundId) setActiveRoundId(nextRound.id); };
  const handleRenameRound = (roundId, name) => setRounds((prev) => prev.map((round) => (round.id === roundId ? { ...round, name } : round)));
  const handleDescribeRound = (roundId, description) => setRounds((prev) => prev.map((round) => (round.id === roundId ? { ...round, description } : round)));
  const toggleQuestion = (question) => setRounds((prev) => prev.map((round) => { if (round.id !== activeRound.id) return round; const current = round.questionIds || []; if (current.map(String).includes(String(question.id))) return { ...round, questionIds: current.filter((id) => String(id) !== String(question.id)) }; return { ...round, questionIds: [...current, question.id] }; }));
  const removeFromRound = (roundId, questionId) => setRounds((prev) => prev.map((round) => round.id === roundId ? { ...round, questionIds: (round.questionIds || []).filter((id) => String(id) !== String(questionId)) } : round));
  const moveQuestionWithinRound = (roundId, questionId, direction) => setRounds((prev) => prev.map((round) => { if (round.id !== roundId) return round; const ids = [...(round.questionIds || [])]; const index = ids.findIndex((id) => String(id) === String(questionId)); const nextIndex = index + direction; if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return round; [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]; return { ...round, questionIds: ids }; }));
  const moveQuestionToRound = (questionId, targetRoundId) => { if (!targetRoundId || targetRoundId === activeRound.id) return; setRounds((prev) => prev.map((round) => { const ids = (round.questionIds || []).filter((id) => String(id) !== String(questionId)); if (round.id === targetRoundId) ids.push(questionId); return { ...round, questionIds: ids }; })); };
  const updateQuestion = (questionId, patch) => setQuestions((prev) => prev.map((question) => String(question.id) === String(questionId) ? normalizeQuestion({ ...question, ...patch }, question.question_type, approvedCategories) : question));
  const applyDraftDefaults = (question, round = activeRound) => { const roundDefaults = round?.defaultQuestionSettings || draftQuestionDefaults; return normalizeQuestion({ ...question, points: question.points === "" || question.points === null || question.points === undefined ? (roundDefaults?.points ?? question.points) : question.points, timer_seconds: question.timer_seconds === null || question.timer_seconds === undefined ? (roundDefaults?.timer_seconds ?? question.timer_seconds) : question.timer_seconds, wager_limit: question.wager_limit === null || question.wager_limit === undefined ? (roundDefaults?.wager_limit ?? question.wager_limit) : question.wager_limit, wager_timing: question.wager_timing || roundDefaults?.wager_timing }, question.question_type); };
  const applyQuestionSettings = (questionId, patch, scope) => {
    const selectedRoundIds = new Set(activeRound.questionIds || []);
    const selectedAllIds = new Set(rounds.flatMap((round) => round.questionIds || []));
    setQuestions((prev) => prev.map((question) => {
      const id = String(question.id);
      const shouldApply = scope === "all" ? selectedAllIds.has(question.id) || selectedAllIds.has(id) : scope === "round" ? selectedRoundIds.has(question.id) || selectedRoundIds.has(id) : id === String(questionId);
      return shouldApply ? normalizeQuestion({ ...question, ...patch }, question.question_type, approvedCategories) : question;
    }));
    toast.success(scope === "all" ? "Settings applied to all selected questions" : scope === "round" ? `Settings applied to ${activeRound.name}` : "Question settings saved");
  };
  const buildAiSessionContext = () => {
    const questionSummary = (question, round) => ({
      category: question?.category || "",
      question_text: question?.question_text || "",
      correct_answer: question?.correct_answer || "",
      question_type: normalizeType(question),
      round: round?.name || "",
    });
    const builtQuestions = safeRounds.flatMap((round) => (round.questionIds || []).map((id) => questionSummary(questionById.get(String(id)), round)).filter((question) => question.question_text && question.correct_answer));
    const activeRoundBuilt = (activeRound?.questionIds || []).map((id) => questionSummary(questionById.get(String(id)), activeRound)).filter((question) => question.question_text && question.correct_answer);
    const roundDescriptions = safeRounds.map((round) => ({
      name: round.name || "",
      description: round.description || "",
      categories: uniqueCategories((round.questionIds || []).map((id) => questionById.get(String(id))?.category)),
    }));
    return {
      sessionName,
      activeRoundName: activeRound?.name || "",
      activeRoundDescription: activeRound?.description || "",
      categories: selectedSessionCategories,
      roundDescriptions,
      activeRoundQuestions: activeRoundBuilt,
      builtQuestions,
    };
  };
  const buildApprovedCategoryScope = ({ softExclusions = [], lockedCategories = [] } = {}) => {
    const locked = uniqueCategories(lockedCategories);
    const lockedKeys = new Set(locked.map(categoryKey));
    const hardExcluded = uniqueCategories(rejectedCategories).filter((category) => !lockedKeys.has(categoryKey(category)));
    const hardKeys = new Set(hardExcluded.map(categoryKey));
    const soft = uniqueCategories(softExclusions).filter((category) => !hardKeys.has(categoryKey(category)) && !lockedKeys.has(categoryKey(category)));
    if (!approvedCategories.length) return { excludedCategories: uniqueCategories([...hardExcluded, ...soft]), approvedPool: locked };
    const availableApproved = approvedCategories.filter((category) => !hardKeys.has(categoryKey(category)));
    const preferredApproved = availableApproved.filter((category) => !soft.some((excluded) => categoryKey(excluded) === categoryKey(category)));
    const pool = locked.length ? locked : (preferredApproved.length ? preferredApproved : availableApproved);
    const poolKeys = new Set(pool.map(categoryKey));
    const activeSoftExclusions = preferredApproved.length ? soft.filter((category) => !poolKeys.has(categoryKey(category))) : [];
    return { excludedCategories: uniqueCategories([...hardExcluded, ...activeSoftExclusions]), approvedPool: uniqueCategories(pool) };
  };
  const handleSaveQuestionToLibrary = async (question) => { if (!user?.id) { toast.error("You must be signed in"); return false; } const type = normalizeType(question); const basePayload = { user_id: user.id, question_text: question.question_text, correct_answer: question.correct_answer, question_type: type, category: question.category || "", incorrect_answers: Array.isArray(question.options) && question.options.length ? question.options.join("; ") : question.incorrect_answers || null, fun_fact: question.fun_fact || null, image_url: question.image_url || null }; const attempts = [basePayload, (({ image_url, ...rest }) => rest)(basePayload), (({ image_url, fun_fact, ...rest }) => rest)(basePayload), (({ image_url, fun_fact, incorrect_answers, ...rest }) => rest)(basePayload)]; try { let saved = null; let lastError = null; for (const payload of attempts) { const { data, error } = await supabase.from("questions").insert(payload).select("*").single(); if (!error) { saved = data; break; } lastError = error; if (!String(error.message || "").includes("column")) break; } if (!saved) throw lastError || new Error("Failed to save question"); setQuestions((prev) => [normalizeQuestion(saved, saved.question_type, approvedCategories), ...prev]); toast.success("Saved to library"); return true; } catch (error) { console.error("Save question to library error:", error); toast.error(error.message || "Failed to save to library"); return false; } };
  const handleAddCustomQuestion = () => { const type = normalizeType(writeForm); const questionText = normalizeText(writeForm.question_text); const correctAnswer = normalizeText(writeForm.correct_answer); const category = normalizeText(writeForm.category); const wrongAnswers = cleanList(writeForm.incorrect_answers).filter((answer) => answer.toLowerCase() !== correctAnswer.toLowerCase()); if (!questionText || !correctAnswer || !category) return toast.error("Question, category, and answer are required"); if (type === "multiple_choice" && wrongAnswers.length < 2) return toast.error("Add at least two wrong answers for multiple choice"); const normalizedAnswer = type === "true_false" ? (correctAnswer.toLowerCase() === "false" ? "False" : "True") : correctAnswer; const newQuestion = applyDraftDefaults(normalizeQuestion({ id: `custom-${Date.now()}`, question_type: type, category, question_text: questionText, correct_answer: normalizedAnswer, incorrect_answers: type === "multiple_choice" ? wrongAnswers.join("; ") : type === "true_false" ? (normalizedAnswer === "False" ? "True" : "False") : null, fun_fact: writeForm.fun_fact, image_url: writeForm.image_url, image_timing: writeForm.image_timing }, type, approvedCategories)); setQuestions((prev) => [newQuestion, ...prev]); setRounds((prev) => prev.map((round) => round.id === activeRound.id ? { ...round, questionIds: [...(round.questionIds || []), newQuestion.id] } : round)); setWriteForm(emptyWriteForm); setShowWriteForm(false); toast.success("Question added to round"); };
  const requestGeneratedQuestions = async ({ replacement = null, rejectCurrent = false, difficultyOverride = null, themeOverride = null, allowCurrentCategory = false, lockedCategoriesOverride = [], typeOverride = null, countOverride = null, roundOverride = null, avoidDuplicatesOverride = true } = {}) => { const targetRound = roundOverride || activeRound; const count = replacement ? 1 : Math.max(1, Math.min(20, Number(countOverride ?? generateCount) || 3)); const type = typeOverride || (replacement ? normalizeType(replacement) : generateType); const latestMemory = readQuestionMemory(); setQuestionMemory(latestMemory); const rejectedQuestions = new Set([...rejectedAi, ...memoryRejectedQuestionTexts(latestMemory)]); if (rejectCurrent && replacement?.question_text) rejectedQuestions.add(replacement.question_text); const categoryExclusions = allowCurrentCategory && replacement ? selectedSessionCategories.filter((category) => categoryKey(category) !== categoryKey(replacement.category)) : selectedSessionCategories; const { excludedCategories, approvedPool } = buildApprovedCategoryScope({ softExclusions: categoryExclusions, lockedCategories: lockedCategoriesOverride }); return axios.post("/api/generate-session-candidates", { sessionId: `build-${targetRound.id}`, questionType: type, count, difficulty: difficultyOverride || difficulty, theme: themeOverride ?? theme, excludeUsed: true, avoidDuplicates: avoidDuplicatesOverride, includeImagePrompt: false, excludeCategories: excludedCategories, approvedCategories: approvedPool, rejectedCategories, lockedCategories: uniqueCategories(lockedCategoriesOverride), rejectedQuestions: [...rejectedQuestions], sessionContext: buildAiSessionContext() }, { timeout: 90000 }); };
  const normalizeGeneratedCandidates = (candidates, roundId, fallbackType) => (Array.isArray(candidates) ? candidates : []).map((candidate, index) => applyDraftDefaults(normalizeQuestion({ ...candidate, id: `ai-${roundId}-${Date.now()}-${index}`, question_type: candidate.question_type || fallbackType, isGenerated: true }, fallbackType, approvedCategories)));
  const normalizeCoHostCandidates = (candidates) => (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const type = normalizeType(candidate, generateType);
    return applyDraftDefaults(normalizeQuestion({ ...candidate, id: `cohost-${activeRound.id}-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`, question_type: type, isGenerated: true }, type, approvedCategories), activeRound);
  }).filter((candidate) => {
    const textKey = fingerprint(candidate.question_text);
    const answerKey = `${categoryKey(candidate.category)}::${fingerprint(candidate.correct_answer)}`;
    const builtQuestions = safeRounds.flatMap((round) => (round.questionIds || []).map((id) => questionById.get(String(id))).filter(Boolean));
    const existingTexts = new Set(builtQuestions.map((question) => fingerprint(question.question_text)));
    const existingCategoryAnswers = new Set(builtQuestions.map((question) => `${categoryKey(question.category)}::${fingerprint(question.correct_answer)}`));
    return textKey && !existingTexts.has(textKey) && !existingCategoryAnswers.has(answerKey);
  });
  const normalizeGeneratedForRound = (candidates, round, fallbackType) => (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const normalized = normalizeQuestion({ ...candidate, id: `ai-${round.id}-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`, question_type: candidate.question_type || fallbackType, isGenerated: true }, fallbackType, approvedCategories);
    const roundDefaults = round?.defaultQuestionSettings || {};
    return applyDraftDefaults({
      ...normalized,
      points: candidate.points ?? candidate.question_points ?? roundDefaults.points ?? normalized.points,
      timer_seconds: candidate.timer_seconds ?? candidate.time_limit ?? roundDefaults.timer_seconds ?? normalized.timer_seconds,
      wager_limit: candidate.wager_limit ?? candidate.free_wager_limit ?? roundDefaults.wager_limit ?? normalized.wager_limit,
      wager_timing: candidate.wager_timing || candidate.wagerTiming || roundDefaults.wager_timing || normalized.wager_timing,
    }, round);
  });
  const fullSessionTypePlan = (needed, roundQuestionType = "mixed") => { const plan = { multiple_choice: 0, true_false: 0, written: 0 }; if (roundQuestionType && roundQuestionType !== "mixed" && plan[roundQuestionType] !== undefined) { plan[roundQuestionType] = needed; return plan; } const order = ["multiple_choice", "true_false", "written", "multiple_choice", "true_false"]; for (let index = 0; index < needed; index += 1) plan[order[index % order.length]] += 1; return plan; };
  const fullSessionFallbackTypes = ["multiple_choice", "true_false", "written"];
  const fullSessionFallbackOrder = (plan, generated, roundQuestionType = "mixed") => {
    if (roundQuestionType && roundQuestionType !== "mixed") return [roundQuestionType];
    const counts = generated.reduce((acc, question) => ({ ...acc, [normalizeType(question)]: (acc[normalizeType(question)] || 0) + 1 }), {});
    const shortTypes = Object.entries(plan).filter(([type, count]) => count > (counts[type] || 0)).sort((a, b) => (b[1] - (counts[b[0]] || 0)) - (a[1] - (counts[a[0]] || 0))).map(([type]) => type);
    return [...new Set([...shortTypes, ...fullSessionFallbackTypes])];
  };
  const isPreferredFullBuildCandidate = (question) => { const text = normalizeText(question?.question_text); const answer = normalizeText(question?.correct_answer); const category = normalizeText(question?.category); if (!text || !answer || !category || categoryKey(category) === "general") return false; if (text.length < 28) return false; if (/^(what|which|who) (is|was|are|were) the (capital|largest|highest|longest|oldest) /i.test(text)) return false; return true; };
  const uniqueGeneratedQuestions = (candidates, existing = []) => { const seen = new Set(existing.map((question) => fingerprint(question?.question_text || ""))); return candidates.filter((candidate) => { const key = fingerprint(candidate?.question_text || ""); if (!key || seen.has(key)) return false; seen.add(key); return true; }); };
  const addGeneratedToSpecificRounds = (generatedByRound) => { const generated = Object.values(generatedByRound).flat(); if (!generated.length) return; setQuestions((prev) => [...generated, ...prev]); setRounds((prev) => prev.map((round) => ({ ...round, questionIds: [...(round.questionIds || []), ...(generatedByRound[round.id] || []).map((question) => question.id)] }))); };
  const requestGeneratedForFullRound = async ({ round, type, count, excludedCategories, generatedQuestions, attempt = 1 }) => { const latestMemory = readQuestionMemory(); setQuestionMemory(latestMemory); const rejectedQuestions = new Set([...rejectedAi, ...memoryRejectedQuestionTexts(latestMemory), ...generatedQuestions.map((question) => question.question_text)]); const { excludedCategories: cleanExcluded, approvedPool } = buildApprovedCategoryScope({ softExclusions: [...recentSessionCategories, ...selectedSessionCategories, ...excludedCategories] }); const fullTheme = [theme, `Build this as part of a full trivia session for ${sessionName || "this show"}.`, `Current target round: ${round.name}.`, `Required question type for this request: ${questionTypeLabel(type)}.`, round.description ? `Round category/direction: ${round.description}` : "", round.description ? "Treat the round category/direction as the primary instruction. The category field and every question must clearly fit that direction." : "", "Quality bar for full-session building: write host-ready bar trivia, not generic database trivia. Favor recognizable US-friendly subjects with fresh angles, satisfying clue paths, and broad reusable categories. Avoid bland textbook facts, random foreign-only facts, capital/largest/first list questions, and categories that feel like one-off answer labels.", "Use only approved categories. To keep each session fresh, prefer approved categories that were not used recently or already selected in this build. If the approved pool gets narrow, reuse approved categories rather than inventing new category names.", attempt > 1 ? `Retry ${attempt}: the previous batch did not fill the round. Send stronger, more concrete, more playable candidates and avoid every rejected or already generated angle.` : ""].filter(Boolean).join("\n"); return axios.post("/api/generate-session-candidates", { sessionId: `full-${round.id}`, questionType: type, count, difficulty, theme: fullTheme, excludeUsed: true, avoidDuplicates: true, includeImagePrompt: false, excludeCategories: cleanExcluded, approvedCategories: approvedPool, rejectedCategories, rejectedQuestions: [...rejectedQuestions], sessionContext: buildAiSessionContext() }, { timeout: 120000 }); };
  const collectFullBuildCandidates = async ({ round, type, needed, generatedCategories, generatedQuestions, errors = [] }) => {
    const accepted = [];
    for (let attempt = 1; accepted.length < needed && attempt <= 2; attempt += 1) {
      const missing = needed - accepted.length;
      const requestCount = Math.min(20, Math.max(missing + 4, Math.ceil(missing * 2)));
      try {
        const { data } = await requestGeneratedForFullRound({ round, type, count: requestCount, excludedCategories: [...generatedCategories, ...accepted.map((question) => question.category)], generatedQuestions: [...generatedQuestions, ...accepted], attempt });
        const uniqueCandidates = uniqueGeneratedQuestions(normalizeGeneratedForRound(data?.candidates, round, type), [...generatedQuestions, ...accepted]);
        const preferredKeys = new Set(uniqueCandidates.filter(isPreferredFullBuildCandidate).map((question) => fingerprint(question.question_text)));
        const orderedCandidates = [...uniqueCandidates.filter((question) => preferredKeys.has(fingerprint(question.question_text))), ...uniqueCandidates.filter((question) => !preferredKeys.has(fingerprint(question.question_text)))].slice(0, missing);
        accepted.push(...orderedCandidates);
      } catch (error) {
        console.warn("Full build generation batch failed:", { round: round?.name, type, attempt, error });
        errors.push(`${round?.name || "Round"} ${questionTypeLabel(type)} attempt ${attempt}: ${error.response?.data?.error || error.message || "failed"}`);
        break;
      }
    }
    return accepted.slice(0, needed);
  };
  const handleAssistWriteQuestion = async () => { setDraftGenerating(true); try { const type = normalizeType(writeForm); const assistTheme = [theme, writeForm.category ? `Use category: ${writeForm.category}` : "", writeForm.question_text ? `Use or improve this idea: ${writeForm.question_text}` : ""].filter(Boolean).join("\n"); const writeCategory = normalizeText(writeForm.category); const draftCategoryExclusions = writeCategory ? selectedSessionCategories.filter((category) => categoryKey(category) !== categoryKey(writeCategory)) : selectedSessionCategories; const { excludedCategories: draftExcludedCategories, approvedPool: draftApprovedPool } = buildApprovedCategoryScope({ softExclusions: draftCategoryExclusions, lockedCategories: writeCategory ? [writeCategory] : [] }); const { data } = await axios.post("/api/generate-session-candidates", { sessionId: `write-${activeRound.id}`, questionType: type, count: 1, difficulty, theme: assistTheme, excludeUsed: true, avoidDuplicates: true, includeImagePrompt: false, excludeCategories: draftExcludedCategories, approvedCategories: draftApprovedPool, rejectedCategories, lockedCategories: writeCategory ? [writeCategory] : [], rejectedQuestions: [...rejectedAi] }, { timeout: 90000 }); const candidate = normalizeGeneratedCandidates(data?.candidates, activeRound.id, type)[0]; if (!candidate) throw new Error("No AI draft came back. Try adding a category or theme."); const wrongAnswers = candidate.options?.length ? candidate.options : parseAnswerOptions(candidate.incorrect_answers); setWriteForm((prev) => ({ ...prev, question_type: type, category: candidate.category || prev.category, question_text: candidate.question_text || prev.question_text, correct_answer: candidate.correct_answer || prev.correct_answer, incorrect_answers: type === "multiple_choice" ? [...wrongAnswers, "", "", ""].slice(0, 3) : prev.incorrect_answers, fun_fact: candidate.fun_fact || prev.fun_fact, image_url: candidate.image_url || prev.image_url, image_timing: prev.image_timing || "initial" })); toast.success("AI draft added"); } catch (error) { console.error("Free write AI assist error:", error); toast.error(error.response?.data?.error || error.message || "Failed to draft question"); } finally { setDraftGenerating(false); } };
  const handleAskCoHost = async () => { const request = normalizeText(cohostPrompt); if (!request) return toast.error("Ask the co-host what you need help with"); const nextMessages = [...cohostMessages, { role: "user", content: request }].slice(-10); setCohostMessages(nextMessages); setCohostPrompt(""); setCohostLoading(true); try { const { excludedCategories, approvedPool } = buildApprovedCategoryScope({ softExclusions: selectedSessionCategories }); const { data } = await axios.post("/api/host-assistant", { mode: "build_cohost", request, context: { session: { name: sessionName, session_date: sessionDate, difficulty, activeRound: activeRound.name, targetType: generateType }, build: buildAiSessionContext(), approvedCategories: approvedPool.length ? approvedPool : approvedCategories, rejectedCategories: uniqueCategories([...rejectedCategories, ...excludedCategories]), recentSessionCategories, conversation: nextMessages, questions: activeRoundQuestions.map((question) => ({ category: question.category, question_text: question.question_text, correct_answer: question.correct_answer, question_type: normalizeType(question) })) } }, { timeout: 90000 }); const reply = data?.answer || "I drafted a few suggestions for this round."; setCohostAnswer(reply); setCohostMessages((prev) => [...prev, { role: "assistant", content: reply }].slice(-12)); setCohostCandidates(normalizeCoHostCandidates(data?.candidates)); toast.success("Co-host response ready"); } catch (error) { console.error("AI co-host error:", error); setCohostMessages((prev) => [...prev, { role: "assistant", content: "I could not finish that request. Try asking again with a tighter direction or fewer requested questions." }].slice(-12)); toast.error(error.response?.data?.error || error.message || "Failed to ask the co-host"); } finally { setCohostLoading(false); } };
  const addGeneratedToRound = (generated, replacement = null, targetRoundId = activeRound.id) => { setQuestions((prev) => [...generated, ...prev.filter((q) => !replacement || String(q.id) !== String(replacement.id))]); setRounds((prev) => prev.map((round) => { if (round.id !== targetRoundId) return round; const current = round.questionIds || []; const withoutReplacement = replacement ? current.filter((id) => String(id) !== String(replacement.id)) : current; return { ...round, questionIds: [...withoutReplacement, ...generated.map((q) => q.id)] }; })); };
  const rejectAiCandidate = (question, note = "Rejected from AI pop-up") => { const nextRejectedAi = new Set(rejectedAi); nextRejectedAi.add(fingerprint(question.question_text)); setRejectedAi(nextRejectedAi); saveRejectedAi(nextRejectedAi); const nextMemory = upsertQuestionMemory(question, { status: "too_common", note }, readQuestionMemory()); setQuestionMemory(nextMemory); saveQuestionMemoryToProfile(supabase, nextMemory).catch((error) => console.warn("Question memory profile save unavailable:", error)); };
  const handleGenerateForRound = async () => { setGenerating(true); try { const { data } = await requestGeneratedQuestions(); const generated = normalizeGeneratedCandidates(data?.candidates, activeRound.id, generateType); if (!generated.length) throw new Error("No candidates returned. Try approving more categories or changing the AI direction."); setAiCandidates(generated); toast.success(`Generated ${generated.length} candidate${generated.length === 1 ? "" : "s"}`); } catch (error) { console.error("Round generate error:", error); toast.error(error.response?.data?.error || error.message || "Failed to generate questions"); } finally { setGenerating(false); } };
  const handleBuildFullSession = async ({ onlyRoundId = null } = {}) => {
    const template = templates.find((item) => item.id === selectedTemplateId) || templates[0];
    const targetPerRound = Math.max(1, Math.min(20, Number(template?.questionsPerRound || 10) || 10));
    const shouldApplyTemplateShell = selectedTotal === 0 && template && safeRounds.every((round, index) => isDefaultRoundShell(round, index));
    const baseSourceRounds = shouldApplyTemplateShell ? normalizeRounds(makeTemplateBuildDraft(template, venues.find((venue) => venue.id === selectedVenueId) || venues[0] || null).rounds) : safeRounds;
    const sourceRounds = onlyRoundId ? baseSourceRounds.filter((round) => String(round.id) === String(onlyRoundId)) : baseSourceRounds;
    if (!sourceRounds.length) return toast.error("Add at least one round first");
    setGenerating(true);
    setAiCandidates([]);
    try {
      const generatedByRound = {};
      const generatedQuestions = [];
      const generatedCategories = [];
      const shortages = [];
      const batchErrors = [];
      for (const round of sourceRounds) {
        const existingCount = (round.questionIds || []).length;
        const needed = Math.max(0, targetPerRound - existingCount);
        if (!needed) continue;
        generatedByRound[round.id] = [];
        const plan = fullSessionTypePlan(needed, round.questionType || "mixed");
        for (const [type, typeCount] of Object.entries(plan)) {
          if (!typeCount) continue;
          const generated = await collectFullBuildCandidates({ round, type, needed: typeCount, generatedCategories, generatedQuestions, errors: batchErrors });
          generatedByRound[round.id].push(...generated);
          generatedQuestions.push(...generated);
          generatedCategories.push(...generated.map((question) => question.category));
        }
        const remaining = needed - generatedByRound[round.id].length;
        if (remaining > 0) {
          const fallbackTypes = fullSessionFallbackOrder(plan, generatedByRound[round.id], round.questionType || "mixed");
          for (const type of fallbackTypes) {
            const missing = needed - generatedByRound[round.id].length;
            if (missing <= 0) break;
            const generated = await collectFullBuildCandidates({ round, type, needed: missing, generatedCategories, generatedQuestions, errors: batchErrors });
            generatedByRound[round.id].push(...generated);
            generatedQuestions.push(...generated);
            generatedCategories.push(...generated.map((question) => question.category));
          }
        }
        const finalMissing = needed - generatedByRound[round.id].length;
        if (finalMissing > 0) shortages.push(`${round.name}: ${finalMissing} short`);
      }
      if (!generatedQuestions.length) {
        if (shortages.length || batchErrors.length) return toast.error("AI did not return usable questions for the full build. Try a smaller round count, a clearer template direction, or generate one round at a time.");
        return toast.info("This build is already filled to the selected template count");
      }
      if (shouldApplyTemplateShell) {
        const draft = makeTemplateBuildDraft(template, venues.find((venue) => venue.id === selectedVenueId) || venues[0] || null);
        setSessionName((current) => current || draft.sessionName || "");
        setTheme((current) => current || draft.theme || "");
        setRounds(sourceRounds);
        setActiveRoundId(getInitialActiveRoundId(sourceRounds, activeRoundId));
      }
      addGeneratedToSpecificRounds(generatedByRound);
      if (shortages.length || batchErrors.length) toast.warning(`Built ${generatedQuestions.length} questions, but ${shortages.join(", ")} after retries`);
      else toast.success(`Built ${generatedQuestions.length} question${generatedQuestions.length === 1 ? "" : "s"} ${onlyRoundId ? "for this round" : "across the session"}`);
    } catch (error) {
      console.error("Full session generation error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to build full session");
    } finally {
      setGenerating(false);
    }
  };
  const handleBuildActiveRound = () => handleBuildFullSession({ onlyRoundId: activeRound.id });
  const handleAddAiCandidateToSession = (candidate) => { createUndoSnapshot("Add AI candidate"); addGeneratedToRound([candidate]); setAiCandidates((prev) => prev.filter((item) => String(item.id) !== String(candidate.id))); appendBuilderAssistant(`I added that ${questionTypeLabel(normalizeType(candidate)).toLowerCase()} question to ${activeRound.name}.`); toast.success("Added to session"); };
  const handleSaveAiCandidateToLibrary = async (candidate) => { const saved = await handleSaveQuestionToLibrary(candidate); if (saved) setAiCandidates((prev) => prev.filter((item) => String(item.id) !== String(candidate.id))); };
  const handleAddCoHostCandidateToSession = (candidate) => { addGeneratedToRound([candidate]); setCohostCandidates((prev) => prev.filter((item) => String(item.id) !== String(candidate.id))); toast.success("Added to session"); };
  const handleSaveCoHostCandidateToLibrary = async (candidate) => { const saved = await handleSaveQuestionToLibrary(candidate); if (saved) setCohostCandidates((prev) => prev.filter((item) => String(item.id) !== String(candidate.id))); };
  const handleRegenerateAiCandidate = async (candidate, scope = "question") => { setAiActionId(candidate.id); rejectAiCandidate(candidate, scope === "category" ? "Regenerated question and category" : "Regenerated question wording"); try { const type = normalizeType(candidate); const regenTheme = [theme, scope === "category" ? "Replace the rejected candidate with a fresh question in a different category. Avoid the same topic, answer, and angle." : "Replace the rejected candidate with a fresh question in the same category. Avoid the same answer and angle, but keep the category.", `Rejected category: ${candidate.category}`, `Rejected question: ${candidate.question_text}`, `Rejected answer: ${candidate.correct_answer}`].filter(Boolean).join("\n"); const { data } = await requestGeneratedQuestions({ replacement: candidate, rejectCurrent: true, themeOverride: regenTheme, allowCurrentCategory: scope === "question", lockedCategoriesOverride: scope === "question" ? [candidate.category].filter(Boolean) : [] }); const replacement = normalizeGeneratedCandidates(data?.candidates, activeRound.id, type)[0]; if (!replacement) throw new Error("No replacement came back. Try changing the AI direction."); const nextReplacement = scope === "question" ? normalizeQuestion({ ...replacement, category: candidate.category || replacement.category }, type) : replacement; setAiCandidates((prev) => prev.map((item) => String(item.id) === String(candidate.id) ? nextReplacement : item)); toast.success(scope === "category" ? "Regenerated question and category" : "Regenerated question"); } catch (error) { console.error("Regenerate AI candidate error:", error); toast.error(error.response?.data?.error || error.message || "Failed to regenerate candidate"); } finally { setAiActionId(null); } };
  const handleConvertAiCandidateType = async (candidate, targetType) => { const currentType = normalizeType(candidate); if (!targetType || targetType === currentType) return; setAiActionId(candidate.id); try { const convertTheme = [theme, `Rewrite this exact ${questionTypeLabel(currentType)} candidate as a ${questionTypeLabel(targetType)} question.`, "This is a format conversion only. Do not replace it with a different trivia fact, different subject, different category, or different fun fact.", targetType === "true_false" ? "For true/false, turn the same fact into one clean verifiable claim and set correct_answer to exactly True or False." : targetType === "multiple_choice" ? "For multiple choice, keep the original correct answer as the correct answer and add three plausible wrong answers." : "For written answer, keep the original correct answer and make the clue fair without answer options.", `Original category: ${candidate.category || "General"}`, `Original question: ${candidate.question_text}`, `Original answer: ${candidate.correct_answer}`, candidate.fun_fact ? `Original fun fact: ${candidate.fun_fact}` : "", "Return only a rewritten version of this same question in the new format."].filter(Boolean).join("\n"); const { data } = await requestGeneratedQuestions({ replacement: candidate, rejectCurrent: false, typeOverride: targetType, themeOverride: convertTheme, allowCurrentCategory: true, lockedCategoriesOverride: [candidate.category].filter(Boolean), avoidDuplicatesOverride: false }); const converted = normalizeGeneratedCandidates(data?.candidates, activeRound.id, targetType).map((item) => normalizeQuestion({ ...item, id: candidate.id, category: candidate.category || item.category, fun_fact: item.fun_fact || candidate.fun_fact, isGenerated: true }, targetType))[0]; if (!converted) throw new Error("No converted question came back."); setAiCandidates((prev) => prev.map((item) => String(item.id) === String(candidate.id) ? converted : item)); toast.success(`Converted to ${questionTypeLabel(targetType)}`); } catch (error) { console.error("Convert AI candidate type error:", error); toast.error(error.response?.data?.error || error.message || "Failed to convert question type"); } finally { setAiActionId(null); } };
  const handleTuneAiCandidateDifficulty = async (candidate, direction) => { setAiActionId(candidate.id); try { const type = normalizeType(candidate); const targetDifficulty = direction === "easier" ? easierDifficulty[difficulty] || "medium" : harderDifficulty[difficulty] || "hard"; const tuningTheme = [theme, direction === "easier" ? "Make a more accessible version of this same trivia idea. Keep it fresh, but add a clearer clue path and make the answer more gettable for a strong bar-trivia team." : "Make a harder version of this same trivia idea. Keep it fair and satisfying, but require a stronger clue path or second-layer knowledge.", type === "written" ? "Because this is a written-answer question, make the answer especially fair to recall without options. Avoid exact-spelling traps." : type === "multiple_choice" ? "Because this is multiple choice, keep the wrong answers plausible and comparable." : "Because this is true/false, keep the claim cleanly verifiable and not a coin flip.", `Original category: ${candidate.category || "General"}`, `Original question: ${candidate.question_text}`, `Original answer: ${candidate.correct_answer}`, candidate.fun_fact ? `Original fun fact: ${candidate.fun_fact}` : "", "Return a replacement candidate, not a duplicate. Keep the same broad idea and category unless the original category is impossible."].filter(Boolean).join("\n"); const { data } = await requestGeneratedQuestions({ replacement: candidate, rejectCurrent: true, difficultyOverride: targetDifficulty, themeOverride: tuningTheme, allowCurrentCategory: true, lockedCategoriesOverride: [candidate.category].filter(Boolean) }); const tuned = normalizeGeneratedCandidates(data?.candidates, activeRound.id, type).map((item) => normalizeQuestion({ ...item, id: candidate.id, category: candidate.category || item.category, isGenerated: true }, type))[0]; if (!tuned) throw new Error(`No ${direction} version came back. Try changing the AI direction.`); setAiCandidates((prev) => prev.map((item) => String(item.id) === String(candidate.id) ? tuned : item)); toast.success(direction === "easier" ? "Made easier" : "Made harder"); } catch (error) { console.error("Tune AI candidate difficulty error:", error); toast.error(error.response?.data?.error || error.message || `Failed to make question ${direction}`); } finally { setAiActionId(null); } };
  const handleRefreshGenerated = async (question) => { setActionQuestionId(question.id); try { const { data } = await requestGeneratedQuestions({ replacement: question, rejectCurrent: true, allowCurrentCategory: true }); const generated = normalizeGeneratedCandidates(data?.candidates, activeRound.id, normalizeType(question)); if (!generated.length) throw new Error("No replacement came back. Try approving more categories or changing the AI direction."); addGeneratedToRound(generated, question); toast.success("Question refreshed"); } catch (error) { console.error("Refresh generated question error:", error); toast.error(error.response?.data?.error || error.message || "Failed to refresh question"); } finally { setActionQuestionId(null); } };
  const handleConvertGeneratedType = async (question, targetType) => { const currentType = normalizeType(question); if (!targetType || targetType === currentType) return null; setActionQuestionId(question.id); try { const convertTheme = [theme, `Rewrite this exact ${questionTypeLabel(currentType)} question as a ${questionTypeLabel(targetType)} question.`, "This is a format conversion only. Do not replace it with a different trivia fact, different subject, different category, or different fun fact.", targetType === "true_false" ? "For true/false, turn the same fact into one clean verifiable claim and set correct_answer to exactly True or False." : targetType === "multiple_choice" ? "For multiple choice, keep the original correct answer as the correct answer and add three plausible wrong answers." : "For written answer, keep the original correct answer and make the clue fair without answer options.", `Original category: ${question.category || "General"}`, `Original question: ${question.question_text}`, `Original answer: ${question.correct_answer}`, question.fun_fact ? `Original fun fact: ${question.fun_fact}` : "", "Return only a rewritten version of this same question in the new format."].filter(Boolean).join("\n"); const { data } = await requestGeneratedQuestions({ replacement: question, rejectCurrent: false, typeOverride: targetType, themeOverride: convertTheme, allowCurrentCategory: true, lockedCategoriesOverride: [question.category].filter(Boolean), avoidDuplicatesOverride: false }); const converted = normalizeGeneratedCandidates(data?.candidates, activeRound.id, targetType).map((candidate) => normalizeQuestion({ ...candidate, id: question.id, category: question.category || candidate.category, fun_fact: candidate.fun_fact || question.fun_fact, isGenerated: true }, targetType))[0]; if (!converted) throw new Error("No converted question came back."); setQuestions((prev) => prev.map((item) => String(item.id) === String(question.id) ? converted : item)); toast.success(`Converted to ${questionTypeLabel(targetType)}`); return converted; } catch (error) { console.error("Convert generated question type error:", error); toast.error(error.response?.data?.error || error.message || "Failed to convert question type"); return null; } finally { setActionQuestionId(null); } };
  const handleChatEditQuestion = async (question, instruction) => { const request = normalizeText(instruction); if (!request) { toast.error("Tell the co-host what to change"); return null; } setActionQuestionId(question.id); try { const { data } = await axios.post("/api/host-assistant", { mode: "question_edit", request, context: { session: { name: sessionName, session_date: sessionDate, difficulty, activeRound: activeRound.name }, build: buildAiSessionContext(), approvedCategories, rejectedCategories, recentSessionCategories, questions: [{ category: question.category, question_text: question.question_text, correct_answer: question.correct_answer, question_type: normalizeType(question), incorrect_answers: question.incorrect_answers, options: question.options, fun_fact: question.fun_fact }] } }, { timeout: 90000 }); const candidate = data?.candidate; const type = normalizeType(candidate, normalizeType(question)); const edited = normalizeQuestion({ ...question, ...candidate, id: question.id, category: candidate?.category || question.category, question_type: type, type, image_url: question.image_url || candidate?.image_url || "", image_timing: question.image_timing, isGenerated: question.isGenerated }, type); return { answer: data?.answer || "I rewrote the question for you to review.", question: edited }; } catch (error) { console.error("Question chat edit error:", error); toast.error(error.response?.data?.error || error.message || "Failed to edit question with AI"); return null; } finally { setActionQuestionId(null); } };
  const handleTuneGeneratedDifficulty = async (question, direction) => { setActionQuestionId(question.id); try { const type = normalizeType(question); const targetDifficulty = direction === "easier" ? easierDifficulty[difficulty] || "medium" : harderDifficulty[difficulty] || "hard"; const tuningTheme = [theme, direction === "easier" ? "Make a more accessible version of this same trivia idea. Keep it fresh, but add a clearer clue path and make the answer more gettable for a strong bar-trivia team." : "Make a harder version of this same trivia idea. Keep it fair and satisfying, but require a stronger clue path or second-layer knowledge.", type === "written" ? "Because this is a written-answer question, make the answer especially fair to recall without options. Avoid exact-spelling traps." : type === "multiple_choice" ? "Because this is multiple choice, keep the wrong answers plausible and comparable." : "Because this is true/false, keep the claim cleanly verifiable and not a coin flip.", `Original category: ${question.category || "General"}`, `Original question: ${question.question_text}`, `Original answer: ${question.correct_answer}`, question.fun_fact ? `Original fun fact: ${question.fun_fact}` : "", "Return a replacement, not a duplicate. It may keep the same broad subject, but should be newly worded and calibrated to the requested difficulty."].filter(Boolean).join("\n"); const { data } = await requestGeneratedQuestions({ replacement: question, rejectCurrent: true, difficultyOverride: targetDifficulty, themeOverride: tuningTheme, allowCurrentCategory: true, lockedCategoriesOverride: [question.category].filter(Boolean) }); const generated = normalizeGeneratedCandidates(data?.candidates, activeRound.id, type).map((candidate) => normalizeQuestion({ ...candidate, category: question.category || candidate.category }, type)); if (!generated.length) throw new Error(`No ${direction} version came back. Try changing the AI direction.`); addGeneratedToRound(generated, question); toast.success(direction === "easier" ? "Made easier" : "Made harder"); } catch (error) { console.error("Tune generated question error:", error); toast.error(error.response?.data?.error || error.message || `Failed to make question ${direction}`); } finally { setActionQuestionId(null); } };
  const handleRejectQuestion = (question) => { const nextRejectedAi = new Set(rejectedAi); nextRejectedAi.add(fingerprint(question.question_text)); setRejectedAi(nextRejectedAi); saveRejectedAi(nextRejectedAi); const nextMemory = upsertQuestionMemory(question, { status: "too_common" }, readQuestionMemory()); setQuestionMemory(nextMemory); saveQuestionMemoryToProfile(supabase, nextMemory).catch((error) => console.warn("Question memory profile save unavailable:", error)); setQuestions((prev) => prev.filter((q) => String(q.id) !== String(question.id))); setRounds((prev) => prev.map((round) => ({ ...round, questionIds: (round.questionIds || []).filter((id) => String(id) !== String(question.id)) }))); toast.success("Question blocked from future AI suggestions"); };
  const handleRejectCategory = (question) => { if (!question.category) return; const clean = canonicalCategory(question.category, [...approvedCategories, ...rejectedCategories]); const approved = new Set(approvedCategories.filter((category) => categoryKey(category) !== categoryKey(clean))); const rejected = new Set(uniqueCategories([...rejectedCategories, clean], [clean])); setApprovedCategories(uniqueCategories([...approved]).sort((a, b) => a.localeCompare(b))); setRejectedCategories(uniqueCategories([...rejected]).sort((a, b) => a.localeCompare(b))); saveLocalCategoryPrefs(approved, rejected); removeFromRound(activeRound.id, question.id); toast.success(`${clean} moved to rejected categories`); };
  const handleClearSession = async () => { await clearSavedState(); setEditingSessionId(null); setEditingSessionWasPast(false); setSessionName(""); setSessionDate(todayInputDate()); setSelectedVenueId(readActiveVenueId() || ""); setRounds(createDefaultRounds()); setActiveRoundId("round-1"); setTheme(""); setTypeFilter("all"); setGenerateType("multiple_choice"); setAiCandidates([]); setShowAiPanel(false); setShowWriteForm(false); setShowLibrary(false); if (sessionId) navigate("/build", { replace: true }); toast.success("Session cleared"); };
  const handleStartFromTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplateId) || templates[0];
    if (!template) return toast.error("Create a template in Setup first");
    if (selectedTotal > 0 && !window.confirm("Start from this template and replace the current round layout? Your library questions will stay available.")) return;
    const activeVenueId = readActiveVenueId();
    const venue = venues.find((item) => item.id === activeVenueId) || venues[0] || null;
    const draft = makeTemplateBuildDraft(template, venue);
    writeTemplateBuildDraft(template, venue);
    const nextRounds = normalizeRounds(draft.rounds);
    setSessionName(draft.sessionName || sessionName);
    setSessionDate(draft.sessionDate || sessionDate);
    setSelectedVenueId(draft.venueId || selectedVenueId);
    setRounds(nextRounds);
    setActiveRoundId(getInitialActiveRoundId(nextRounds, draft.activeRoundId));
    setTheme(draft.theme || "");
    setShowAiPanel(false);
    setShowWriteForm(false);
    setShowLibrary(false);
    toast.success(`Started from ${template.name}`);
  };
  const createUndoSnapshot = (label = "AI action") => setBuilderUndoSnapshot({ label, questions: safeQuestions(questions), rounds: normalizeRounds(rounds), activeRoundId, theme, difficulty, aiCandidates: safeQuestions(aiCandidates), time: Date.now() });
  const restoreBuilderUndo = () => {
    if (!builderUndoSnapshot) return;
    setQuestions(safeQuestions(builderUndoSnapshot.questions));
    setRounds(normalizeRounds(builderUndoSnapshot.rounds));
    setActiveRoundId(getInitialActiveRoundId(builderUndoSnapshot.rounds, builderUndoSnapshot.activeRoundId));
    setTheme(builderUndoSnapshot.theme || "");
    setDifficulty(builderUndoSnapshot.difficulty || "medium");
    setAiCandidates(safeQuestions(builderUndoSnapshot.aiCandidates));
    setChatPreview(null);
    setBuilderChatMessages((prev) => [...prev, { role: "assistant", content: `Undone: ${builderUndoSnapshot.label}.` }].slice(-12));
    setBuilderUndoSnapshot(null);
  };
  const findRoundFromPrompt = (request) => {
    const number = parseRoundNumber(request);
    if (!number) return activeRound;
    return safeRounds[number - 1] || activeRound;
  };
  const findQuestionFromPrompt = (request) => {
    const number = parseQuestionNumber(request);
    if (!number) return null;
    return activeRoundQuestions[number - 1] || null;
  };
  const appendBuilderAssistant = (content) => setBuilderChatMessages((prev) => [...prev, { role: "assistant", content }].slice(-12));
  const acceptChatPreview = () => {
    if (!chatPreview) return;
    createUndoSnapshot(chatPreview.kind === "replace" ? "Replace question" : "Rewrite question");
    if (chatPreview.kind === "replace") addGeneratedToRound([chatPreview.question], chatPreview.originalQuestion, chatPreview.roundId || activeRound.id);
    else updateQuestion(chatPreview.originalQuestion.id, chatPreview.question);
    appendBuilderAssistant(chatPreview.kind === "replace" ? "I replaced the question." : "I applied the rewrite.");
    setChatPreview(null);
  };
  const runBuilderChat = async (messageOverride = "") => {
    const request = normalizeText(messageOverride || builderChatInput);
    if (!request) return toast.error("Ask Quiz Crafter what you want to build");
    const intent = classifyBuildIntent(request);
    const targetRound = findRoundFromPrompt(request);
    const requestedType = parseRequestedType(request, generateType);
    const requestedCount = parseRequestedCount(request, 3);
    setBuilderChatInput("");
    setBuilderChatMessages((prev) => [...prev, { role: "user", content: request }].slice(-12));
    setBuilderChatLoading(true);
    try {
      if (/\b(write my own|manual|manually write|create my own)\b/i.test(request)) {
        setShowWriteForm(true);
        setShowLibrary(false);
        setShowAiPanel(false);
        setShowCoHost(false);
        appendBuilderAssistant("I opened the manual question editor. Write the question here, or give me a rough idea and use the sparkle button to draft it.");
        return;
      }
      if (/\b(use template|apply template|start from template)\b/i.test(request)) {
        createUndoSnapshot("Apply template");
        handleStartFromTemplate();
        appendBuilderAssistant("I applied the selected template. The round list is ready for you to build into.");
        return;
      }
      if (/\b(save session|save build)\b/i.test(request)) {
        await handleSave(false);
        appendBuilderAssistant("I saved this build so you can come back to it.");
        return;
      }
      if (/\b(export csv)\b/i.test(request)) {
        appendBuilderAssistant("CSV export is available after saving/opening the session detail. Save the build first, then export from the session screen.");
        return;
      }
      if (intent === "import_file") {
        appendBuilderAssistant("Imports still live on the Import CSV/PDF screen so you can review detected rows before they touch the database. Opening that next.");
        navigate("/import");
        return;
      }
      if (intent === "search_library") {
        const query = request.replace(/\b(search|find|library|saved question|from my library|about|for)\b/gi, " ").replace(/\s+/g, " ").trim();
        setSearchQuery(query);
        setTypeFilter(parseRequestedType(request, "all") || "all");
        setShowLibrary(true);
        setShowAiPanel(false);
        setShowWriteForm(false);
        setShowCoHost(false);
        appendBuilderAssistant(`I opened your unused library${query ? ` and searched for "${query}"` : ""}. Pick any question to add it to ${targetRound.name}.`);
        return;
      }
      if (intent === "generate_full_session") {
        createUndoSnapshot("Finish full session");
        await handleBuildFullSession();
        appendBuilderAssistant("I filled the open gaps across the session using the current template, approved categories, and questions already in the build.");
        return;
      }
      if (intent === "generate_round") {
        createUndoSnapshot(`Build ${targetRound.name}`);
        await handleBuildFullSession({ onlyRoundId: targetRound.id });
        setActiveRoundId(targetRound.id);
        appendBuilderAssistant(`I filled open spots in ${targetRound.name}. Review the round list and undo if the direction feels off.`);
        return;
      }
      if (intent === "add_questions") {
        const themeParts = [theme, request, `Target round: ${targetRound.name}.`, targetRound.description ? `Round direction: ${targetRound.description}` : ""].filter(Boolean);
        const { data } = await requestGeneratedQuestions({ countOverride: requestedCount, typeOverride: requestedType, themeOverride: themeParts.join("\n"), roundOverride: targetRound });
        const generated = normalizeGeneratedCandidates(data?.candidates, targetRound.id, requestedType);
        if (!generated.length) throw new Error("No candidates came back.");
        setAiCandidates(generated);
        setActiveRoundId(targetRound.id);
        appendBuilderAssistant(`I found ${generated.length} possible ${generated.length === 1 ? "question" : "questions"} for ${targetRound.name}. Pick the ones you want to add.`);
        return;
      }
      if (["replace_question", "rewrite_question", "make_harder", "make_easier", "add_fun_fact"].includes(intent)) {
        if (/\bweakest|balance|review\b/i.test(request) && !parseQuestionNumber(request)) {
          setCohostPrompt(request);
          await handleAskCoHost();
          appendBuilderAssistant("I reviewed the round balance. If I draft replacements, they will appear in the co-host drafts.");
          return;
        }
        const targetQuestion = findQuestionFromPrompt(request);
        if (!targetQuestion) {
          appendBuilderAssistant("I need a question number for that. Try: \"Replace question 4\" or \"Make question 6 easier.\"");
          return;
        }
        const direction = intent === "make_easier" ? "Make this easier and more gettable for a US bar-trivia crowd." : intent === "make_harder" ? "Make this harder but still fair and playable." : intent === "add_fun_fact" ? "Add or improve the fun fact. Keep the same question, answer, category, and type." : request;
        if (intent === "replace_question") {
          const { data } = await requestGeneratedQuestions({ replacement: targetQuestion, rejectCurrent: true, typeOverride: parseRequestedType(request, normalizeType(targetQuestion)), themeOverride: [theme, request, "Replace this question with a different fact but keep the same broad round fit.", `Old question: ${targetQuestion.question_text}`, `Old answer: ${targetQuestion.correct_answer}`].filter(Boolean).join("\n"), roundOverride: targetRound, allowCurrentCategory: true });
          const replacement = normalizeGeneratedCandidates(data?.candidates, targetRound.id, parseRequestedType(request, normalizeType(targetQuestion)))[0];
          if (!replacement) throw new Error("No replacement came back.");
          setChatPreview({ kind: "replace", originalQuestion: targetQuestion, question: replacement, roundId: targetRound.id });
          appendBuilderAssistant(`I found a replacement for Question ${parseQuestionNumber(request) || 1}. Preview it before saving.`);
          return;
        }
        const result = await handleChatEditQuestion(targetQuestion, direction);
        if (result?.question) {
          setChatPreview({ kind: "rewrite", originalQuestion: targetQuestion, question: result.question, roundId: targetRound.id });
          appendBuilderAssistant(result.answer || "I made a preview rewrite. Accept it to update the question.");
        }
        return;
      }
      setCohostPrompt(request);
      await handleAskCoHost();
      appendBuilderAssistant("I sent that to the co-host brain. If it drafts usable questions, they will appear in the co-host preview.");
    } catch (error) {
      console.error("Builder chat command error:", error);
      appendBuilderAssistant(error.response?.data?.error || error.message || "I could not finish that request. Try naming a round, question number, type, or count.");
      toast.error(error.response?.data?.error || error.message || "Ask Quiz Crafter failed");
    } finally {
      setBuilderChatLoading(false);
    }
  };
  const handleSave = async (goLive = false) => {
    if (!user?.id) return toast.error("You must be signed in");

    const builtName = sessionName.trim() || `${new Date().toLocaleDateString()} Trivia`;
    const grouped = { true_false_questions: [], multiple_choice_questions: [], written_questions: [], picture_questions: [] };
    const selectedLibraryIds = new Set();
    const roundDescriptions = safeRounds.map((round, index) => ({
      name: round.name,
      description: round.description || "",
      order: index + 1,
      categories: [...new Set((round.questionIds || []).map((id) => questionById.get(String(id))?.category).filter(Boolean))],
    }));

    safeRounds.forEach((round, roundIndex) => (round.questionIds || []).forEach((id, sourceOrder) => {
      const question = questionById.get(String(id));
      if (!question) return;
      const questionId = String(question.id);
      if (!question.isGenerated && !questionId.startsWith("custom-") && !questionId.startsWith("session-")) selectedLibraryIds.add(questionId);
      const type = normalizeType(question);
      const sessionQuestion = toSessionQuestion(question, round, roundIndex, sourceOrder);
      if (type === "true_false") grouped.true_false_questions.push(sessionQuestion);
      else if (type === "multiple_choice") grouped.multiple_choice_questions.push(sessionQuestion);
      else grouped.written_questions.push(sessionQuestion);
    }));

    const total = Object.values(grouped).reduce((sum, items) => sum + items.length, 0);
    if (goLive && !total) return toast.error("Add at least one question before going live");

    setSaving(true);
    try {
      const selectedVenue = venues.find((venue) => venue.id === selectedVenueId);
      const sessionMetaPayload = { session_date: sessionDate || null, event_date: sessionDate || null, venue_id: selectedVenueId || null, venue_name: selectedVenue?.name || selectedVenue?.nightName || null };
      const baseSessionPayload = { user_id: user.id, name: builtName, session_name: builtName, is_past: goLive ? false : editingSessionWasPast, ...grouped };
      const fullSessionPayload = { ...baseSessionPayload, ...sessionMetaPayload };
      let saveResult = editingSessionId
        ? await supabase.from("sessions").update({ ...fullSessionPayload, round_descriptions: roundDescriptions }).eq("id", editingSessionId).select("id").single()
        : await supabase.from("sessions").insert({ ...fullSessionPayload, round_descriptions: roundDescriptions }).select("id").single();

      if (saveResult.error) {
        saveResult = editingSessionId
          ? await supabase.from("sessions").update({ ...baseSessionPayload, round_descriptions: roundDescriptions }).eq("id", editingSessionId).select("id").single()
          : await supabase.from("sessions").insert({ ...baseSessionPayload, round_descriptions: roundDescriptions }).select("id").single();
      }
      if (saveResult.error) {
        saveResult = editingSessionId
          ? await supabase.from("sessions").update(baseSessionPayload).eq("id", editingSessionId).select("id").single()
          : await supabase.from("sessions").insert(baseSessionPayload).select("id").single();
      }
      if (saveResult.error) throw saveResult.error;

      const data = saveResult.data;
      setEditingSessionId(data.id);
      setSessionName(builtName);
      await clearSavedState();

      if (goLive) {
        if (selectedLibraryIds.size > 0) {
          const nextUsedIds = new Set([...readUsedIds(), ...selectedLibraryIds]);
          writeUsedIds(nextUsedIds);
          setUsedQuestionIds(nextUsedIds);
        }
        toast.success("Session saved. Opening host screen.");
        navigate(`/host-session/${data.id}`);
      } else {
        toast.success("Build saved");
        if (!sessionId) navigate(`/build/${data.id}`, { replace: true });
      }
    } catch (error) {
      console.error("Save built session error:", error);
      toast.error(error.message || "Failed to save session");
    } finally {
      setSaving(false);
    }
  };
  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) || templates[0] || null;
  const templateGoal = Math.max(1, Number(selectedTemplate?.questionsPerRound || 0) || 0);
  const selectedTotal = safeRounds.reduce((sum, round) => sum + (round.questionIds?.length || 0), 0);
  const fullSessionGoal = templateGoal ? safeRounds.length * templateGoal : 0;
  const fullSessionComplete = Boolean(fullSessionGoal && selectedTotal >= fullSessionGoal);

  return <div className="p-4 lg:p-6 max-w-7xl mx-auto animate-fade-in" data-testid="build-session-page">
    <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-5"><div><h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Build <span className="gradient-text">Session</span></h1><p className="text-zinc-500">Create or continue the active trivia session.</p></div><div className="flex gap-2 flex-wrap"><Button onClick={() => handleSave(false)} disabled={saving} className="gradient-btn" data-testid="save-build-btn">{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : <><Save className="mr-2" size={18} />Save Build</>}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="border-white/15 text-zinc-300 hover:text-white hover:bg-zinc-800" aria-label="More build actions"><MoreHorizontal size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="border-white/10 bg-zinc-950 text-zinc-200"><DropdownMenuItem onClick={() => handleSave(true)} className="cursor-pointer focus:bg-zinc-800" data-testid="go-live-btn"><Sparkles size={15} className="mr-2" />Go Live</DropdownMenuItem>{selectedTotal > 0 && <DropdownMenuItem onClick={handleClearSession} className="cursor-pointer text-red-200 focus:bg-red-500/10 focus:text-red-200"><X size={15} className="mr-2" />Clear Build</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div></div>
    {loading && <div className="mb-4 flex items-center gap-2 rounded-md border border-[#71E0DC]/20 bg-[#071A1D]/70 px-3 py-2 text-sm text-[#AEEBFF]"><Loader2 className="h-4 w-4 animate-spin" />Loading your saved builds and question library...</div>}
    <Card className="glass-card mb-5"><CardContent className="p-4 space-y-4"><div className="grid grid-cols-1 lg:grid-cols-[1fr_170px_240px] gap-3"><Field label="Session Name"><Input value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g., Tuesday Night Trivia" className="bg-zinc-950/50 border-white/10 text-white" /></Field><Field label="Date"><Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className="bg-zinc-950/50 border-white/10 text-white" /></Field><Field label="Venue"><select value={selectedVenueId} onChange={(e) => setSelectedVenueId(e.target.value)} className="w-full h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3"><option value="">No venue</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name || venue.nightName || "Untitled venue"}</option>)}</select></Field></div>{approvedCategories.length > 0 && <p className="text-xs text-zinc-500">AI category pool: {approvedCategories.slice(0, 10).join(", ")}{approvedCategories.length > 10 ? "..." : ""}</p>}</CardContent></Card>
    <Card className="glass-card mb-5"><CardContent className="p-4"><div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr_auto] gap-3 items-end"><div><p className="text-xs font-bold uppercase tracking-wide text-[#71E0DC]">Start from template</p><p className="text-sm text-zinc-500 mt-1">Apply a saved show format, then ask Quiz Crafter to fill or refine it.</p></div><label className="text-sm text-zinc-400">Template<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="mt-1 h-11 w-full rounded-lg bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60">{templates.map((template) => <option key={template.id} value={template.id}>{template.name} - {template.roundCount} rounds</option>)}</select></label><Button type="button" onClick={handleStartFromTemplate} disabled={!templates.length || generating} className="h-11 border border-white/10 bg-zinc-950/70 text-zinc-100 hover:border-[#71E0DC]/40 hover:bg-zinc-900"><Layers size={16} className="mr-2" />Use Template</Button></div></CardContent></Card>
    <AskQuizCrafterPanel input={builderChatInput} setInput={setBuilderChatInput} messages={builderChatMessages} loading={builderChatLoading || generating} undoSnapshot={builderUndoSnapshot} onUndo={restoreBuilderUndo} onAsk={runBuilderChat} preview={chatPreview} onAcceptPreview={acceptChatPreview} onDiscardPreview={() => setChatPreview(null)} aiCandidates={aiCandidates} aiActionId={aiActionId} onAddToSession={handleAddAiCandidateToSession} onSaveToLibrary={handleSaveAiCandidateToLibrary} onRegenerate={handleRegenerateAiCandidate} onConvertType={handleConvertAiCandidateType} onTuneDifficulty={handleTuneAiCandidateDifficulty} sessionName={sessionName} sessionDate={sessionDate} venueName={selectedVenue?.name || selectedVenue?.nightName || ""} activeRound={activeRound} activeRoundCount={activeRoundQuestions.length} templateGoal={templateGoal} fullSessionComplete={fullSessionComplete} />
    <div className="space-y-5"><RoundDropdown rounds={rounds} activeRoundId={activeRoundId} menuOpen={roundMenuOpen} setMenuOpen={setRoundMenuOpen} onSelect={setActiveRoundId} onRename={handleRenameRound} onDescribe={handleDescribeRound} onDelete={handleDeleteRound} onAdd={handleAddRound} />
      <Card className="glass-card overflow-hidden border-[#71E0DC]/15"><CardHeader className="pb-3 border-b border-white/10"><div><CardTitle className="text-white flex items-center gap-2"><Layers size={20} className="text-[#71E0DC]" />{activeRound.name}</CardTitle><CardDescription className="text-zinc-500">{activeRoundQuestions.length} question{activeRoundQuestions.length === 1 ? "" : "s"} selected. Ask Quiz Crafter above to edit this workspace.</CardDescription></div></CardHeader><CardContent className="p-4 space-y-4"><BuilderToolbar showWriteForm={showWriteForm} setShowWriteForm={setShowWriteForm} showLibrary={showLibrary} onBrowseLibrary={handleBrowseLibrary} />{showWriteForm && <FreeWriteModal form={writeForm} setForm={setWriteForm} categories={approvedCategories} onSubmit={handleAddCustomQuestion} onCancel={() => setShowWriteForm(false)} onAssist={handleAssistWriteQuestion} draftGenerating={draftGenerating} />}<SelectedRoundList questions={activeRoundQuestions} rounds={safeRounds} activeRoundId={activeRound.id} mediaQuestionId={mediaQuestionId} settingsQuestionId={settingsQuestionId} actionQuestionId={actionQuestionId} onOpenMedia={setMediaQuestionId} onOpenSettings={setSettingsQuestionId} onCloseMedia={() => setMediaQuestionId(null)} onMoveWithinRound={moveQuestionWithinRound} onMoveToRound={moveQuestionToRound} onRemove={(questionId) => removeFromRound(activeRound.id, questionId)} onUpdate={updateQuestion} onSaveToLibrary={handleSaveQuestionToLibrary} onRefresh={handleRefreshGenerated} onConvertType={handleConvertGeneratedType} onTuneDifficulty={handleTuneGeneratedDifficulty} onChatEdit={handleChatEditQuestion} onRejectQuestion={handleRejectQuestion} onRejectCategory={handleRejectCategory} /></CardContent></Card>
    </div>
    {showLibrary && <LibraryModal typeFilter={typeFilter} setTypeFilter={setTypeFilter} searchQuery={searchQuery} setSearchQuery={setSearchQuery} availableQuestions={availableQuestions} activeRound={activeRound} selectedIds={selectedIds} generating={generating} onGenerate={handleGenerateForRound} onToggleQuestion={toggleQuestion} onClose={() => setShowLibrary(false)} />}
    {mediaQuestion && <MediaModal question={mediaQuestion} onClose={() => setMediaQuestionId(null)} onSave={(patch) => { updateQuestion(mediaQuestion.id, patch); setMediaQuestionId(null); toast.success(patch.image_url ? "Image saved" : "Image removed"); }} />}
    {settingsQuestion && <QuestionSettingsModal question={settingsQuestion} roundName={activeRound.name} onClose={() => setSettingsQuestionId(null)} onApply={(patch, scope) => { applyQuestionSettings(settingsQuestion.id, patch, scope); setSettingsQuestionId(null); }} />}
  </div>;
};

const Field = ({ label, children }) => <div className="space-y-2"><Label className="text-zinc-300">{label}</Label>{children}</div>;
const AskQuizCrafterPanel = ({ input, setInput, messages, loading, undoSnapshot, onUndo, onAsk, preview, onAcceptPreview, onDiscardPreview, aiCandidates, aiActionId, onAddToSession, onSaveToLibrary, onRegenerate, onConvertType, onTuneDifficulty, sessionName, sessionDate, venueName, activeRound, activeRoundCount, templateGoal, fullSessionComplete }) => {
  const roundComplete = Boolean(templateGoal && activeRoundCount >= templateGoal);
  const nextRoundNumber = (Number(String(activeRound?.name || "").match(/\d+/)?.[0]) || 1) + 1;
  const chips = fullSessionComplete
    ? ["Export CSV", "Review session", "Create host notes", "Save session"]
    : activeRoundCount === 0
      ? ["Build this round", "Search library", "Write my own", "Use template"]
      : roundComplete
        ? [`Build Round ${nextRoundNumber}`, "Review balance", "Replace weakest question", "Finish session"]
        : ["Add more questions", "Replace a question", "Make harder", "Add fun facts"];
  const dateLabel = sessionDate ? formatSessionDate(sessionDate) : "today";
  const sessionLabel = normalizeText(sessionName) || "this trivia session";
  const venueLabel = normalizeText(venueName) || "no venue selected";
  const goalLabel = templateGoal ? `${activeRoundCount}/${templateGoal} questions` : `${activeRoundCount} questions`;
  const contextLine = `You're building ${activeRound?.name || "this round"} for ${sessionLabel} at ${venueLabel} on ${dateLabel}. This round has ${goalLabel}. What would you like to do?`;
  const handleKeyDown = (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onAsk();
  };
  return <Card className="glass-card mb-5 overflow-hidden border-[#71E0DC]/25 shadow-lg shadow-[#71E0DC]/5"><CardHeader className="pb-3 border-b border-[#71E0DC]/15"><div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div><CardTitle className="text-white flex items-center gap-2"><Sparkles size={20} className="text-[#71E0DC]" />Ask Quiz Crafter</CardTitle><CardDescription className="text-zinc-400 mt-1">{contextLine}</CardDescription></div>{undoSnapshot && <Button type="button" variant="outline" onClick={onUndo} className="h-9 border-[#71E0DC]/25 text-[#71E0DC] hover:text-white hover:bg-[#71E0DC]/10"><RefreshCw size={14} className="mr-2" />Undo last change</Button>}</div></CardHeader><CardContent className="p-4 space-y-4"><Textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Example: Build this round with true/false questions, replace question 4, or find a library question about cats..." className="min-h-[104px] bg-zinc-950/70 border-[#71E0DC]/20 text-white text-base focus:border-[#71E0DC]/60" /><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{chips.map((chip) => <button key={chip} type="button" onClick={() => onAsk(chip)} className="rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-[#71E0DC]/40 hover:text-white">{chip}</button>)}</div><Button type="button" onClick={() => onAsk()} disabled={loading || !normalizeText(input)} className="gradient-btn h-10">{loading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}Ask</Button></div><div className="space-y-2">{messages.length ? messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${message.role === "user" ? "bg-[#71E0DC]/16 border border-[#71E0DC]/25 text-white" : "bg-zinc-900/90 border border-white/10 text-zinc-200"}`}>{message.content}</div></div>) : <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/35 p-4 text-sm text-zinc-500">{contextLine}</div>}{loading && <div className="flex justify-start"><div className="rounded-2xl bg-zinc-900/90 border border-white/10 px-4 py-3 text-sm text-zinc-400"><Loader2 size={14} className="mr-2 inline animate-spin text-[#71E0DC]" />Working...</div></div>}</div>{preview && <div className="rounded-xl border border-[#AEB2EF]/25 bg-[#AEB2EF]/8 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-[#AEB2EF]">{preview.kind === "replace" ? "Replacement Preview" : "Rewrite Preview"}</p><p className="mt-1 text-sm text-zinc-500">Review before changing the round.</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={onDiscardPreview} className="h-9 border-white/10 text-zinc-300 hover:text-white">Discard</Button><Button type="button" onClick={onAcceptPreview} className="h-9 gradient-btn"><Check size={15} className="mr-2" />Accept</Button></div></div><div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3"><PreviewQuestion title="Current" question={preview.originalQuestion} muted /><PreviewQuestion title="Preview" question={preview.question} /></div></div>}{aiCandidates.length > 0 && <div className="rounded-xl border border-white/10 bg-zinc-950/35 p-3"><div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-sm font-bold text-white">Candidate Drafts</p><p className="text-xs text-zinc-500">Pick the ones to add. Adding creates an undo point.</p></div><Badge className="bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{aiCandidates.length}</Badge></div><div className="space-y-3">{aiCandidates.map((candidate) => <AiCandidateCard key={candidate.id} candidate={candidate} busy={String(aiActionId) === String(candidate.id)} onAddToSession={() => onAddToSession(candidate)} onSaveToLibrary={() => onSaveToLibrary(candidate)} onRegenQuestion={() => onRegenerate(candidate, "question")} onRegenCategory={() => onRegenerate(candidate, "category")} onConvertType={(targetType) => onConvertType(candidate, targetType)} onTuneDifficulty={(direction) => onTuneDifficulty(candidate, direction)} />)}</div></div>}</CardContent></Card>;
};
const PreviewQuestion = ({ title, question, muted }) => <div className={`rounded-lg border p-3 ${muted ? "border-white/10 bg-zinc-950/60 opacity-75" : "border-[#71E0DC]/25 bg-[#071A1D]/50"}`}><p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{title}</p><QuestionMeta question={question} /><p className="mt-2 text-sm font-semibold text-white">{question.question_text}</p><p className="mt-2 text-xs text-zinc-400">Answer: <span className="text-emerald-300">{question.correct_answer}</span></p>{question.fun_fact && <p className="mt-2 text-xs text-zinc-500">{question.fun_fact}</p>}</div>;
const TimingButtons = ({ value, onChange }) => <div className="inline-flex rounded-lg bg-zinc-800 p-1"><button type="button" onClick={() => onChange("initial")} className={`px-4 py-2 rounded-md text-sm font-semibold ${normalizeImageTiming(value) === "initial" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-white"}`}>Before Answer</button><button type="button" onClick={() => onChange("after_answer")} className={`px-4 py-2 rounded-md text-sm font-semibold ${normalizeImageTiming(value) === "after_answer" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-white"}`}>After Answer</button></div>;
const RoundDropdown = ({ rounds, activeRoundId, menuOpen, setMenuOpen, onSelect, onRename, onDescribe, onDelete, onAdd }) => {
  const [manageOpen, setManageOpen] = useState(false);
  const activeRound = rounds.find((round) => round.id === activeRoundId) || rounds[0];
  return <div className="relative z-20 flex items-center gap-2"><Button type="button" onClick={() => setMenuOpen((value) => !value)} className="h-10 border border-white/10 bg-zinc-950/70 px-3 text-zinc-100 shadow-lg shadow-black/20 hover:border-[#71E0DC]/40 hover:bg-zinc-900"><span className="font-semibold truncate max-w-[190px]">{activeRound?.name || "Select Round"}</span><Badge className="ml-2 bg-[#71E0DC]/15 text-[#71E0DC] border border-[#71E0DC]/20">{activeRound?.questionIds?.length || 0}</Badge><ChevronDown size={16} className={`ml-2 transition-transform ${menuOpen ? "rotate-180" : ""}`} /></Button>{menuOpen && <div className="absolute left-0 top-12 w-[300px] rounded-xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/50 p-2"><div className="flex items-center justify-between gap-2 px-3 py-2"><p className="text-xs text-zinc-500">Rounds</p><button type="button" onClick={() => setManageOpen((value) => !value)} className={`text-xs font-semibold ${manageOpen ? "text-[#71E0DC]" : "text-zinc-400 hover:text-white"}`}>{manageOpen ? "Done" : "Manage"}</button></div><div className="space-y-1">{rounds.map((round, index) => { const active = round.id === activeRoundId; return <div key={round.id} className={`rounded-lg border transition-colors ${active ? "border-[#71E0DC]/30 bg-[#71E0DC]/10 text-white" : "border-transparent text-zinc-300 hover:bg-zinc-900/70 hover:text-white"}`}><button type="button" onClick={() => onSelect(round.id)} className="w-full px-3 py-2 text-left"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{round.name}</p><p className="text-xs text-zinc-500">Round {index + 1}</p></div><Badge className="bg-zinc-800 text-zinc-300">{round.questionIds?.length || 0}</Badge></div></button>{manageOpen && active && <div className="mx-2 mb-2 rounded-lg border border-[#71E0DC]/20 bg-zinc-950/70 p-2 space-y-2"><Label className="text-xs text-zinc-500">Editing this round</Label><div className="flex items-center gap-2"><Input value={round.name} onChange={(e) => onRename(round.id, e.target.value)} className="h-9 bg-zinc-950/70 border-white/10 text-white text-sm" /><Button title="Delete round" aria-label="Delete round" size="sm" variant="outline" onClick={() => onDelete(round.id)} className="h-9 w-9 p-0 border-zinc-700 text-zinc-400 hover:text-red-300"><Trash2 size={14} /></Button></div><Textarea value={round.description || ""} onChange={(e) => onDescribe(round.id, e.target.value)} placeholder="Round description or host notes" className="min-h-[64px] bg-zinc-950/70 border-white/10 text-white text-sm" /></div>}</div>; })}</div>{manageOpen && <><div className="my-2 h-px bg-white/10" /><Button type="button" onClick={onAdd} className="w-full h-9 gradient-btn"><Plus size={15} className="mr-2" />Add Round</Button><p className="px-2 pt-2 text-[11px] text-zinc-500">Select any round above to edit it in place.</p></>}</div>}</div>;
};
const BuilderToolbar = ({ showWriteForm, setShowWriteForm, showLibrary, onBrowseLibrary }) => <div className="rounded-xl border border-white/10 bg-zinc-950/35 p-3"><div className="flex flex-col md:flex-row md:items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Manual tools</p><p className="text-sm text-zinc-500 mt-1">Use these when you want to bypass the assistant.</p></div><div className="flex flex-wrap gap-2"><AddModeButton active={showWriteForm} icon={Pencil} label="Write" onClick={() => setShowWriteForm((value) => !value)} /><AddModeButton active={showLibrary} icon={List} label="Library" onClick={onBrowseLibrary} /></div></div></div>;
const AddModeButton = ({ active, icon: Icon, label, onClick }) => <Button type="button" variant="outline" onClick={onClick} className={`h-12 px-4 border-white/10 ${active ? "bg-[#71E0DC]/15 text-[#71E0DC] border-[#71E0DC]/30" : "bg-zinc-950/70 text-zinc-300 hover:text-white hover:bg-zinc-800"}`}><Icon size={18} className="mr-2" />{label}</Button>;
const CoHostModal = ({ prompt, setPrompt, loading, messages, candidates, onAsk, onClose, onAddToSession, onSaveToLibrary }) => <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-8 md:pt-14 overflow-y-auto"><div className="w-full max-w-5xl rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative"><button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close AI co-host"><X size={18} /></button><div className="mb-5"><h2 className="text-xl font-bold text-white flex items-center gap-2"><MessageSquare size={19} className="text-[#71E0DC]" />AI Co-Host Chat</h2><p className="mt-1 text-sm text-zinc-500">Work like you would in ChatGPT: ask for a vibe, push back, refine, and add only the questions you like.</p></div><div className="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] gap-4"><div className="rounded-xl border border-white/10 bg-zinc-950/40 p-3 flex flex-col min-h-[520px]"><div className="flex-1 space-y-3 overflow-y-auto pr-1">{messages.length ? messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${message.role === "user" ? "bg-[#71E0DC]/18 border border-[#71E0DC]/25 text-white" : "bg-zinc-900/90 border border-white/10 text-zinc-200"}`}>{message.content}</div></div>) : <div className="h-full min-h-[300px] flex items-center justify-center text-center text-zinc-500"><div><MessageSquare className="mx-auto mb-3 h-7 w-7 text-[#71E0DC]" /><p className="font-semibold text-zinc-300">Start with the way you actually work.</p><p className="mt-1 text-sm">Example: “I need a playful Round 2 with easier written answers and no repeat categories.”</p></div></div>}{loading && <div className="flex justify-start"><div className="rounded-2xl bg-zinc-900/90 border border-white/10 px-4 py-3 text-sm text-zinc-400"><Loader2 size={15} className="mr-2 inline animate-spin text-[#71E0DC]" />Thinking...</div></div>}</div><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Tell the co-host what you need. You can push back, ask for another angle, or ask it to use what is already in the round." className="mt-3 min-h-[104px] bg-zinc-950/70 border-white/10 text-white" /><div className="mt-3 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setPrompt("Review this active round and tell me what feels too hard, too repetitive, or missing for my regular US bar-trivia crowd.")} className="border-white/10 text-zinc-300 hover:text-white">Review Round</Button><Button type="button" variant="outline" onClick={() => setPrompt("Give me 4 playable written-answer candidates for this active round using approved categories only. Make the answers gettable without choices.")} className="border-white/10 text-zinc-300 hover:text-white">Written Help</Button><Button type="button" onClick={onAsk} disabled={loading || !normalizeText(prompt)} className="gradient-btn">{loading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}Send</Button></div></div><div className="rounded-xl border border-white/10 bg-zinc-950/30 p-3"><div className="mb-3 flex items-center justify-between gap-2"><div><p className="text-sm font-semibold text-white">Usable Drafts</p><p className="text-xs text-zinc-500">Add to this round or save for later.</p></div><Badge className="bg-zinc-800 text-zinc-300">{candidates.length}</Badge></div><div className="max-h-[640px] overflow-y-auto space-y-3 pr-1">{loading && !candidates.length ? <div className="rounded-lg border border-white/10 bg-zinc-950/50 p-6 text-center text-zinc-400"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-[#71E0DC]" />Drafting...</div> : candidates.length ? candidates.map((candidate) => <CoHostCandidateCard key={candidate.id} candidate={candidate} onAddToSession={() => onAddToSession(candidate)} onSaveToLibrary={() => onSaveToLibrary(candidate)} />) : <div className="rounded-lg border border-dashed border-white/10 bg-zinc-950/30 p-6 text-center text-zinc-500">When the co-host writes usable questions, they will appear here.</div>}</div></div></div></div></div>;
const AiGenerateModal = ({ theme, setTheme, difficulty, setDifficulty, generateType, setGenerateType, generateCount, setGenerateCount, generating, aiCandidates, aiActionId, onGenerate, onAddToSession, onSaveToLibrary, onRegenerate, onConvertType, onTuneDifficulty, onClose }) => <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-8 md:pt-14 overflow-y-auto"><div className="w-full max-w-4xl rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative"><button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close AI generator"><X size={18} /></button><div className="mb-5"><h2 className="text-xl font-bold text-white flex items-center gap-2"><Sparkles size={19} className="text-[#71E0DC]" />AI Questions</h2><p className="mt-1 text-sm text-zinc-500">Review candidates before adding them to this session.</p></div><div className="space-y-3"><label className="text-xs text-zinc-400 block">AI Direction<Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. 90s night, no sports, cozy nerd trivia" className="mt-1 h-11 bg-zinc-950 border-white/10 text-white" /></label><div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_110px] gap-3"><label className="text-xs text-zinc-400">Type<select value={generateType} onChange={(e) => setGenerateType(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60"><option value="true_false">True/False</option><option value="multiple_choice">Multiple Choice</option><option value="written">Written</option></select></label><label className="text-xs text-zinc-400">Difficulty<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-zinc-950 border border-white/10 px-3 text-white outline-none focus:border-[#71E0DC]/60"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="host_hard">Host Hard</option></select></label><label className="text-xs text-zinc-400">Count<Input value={generateCount} onChange={(e) => setGenerateCount(e.target.value)} className="mt-1 h-11 bg-zinc-950 border-white/10 text-white text-center" /></label></div></div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} className="border-white/10 text-zinc-300 hover:text-white">Cancel</Button><Button type="button" onClick={onGenerate} disabled={generating} className="gradient-btn">{generating ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}Generate Candidates</Button></div><div className="mt-5 space-y-3">{generating && !aiCandidates.length ? <div className="rounded-lg border border-white/10 bg-zinc-950/50 p-6 text-center text-zinc-400"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-[#71E0DC]" />Generating fresh candidates...</div> : aiCandidates.length ? aiCandidates.map((candidate) => <AiCandidateCard key={candidate.id} candidate={candidate} busy={String(aiActionId) === String(candidate.id)} onAddToSession={() => onAddToSession(candidate)} onSaveToLibrary={() => onSaveToLibrary(candidate)} onRegenQuestion={() => onRegenerate(candidate, "question")} onRegenCategory={() => onRegenerate(candidate, "category")} onConvertType={(targetType) => onConvertType(candidate, targetType)} onTuneDifficulty={(direction) => onTuneDifficulty(candidate, direction)} />) : <div className="rounded-lg border border-dashed border-white/10 bg-zinc-950/30 p-6 text-center text-zinc-500">Generate candidates to review them here before adding anything to the session.</div>}</div></div></div>;
const AiCandidateCard = ({ candidate, busy, onAddToSession, onSaveToLibrary, onRegenQuestion, onRegenCategory, onConvertType, onTuneDifficulty }) => <div className="rounded-lg border border-white/10 bg-zinc-950/55 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><QuestionMeta question={candidate} /><p className="mt-2 text-white font-semibold leading-relaxed">{candidate.question_text}</p><p className="mt-2 text-sm text-zinc-400">Answer: <span className="text-emerald-300">{candidate.correct_answer}</span></p>{candidate.options?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{candidate.options.map((option, index) => <span key={index} className="rounded bg-zinc-800/80 px-2 py-1 text-xs text-zinc-300">{option}</span>)}</div>}{candidate.fun_fact && <p className="mt-2 text-sm text-zinc-500">{candidate.fun_fact}</p>}</div>{busy && <Loader2 className="h-5 w-5 animate-spin text-[#71E0DC] flex-shrink-0" />}</div><div className="mt-4 flex flex-wrap gap-2 justify-end"><div className="flex rounded-md border border-white/10 bg-zinc-950/70 overflow-hidden"><IconAction label="Make easier" icon={Minus} onClick={() => onTuneDifficulty("easier")} disabled={busy} tone="success" /><IconAction label="Make harder" icon={Plus} onClick={() => onTuneDifficulty("harder")} disabled={busy} tone="warning" /></div><ConvertTypeSelect question={candidate} disabled={busy} onConvert={onConvertType} /><Button type="button" onClick={onAddToSession} disabled={busy} className="gradient-btn h-9"><Plus size={15} className="mr-2" />Add to Session</Button><Button type="button" variant="outline" onClick={onSaveToLibrary} disabled={busy} className="h-9 border-white/10 text-zinc-300 hover:text-white"><Save size={15} className="mr-2" />Library</Button><Button type="button" variant="outline" onClick={onRegenQuestion} disabled={busy} className="h-9 border-white/10 text-zinc-300 hover:text-white"><RefreshCw size={15} className="mr-2" />Regen Question</Button><Button type="button" variant="outline" onClick={onRegenCategory} disabled={busy} className="h-9 border-white/10 text-zinc-300 hover:text-white"><Tag size={15} className="mr-2" />Regen Category</Button></div></div>;
const CoHostCandidateCard = ({ candidate, onAddToSession, onSaveToLibrary }) => <div className="rounded-lg border border-white/10 bg-zinc-950/55 p-4"><QuestionMeta question={candidate} /><p className="mt-2 text-white font-semibold leading-relaxed">{candidate.question_text}</p><p className="mt-2 text-sm text-zinc-400">Answer: <span className="text-emerald-300">{candidate.correct_answer}</span></p>{candidate.options?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{candidate.options.map((option, index) => <span key={index} className="rounded bg-zinc-800/80 px-2 py-1 text-xs text-zinc-300">{option}</span>)}</div>}{candidate.fun_fact && <p className="mt-2 text-sm text-zinc-500">{candidate.fun_fact}</p>}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" onClick={onAddToSession} className="gradient-btn h-9"><Plus size={15} className="mr-2" />Add to Session</Button><Button type="button" variant="outline" onClick={onSaveToLibrary} className="h-9 border-white/10 text-zinc-300 hover:text-white"><Save size={15} className="mr-2" />Save to Library</Button></div></div>;
const FreeWriteModal = (props) => <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-8 md:pt-14 overflow-y-auto"><div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative"><button type="button" onClick={props.onCancel} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close write question"><X size={18} /></button><div className="mb-5"><h2 className="text-xl font-bold text-white flex items-center gap-2"><Pencil size={19} className="text-[#71E0DC]" />Write Question</h2><p className="mt-1 text-sm text-zinc-500">Create one question by hand, with optional AI drafting.</p></div><FreeWriteForm {...props} /></div></div>;
const LibraryModal = ({ typeFilter, setTypeFilter, searchQuery, setSearchQuery, availableQuestions, activeRound, selectedIds, generating, onGenerate, onToggleQuestion, onClose }) => <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-8 md:pt-14 overflow-y-auto"><div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative"><button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close library"><X size={18} /></button><div className="mb-5 flex items-start justify-between gap-4 pr-8 flex-wrap"><div><h2 className="text-xl font-bold text-white flex items-center gap-2"><Upload size={20} className="text-[#71E0DC]" />Unused Question Library</h2><p className="mt-1 text-sm text-zinc-500">Used questions and questions from saved sessions are hidden.</p></div><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-10 rounded-md bg-zinc-950/70 border border-white/10 text-white px-3 text-sm">{questionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div><div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" /><Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search unused questions..." className="pl-9 bg-zinc-950/70 border-white/10 text-white" /></div><ScrollArea className="h-[62vh] pr-3">{availableQuestions.length === 0 ? <div className="text-center py-16"><p className="text-zinc-500">No unused questions match this view.</p><Button onClick={onGenerate} disabled={generating} className="gradient-btn mt-4">{generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles size={16} className="mr-2" />}Generate For {activeRound.name}</Button></div> : <div className="space-y-3">{availableQuestions.map((question) => <QuestionRow key={question.id} question={question} selected={(activeRound.questionIds || []).map(String).includes(String(question.id))} alreadyInSession={selectedIds.has(String(question.id)) && !(activeRound.questionIds || []).map(String).includes(String(question.id))} onClick={() => onToggleQuestion(question)} />)}</div>}</ScrollArea></div></div>;
const IconAction = ({ label, icon: Icon, onClick, active, disabled, spin }) => <Button title={label} aria-label={label} variant="outline" type="button" disabled={disabled} onClick={onClick} className={`h-10 w-10 p-0 border-white/10 ${active ? "bg-[#71E0DC]/15 text-[#71E0DC]" : "bg-zinc-950/70 text-zinc-300 hover:bg-zinc-800 hover:text-white"}`}><Icon size={18} className={spin ? "animate-spin" : ""} /></Button>;
const MediaFields = ({ imageUrl, timing, onUrlChange, onTimingChange }) => { const handleDrop = async (event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (!file || !file.type.startsWith("image/")) return toast.error("Choose an image file"); onUrlChange(await fileToDataUrl(file)); }; return <div className="rounded-md border border-[#71E0DC]/20 bg-zinc-950/30 p-3 space-y-3"><div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><Label className="text-zinc-300">Media</Label><TimingButtons value={timing} onChange={onTimingChange} /></div><div className="relative"><Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" /><Input value={imageUrl || ""} onChange={(e) => onUrlChange(e.target.value)} placeholder="Image or media URL" className="pl-9 bg-zinc-950/50 border-white/10 text-white" /></div><div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} className="rounded-md border border-dashed border-white/10 bg-zinc-950/40 p-3 text-sm text-zinc-500 min-h-16 flex items-center gap-3">{imageUrl ? <img src={imageUrl} alt="Question media preview" className="h-12 w-12 rounded object-cover border border-white/10" /> : <Upload size={18} className="text-zinc-400" />}<span>{imageUrl ? "Media attached. Drop a new photo here to replace it." : "Drop a photo here or paste a media URL above. Pictures are optional for every question."}</span></div></div>; };
const FreeWriteForm = ({ form, setForm, categories, onSubmit, onCancel, onAssist, draftGenerating }) => { const updateWrong = (index, value) => setForm((prev) => ({ ...prev, incorrect_answers: prev.incorrect_answers.map((answer, i) => (i === index ? value : answer)) })); const randomizeCategory = () => { const pool = categories.filter(Boolean); if (!pool.length) return toast.error("No approved categories yet"); const options = pool.length > 1 ? pool.filter((category) => category !== form.category) : pool; const category = options[Math.floor(Math.random() * options.length)]; setForm((prev) => ({ ...prev, category })); }; return <div className="mb-5 rounded-md border border-[#71E0DC]/20 bg-zinc-950/40 p-4 space-y-4"><div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3"><select value={form.question_type} onChange={(e) => setForm((prev) => ({ ...prev, question_type: e.target.value }))} className="h-10 rounded-md bg-zinc-950/50 border border-white/10 text-white px-3"><option value="written">Free Response</option><option value="true_false">True/False</option><option value="multiple_choice">Multiple Choice</option></select><div className="flex gap-2"><Input value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} placeholder={categories[0] || "Category"} list="approved-category-list" className="bg-zinc-950/50 border-white/10 text-white" /><Button type="button" title="Random approved category" aria-label="Random approved category" onClick={randomizeCategory} className="h-10 w-10 p-0 bg-zinc-950/70 border border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white flex-shrink-0"><RefreshCw size={16} /></Button></div></div><datalist id="approved-category-list">{categories.map((category) => <option key={category} value={category} />)}</datalist><div className="relative"><Textarea value={form.question_text} onChange={(e) => setForm((prev) => ({ ...prev, question_text: e.target.value }))} placeholder="Question" className="bg-zinc-950/50 border-white/10 text-white min-h-[86px] pr-12" /><Button type="button" title="AI draft question" aria-label="AI draft question" onClick={onAssist} disabled={draftGenerating} className="absolute right-2 top-2 h-9 w-9 p-0 bg-zinc-950/70 border border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white">{draftGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}</Button></div><Input value={form.correct_answer} onChange={(e) => setForm((prev) => ({ ...prev, correct_answer: e.target.value }))} placeholder="Correct answer" className="bg-zinc-950/50 border-white/10 text-white" />{form.question_type === "multiple_choice" && <div className="grid grid-cols-1 md:grid-cols-3 gap-2">{form.incorrect_answers.map((answer, index) => <Input key={index} value={answer} onChange={(e) => updateWrong(index, e.target.value)} placeholder={`Wrong answer ${index + 1}`} className="bg-zinc-950/50 border-white/10 text-white" />)}</div>}<Input value={form.fun_fact} onChange={(e) => setForm((prev) => ({ ...prev, fun_fact: e.target.value }))} placeholder="Fun fact" className="bg-zinc-950/50 border-white/10 text-white" /><MediaFields imageUrl={form.image_url} timing={form.image_timing} onUrlChange={(value) => setForm((prev) => ({ ...prev, image_url: value }))} onTimingChange={(value) => setForm((prev) => ({ ...prev, image_timing: value }))} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel} className="border-zinc-700 text-zinc-400">Cancel</Button><Button onClick={onSubmit} className="gradient-btn"><Plus size={16} className="mr-2" />Create Question</Button></div></div>; };
const QuestionSettingsModal = ({ question, roundName, onClose, onApply }) => { const settings = getQuestionSettings(question); const [form, setForm] = useState({ points: String(settings.points || ""), timer_seconds: String(settings.timer_seconds || 30), wager_limit: String(settings.wager_limit || 0), wager_timing: normalizeWagerTiming(settings.wager_timing) }); const patch = { points: form.points === "" ? "" : Math.max(0, Number(form.points) || 0), timer_seconds: Math.max(0, Number(form.timer_seconds) || 0), wager_limit: Math.max(0, Number(form.wager_limit) || 0), wager_timing: normalizeWagerTiming(form.wager_timing) }; const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value })); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"><div className="w-full max-w-md rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-5 relative"><button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close settings"><X size={18} /></button><div className="mb-5"><h2 className="text-xl font-bold text-white flex items-center gap-2"><Settings size={19} className="text-[#71E0DC]" />Question Settings</h2><p className="mt-1 text-sm text-zinc-500 line-clamp-2">{question.question_text}</p></div><div className="space-y-4"><SettingInput icon={Coins} label="Points" value={form.points} onChange={(value) => update("points", value)} placeholder="Type default" /><SettingInput icon={Clock} label="Timer (seconds)" value={form.timer_seconds} onChange={(value) => update("timer_seconds", value)} /><SettingInput icon={Coins} label="Free wager limit" value={form.wager_limit} onChange={(value) => update("wager_limit", value)} /><div><Label className="text-zinc-300">Wager timing</Label><div className="mt-2 grid grid-cols-2 rounded-md bg-zinc-900 p-1"><button type="button" onClick={() => update("wager_timing", "before_answer")} className={`h-10 rounded text-sm font-semibold ${form.wager_timing === "before_answer" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}>Before Answer</button><button type="button" onClick={() => update("wager_timing", "after_answer")} className={`h-10 rounded text-sm font-semibold ${form.wager_timing === "after_answer" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}>After Answer</button></div><p className="mt-1 text-xs text-zinc-500">A wager limit of 0 means no wager for this question.</p></div></div><div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2"><Button type="button" onClick={() => onApply(patch, "question")} className="gradient-btn">Save</Button><Button type="button" onClick={() => onApply(patch, "round")} className="bg-zinc-950/70 border border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white">Apply to {roundName}</Button><Button type="button" onClick={() => onApply(patch, "all")} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100">Apply to All</Button></div></div></div>; };
const SettingInput = ({ icon: Icon, label, value, onChange, placeholder }) => <label className="block"><Label className="text-zinc-300">{label}</Label><div className="relative mt-2"><Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" /><Input type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9 bg-zinc-900 border-transparent text-white h-10" /></div></label>;
const MediaModal = ({ question, onClose, onSave }) => {
  const [url, setUrl] = useState(question.image_url || "");
  const [timing, setTiming] = useState(normalizeImageTiming(question.image_timing));
  const [dragging, setDragging] = useState(false);
  const [imagePrompt, setImagePrompt] = useState([question.category, question.question_text].filter(Boolean).join(": "));
  const [generatingImage, setGeneratingImage] = useState(false);
  const handleFile = async (file) => { if (!file || !file.type.startsWith("image/")) return toast.error("Choose an image file"); setUrl(await fileToDataUrl(file)); };
  const handleDrop = async (event) => { event.preventDefault(); setDragging(false); await handleFile(event.dataTransfer.files?.[0]); };
  const handleGenerateImage = async () => {
    setGeneratingImage(true);
    try {
      const { data } = await axios.post("/api/generate-session-candidates", { mode: "image", prompt: imagePrompt || question.question_text }, { timeout: 120000 });
      if (!data?.image_url) throw new Error("No image returned");
      setUrl(data.image_url);
      toast.success("Image generated");
    } catch (error) {
      console.error("Generate image error:", error);
      toast.error(error.response?.data?.error || error.message || "Failed to generate image");
    } finally {
      setGeneratingImage(false);
    }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"><div className="w-full max-w-lg rounded-xl bg-[#17181c] border border-white/10 shadow-2xl shadow-black/60 p-6 relative"><button type="button" onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white" aria-label="Close media"><X size={18} /></button><h2 className="text-xl font-bold text-white mb-6">Media</h2><TimingButtons value={timing} onChange={setTiming} /><p className="text-center text-sm text-zinc-500 my-5">{timing === "after_answer" ? "This image will be shown after the answer is released" : "This image will be shown during the question"}</p><div className="flex gap-2 mb-4"><div className="relative flex-1"><Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" /><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enter image URL" className="pl-9 bg-zinc-800 border-transparent text-white h-10" /></div><Button type="button" onClick={() => setUrl(url.trim())} className="h-10 bg-zinc-950/70 border border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white">Add</Button></div><div className="mb-5 rounded-lg border border-[#71E0DC]/20 bg-[#71E0DC]/5 p-3"><Label className="text-zinc-300">Generate image</Label><Textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} className="mt-2 min-h-[74px] bg-zinc-950/70 border-white/10 text-white" placeholder="Describe the visual clue you want..." /><Button type="button" onClick={handleGenerateImage} disabled={generatingImage} className="gradient-btn mt-3 w-full">{generatingImage ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Image size={16} className="mr-2" />}Generate Image</Button></div><div className="flex items-center gap-3 mb-4"><div className="h-px bg-white/10 flex-1" /><span className="text-sm text-zinc-500">or upload</span><div className="h-px bg-white/10 flex-1" /></div><label onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} className={`h-60 rounded-md border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${dragging ? "border-[#71E0DC] bg-[#71E0DC]/10" : "border-zinc-400 bg-zinc-950/20 hover:border-[#71E0DC]"}`}>{url ? <img src={url} alt="Question media preview" className="max-h-52 max-w-full rounded object-contain" /> : <><Upload className="mb-3 text-white" size={28} /><p className="text-white font-medium">Drag an image or click to upload</p></>}<input type="file" accept="image/*" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} /></label>{url && <Button type="button" variant="ghost" onClick={() => setUrl("")} className="mt-3 text-zinc-400 hover:text-white">Remove image</Button>}<Button type="button" onClick={() => onSave({ image_url: url.trim(), image_timing: timing })} className="w-full h-11 gradient-btn mt-6">Save</Button></div></div>;
};
const SelectedRoundList = ({ questions, rounds, activeRoundId, mediaQuestionId, settingsQuestionId, actionQuestionId, onOpenMedia, onOpenSettings, onMoveWithinRound, onMoveToRound, onRemove, onUpdate, onSaveToLibrary, onRefresh, onConvertType, onTuneDifficulty, onChatEdit, onRejectQuestion, onRejectCategory }) => {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const startEdit = (question) => {
    setEditingId(question.id);
    setChatPrompt("");
    setChatAnswer("");
    setEditForm({
      question_type: normalizeType(question),
      category: question.category || "",
      question_text: question.question_text || "",
      correct_answer: question.correct_answer || "",
      incorrect_answers: [...(question.options || parseAnswerOptions(question.incorrect_answers)), "", "", ""].slice(0, 3),
      fun_fact: question.fun_fact || ""
    });
  };
  const formFromQuestion = (question) => ({
    question_type: normalizeType(question),
    category: question.category || "",
    question_text: question.question_text || "",
    correct_answer: question.correct_answer || "",
    incorrect_answers: [...(question.options || parseAnswerOptions(question.incorrect_answers)), "", "", ""].slice(0, 3),
    fun_fact: question.fun_fact || ""
  });
  const buildEditableQuestion = (question) => {
    const type = normalizeType(editForm);
    return normalizeQuestion({
      ...question,
      question_type: type,
      type,
      category: editForm.category,
      question_text: editForm.question_text,
      correct_answer: type === "true_false" ? (String(editForm.correct_answer).toLowerCase() === "false" ? "False" : "True") : editForm.correct_answer,
      incorrect_answers: type === "multiple_choice" ? cleanList(editForm.incorrect_answers).join("; ") : type === "true_false" ? (String(editForm.correct_answer).toLowerCase() === "false" ? "True" : "False") : null,
      fun_fact: editForm.fun_fact
    }, type);
  };
  const convertEdit = async (question, targetType) => {
    if (!editForm) return;
    const converted = await onConvertType(buildEditableQuestion(question), targetType);
    if (converted) setEditForm(formFromQuestion(converted));
  };
  const askQuestionEditor = async (question, promptOverride = "") => {
    const instruction = normalizeText(promptOverride || chatPrompt);
    if (!instruction) return toast.error("Tell the co-host what to change");
    const result = await onChatEdit(buildEditableQuestion(question), instruction);
    if (!result?.question) return;
    setEditForm(formFromQuestion(result.question));
    setChatAnswer(result.answer || "");
    setChatPrompt("");
  };
  const saveEdit = () => {
    if (!editingId || !editForm) return;
    const type = normalizeType(editForm);
    onUpdate(editingId, {
      question_type: type,
      category: editForm.category,
      question_text: editForm.question_text,
      correct_answer: type === "true_false" ? (String(editForm.correct_answer).toLowerCase() === "false" ? "False" : "True") : editForm.correct_answer,
      incorrect_answers: type === "multiple_choice" ? cleanList(editForm.incorrect_answers).join("; ") : type === "true_false" ? (String(editForm.correct_answer).toLowerCase() === "false" ? "True" : "False") : null,
      fun_fact: editForm.fun_fact
    });
    setEditingId(null);
    setEditForm(null);
    toast.success("Question updated");
  };
  if (!questions.length) return <div className="min-h-[260px] flex items-center justify-center text-center"><div><p className="text-2xl font-bold text-white mb-1">No Questions</p><p className="text-zinc-500">Create, browse, or generate questions for this round.</p></div></div>;
  return <div className="space-y-2">{questions.map((question, index) => {
    const busy = String(actionQuestionId) === String(question.id);
    const currentRoundId = rounds.find((round) => (round.questionIds || []).map(String).includes(String(question.id)))?.id || activeRoundId;
    const otherRounds = rounds.filter((round) => String(round.id) !== String(currentRoundId));
    const editing = String(editingId) === String(question.id);
    return <div key={question.id} className="rounded-md bg-zinc-950/40 border border-white/10 p-3"><div className="flex items-start gap-3"><span className="text-zinc-500 text-sm font-mono mt-0.5 w-6 text-right">{index + 1}</span><div className="flex-1 min-w-0"><QuestionMeta question={question} /><p className="text-white text-sm mt-1 leading-relaxed">{question.question_text}</p><p className="text-zinc-500 text-xs mt-1">Answer: <span className="text-emerald-400">{question.correct_answer}</span></p><QuestionSettingsSummary question={question} />{question.image_prompt && <p className="text-amber-200 text-xs mt-1">Image idea: {question.image_prompt}</p>}{question.image_url && <p className="text-amber-300 text-xs mt-1">Media attached: {normalizeImageTiming(question.image_timing) === "after_answer" ? "after answer" : "before answer"}</p>}</div><div className="flex gap-1 flex-wrap justify-end items-start"><RowIcon label="Move up" icon={ArrowUp} onClick={() => onMoveWithinRound(currentRoundId, question.id, -1)} disabled={index === 0} /><RowIcon label="Move down" icon={ArrowDown} onClick={() => onMoveWithinRound(currentRoundId, question.id, 1)} disabled={index === questions.length - 1} /><RowIcon label="Question settings" icon={Settings} onClick={() => onOpenSettings(question.id)} active={String(settingsQuestionId) === String(question.id)} /><RowIcon label="Edit question" icon={Pencil} onClick={() => editing ? setEditingId(null) : startEdit(question)} active={editing} /><RowIcon label="Save to library" icon={Save} onClick={() => onSaveToLibrary(question)} /><RowIcon label="Add media" icon={Image} onClick={() => onOpenMedia(question.id)} active={String(mediaQuestionId) === String(question.id) || Boolean(question.image_url)} />{question.isGenerated && <RowIcon label="Refresh question" icon={busy ? Loader2 : RefreshCw} onClick={() => onRefresh(question)} disabled={busy} spin={busy} />}{question.isGenerated && <ConvertTypeSelect question={question} disabled={busy} onConvert={(targetType) => onConvertType(question, targetType)} />}<MoveToRoundSelect questionId={question.id} otherRounds={otherRounds} onMoveToRound={onMoveToRound} />{question.isGenerated && <RowIcon label="Reject question" icon={Ban} onClick={() => onRejectQuestion(question)} tone="danger" />}{question.isGenerated && <RowIcon label="Reject category" icon={Tag} onClick={() => onRejectCategory(question)} tone="warning" />}<RowIcon label="Remove" icon={X} onClick={() => onRemove(question.id)} /></div></div>{editing && editForm && <div className="mt-3 rounded-md border border-white/10 bg-zinc-950/50 p-3 space-y-3"><div className="rounded-lg border border-[#71E0DC]/20 bg-[#71E0DC]/5 p-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-white flex items-center gap-2"><MessageSquare size={15} className="text-[#71E0DC]" />Talk to AI about this question</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => askQuestionEditor(question, "Make this a false true/false question while keeping the same trivia idea.")} className="h-8 border-white/10 text-zinc-300 hover:text-white">Make False</Button><Button type="button" variant="outline" disabled={busy} onClick={() => askQuestionEditor(question, "This is close, but make it easier and more gettable for a US bar-trivia team.")} className="h-8 border-white/10 text-zinc-300 hover:text-white">Easier</Button><Button type="button" variant="outline" disabled={busy} onClick={() => askQuestionEditor(question, "Keep the idea, but make this better as a written-answer question with a fair clue path.")} className="h-8 border-white/10 text-zinc-300 hover:text-white">Better Written</Button></div></div><Textarea value={chatPrompt} onChange={(event) => setChatPrompt(event.target.value)} placeholder="Example: make this false, keep the category, and make the clue less obscure." className="min-h-[72px] bg-zinc-950/70 border-white/10 text-white text-sm" /><div className="flex flex-wrap items-center justify-between gap-2">{chatAnswer ? <p className="text-xs text-zinc-400 flex-1">{chatAnswer}</p> : <p className="text-xs text-zinc-500 flex-1">AI changes fill the fields below. Review, tweak, then save edits.</p>}<Button type="button" onClick={() => askQuestionEditor(question)} disabled={busy || !normalizeText(chatPrompt)} className="h-9 gradient-btn">{busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Sparkles size={14} className="mr-2" />}Ask</Button></div></div><div className="grid grid-cols-1 md:grid-cols-[160px_1fr_150px] gap-2"><select value={editForm.question_type} onChange={(e) => setEditForm((prev) => ({ ...prev, question_type: e.target.value }))} className="h-9 rounded-md bg-zinc-950/70 border border-white/10 text-white px-2 text-sm"><option value="written">Written</option><option value="true_false">True/False</option><option value="multiple_choice">Multiple Choice</option></select><Input value={editForm.category} onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))} placeholder="Category" className="h-9 bg-zinc-950/70 border-white/10 text-white text-sm" /><ConvertTypeSelect question={{ ...question, question_type: editForm.question_type }} disabled={busy} onConvert={(targetType) => convertEdit(question, targetType)} className="h-9" /></div><Textarea value={editForm.question_text} onChange={(e) => setEditForm((prev) => ({ ...prev, question_text: e.target.value }))} placeholder="Question" className="min-h-[80px] bg-zinc-950/70 border-white/10 text-white text-sm" /><Input value={editForm.correct_answer} onChange={(e) => setEditForm((prev) => ({ ...prev, correct_answer: e.target.value }))} placeholder="Correct answer" className="h-9 bg-zinc-950/70 border-white/10 text-white text-sm" />{editForm.question_type === "multiple_choice" && <div className="grid grid-cols-1 md:grid-cols-3 gap-2">{editForm.incorrect_answers.map((answer, answerIndex) => <Input key={answerIndex} value={answer} onChange={(e) => setEditForm((prev) => ({ ...prev, incorrect_answers: prev.incorrect_answers.map((item, itemIndex) => itemIndex === answerIndex ? e.target.value : item) }))} placeholder={`Wrong answer ${answerIndex + 1}`} className="h-9 bg-zinc-950/70 border-white/10 text-white text-sm" />)}</div>}<Input value={editForm.fun_fact} onChange={(e) => setEditForm((prev) => ({ ...prev, fun_fact: e.target.value }))} placeholder="Fun fact" className="h-9 bg-zinc-950/70 border-white/10 text-white text-sm" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setEditingId(null); setEditForm(null); setChatPrompt(""); setChatAnswer(""); }} className="h-9 border-zinc-700 text-zinc-400">Cancel</Button><Button onClick={saveEdit} className="h-9 gradient-btn"><Save size={14} className="mr-2" />Save Edits</Button></div></div>}</div>;
  })}</div>;
};
const MoveToRoundSelect = ({ questionId, otherRounds, onMoveToRound }) => {
  const hasTargets = Array.isArray(otherRounds) && otherRounds.length > 0;
  return (
    <select
      aria-label="Move question to round"
      title={hasTargets ? "Move question to another round" : "No other rounds available"}
      value=""
      disabled={!hasTargets}
      onChange={(event) => {
        if (event.target.value) onMoveToRound(questionId, event.target.value);
        event.target.value = "";
      }}
      className="h-8 min-w-[118px] shrink-0 rounded-md bg-zinc-950/70 border border-white/10 text-zinc-300 px-2 text-xs disabled:opacity-60"
    >
      <option value="">Move to...</option>
      {hasTargets ? otherRounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>) : <option value="" disabled>No other rounds</option>}
    </select>
  );
};
const ConvertTypeSelect = ({ question, disabled, onConvert, className = "h-8" }) => <select aria-label="Convert question type" title="Convert question type with AI" value="" disabled={disabled} onChange={(event) => { onConvert(event.target.value); event.target.value = ""; }} className={`${className} rounded-md bg-zinc-950/70 border border-white/10 text-zinc-300 px-2 text-xs disabled:opacity-50`}><option value="">Convert...</option>{convertibleQuestionTypes.filter((type) => type.value !== normalizeType(question)).map((type) => <option key={type.value} value={type.value}>To {type.label}</option>)}</select>;
const QuestionSettingsSummary = ({ question }) => { const settings = getQuestionSettings(question); const hasWager = Number(settings.wager_limit || 0) > 0; return <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-zinc-500"><span>{settings.points === "" ? "type pts" : `${settings.points} pts`}</span><span>{settings.timer_seconds || 0}s</span>{hasWager && <span>Wager up to {settings.wager_limit} {settings.wager_timing === "after_answer" ? "after" : "before"}</span>}</div>; };
const RowIcon = ({ label, icon: Icon, onClick, active, disabled, spin, tone }) => <Button title={label} aria-label={label} size="sm" variant="ghost" disabled={disabled} onClick={onClick} className={`h-8 w-8 p-0 text-zinc-500 ${active ? "text-[#71E0DC] bg-[#71E0DC]/10" : tone === "danger" ? "hover:text-red-300" : tone === "warning" ? "hover:text-amber-300" : tone === "success" ? "hover:text-emerald-300" : "hover:text-white"}`}><Icon size={15} className={spin ? "animate-spin" : ""} /></Button>;
const QuestionMeta = ({ question }) => { const type = normalizeType(question); const typeConfig = questionTypes.find((item) => item.value === type) || questionTypes[0]; const Icon = typeConfig.icon; return <div className="flex items-center gap-2 flex-wrap"><Badge variant="outline" className="text-xs border-zinc-700 text-zinc-400">{question.category}</Badge><Badge className="bg-zinc-800 text-zinc-300 text-xs"><Icon size={12} className={`mr-1 ${typeConfig.color}`} />{typeConfig.shortLabel}</Badge>{question.isGenerated && <Badge className="bg-[#71E0DC]/15 text-[#71E0DC] text-xs">AI</Badge>}</div>; };
const QuestionRow = ({ question, selected, alreadyInSession, onClick }) => <div onClick={onClick} className={`session-question-card ${selected ? "selected" : ""} ${alreadyInSession ? "opacity-60" : ""}`}><div className="flex items-start justify-between gap-3"><div className="flex-1 min-w-0"><QuestionMeta question={question} /><p className="text-white text-sm mt-2">{question.question_text}</p><p className="text-zinc-500 text-xs mt-1">Answer: <span className="text-emerald-400">{question.correct_answer}</span></p>{question.image_url && <p className="text-amber-300 text-xs mt-1">Media attached</p>}{question.options?.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{question.options.map((option, index) => <span key={index} className="text-xs px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400">{option}</span>)}</div>}</div><div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? "bg-[#71E0DC] border-[#71E0DC]" : "border-zinc-600"}`}>{selected && <Check size={14} className="text-zinc-900" />}</div></div></div>;

export default BuildSession;










