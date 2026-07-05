const QUESTION_TYPES = {
  true_false: {
    label: "True/False",
    outputType: "true_false",
    incorrectCount: 0,
    answerRule: 'correct_answer must be exactly "True" or "False".',
    roundGuidance: "This belongs in a true/false slot. Use claims that are surprising, fair, and cleanly verifiable.",
  },
  multiple_choice: {
    label: "Multiple Choice",
    outputType: "multiple_choice",
    incorrectCount: 3,
    answerRule: "incorrect_answers must contain exactly 3 plausible wrong answers and must not include correct_answer.",
    roundGuidance: "This belongs in a multiple choice slot. Wrong answers should be comparable, not silly giveaways.",
  },
  written: {
    label: "Written Answer",
    outputType: "written",
    incorrectCount: 0,
    answerRule: "correct_answer should be concise, specific, and easy for a host to verify.",
    roundGuidance: "This belongs in a written-answer slot. The answer should be gettable without options and not depend on exact spelling unless famous.",
  },
};

const DIFFICULTY_PROFILES = {
  easy: { label: "Easy", guidance: "Accessible for casual players. Avoid trick wording. The average trivia team should have a fair shot." },
  medium: { label: "Medium", guidance: "Balanced pub-trivia difficulty. Not obvious, but answerable by a good mixed team." },
  hard: { label: "Hard", guidance: "Challenging but fair. Prefer second-layer knowledge over household-name facts." },
  host_hard: {
    label: "Host Hard",
    guidance: "Fresh and host-worthy, but still playable for a US bar-trivia room. Aim for strong mixed teams to have a real path to the answer, not a stump-the-room pull. Prefer familiar subjects with a less-obvious angle over obscure subjects with no foothold.",
  },
};

const BROAD_CATEGORIES = ["Art", "Books", "Food & Drink", "Geography", "History", "Internet Culture", "Local Flavor", "Movies", "Music", "Nature", "Pop Culture", "Science", "Sports", "Television", "Theater", "Video Games", "Weird Science", "World Culture"];
const APPROVED_CATEGORY_STRICT_THRESHOLD = 14;
const EXISTING_QUESTIONS_CACHE_MS = 5 * 60 * 1000;
const STYLE_EXAMPLE_LIMIT = 24;
const DUPLICATE_EXAMPLE_LIMIT = 55;
let existingQuestionsCache = { expiresAt: 0, data: null, pending: null, libraryLimit: 0, sessionLimit: 0 };

