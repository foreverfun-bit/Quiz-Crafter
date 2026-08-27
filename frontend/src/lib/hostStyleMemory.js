import { profileKeys, readLocalJson, saveProfileValue, syncProfileJson, writeLocalJson } from "./profileState";
import { dedupeCategories } from "./categories";

export const HOST_STYLE_MEMORY_KEY = "quiz-crafter-host-style-profile-v1";

export const defaultHostStyleProfile = {
  preferredDifficulty: "Slightly hard, fresh, and fair for a US bar-trivia room.",
  favoriteCategories: [],
  avoidedCategories: [],
  commonQuestionTypes: ["true_false", "multiple_choice", "written"],
  preferredRoundStructure: "Three flexible rounds with true/false, multiple choice, written answers, and optional media on any question.",
  writingStyleNotes: "Write like a real live trivia host: unique, fun, clean enough for bar trivia, not too obvious, not generic, and not overexplained.",
  funFactStyle: "Short, interesting, host-friendly fun facts that add one neat extra detail.",
  wrongAnswerStyle: "Plausible, comparable wrong answers. Avoid joke throwaways and obvious giveaways.",
  categoriesThatPerformWell: [],
  categoriesThatPerformPoorly: [],
  venuePreferences: "",
  examplesOfGoodQuestions: [],
  examplesOfBadQuestions: [],
  feedbackCounts: {
    keep: 0,
    too_easy: 0,
    too_hard: 0,
    too_common: 0,
    not_my_style: 0,
    more_like_this: 0,
    used_before: 0,
    ambiguous: 0,
  },
  updatedAt: "",
};

const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const cleanList = (value, limit = 20) => [...new Set((Array.isArray(value) ? value : [])
  .map(cleanText)
  .filter(Boolean))]
  .slice(0, limit);

const cleanQuestionExample = (question, note = "") => ({
  category: cleanText(question?.category),
  question_type: cleanText(question?.question_type || question?.type),
  question_text: cleanText(question?.question_text || question?.question),
  correct_answer: cleanText(question?.correct_answer || question?.answer),
  fun_fact: cleanText(question?.fun_fact),
  note: cleanText(note),
  addedAt: new Date().toISOString(),
});

export const normalizeHostStyleProfile = (profile = {}) => ({
  ...defaultHostStyleProfile,
  ...(profile && typeof profile === "object" ? profile : {}),
  favoriteCategories: dedupeCategories(cleanList(profile?.favoriteCategories, 30)),
  avoidedCategories: dedupeCategories(cleanList(profile?.avoidedCategories, 30)),
  commonQuestionTypes: cleanList(profile?.commonQuestionTypes, 8),
  categoriesThatPerformWell: dedupeCategories(cleanList(profile?.categoriesThatPerformWell, 30)),
  categoriesThatPerformPoorly: dedupeCategories(cleanList(profile?.categoriesThatPerformPoorly, 30)),
  examplesOfGoodQuestions: (Array.isArray(profile?.examplesOfGoodQuestions) ? profile.examplesOfGoodQuestions : []).map((item) => cleanQuestionExample(item, item?.note)).filter((item) => item.question_text).slice(0, 12),
  examplesOfBadQuestions: (Array.isArray(profile?.examplesOfBadQuestions) ? profile.examplesOfBadQuestions : []).map((item) => cleanQuestionExample(item, item?.note)).filter((item) => item.question_text).slice(0, 12),
  feedbackCounts: { ...defaultHostStyleProfile.feedbackCounts, ...(profile?.feedbackCounts || {}) },
});

export const readHostStyleProfile = () => normalizeHostStyleProfile(readLocalJson(HOST_STYLE_MEMORY_KEY, defaultHostStyleProfile));

export const writeHostStyleProfile = (profile) => {
  const normalized = normalizeHostStyleProfile({ ...profile, updatedAt: new Date().toISOString() });
  writeLocalJson(HOST_STYLE_MEMORY_KEY, normalized);
  return normalized;
};

export const syncHostStyleProfile = async () => {
  const profile = await syncProfileJson({
    localKey: HOST_STYLE_MEMORY_KEY,
    profileKey: profileKeys.hostStyleProfile,
    fallback: defaultHostStyleProfile,
    merge: "object",
  });
  const normalized = normalizeHostStyleProfile(profile);
  writeLocalJson(HOST_STYLE_MEMORY_KEY, normalized);
  return normalized;
};

