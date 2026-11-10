import { supabase } from "./supabase";
import { dedupeCategories } from "./categories";

export const profileKeys = {
  categoryPrefs: "quiz_crafter_category_preferences_v1",
  rejectedAi: "quiz_crafter_rejected_ai_questions_v1",
  generatedHistory: "quiz_crafter_recent_ai_suggestions_v1",
  lockedCategories: "quiz_crafter_locked_generator_categories_v1",
  questionMemory: "quiz_crafter_question_memory_v1",
  usedQuestionIds: "quiz_crafter_used_question_ids_v1",
  unusedQuestionIds: "quiz_crafter_unused_question_ids_v1",
  socialLinks: "quiz_crafter_social_links_v1",
  outreachContacts: "quiz_crafter_outreach_contacts_v1",
  hostSetup: "quiz_crafter_host_setup_v1",
  venues: "quiz_crafter_venues_v1",
  showTemplates: "quiz_crafter_show_templates_v1",
  activeVenueId: "quiz_crafter_active_venue_id",
  brandingDefaults: "quiz_crafter_host_branding_defaults_v1",
  hostStyleProfile: "quiz_crafter_host_style_profile_v1",
  clueHistory: "quiz_crafter_clue_history_v1",
  currentProjectSessionId: "quiz_crafter_current_project_session_id",
};

export const HOST_SETUP_CATEGORY = "__quiz_crafter_host_setup_v1";

export const readLocalJson = (localKey, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(localKey) || JSON.stringify(fallback));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
};

export const writeLocalJson = (localKey, value) => {
  try {
    localStorage.setItem(localKey, JSON.stringify(value));
  } catch {
    // Local cache is only a fallback for profile-backed settings.
  }
};

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const mergeArrays = (remote, local) => [...new Set([...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])].filter(Boolean))];
let metadataUpdateQueue = Promise.resolve();

export const updateUserMetadata = (patch) => {
  const task = metadataUpdateQueue.catch(() => {}).then(async () => {
    const { data, error: loadError } = await supabase.auth.getSession();
    if (loadError) throw loadError;
    const currentMetadata = isPlainObject(data?.session?.user?.user_metadata) ? data.session.user.user_metadata : {};
    const nextMetadata = { ...currentMetadata, ...(isPlainObject(patch) ? patch : {}) };
    const { error } = await supabase.auth.updateUser({ data: nextMetadata });
    if (error) throw error;
    return nextMetadata;
  });
  metadataUpdateQueue = task;
  return task;
};

export const saveProfileValue = async (profileKey, value) => {
  await updateUserMetadata({ [profileKey]: value });
  return value;
};

const parseSetupStatus = (value) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const loadHostSetupSettings = async () => {
  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: null }));
  return parseSetupStatus(sessionData?.session?.user?.user_metadata?.[profileKeys.hostSetup]);
};

export const saveHostSetupSettings = async (patch) => {
  const current = await loadHostSetupSettings().catch(() => ({}));
  const next = { ...current, ...(isPlainObject(patch) ? patch : {}), updatedAt: new Date().toISOString() };
  const metadataPatch = { [profileKeys.hostSetup]: next };
  if (Array.isArray(next.venues)) metadataPatch[profileKeys.venues] = next.venues;
  if (Array.isArray(next.templates)) metadataPatch[profileKeys.showTemplates] = next.templates;
  if (next.activeVenueId !== undefined) metadataPatch[profileKeys.activeVenueId] = next.activeVenueId;
  if (isPlainObject(next.branding)) metadataPatch[profileKeys.brandingDefaults] = next.branding;
  await updateUserMetadata(metadataPatch);
  return next;
};

export const loadProfileValue = async (profileKey) => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session?.user?.user_metadata?.[profileKey];
};

export const syncProfileJson = async ({ localKey, profileKey, fallback, merge = "remote" }) => {
  const localValue = readLocalJson(localKey, fallback);
  const remoteValue = await loadProfileValue(profileKey);
  let nextValue = remoteValue ?? localValue;

  if (merge === "array") nextValue = mergeArrays(remoteValue, localValue);
  if (merge === "object" && isPlainObject(remoteValue) && isPlainObject(localValue)) nextValue = { ...remoteValue, ...localValue };
  if (merge === "categoryPrefs") {
    nextValue = {
      approved: dedupeCategories(mergeArrays(remoteValue?.approved, localValue?.approved)),
      rejected: dedupeCategories(mergeArrays(remoteValue?.rejected, localValue?.rejected)),
      // Removed is distinct from rejected -- a deleted duplicate, not a
      // category the host dislikes -- so it must survive this merge the
      // same way approved/rejected do, or it would quietly reappear on the
      // next sync (nextValue below replaces the whole stored object).
      removed: dedupeCategories(mergeArrays(remoteValue?.removed, localValue?.removed)),
    };
  }

  writeLocalJson(localKey, nextValue);
  if (remoteValue === undefined || JSON.stringify(remoteValue) !== JSON.stringify(nextValue)) {
    await saveProfileValue(profileKey, nextValue);
  }
  return nextValue;
};