const BANNED_GENERIC_PATTERNS = [
  /capital of/i,
  /first president/i,
  /largest planet/i,
  /chemical symbol for water/i,
  /author of harry potter/i,
  /painted the mona lisa/i,
  /red planet/i,
  /highest mountain/i,
  /longest river/i,
  /fastest land animal/i,
  /who wrote romeo and juliet/i,
  /currency of japan/i,
  /largest ocean/i,
  /smallest country/i,
  /academy award for best picture/i,
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (req.body?.mode === "image") {
      const prompt = String(req.body?.prompt || "").trim();
      if (!prompt) return res.status(400).json({ error: "Missing image prompt" });
      const image = await requestGeneratedImage(prompt);
      return res.status(200).json(image);
    }

    const {
      sessionId,
      questionType,
      count,
      difficulty = "medium",
      theme,
      excludeUsed = true,
      avoidDuplicates = true,
      includeImagePrompt = false,
      excludeCategories = [],
      approvedCategories = [],
      rejectedCategories = [],
      lockedCategories = [],
      rejectedQuestions = [],
      currentBatchQuestions = [],
      sessionContext = null,
      generationMode = "polished",
    } = req.body || {};

    if (!sessionId || !questionType) return res.status(400).json({ error: "Missing sessionId or questionType" });

    const normalizedQuestionType = questionType === "picture" ? "written" : questionType;
    const config = QUESTION_TYPES[normalizedQuestionType];
    if (!config) return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });

    const safeCount = clampCount(count);
    const difficultyKey = normalizeDifficulty(difficulty);
    const difficultyProfile = DIFFICULTY_PROFILES[difficultyKey];
    const fastMode = generationMode === "quick";
    const cleanTheme = typeof theme === "string" ? theme.trim() : "";
    const cleanLockedCategories = dedupeCategoryStrings(normalizeStringArray(lockedCategories));
    const cleanApprovedCategories = dedupeCategoryStrings([...normalizeStringArray(approvedCategories), ...cleanLockedCategories]);
    const cleanRejectedCategories = dedupeCategoryStrings(normalizeStringArray(rejectedCategories).filter((category) => !containsCategory(cleanLockedCategories, category)));
    const cleanExcludeCategories = dedupeCategoryStrings([...normalizeStringArray(excludeCategories), ...cleanRejectedCategories].filter((category) => !containsCategory(cleanLockedCategories, category)));
    const cleanRejectedQuestions = dedupeStrings([...normalizeStringArray(rejectedQuestions), ...normalizeStringArray(currentBatchQuestions)]);
    const cleanSessionContext = normalizeSessionContext(sessionContext);
    const requireApprovedCategories = cleanLockedCategories.length > 0 || cleanApprovedCategories.length > 0;
    const categoryExpansionMode = false;
    const existingQuestions = avoidDuplicates || excludeUsed ? await fetchExistingQuestions(fastMode ? 220 : 1500, fastMode ? 100 : 500) : [];
    const styleExamples = fastMode ? [] : buildStyleExamples(existingQuestions, normalizedQuestionType, cleanApprovedCategories);
    const existingFingerprints = new Set(existingQuestions.map((q) => fingerprint(q.question_text)));
    const existingAnswerPairs = new Set(existingQuestions.map((q) => answerPairFingerprint(q.question_text, q.correct_answer)));
    const existingAnswers = new Set(existingQuestions.map((q) => answerFingerprint(q.correct_answer)).filter(Boolean));
    const rejectedQuestionFingerprints = new Set(cleanRejectedQuestions.map(fingerprint));
    const rejectedAnswerFingerprints = new Set(cleanRejectedQuestions.map(answerFingerprint).filter(Boolean));

    const prompt = buildPrompt({
      config,
      safeCount,
      difficultyKey,
      difficultyProfile,
      cleanTheme,
      cleanExcludeCategories,
      cleanApprovedCategories,
      cleanLockedCategories,
      categoryExpansionMode,
      cleanRejectedQuestions,
      cleanSessionContext,
      existingQuestions,
      styleExamples,
      excludeUsed,
      avoidDuplicates,
      includeImagePrompt,
      fastMode,
    });
    const parsed = await requestCandidates(prompt, { fastMode });
    const validationInput = {
      candidates: parsed.candidates,
      config,
      questionType: normalizedQuestionType,
      difficultyKey,
      cleanExcludeCategories,
      cleanApprovedCategories,
      cleanLockedCategories,
      requireApprovedCategories,
      existingFingerprints,
      existingAnswerPairs,
      existingAnswers,
      rejectedQuestionFingerprints,
      rejectedAnswerFingerprints,
      avoidDuplicates,
      includeImagePrompt,
    };
    let validation = normalizeCandidates(validationInput);

    if (!validation.candidates.length && Array.isArray(parsed.candidates) && parsed.candidates.length) {
      validation = normalizeCandidates({
        ...validationInput,
        cleanApprovedCategories: [],
        requireApprovedCategories: false,
        avoidDuplicates: false,
      });
    }
    if (!validation.candidates.length && Array.isArray(parsed.candidates) && parsed.candidates.length) {
      validation = normalizeCandidates({
        ...validationInput,
        cleanExcludeCategories: cleanRejectedCategories,
        cleanApprovedCategories: [],
        requireApprovedCategories: false,
        cleanLockedCategories: cleanLockedCategories.length ? cleanLockedCategories : [],
        existingFingerprints: new Set(),
        existingAnswerPairs: new Set(),
        existingAnswers: new Set(),
        avoidDuplicates: false,
      });
    }
    if (!validation.candidates.length && Array.isArray(parsed.candidates) && parsed.candidates.length && !cleanLockedCategories.length) {
      validation = normalizeCandidates({
        ...validationInput,
        cleanExcludeCategories: [],
        cleanApprovedCategories: [],
        requireApprovedCategories: false,
        cleanLockedCategories: [],
        rejectedAnswerFingerprints: new Set(),
        existingFingerprints: new Set(),
        existingAnswerPairs: new Set(),
        existingAnswers: new Set(),
        avoidDuplicates: false,
      });
    }

    return res.status(200).json({ candidates: validation.candidates.slice(0, safeCount), rejected: validation.rejected, requested: safeCount });
  } catch (error) {
    console.error("generate-session-candidates error:", error);
    return res.status(500).json({ error: error?.message || "Failed to generate candidates" });
  }
}

