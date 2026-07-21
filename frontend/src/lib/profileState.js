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
  hostToolsBySession: "quiz_crafter_host_tools_by_session_v1",
  hostSetup: "quiz_crafter_host_setup_v1",
  venues: "quiz_crafter_venues_v1",
  showTemplates: "quiz_crafter_show_templates_v1",
  activeVenueId: "quiz_crafter_active_venue_id",
  brandingDefaults: "quiz_crafter_host_branding_defaults_v1",
  hostStyleProfile: "quiz_crafter_host_style_profile_v1",
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

export const loadHostToolsSessionState = async (sessionId) => {
  const allState = await loadProfileValue(profileKeys.hostToolsBySession);
  return isPlainObject(allState?.[sessionId]) ? allState[sessionId] : {};
};

let hostToolsSessionSaveQueue = Promise.resolve();

export const saveHostToolsSessionState = (sessionId, patch) => {
  const task = hostToolsSessionSaveQueue.catch(() => {}).then(async () => {
    const allState = await loadProfileValue(profileKeys.hostToolsBySession);
    const safeState = isPlainObject(allState) ? allState : {};
    const next = { ...safeState, [sessionId]: { ...(safeState[sessionId] || {}), ...patch } };
    await saveProfileValue(profileKeys.hostToolsBySession, next);
    return next[sessionId];
  });
  hostToolsSessionSaveQueue = task;
  return task;
};
