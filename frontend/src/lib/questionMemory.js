import { updateUserMetadata } from "./profileState";

export const QUESTION_MEMORY_KEY = "quiz-crafter-question-memory-v1";
export const QUESTION_MEMORY_PROFILE_KEY = "quiz_crafter_question_memory_v1";

export const memoryStatuses = {
  available: { label: "Available", blocksBuild: false, blocksAI: false },
  reusable: { label: "Reusable", blocksBuild: false, blocksAI: false },
  used_recently: { label: "Used Recently", blocksBuild: true, blocksAI: true },
  needs_rewrite: { label: "Needs Rewrite", blocksBuild: true, blocksAI: true },
  too_common: { label: "Too Common", blocksBuild: true, blocksAI: true },
  retired: { label: "Retired", blocksBuild: true, blocksAI: true },
};

export const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
export const questionFingerprint = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

export const readQuestionMemory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUESTION_MEMORY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const writeQuestionMemory = (memory) => {
  try {
    localStorage.setItem(QUESTION_MEMORY_KEY, JSON.stringify(memory && typeof memory === "object" ? memory : {}));
  } catch {
    // Keep the app usable if browser storage is unavailable.
  }
};

export const syncQuestionMemoryFromProfile = async (supabase) => {
  const localMemory = readQuestionMemory();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const remoteMemory = data?.session?.user?.user_metadata?.[QUESTION_MEMORY_PROFILE_KEY];
  const nextMemory = remoteMemory && typeof remoteMemory === "object" ? { ...remoteMemory, ...localMemory } : localMemory;
  writeQuestionMemory(nextMemory);
  if (!remoteMemory || JSON.stringify(remoteMemory) !== JSON.stringify(nextMemory)) {
    await updateUserMetadata({ [QUESTION_MEMORY_PROFILE_KEY]: nextMemory });
  }
  return nextMemory;
};

export const saveQuestionMemoryToProfile = async (supabase, memory) => {
  const safeMemory = memory && typeof memory === "object" ? memory : {};
  await updateUserMetadata({ [QUESTION_MEMORY_PROFILE_KEY]: safeMemory });
  return safeMemory;
};

export const memoryKeysForQuestion = (question = {}) => {
  const id = question.id ? `id:${question.id}` : "";
  const text = question.question_text || question.question || question.questionText || "";
  const fp = questionFingerprint(text);
  return [id, fp ? `fp:${fp}` : ""].filter(Boolean);
};

export const getQuestionMemory = (question, memory = readQuestionMemory()) => {
  const keys = memoryKeysForQuestion(question);
  const found = keys.map((key) => memory[key]).find(Boolean);
  if (found) return found;
  const status = question?.memory_status || question?.status_memory || "";
  if (status && memoryStatuses[status]) return { status, note: question?.memory_note || "", updatedAt: question?.memory_updated_at || "" };
  return { status: "available", note: "", updatedAt: "" };
};

export const upsertQuestionMemory = (question, patch, memory = readQuestionMemory()) => {
  const keys = memoryKeysForQuestion(question);
  const status = patch?.status || "available";
  const base = {
    status,
    note: patch?.note || "",
    question_text: normalizeText(question?.question_text || question?.question || question?.questionText),
    correct_answer: normalizeText(question?.correct_answer || question?.answer),
    category: normalizeText(question?.category),
    updatedAt: new Date().toISOString(),
  };
  const next = { ...memory };
  keys.forEach((key) => {
    if (status === "available") delete next[key];
    else next[key] = { ...(next[key] || {}), ...base };
  });
  writeQuestionMemory(next);
  return next;
};

export const isMemoryBlocked = (question, memory = readQuestionMemory()) => {
  const status = getQuestionMemory(question, memory).status;
  return Boolean(memoryStatuses[status]?.blocksBuild);
};

export const isMemoryUsed = (question, memory = readQuestionMemory()) => getQuestionMemory(question, memory).status === "used_recently";

export const memoryRejectedQuestionTexts = (memory = readQuestionMemory()) => [...new Map(Object.values(memory)
  .filter((item) => item?.question_text && memoryStatuses[item.status]?.blocksAI)
  .map((item) => [questionFingerprint(item.question_text), item.question_text])).values()];