async function requestGeneratedImage(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const safePrompt = [
    "Create a clean, modern trivia presentation image.",
    "It should be useful as a visual clue but must not include readable text, logos, watermarks, celebrity likenesses, or reveal the answer.",
    "Style: polished, high-contrast, bar-trivia friendly, not cartoonish.",
    `Trivia image brief: ${prompt}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
      prompt: safePrompt,
      size: "1024x1024",
      quality: "low",
      n: 1,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI image request failed");
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned");
  return { image_url: `data:image/png;base64,${b64}`, revised_prompt: data?.data?.[0]?.revised_prompt || safePrompt };
}

function clampCount(count) {
  const parsed = Number(count);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 20 ? parsed : 5;
}

function normalizeDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_PROFILES, value) ? value : "medium";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function dedupeStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCategoryStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = categoryKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function containsCategory(categories, category) {
  return categories.some((item) => categoryKey(item) === categoryKey(category));
}

function categoryKey(value) {
  return cleanText(value).toLowerCase().replace(/[’‘`]/g, "'").replace(/\band\b/g, "&").replace(/[^a-z0-9&]+/g, "");
}

function normalizeSessionContext(value) {
  if (!value || typeof value !== "object") return null;
  const cleanQuestion = (question) => ({
    category: cleanText(question?.category).slice(0, 60),
    question_text: cleanText(question?.question_text || question?.questionText).slice(0, 220),
    correct_answer: cleanText(question?.correct_answer || question?.answer).slice(0, 80),
    question_type: cleanText(question?.question_type || question?.type).slice(0, 40),
    round: cleanText(question?.round || question?.roundName).slice(0, 80),
  });
  const builtQuestions = Array.isArray(value.builtQuestions) ? value.builtQuestions.map(cleanQuestion).filter((q) => q.question_text && q.correct_answer).slice(0, 18) : [];
  const activeRoundQuestions = Array.isArray(value.activeRoundQuestions) ? value.activeRoundQuestions.map(cleanQuestion).filter((q) => q.question_text && q.correct_answer).slice(0, 8) : [];
  const roundDescriptions = Array.isArray(value.roundDescriptions) ? value.roundDescriptions.map((round) => ({
    name: cleanText(round?.name).slice(0, 80),
    description: cleanText(round?.description).slice(0, 180),
    categories: normalizeStringArray(round?.categories).slice(0, 8),
  })).filter((round) => round.name || round.description || round.categories.length).slice(0, 8) : [];
  const categories = normalizeStringArray(value.categories).slice(0, 30);
  return { builtQuestions, activeRoundQuestions, roundDescriptions, categories };
}

function formatContextQuestion(question) {
  return `- [${question.round || "Session"} / ${question.category || "Uncategorized"} / ${question.question_type || "written"}] ${question.question_text} Answer: ${question.correct_answer}`;
}

