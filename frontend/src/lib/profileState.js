import { supabase } from "./supabase";

export const profileKeys = {
  categoryPrefs: "quiz_crafter_category_preferences_v1",
  rejectedAi: "quiz_crafter_rejected_ai_questions_v1",
  generatedHistory: "quiz_crafter_recent_ai_suggestions_v1",
  lockedCategories: "quiz_crafter_locked_generator_categories_v1",
  questionMemory: "quiz_crafter_question_memory_v1",
  usedQuestionIds: "quiz_crafter_used_question_ids_v1",
  unusedQuestionIds: "quiz_crafter_unused_question_ids_v1",
  socialLinks: "quiz_crafter_social_links_v1",
  hostToolsBySession: "quiz_crafter_host_tools_by_session_v1",
};

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

export const updateUserMetadata = async (patch) => {
  const { data, error: loadError } = await supabase.auth.getUser();
  if (loadError) throw loadError;
  const currentMetadata = isPlainObject(data?.user?.user_metadata) ? data.user.user_metadata : {};
  const { error } = await supabase.auth.updateUser({ data: { ...currentMetadata, ...(isPlainObject(patch) ? patch : {}) } });
  if (error) throw error;
  return { ...currentMetadata, ...(isPlainObject(patch) ? patch : {}) };
};

export const saveProfileValue = async (profileKey, value) => {
  await updateUserMetadata({ [profileKey]: value });
  return value;
};

export const loadProfileValue = async (profileKey) => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user?.user_metadata?.[profileKey];
};

export const syncProfileJson = async ({ localKey, profileKey, fallback, merge = "remote" }) => {
  const localValue = readLocalJson(localKey, fallback);
  const remoteValue = await loadProfileValue(profileKey);
  let nextValue = remoteValue ?? localValue;

  if (merge === "array") nextValue = mergeArrays(remoteValue, localValue);
  if (merge === "object" && isPlainObject(remoteValue) && isPlainObject(localValue)) nextValue = { ...remoteValue, ...localValue };
  if (merge === "categoryPrefs") {
    nextValue = {
      approved: mergeArrays(remoteValue?.approved, localValue?.approved),
      rejected: mergeArrays(remoteValue?.rejected, localValue?.rejected),
    };
  }

  writeLocalJson(localKey, nextValue);
  if (remoteValue === undefined || JSON.stringify(remoteValue) !== JSON.stringify(nextValue)) {
    await saveProfileValue(profileKey, nextValue);
  }
  return nextValue;
};

export const loadHostToolsSessionState = async (sessionId) => {
  const allState = await loadProfileValue(profileKeys.hostToolsBySession);
  return isPlainObject(allState?.[sessionId]) ? allState[sessionId] : {};
};

export const saveHostToolsSessionState = async (sessionId, patch) => {
  const allState = await loadProfileValue(profileKeys.hostToolsBySession);
  const safeState = isPlainObject(allState) ? allState : {};
  const next = { ...safeState, [sessionId]: { ...(safeState[sessionId] || {}), ...patch } };
  await saveProfileValue(profileKeys.hostToolsBySession, next);
  return next[sessionId];
};
