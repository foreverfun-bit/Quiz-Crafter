import { profileKeys, readLocalJson, saveProfileValue, syncProfileJson, writeLocalJson } from "./profileState";

export const CLUE_HISTORY_KEY = "quiz-crafter-clue-history-v1";
const MAX_HISTORY = 30;

const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeEntry = (entry = {}) => ({
  id: entry.id || `clue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  sessionName: cleanText(entry.sessionName),
  message: cleanText(entry.message),
  socialPost: cleanText(entry.socialPost),
  categories: Array.isArray(entry.categories) ? entry.categories.map(cleanText).filter(Boolean).slice(0, 8) : [],
  createdAt: entry.createdAt || new Date().toISOString(),
});

// Newest wins on an id collision (e.g. the same draft edited and re-logged).
const dedupeHistory = (entries) => {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry.message && !entry.socialPost) return;
    const existing = map.get(entry.id);
    if (!existing || new Date(entry.createdAt) > new Date(existing.createdAt)) map.set(entry.id, entry);
  });
  return [...map.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, MAX_HISTORY);
};

export const readClueHistory = () => dedupeHistory(readLocalJson(CLUE_HISTORY_KEY, []));

export const writeClueHistory = (entries) => {
  const normalized = dedupeHistory(entries);
  writeLocalJson(CLUE_HISTORY_KEY, normalized);
  return normalized;
};

export const syncClueHistory = async () => {
  const merged = await syncProfileJson({ localKey: CLUE_HISTORY_KEY, profileKey: profileKeys.clueHistory, fallback: [], merge: "array" });
  return writeClueHistory(merged);
};

// Logged when the host actually copies/opens a post to publish it, not when
// AI first drafts it -- that way the history (and the style it teaches
// future drafts) reflects posts the host chose to use, edits included,
// rather than every rough first draft.
export const logCluePost = async ({ sessionName, message, socialPost, categories }) => {
  const entry = normalizeEntry({ sessionName, message, socialPost, categories });
  if (!entry.message && !entry.socialPost) return readClueHistory();
  const next = writeClueHistory([entry, ...readClueHistory()]);
  try {
    await saveProfileValue(profileKeys.clueHistory, next);
  } catch (error) {
    console.warn("Clue history profile save unavailable:", error);
  }
  return next;
};

export const buildClueStyleExamples = (history = readClueHistory(), limit = 6) =>
  [...new Set(history.map((entry) => entry.socialPost).filter(Boolean))].slice(0, limit);