function buildPrompt({ config, safeCount, difficultyKey, difficultyProfile, cleanTheme, cleanExcludeCategories, cleanApprovedCategories, cleanLockedCategories, categoryExpansionMode, cleanRejectedQuestions = [], cleanSessionContext = null, existingQuestions, styleExamples, excludeUsed, avoidDuplicates, includeImagePrompt, fastMode = false }) {
  const overGenerateCount = fastMode ? Math.min(8, Math.max(safeCount + 1, Math.ceil(safeCount * 1.35))) : Math.min(18, Math.max(safeCount + 4, Math.ceil(safeCount * 1.7)));
  const lockedCategoryText = cleanLockedCategories.length ? `Locked categories are active. The category field must exactly match one of these locked categories: ${cleanLockedCategories.join(", ")}. Generate all candidates inside these locked categories until the host unlocks them.` : "";
  const approvedCategoryText = cleanLockedCategories.length
    ? lockedCategoryText
    : categoryExpansionMode
      ? `Use only these approved category names. The category field must exactly match one of these names; do not invent adjacent, similar, or new category names: ${cleanApprovedCategories.join(", ")}.`
      : cleanApprovedCategories.length
      ? `Use only these approved category names. The category field must exactly match one of these names; do not invent adjacent, similar, or new category names: ${cleanApprovedCategories.join(", ")}.`
      : `Use varied broad categories such as: ${BROAD_CATEGORIES.join(", ")}.`;
  const excludedCategoryText = cleanExcludeCategories.length ? `Do not use these rejected or avoided categories: ${cleanExcludeCategories.join(", ")}.` : "";
  const themeText = cleanTheme ? `Theme/vibe/category guidance: ${cleanTheme}. Stay useful to that direction, but avoid repetitive question angles.` : "";
  const tasteProfileText = fastMode ? "" : buildTasteProfileText(styleExamples, cleanSessionContext);
  const styleText = styleExamples.length ? `Style calibration examples. These are not a source to copy from; they are the host's taste profile. Match their practical qualities: readable aloud, fresh-but-playable, specific without being tiny-name trivia, playful but clean, and useful for a US live bar crowd. Do not copy, lightly rewrite, reuse their answers, or generate the same topic angles:\n${styleExamples.map(formatStyleExample).join("\n")}` : "";
  const sessionContextText = cleanSessionContext && (cleanSessionContext.builtQuestions.length || cleanSessionContext.activeRoundQuestions.length || cleanSessionContext.roundDescriptions.length)
    ? [
        "Current build context. Use this to match the session's pacing, tone, readability, and clue style. Do not copy these questions, reuse their answers, or force the same categories if those categories are excluded:",
        cleanSessionContext.roundDescriptions.length ? `Round plan:\n${cleanSessionContext.roundDescriptions.map((round) => `- ${round.name || "Round"}${round.description ? `: ${round.description}` : ""}${round.categories?.length ? ` Categories already present: ${round.categories.join(", ")}` : ""}`).join("\n")}` : "",
        cleanSessionContext.activeRoundQuestions.length ? `Questions already in the active round:\n${cleanSessionContext.activeRoundQuestions.map(formatContextQuestion).join("\n")}` : "",
        cleanSessionContext.builtQuestions.length ? `Questions already selected in the full session:\n${cleanSessionContext.builtQuestions.slice(0, fastMode ? 18 : 80).map(formatContextQuestion).join("\n")}` : "",
      ].filter(Boolean).join("\n")
    : "";
  const duplicateExamples = existingQuestions.slice(0, fastMode ? 16 : DUPLICATE_EXAMPLE_LIMIT).map((q) => `- ${q.question_text}${q.correct_answer ? ` Answer: ${q.correct_answer}` : ""}`).join("\n");
  const duplicateText = avoidDuplicates && duplicateExamples ? `Avoid duplicating, lightly rewording, using the same answer, or using the same answer-angle as these existing and past-session questions:\n${duplicateExamples}` : "";
  const rejectedText = cleanRejectedQuestions.length ? `The host explicitly rejected these generated questions. Do not return them, close rewrites, same-answer variations, or same topic-angle cousins:\n${cleanRejectedQuestions.map((question) => `- ${question}`).join("\n")}` : "";
  const usedText = excludeUsed ? "Assume the host has already used years of common trivia. Avoid the most repeated stock facts, but do not compensate by choosing tiny or joyless facts. Use familiar subjects with fresher angles." : "";
  const hostHardText = difficultyKey === "host_hard" ? "Host Hard calibration: this means polished and fresh, not brutally obscure. A good team should be able to reason toward the answer from the wording even if they do not know it cold." : "";
  const noveltySeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const imagePromptField = includeImagePrompt ? ',\n      "image_prompt": "A concise visual clue idea that does not reveal the answer"' : ',\n      "image_prompt": ""';
  const imagePromptRule = includeImagePrompt
    ? "- image_prompt must describe a useful generated or uploaded visual clue for this question. It must not reveal the answer, include readable text, or require logos/copyrighted screenshots."
    : "- image_prompt must be empty.";

  return `
Generate exactly ${overGenerateCount} ${config.label} trivia question candidates so the app can keep the best ${safeCount}.

Novelty seed: ${noveltySeed}
Use the novelty seed to vary the angle and avoid repeating your usual examples, while keeping the subject matter broadly recognizable.

Host context:
- The host runs live trivia and wants an assistant, not a generic question bank.
- The host is based in the United States and usually hosts for a US bar-trivia audience.
- The host builds flexible rounds with true/false, multiple choice, and written answer questions.
- Pictures are not a question type. Any question can have media attached later.
- The biggest need is fresh-but-playable questions: fun angles, useful clue paths, and categories that regular bar teams recognize.
- The host has been hosting since 2019 and has already used a lot of common trivia.

Return valid JSON only. No markdown. No comments. No extra keys outside the requested object.

Use this exact shape:
{
  "candidates": [
    {
      "category": "History",
      "question_text": "Question text goes here.",
      "correct_answer": "Correct answer",
      "incorrect_answers": [],
      "fun_fact": "One short sentence.",
      "difficulty": "${difficultyKey}",
      "question_type": "${config.outputType}",
      "image_url": ""${imagePromptField}
    }
  ]
}

${fastMode ? "Quick draft mode: move fast. Return complete usable drafts with concise wording, plausible wrong answers when needed, and one short fun fact." : "Polished mode: spend extra care on clue path, wrong answers, and fun facts."}

Freshness rules:
- Do not produce classic bar-trivia staples or their reworded cousins.
- Default to general US-friendly trivia: recognizable subjects, broadly playable categories, and clues a US mixed team can reasonably follow.
- Fresh does not mean obscure. Prefer a recognizable answer with a surprising route over a little-known answer with no clue path.
- Every question must have at least one real foothold in the wording: etymology hint, era, object use, pop-culture connection, category cue, or elimination path.
- International or foreign-country questions are welcome only occasionally. When used, make the subject globally recognizable or give a very clear clue path; do not depend on obscure foreign place names, politicians, monarchs, local festivals, minor wars, regional foods, or untranslated terms.
- For Geography and World Culture, prefer accessible angles with context over "name this foreign thing" recall.
- Avoid these angles entirely: capitals, first presidents, tallest/highest/largest/longest records, basic planets, basic elements, basic Shakespeare, Mona Lisa, Harry Potter author, obvious Oscar winners, obvious Disney facts, and common holiday myths.
- Prefer second-order facts only when the answer is still reasonably familiar or the clue gives enough context to reach it.
- Avoid tiny-name answers, obscure technical terms, minor foreign places, niche academic facts, and questions where the only path is "you either know this exact fact or you don't."
- Ask yourself: "Would this feel fresh to someone who has hosted weekly trivia for years?" If not, replace it.
- Also ask: "Would a good mixed bar team feel this was fair after hearing the answer?" If not, make it easier or choose a more recognizable subject.

Game-show inspiration:
- You may take high-level inspiration from game-show clue craft: strong hooks, clean clue paths, satisfying reveals, category variety, and answerability under pressure.
- Do not copy actual game-show questions, recurring clue wording, proprietary formats, catchphrases, or the exact voice of any specific show.
- Aim for the feel of a polished trivia room: concise like a good quiz clue, fair like a well-edited game show, and fresh enough for a host who has heard the obvious versions before.

Trivia host style:
- ${config.roundGuidance}
- Difficulty: ${difficultyProfile.label}. ${difficultyProfile.guidance}
- Prefer fresh-but-fair, gettable, satisfying facts over generic quiz-bank material.
- For written-answer questions, the correct answer must be a familiar term, person, brand, object, title, or place. Do not use obscure names or exact technical vocabulary as written answers unless the clue makes the answer strongly inferable.
- ${approvedCategoryText}
- Avoid repeating a correct answer anywhere in the batch.
- If more than one locked category is active, balance the candidates across those locked categories.
- Write concise, host-friendly question text that sounds natural when read aloud.
- Avoid ambiguous answers, disputed facts, and answer wording that would cause scoring arguments.
- fun_fact must be one short sentence that adds color without spoiling another question.
- ${config.answerRule}
- question_type must be "${config.outputType}".
- image_url must be "".
- difficulty must be "${difficultyKey}".
${imagePromptRule}
${hostHardText}
${tasteProfileText}
${sessionContextText}
${styleText}
${themeText}
${excludedCategoryText}
${usedText}
${rejectedText}
${duplicateText}
`.trim();
}