const CURRENT_PROJECT_LOCAL_KEY = "quiz-crafter-current-project-session-id";

// Local storage is authoritative here once anything has been written locally --
// the remote save (updateUser -> PUT /auth/v1/user) can be unavailable for
// extended stretches, and silently reverting the marker on next page load
// because the remote write never landed would be worse than just trusting
// this browser's last write. Remote is only consulted as a first-time
// fallback for a browser/device that has never toggled this locally.
export const readCurrentProjectSessionId = () => {
  try {
    const raw = localStorage.getItem(CURRENT_PROJECT_LOCAL_KEY);
    if (raw === null) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const writeCurrentProjectSessionId = (sessionId) => {
  const value = sessionId || null;
  writeLocalJson(CURRENT_PROJECT_LOCAL_KEY, value);
  saveProfileValue(profileKeys.currentProjectSessionId, value).catch((error) => console.warn("Current project remote sync unavailable:", error));
  return value;
};

// Lives in its own host_tools_state table (one row per session, keyed by
// session_id) rather than user_metadata -- this used to be one giant object
// under a single user_metadata key, with every session's players/answers/
// activity/feedback/etc ever hosted accumulating in it forever (nothing
// ever pruned old sessions out). Supabase embeds user_metadata in the JWT,
// so that blob grew right along with the access token on every request;
// for an account with many hosted sessions it reached 175KB+, and both the
// oversized token and the oversized updateUser() request body it took to
// save it started failing outright with a bare "Failed to fetch". Per-row
// storage means a save only ever touches one session's data, and nothing
// here rides along on auth requests anymore.
export const loadHostToolsSessionState = async (sessionId) => {
  if (!sessionId) return {};
  const { data, error } = await supabase.from("host_tools_state").select("data").eq("session_id", sessionId);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return isPlainObject(row?.data) ? row.data : {};
};

let hostToolsSessionSaveQueue = Promise.resolve();

export const saveHostToolsSessionState = (sessionId, patch) => {
  const task = hostToolsSessionSaveQueue.catch(() => {}).then(async () => {
    const current = await loadHostToolsSessionState(sessionId);
    const next = { ...current, ...patch };
    const { error } = await supabase.from("host_tools_state").upsert({ session_id: sessionId, data: next, updated_at: new Date().toISOString() });
    if (error) throw error;
    return next;
  });
  hostToolsSessionSaveQueue = task;
  return task;
};

// Shared with HostSession.jsx's localStorage reads/writes -- keep the key
// shape in sync there.
export const hostToolsStorageKey = (sessionId, name) => `quiz-crafter-host-tools-${sessionId}-${name}`;
const HOST_TOOLS_FIELD_NAMES = ["players", "answers", "activity", "feedback", "category-feedback", "ideas", "graded-answers", "disputes", "results"];

// Clears a session's cached roster/progress (players, leaderboard, answers,
// feedback, etc.) -- both the profile-backed copy (loadHostToolsSessionState,
// survives reloads/devices) and this browser's localStorage mirror. Used
// when a host explicitly starts a fresh Test Run so a team that joined
// during an earlier rehearsal doesn't reappear -- this cache is purely a
// live-hosting reload-resilience layer, never read by past-session review,
// so clearing it is always safe.
export const resetHostToolsSessionState = async (sessionId) => {
  HOST_TOOLS_FIELD_NAMES.forEach((name) => {
    try { localStorage.removeItem(hostToolsStorageKey(sessionId, name)); } catch { /* Local cache is best-effort. */ }
  });
  try { localStorage.removeItem(`quiz-crafter-leaderboard-${sessionId}`); } catch { /* Local cache is best-effort. */ }
  const { error } = await supabase.from("host_tools_state").delete().eq("session_id", sessionId);
  if (error) console.warn("Host tools state reset unavailable:", error);
};