export const saveHostStyleProfile = async (profile) => {
  const normalized = writeHostStyleProfile(profile);
  await saveProfileValue(profileKeys.hostStyleProfile, normalized);
  return normalized;
};

export const rememberStyleFeedback = async (question, action, note = "") => {
  const current = readHostStyleProfile();
  const next = normalizeHostStyleProfile({
    ...current,
    feedbackCounts: {
      ...current.feedbackCounts,
      [action]: Number(current.feedbackCounts?.[action] || 0) + 1,
    },
  });
  const category = cleanText(question?.category);
  if (["keep", "more_like_this"].includes(action) && category) {
    next.favoriteCategories = dedupeCategories([category, ...next.favoriteCategories]).slice(0, 30);
    next.categoriesThatPerformWell = dedupeCategories([category, ...next.categoriesThatPerformWell]).slice(0, 30);
    next.examplesOfGoodQuestions = [cleanQuestionExample(question, note || action), ...next.examplesOfGoodQuestions].filter((item) => item.question_text).slice(0, 12);
  }
  if (["too_easy", "too_hard", "too_common", "not_my_style", "used_before", "ambiguous"].includes(action)) {
    if (category) next.categoriesThatPerformPoorly = dedupeCategories([category, ...next.categoriesThatPerformPoorly]).slice(0, 30);
    next.examplesOfBadQuestions = [cleanQuestionExample(question, note || action), ...next.examplesOfBadQuestions].filter((item) => item.question_text).slice(0, 12);
  }
  if (action === "too_easy") next.preferredDifficulty = "Slightly hard. Avoid too-obvious clues and give the question a stronger second step while staying fair.";
  if (action === "too_hard") next.preferredDifficulty = "Too hard right now. Ease off obscure clues and make the answer more gettable for a strong bar-trivia team while staying interesting.";
  if (action === "too_common") next.writingStyleNotes = "Avoid common trivia-site staples, stock facts, and familiar reworded questions. Use fresher angles with real clue paths.";
  if (action === "not_my_style") next.writingStyleNotes = "Write more like Jewelzz/Forever Fun: live-host friendly, unique, playful, concise, category-varied, and not generic AI trivia.";
  if (action === "used_before") next.writingStyleNotes = "Avoid repeating facts, answers, or angles the host has already used in past sessions. Find a different fact about the subject or a different subject entirely.";
  if (action === "ambiguous") next.writingStyleNotes = "Only write questions with one single, indisputable, well-documented correct answer. Avoid questions that hinge on interpretation, recent slang, close calls, matters of opinion, or anything a team could reasonably argue a different answer for.";
  return saveHostStyleProfile(next).catch((error) => {
    console.warn("Host style feedback save unavailable:", error);
    return writeHostStyleProfile(next);
  });
};

export const buildHostStylePrompt = (profile = readHostStyleProfile()) => {
  const clean = normalizeHostStyleProfile(profile);
  return [
    `Preferred difficulty: ${clean.preferredDifficulty}`,
    `Writing style: ${clean.writingStyleNotes}`,
    `Fun facts: ${clean.funFactStyle}`,
    `Wrong answers: ${clean.wrongAnswerStyle}`,
    `Round structure: ${clean.preferredRoundStructure}`,
    clean.favoriteCategories.length ? `Favorite categories: ${clean.favoriteCategories.join(", ")}` : "",
    clean.avoidedCategories.length ? `Avoided categories: ${clean.avoidedCategories.join(", ")}` : "",
    clean.categoriesThatPerformWell.length ? `Categories that perform well: ${clean.categoriesThatPerformWell.join(", ")}` : "",
    clean.categoriesThatPerformPoorly.length ? `Categories to handle carefully: ${clean.categoriesThatPerformPoorly.join(", ")}` : "",
    clean.venuePreferences ? `Venue preferences: ${clean.venuePreferences}` : "",
    clean.examplesOfGoodQuestions.length ? `Sounds-like-me examples:\n${clean.examplesOfGoodQuestions.slice(0, 4).map((q) => `- [${q.category || "Category"}] ${q.question_text} Answer: ${q.correct_answer}${q.fun_fact ? ` Fun fact: ${q.fun_fact}` : ""}`).join("\n")}` : "",
    clean.examplesOfBadQuestions.length ? `Avoid-this-style examples:\n${clean.examplesOfBadQuestions.slice(0, 4).map((q) => `- [${q.category || "Category"}] ${q.question_text} Answer: ${q.correct_answer}${q.note ? ` (${q.note})` : ""}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
};