function buildStyleExamples(existingQuestions, questionType, approvedCategories) {
  const approvedSet = new Set(approvedCategories.map(categoryKey));
  const usableQuestions = existingQuestions.filter((q) => q.question_text && q.correct_answer);
  const matchingType = usableQuestions.filter((q) => q.question_type === questionType);
  const matchingApproved = matchingType.filter((q) => !approvedSet.size || approvedSet.has(categoryKey(q.category)));
  const liked = usableQuestions.filter(isLikedQuestion);
  const likedMatchingType = liked.filter((q) => q.question_type === questionType);
  const candidates = [
    ...(likedMatchingType.length ? likedMatchingType : liked),
    ...(matchingApproved.length >= 8 ? matchingApproved : matchingType.length >= 8 ? matchingType : usableQuestions),
  ];
  return sampleStable(candidates, STYLE_EXAMPLE_LIMIT);
}

function buildTasteProfileText(styleExamples, cleanSessionContext) {
  const examples = [...styleExamples, ...(cleanSessionContext?.builtQuestions || []), ...(cleanSessionContext?.activeRoundQuestions || [])]
    .filter((question) => question?.question_text);
  if (!examples.length) {
    return `Host taste contract:
- Generate for Julie's Forever Fun style, not a generic trivia site.
- Favor questions with a hook, a fair clue path, and a satisfying reveal.
- Avoid sterile encyclopedia facts, hyper-specific foreign recall, and one-word category dumps.`;
  }
  const categoryCounts = new Map();
  const typeCounts = new Map();
  let totalLength = 0;
  examples.forEach((question) => {
    const category = cleanText(question.category) || "Uncategorized";
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    const type = normalizeFetchedType(question.question_type);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    totalLength += cleanText(question.question_text).length;
  });
  const topCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([category]) => category);
  const typeMix = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type}: ${count}`).join(", ");
  const averageLength = Math.round(totalLength / examples.length);
  return `Host taste contract:
- Treat this as a custom question-writing assignment for the Forever Fun host. Style match matters more than novelty for novelty's sake.
- Preferred category feel from saved/hosted material: ${topCategories.join(", ") || "varied broad categories"}.
- Current observed type mix: ${typeMix || "mixed"}.
- Typical question length is about ${averageLength} characters; stay readable aloud in one breath unless the clue needs a setup.
- Good candidates should feel like a clever live-host clue: a concrete hook, a fair path to the answer, and a little "oh, that's neat" reveal.
- Bad candidates are generic quiz-bank facts, sterile textbook definitions, obscure foreign recall with no context, answer-only categories, and claims that feel like a coin flip.
- If the prompt or round direction conflicts with this taste profile, follow the host taste profile first.`;
}

function sampleStable(items, limit) {
  const seen = new Set();
  return items
    .filter((item) => {
      const key = fingerprint(item.question_text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => scoreStyleExample(b) - scoreStyleExample(a))
    .slice(0, limit);
}

function scoreStyleExample(question) {
  let score = 0;
  if (isLikedQuestion(question)) score += 30;
  if (isDislikedQuestion(question)) score -= 20;
  if (question.source === "library") score += 8;
  if (question.source === "session") score += 8;
  if (question.category) score += 2;
  if (question.fun_fact) score += 2;
  const length = cleanText(question.question_text).length;
  if (length >= 45 && length <= 180) score += 3;
  if (question.question_type === "multiple_choice" || question.question_type === "true_false" || question.question_type === "written") score += 1;
  return score;
}

function formatStyleExample(q) {
  const sourceLabel = q.source === "session" ? "past session" : "library";
  const parts = [`- [${sourceLabel} / ${q.category || "Uncategorized"} / ${q.question_type || "written"}] ${q.question_text}`, `Answer: ${q.correct_answer}`];
  if (q.fun_fact) parts.push(`Fun fact style: ${q.fun_fact}`);
  return parts.join(" ");
}

function isLikedQuestion(question) {
  const rating = cleanText(question.rating || question.status).toLowerCase();
  return Boolean(question.is_liked || question.liked || rating === "liked" || rating === "like" || rating === "approved" || rating === "favorite");
}

function isDislikedQuestion(question) {
  const rating = cleanText(question.rating || question.status).toLowerCase();
  return Boolean(question.is_disliked || question.disliked || rating === "disliked" || rating === "dislike" || rating === "rejected");
}

async function requestCandidates(prompt, { fastMode = false } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Vercel");

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: fastMode ? (process.env.OPENAI_FAST_GENERATOR_MODEL || "gpt-4.1-mini") : (process.env.OPENAI_GENERATOR_MODEL || "gpt-4.1"),
      temperature: fastMode ? 0.76 : 0.82,
      presence_penalty: fastMode ? 0.2 : 0.35,
      frequency_penalty: fastMode ? 0.2 : 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a careful, inventive trivia co-host for a weekly live trivia host. You learn from the host's saved library and previously hosted questions, avoid common quiz-bank questions, and return only valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await openaiRes.json();
  if (!openaiRes.ok) {
    console.error("OpenAI error response:", data);
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No AI response received");

  try {
    return JSON.parse(content);
  } catch {
    console.error("Failed to parse model JSON:", content);
    throw new Error("AI returned invalid JSON");
  }
}

function normalizeCandidates({ candidates, config, questionType, difficultyKey, cleanExcludeCategories, cleanApprovedCategories, cleanLockedCategories, requireApprovedCategories = true, existingFingerprints, existingAnswerPairs, existingAnswers, rejectedQuestionFingerprints, rejectedAnswerFingerprints, avoidDuplicates, includeImagePrompt }) {
  const rejected = [];
  const accepted = [];
  const batchFingerprints = new Set();
  const batchAnswerPairs = new Set();
  const batchAnswers = new Set();
  const excludedCategories = new Set(cleanExcludeCategories.map(categoryKey));
  const approvedCategorySet = new Set(cleanApprovedCategories.map(categoryKey));
  const lockedCategorySet = new Set(cleanLockedCategories.map(categoryKey));

  if (!Array.isArray(candidates)) throw new Error("No candidates returned");

  candidates.forEach((candidate, index) => {
    const normalized = normalizeCandidate(candidate, config, questionType, difficultyKey, includeImagePrompt);
    if (!normalized.ok) {
      rejected.push({ index, reason: normalized.reason });
      return;
    }

    const item = normalized.candidate;
    const itemFingerprint = fingerprint(item.question_text);
    const itemAnswerPair = answerPairFingerprint(item.question_text, item.correct_answer);
    const itemAnswer = answerFingerprint(item.correct_answer);
    const itemCategoryKey = categoryKey(item.category);

    if (isGenericQuestion(item.question_text)) {
      rejected.push({ index, question: item.question_text, reason: "generic_overused_trivia_pattern" });
      return;
    }
    if (lockedCategorySet.size > 0 && !lockedCategorySet.has(itemCategoryKey)) {
      rejected.push({ index, question: item.question_text, reason: "not_locked_category" });
      return;
    }
    if (requireApprovedCategories && approvedCategorySet.size > 0 && !approvedCategorySet.has(itemCategoryKey)) {
      rejected.push({ index, question: item.question_text, reason: "not_approved_category" });
      return;
    }
    if (excludedCategories.has(itemCategoryKey)) {
      rejected.push({ index, question: item.question_text, reason: "excluded_category" });
      return;
    }
    if (rejectedQuestionFingerprints.has(itemFingerprint)) {
      rejected.push({ index, question: item.question_text, reason: "permanently_rejected_question" });
      return;
    }
    if (rejectedAnswerFingerprints.has(itemAnswer)) {
      rejected.push({ index, question: item.question_text, reason: "rejected_answer_repeated" });
      return;
    }
    if (avoidDuplicates) {
      if (existingFingerprints.has(itemFingerprint) || batchFingerprints.has(itemFingerprint)) {
        rejected.push({ index, question: item.question_text, reason: "duplicate_question" });
        return;
      }
      if (existingAnswerPairs.has(itemAnswerPair) || batchAnswerPairs.has(itemAnswerPair)) {
        rejected.push({ index, question: item.question_text, reason: "duplicate_answer_angle" });
        return;
      }
      if (itemAnswer && (existingAnswers.has(itemAnswer) || batchAnswers.has(itemAnswer))) {
        rejected.push({ index, question: item.question_text, reason: "duplicate_correct_answer" });
        return;
      }
    }

    batchFingerprints.add(itemFingerprint);
    batchAnswerPairs.add(itemAnswerPair);
    if (itemAnswer) batchAnswers.add(itemAnswer);
    accepted.push(item);
  });

  return { candidates: accepted, rejected };
}

function normalizeCandidate(candidate, config, questionType, difficultyKey, includeImagePrompt) {
  if (!candidate || typeof candidate !== "object") return { ok: false, reason: "candidate_not_object" };

  const category = cleanText(candidate.category);
  const questionText = cleanText(candidate.question_text);
  let correctAnswer = cleanText(candidate.correct_answer);
  const funFact = cleanText(candidate.fun_fact);
  const imagePrompt = includeImagePrompt ? cleanText(candidate.image_prompt) : "";
  const incorrectAnswers = Array.isArray(candidate.incorrect_answers) ? candidate.incorrect_answers.map(cleanText).filter(Boolean) : [];

  if (!category || !questionText || !correctAnswer) return { ok: false, reason: "missing_required_text" };

  if (questionType === "true_false") {
    const normalizedAnswer = correctAnswer.toLowerCase();
    if (normalizedAnswer !== "true" && normalizedAnswer !== "false") return { ok: false, reason: "invalid_true_false_answer" };
    correctAnswer = normalizedAnswer === "true" ? "True" : "False";
  }

  if (config.incorrectCount > 0) {
    const uniqueIncorrect = [...new Set(incorrectAnswers.map((answer) => answer.trim()))];
    const duplicatesCorrect = uniqueIncorrect.some((answer) => answer.toLowerCase() === correctAnswer.toLowerCase());
    if (uniqueIncorrect.length !== config.incorrectCount || duplicatesCorrect) return { ok: false, reason: "invalid_multiple_choice_answers" };
  }

  return {
    ok: true,
    candidate: {
      category,
      question_text: questionText,
      correct_answer: correctAnswer,
      incorrect_answers: config.incorrectCount > 0 ? incorrectAnswers : [],
      fun_fact: funFact,
      difficulty: difficultyKey,
      question_type: config.outputType,
      image_url: "",
      image_prompt: imagePrompt,
    },
  };
}

function isGenericQuestion(questionText) {
  return BANNED_GENERIC_PATTERNS.some((pattern) => pattern.test(questionText));
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function fingerprint(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ").filter((word) => word && !STOP_WORDS.has(word)).sort().join(" ");
}

function answerFingerprint(answer) {
  return cleanText(answer).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function answerPairFingerprint(questionText, answer) {
  return `${fingerprint(questionText)}::${answerFingerprint(answer)}`;
}

async function fetchExistingQuestions(libraryLimit = 1500, sessionLimit = 500) {
  const now = Date.now();
  if (existingQuestionsCache.data && existingQuestionsCache.expiresAt > now && existingQuestionsCache.libraryLimit >= libraryLimit && existingQuestionsCache.sessionLimit >= sessionLimit) {
    return existingQuestionsCache.data.slice(0, libraryLimit + sessionLimit);
  }
  if (existingQuestionsCache.pending) return existingQuestionsCache.pending;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  existingQuestionsCache.pending = fetchExistingQuestionsUncached(supabaseUrl, supabaseKey, libraryLimit, sessionLimit)
    .then((data) => {
      existingQuestionsCache = { data, expiresAt: Date.now() + EXISTING_QUESTIONS_CACHE_MS, pending: null, libraryLimit, sessionLimit };
      return data;
    })
    .catch((error) => {
      existingQuestionsCache.pending = null;
      console.error("Existing question fetch failed:", error);
      return existingQuestionsCache.data || [];
    });

  return existingQuestionsCache.pending;
}

async function fetchExistingQuestionsUncached(supabaseUrl, supabaseKey, libraryLimit = 1500, sessionLimit = 500) {
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const [libraryQuestions, sessions] = await Promise.all([
    fetchJsonWithFallback([
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,is_liked,is_disliked,liked,disliked,rating,status&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,rating&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact&order=created_at.desc&limit=${libraryLimit}`,
    ], headers),
    fetchJsonWithFallback([
      `${base}/rest/v1/sessions?select=true_false_questions,multiple_choice_questions,written_questions,picture_questions&order=created_at.desc&limit=${sessionLimit}`,
    ], headers),
  ]);
  const sessionQuestions = Array.isArray(sessions) ? sessions.flatMap(extractSessionQuestions) : [];

  return [
    ...(Array.isArray(libraryQuestions) ? libraryQuestions.map((q) => ({ ...q, source: "library" })) : []),
    ...sessionQuestions.map((q) => ({ ...q, source: "session" })),
  ]
    .map((q) => ({
      question_text: cleanText(q.question_text || q.question),
      correct_answer: cleanText(q.correct_answer || q.answer),
      category: cleanText(q.category),
      question_type: normalizeFetchedType(q.question_type),
      fun_fact: cleanText(q.fun_fact),
      is_liked: Boolean(q.is_liked || q.liked),
      is_disliked: Boolean(q.is_disliked || q.disliked),
      rating: cleanText(q.rating || q.status),
      source: q.source || "library",
    }))
    .filter((q) => q.question_text);
}

async function fetchJsonWithFallback(urls, headers) {
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response.json();
    } catch {
      // Try the next shape; Supabase schemas vary across deployments.
    }
  }
  return [];
}

function normalizeFetchedType(value) {
  return value === "true_false" || value === "multiple_choice" || value === "written" ? value : "written";
}

function extractSessionQuestions(session) {
  return [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions]
    .flatMap((value) => (Array.isArray(value) ? value : []));
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which", "who", "whom", "whose", "why", "with"]);
