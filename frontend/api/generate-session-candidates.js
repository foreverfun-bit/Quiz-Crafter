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
const FAST_STYLE_EXAMPLE_LIMIT = 8;
const DUPLICATE_EXAMPLE_LIMIT = 24;
const SOURCE_SEED_LIMIT = 18;
const SESSION_STYLE_REFERENCE_LIMIT = 8;
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

    if (req.body?.mode === "opentdb_import") {
      const result = await importFromOpenTrivia(req.body || {});
      return res.status(200).json(result);
    }

    if (req.body?.mode === "categorize") {
      const category = await categorizeQuestion(req.body || {});
      return res.status(200).json({ category });
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
      rejectedAnswers = [],
      currentBatchQuestions = [],
      sessionContext = null,
      generationMode = "polished",
      hostStyleProfile = null,
      venueId = null,
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
    const cleanRejectedAnswers = dedupeStrings(normalizeStringArray(rejectedAnswers));
    const cleanSessionContext = normalizeSessionContext(sessionContext);
    const cleanHostStyleProfile = normalizeHostStyleProfile(hostStyleProfile);
    const cleanVenueId = cleanText(venueId);
    const venueHistory = fastMode || !cleanVenueId ? null : await fetchVenueHistory(cleanVenueId);
    const venueProfileText = buildVenueProfileText(venueHistory);
    const allowUsedSources = hasReuseIntent(cleanTheme);
    const requireApprovedCategories = cleanLockedCategories.length > 0 || cleanApprovedCategories.length > 0;
    const categoryExpansionMode = false;
    const existingQuestions = avoidDuplicates || excludeUsed ? await fetchExistingQuestions(fastMode ? 220 : 1500, fastMode ? 100 : 500) : [];
    // Quick mode used to skip real-library style examples entirely to save
    // prompt size, even though existingQuestions is already fetched either
    // way -- that left Quick-mode generations with no automatic signal for
    // the host's actual voice, only whatever was manually taught via the
    // Style feedback buttons. A smaller sample keeps Quick mode fast while
    // still calibrating from real past questions instead of zero of them.
    const styleExamples = buildStyleExamples(existingQuestions, normalizedQuestionType, cleanApprovedCategories, fastMode ? FAST_STYLE_EXAMPLE_LIMIT : STYLE_EXAMPLE_LIMIT);
    const sessionStyleProfile = fastMode ? null : buildSessionStyleProfile(existingQuestions, {
      cleanTheme,
      cleanSessionContext,
      questionType: normalizedQuestionType,
      difficultyKey,
    });
    const existingFingerprints = new Set(existingQuestions.map((q) => fingerprint(q.question_text)));
    const existingAnswerPairs = new Set(existingQuestions.map((q) => answerPairFingerprint(q.question_text, q.correct_answer)));
    const existingAnswers = new Set(existingQuestions.map((q) => answerFingerprint(q.correct_answer)).filter(Boolean));
    // Questions already placed in THIS in-progress build only ever reached the
    // model as prompt text ("do not duplicate these") -- a soft instruction the
    // model doesn't reliably honor, and unlike the library/past-session sets
    // above this can't be gated behind avoidDuplicates or reset by the
    // no-candidates-came-back fallback passes below -- re-suggesting something
    // already sitting in the build should never be allowed.
    const inBuildQuestions = [...(cleanSessionContext?.builtQuestions || []), ...(cleanSessionContext?.activeRoundQuestions || [])];
    const inBuildFingerprints = new Set(inBuildQuestions.map((q) => fingerprint(q.question_text)));
    const inBuildAnswerPairs = new Set(inBuildQuestions.map((q) => answerPairFingerprint(q.question_text, q.correct_answer)));
    const rejectedQuestionFingerprints = new Set(cleanRejectedQuestions.map(fingerprint));
    const rejectedAnswerFingerprints = new Set([
      ...cleanRejectedAnswers.map(answerFingerprint),
      ...cleanRejectedQuestions.map(extractRejectedAnswer).filter(Boolean).map(answerFingerprint),
    ].filter(Boolean));

    const isQuickRegeneration = fastMode && cleanRejectedQuestions.length > 0;
    const sourceSeeds = isQuickRegeneration ? [] : await collectSourceSeeds({
      cleanTheme,
      cleanApprovedCategories,
      cleanLockedCategories,
      cleanExcludeCategories,
      normalizedQuestionType,
      safeCount,
      existingQuestions,
      rejectedQuestionFingerprints,
      rejectedAnswerFingerprints,
      allowUsedSources,
      allowQuestionBankSources: allowUsedSources || hasQuestionBankIntent(cleanTheme),
    });
    const sourceNotice = !allowUsedSources && !sourceSeeds.some((seed) => seed.source_type === "unused_library" || seed.source_type === "reusable") && hasMatchingUsedSourceQuestion(existingQuestions, {
      normalizedQuestionType,
      preferredCategories: cleanLockedCategories.length ? cleanLockedCategories : cleanApprovedCategories,
      cleanTheme,
      blockedCategories: new Set(cleanExcludeCategories.map(categoryKey)),
    })
      ? "I only found used questions in this category. Want to reuse one, search external sources, or generate a new draft?"
      : "";
    let parsed = null;
    let usedSourceBackedPrompt = false;
    if (sourceSeeds.length) {
      const sourcePrompt = buildSourceBackedPrompt({
        config,
        safeCount,
        difficultyKey,
        difficultyProfile,
        cleanTheme,
        cleanApprovedCategories,
        cleanLockedCategories,
        cleanExcludeCategories,
        cleanSessionContext,
        sourceSeeds,
        includeImagePrompt,
        cleanHostStyleProfile,
        sessionStyleProfile,
        cleanRejectedQuestions,
        cleanRejectedAnswers,
        venueProfileText,
      });
      parsed = await requestCandidates(sourcePrompt, { fastMode });
      usedSourceBackedPrompt = true;
    }
    if (!parsed?.candidates?.length) {
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
        cleanRejectedAnswers,
        cleanSessionContext,
        existingQuestions,
        styleExamples,
        excludeUsed,
        avoidDuplicates,
        includeImagePrompt,
        fastMode,
        cleanHostStyleProfile,
        sessionStyleProfile,
        venueProfileText,
      });
      parsed = await requestCandidates(prompt, { fastMode });
    }
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
      inBuildFingerprints,
      inBuildAnswerPairs,
      rejectedQuestionFingerprints,
      rejectedAnswerFingerprints,
      avoidDuplicates,
      includeImagePrompt,
      sourceSeeds,
      sourceBacked: usedSourceBackedPrompt,
      sessionStyleProfile,
    };
    let validation = normalizeCandidates(validationInput);

    if (!validation.candidates.length && Array.isArray(parsed.candidates) && parsed.candidates.length) {
      validation = normalizeCandidates({
        ...validationInput,
        cleanApprovedCategories: [],
        requireApprovedCategories: false,
        avoidDuplicates: Boolean(avoidDuplicates),
      });
    }
    if (!validation.candidates.length && Array.isArray(parsed.candidates) && parsed.candidates.length) {
      validation = normalizeCandidates({
        ...validationInput,
        cleanExcludeCategories: cleanRejectedCategories,
        cleanApprovedCategories: [],
        requireApprovedCategories: false,
        cleanLockedCategories: cleanLockedCategories.length ? cleanLockedCategories : [],
        existingFingerprints: avoidDuplicates ? existingFingerprints : new Set(),
        existingAnswerPairs: avoidDuplicates ? existingAnswerPairs : new Set(),
        existingAnswers: avoidDuplicates ? existingAnswers : new Set(),
        avoidDuplicates: Boolean(avoidDuplicates),
      });
    }
    if (!validation.candidates.length && Array.isArray(parsed.candidates) && parsed.candidates.length && !cleanLockedCategories.length) {
      validation = normalizeCandidates({
        ...validationInput,
        cleanExcludeCategories: [],
        cleanApprovedCategories: [],
        requireApprovedCategories: false,
        cleanLockedCategories: [],
        existingFingerprints: avoidDuplicates ? existingFingerprints : new Set(),
        existingAnswerPairs: avoidDuplicates ? existingAnswerPairs : new Set(),
        existingAnswers: avoidDuplicates ? existingAnswers : new Set(),
        avoidDuplicates: Boolean(avoidDuplicates),
      });
    }
    if (!validation.candidates.length && usedSourceBackedPrompt && !fastMode) {
      const fallbackPrompt = buildPrompt({
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
        cleanRejectedAnswers,
        cleanSessionContext,
        existingQuestions,
        styleExamples,
        excludeUsed,
        avoidDuplicates,
        includeImagePrompt,
        fastMode,
        cleanHostStyleProfile,
        sessionStyleProfile,
      });
      const fallbackParsed = await requestCandidates(fallbackPrompt, { fastMode });
      const fallbackValidationInput = {
        ...validationInput,
        candidates: fallbackParsed.candidates,
        sourceSeeds: [],
        sourceBacked: false,
        sessionStyleProfile,
      };
      validation = normalizeCandidates(fallbackValidationInput);
      if (!validation.candidates.length && Array.isArray(fallbackParsed.candidates) && fallbackParsed.candidates.length) {
        validation = normalizeCandidates({
          ...fallbackValidationInput,
          cleanApprovedCategories: [],
          requireApprovedCategories: false,
          avoidDuplicates: Boolean(avoidDuplicates),
        });
      }
    }

    return res.status(200).json({ candidates: validation.candidates.slice(0, safeCount), rejected: validation.rejected, requested: safeCount, source_notice: sourceNotice, style_reference_note: sessionStyleProfile?.note || "" });
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

function shuffleArray(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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
  // Was capped at 18/8 -- a leftover from when this only padded prompt text.
  // Now that it also feeds the hard in-build duplicate check below, a host
  // more than 18 questions into a build had everything past that point
  // invisible to both the soft prompt guidance and the dedup check. Raised
  // to match buildPrompt's own intended non-fast-mode ceiling (80) for the
  // full session, and to comfortably cover any single round for the active one.
  const builtQuestions = Array.isArray(value.builtQuestions) ? value.builtQuestions.map(cleanQuestion).filter((q) => q.question_text && q.correct_answer).slice(0, 80) : [];
  const activeRoundQuestions = Array.isArray(value.activeRoundQuestions) ? value.activeRoundQuestions.map(cleanQuestion).filter((q) => q.question_text && q.correct_answer).slice(0, 30) : [];
  const roundDescriptions = Array.isArray(value.roundDescriptions) ? value.roundDescriptions.map((round) => ({
    name: cleanText(round?.name).slice(0, 80),
    description: cleanText(round?.description).slice(0, 180),
    categories: normalizeStringArray(round?.categories).slice(0, 8),
  })).filter((round) => round.name || round.description || round.categories.length).slice(0, 8) : [];
  const categories = normalizeStringArray(value.categories).slice(0, 30);
  return { builtQuestions, activeRoundQuestions, roundDescriptions, categories };
}

function normalizeHostStyleProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const cleanExamples = (examples) => (Array.isArray(examples) ? examples : [])
    .map((item) => ({
      category: cleanText(item?.category),
      question_type: normalizeFetchedType(item?.question_type || item?.type),
      question_text: cleanText(item?.question_text || item?.question),
      correct_answer: cleanText(item?.correct_answer || item?.answer),
      fun_fact: cleanText(item?.fun_fact),
      note: cleanText(item?.note),
    }))
    .filter((item) => item.question_text && item.correct_answer)
    .slice(0, 6);
  return {
    preferredDifficulty: cleanText(source.preferredDifficulty),
    favoriteCategories: dedupeCategoryStrings(normalizeStringArray(source.favoriteCategories)).slice(0, 18),
    avoidedCategories: dedupeCategoryStrings(normalizeStringArray(source.avoidedCategories)).slice(0, 18),
    commonQuestionTypes: normalizeStringArray(source.commonQuestionTypes).slice(0, 6),
    preferredRoundStructure: cleanText(source.preferredRoundStructure),
    writingStyleNotes: cleanText(source.writingStyleNotes),
    funFactStyle: cleanText(source.funFactStyle),
    wrongAnswerStyle: cleanText(source.wrongAnswerStyle),
    categoriesThatPerformWell: dedupeCategoryStrings(normalizeStringArray(source.categoriesThatPerformWell)).slice(0, 18),
    categoriesThatPerformPoorly: dedupeCategoryStrings(normalizeStringArray(source.categoriesThatPerformPoorly)).slice(0, 18),
    venuePreferences: cleanText(source.venuePreferences),
    examplesOfGoodQuestions: cleanExamples(source.examplesOfGoodQuestions),
    examplesOfBadQuestions: cleanExamples(source.examplesOfBadQuestions),
  };
}

function buildHostStyleProfileText(profile) {
  if (!profile || !Object.values(profile).some((value) => Array.isArray(value) ? value.length : Boolean(value))) return "";
  const goodExamples = profile.examplesOfGoodQuestions?.length
    ? `Sounds-like-me examples:\n${profile.examplesOfGoodQuestions.slice(0, 4).map((q) => `- [${q.category || "Category"} / ${q.question_type}] ${q.question_text} Answer: ${q.correct_answer}${q.fun_fact ? ` Fun fact: ${q.fun_fact}` : ""}`).join("\n")}`
    : "";
  const badExamples = profile.examplesOfBadQuestions?.length
    ? `Avoid-this-style examples:\n${profile.examplesOfBadQuestions.slice(0, 4).map((q) => `- [${q.category || "Category"} / ${q.question_type}] ${q.question_text} Answer: ${q.correct_answer}${q.note ? ` (${q.note})` : ""}`).join("\n")}`
    : "";
  return [
    "Host Style Profile for Jewelzz / Forever Fun Events:",
    profile.preferredDifficulty ? `- Preferred difficulty: ${profile.preferredDifficulty}` : "",
    profile.writingStyleNotes ? `- Voice and wording: ${profile.writingStyleNotes}` : "",
    profile.funFactStyle ? `- Fun fact style: ${profile.funFactStyle}` : "",
    profile.wrongAnswerStyle ? `- Wrong answer style: ${profile.wrongAnswerStyle}` : "",
    profile.preferredRoundStructure ? `- Round structure: ${profile.preferredRoundStructure}` : "",
    profile.favoriteCategories?.length ? `- Favorite categories: ${profile.favoriteCategories.join(", ")}` : "",
    profile.avoidedCategories?.length ? `- Avoided categories: ${profile.avoidedCategories.join(", ")}` : "",
    profile.categoriesThatPerformWell?.length ? `- Categories that perform well: ${profile.categoriesThatPerformWell.join(", ")}` : "",
    profile.categoriesThatPerformPoorly?.length ? `- Categories to handle carefully or rewrite broadly: ${profile.categoriesThatPerformPoorly.join(", ")}` : "",
    profile.venuePreferences ? `- Venue preferences: ${profile.venuePreferences}` : "",
    goodExamples,
    badExamples,
    "Before returning JSON, silently style-check every candidate. Revise or replace any candidate that feels generic, too easy, too common, overexplained, category-repetitive, or not like this host would approve it.",
  ].filter(Boolean).join("\n");
}

function formatContextQuestion(question) {
  return `- [${question.round || "Session"} / ${question.category || "Uncategorized"} / ${question.question_type || "written"}] ${question.question_text} Answer: ${question.correct_answer}`;
}

function buildSourceBackedPrompt({ config, safeCount, difficultyKey, difficultyProfile, cleanTheme, cleanApprovedCategories, cleanLockedCategories, cleanExcludeCategories, cleanSessionContext = null, sourceSeeds = [], includeImagePrompt, cleanHostStyleProfile = null, sessionStyleProfile = null, cleanRejectedQuestions = [], cleanRejectedAnswers = [], venueProfileText = "" }) {
  const approvedCategoryText = cleanLockedCategories.length
    ? `Use exactly one of these locked categories: ${cleanLockedCategories.join(", ")}.`
    : cleanApprovedCategories.length
      ? `Use only these approved category names when possible, exact spelling: ${shuffleArray(cleanApprovedCategories).join(", ")}. This list is not in priority order -- do not favor the earlier names.`
      : "Use a broad useful trivia category.";
  const excludedCategoryText = cleanExcludeCategories.length ? `Do not use these categories: ${cleanExcludeCategories.join(", ")}.` : "";
  const themeText = cleanTheme ? `Request/theme: ${cleanTheme}` : "Request/theme: general live trivia.";
  const sessionContextText = cleanSessionContext && (cleanSessionContext.builtQuestions.length || cleanSessionContext.activeRoundQuestions.length)
    ? `Current session context. Do not duplicate these:\n${[...cleanSessionContext.activeRoundQuestions, ...cleanSessionContext.builtQuestions].slice(0, 30).map(formatContextQuestion).join("\n")}`
    : "";
  const rejectedText = cleanRejectedQuestions.length || cleanRejectedAnswers.length ? [
    cleanRejectedQuestions.length ? `Rejected candidate(s). Do not return these, close rewrites, same-answer variants, same subject, or same topic angle:\n${cleanRejectedQuestions.map((question) => `- ${question}`).join("\n")}` : "",
    cleanRejectedAnswers.length ? `Rejected answer(s). Do not use these correct answers again for this regeneration:\n${cleanRejectedAnswers.map((answer) => `- ${answer}`).join("\n")}` : "",
  ].filter(Boolean).join("\n") : "";
  const hostStyleProfileText = buildHostStyleProfileText(cleanHostStyleProfile);
  const sessionStyleText = sessionStyleProfile?.text || "";
  const imagePromptField = includeImagePrompt ? ',\n      "image_prompt": "A concise visual clue idea that does not reveal the answer"' : ',\n      "image_prompt": ""';
  const imagePromptRule = includeImagePrompt
    ? "- image_prompt may describe a useful visual clue that does not reveal the answer."
    : "- image_prompt must be empty.";
  const sourceText = sourceSeeds.map((seed, index) => [
    `Source ${index + 1}:`,
    `- type: ${seed.source_type}`,
    `- label: ${seed.source_label}`,
    seed.source_url ? `- url: ${seed.source_url}` : "",
    `- category hint: ${seed.category || "General"}`,
    seed.question_text ? `- source question: ${seed.question_text}` : "",
    seed.correct_answer ? `- answer/fact subject: ${seed.correct_answer}` : "",
    seed.fact ? `- fact: ${seed.fact}` : "",
    seed.fun_fact ? `- source note: ${seed.fun_fact}` : "",
    `- confidence: ${seed.confidence}`,
  ].filter(Boolean).join("\n")).join("\n\n");

  return `
Create exactly ${safeCount} ${config.label} trivia questions by curating and rewriting the source seeds below.

You are an editor and trivia host, not the fact source. Do not invent unsupported facts when a source-backed option is available.

${themeText}

Source seeds:
${sourceText}

Return valid JSON only:
{
  "candidates": [
    {
      "source_index": 1,
      "category": "History",
      "question_text": "Host-ready trivia question.",
      "correct_answer": "Correct answer",
      "incorrect_answers": [],
      "fun_fact": "One short sentence.",
      "difficulty": "${difficultyKey}",
      "question_type": "${config.outputType}",
      "image_url": ""${imagePromptField},
      "source_type": "unused_library | reusable | external_source | ai_fallback | used_before",
      "source_url": "https://...",
      "source_label": "Source label",
      "confidence": 0.85,
      "originality_score": 0.75,
      "similarity_score": 0.15,
      "style_note": "Based on your previous summer sessions",
      "originality_note": "New question - not previously used",
      "needsReview": false
    }
  ]
}

Rules:
- Every candidate must be grounded in one source seed and include its source_index.
- Preserve the source seed's source_type, source_label, and source_url.
- You may rewrite wording, adjust difficulty, and generate plausible wrong answers.
- fun_fact must be one short sentence of genuinely true additional context about THIS SAME candidate's specific subject or answer -- not a generic or unrelated trivia tidbit about a different topic, even a true one. If you do not have a real, directly relevant fact for this exact answer, leave fun_fact as an empty string rather than filling it with something unrelated.
- If this is a regeneration, choose a materially different source seed and answer angle from the rejected candidate. Same category is okay; same fact is not.
- Do not add facts that are not supported by the seed unless you mark needsReview true and lower confidence below 0.65.
- ${config.roundGuidance}
- ${config.answerRule}
- question_type must be "${config.outputType}".
- difficulty must be "${difficultyKey}". ${difficultyProfile.guidance}
- ${approvedCategoryText}
- ${excludedCategoryText}
- ${imagePromptRule}
- Keep it playable for a US bar-trivia room. Fresh angle, clear clue path, no sterile encyclopedia wording.
- For multiple choice, wrong answers should be plausible and comparable.
- For written answer, the answer should be familiar/gettable enough without options.
${hostStyleProfileText}
${venueProfileText}
${sessionStyleText}
${sessionContextText}
${rejectedText}
`.trim();
}

function buildPrompt({ config, safeCount, difficultyKey, difficultyProfile, cleanTheme, cleanExcludeCategories, cleanApprovedCategories, cleanLockedCategories, categoryExpansionMode, cleanRejectedQuestions = [], cleanRejectedAnswers = [], cleanSessionContext = null, existingQuestions, styleExamples, excludeUsed, avoidDuplicates, includeImagePrompt, fastMode = false, cleanHostStyleProfile = null, sessionStyleProfile = null, venueProfileText = "" }) {
  const overGenerateCount = fastMode ? Math.min(8, Math.max(safeCount + 1, Math.ceil(safeCount * 1.35))) : Math.min(18, Math.max(safeCount + 4, Math.ceil(safeCount * 1.7)));
  const lockedCategoryText = cleanLockedCategories.length ? `Locked categories are active. The category field must exactly match one of these locked categories: ${cleanLockedCategories.join(", ")}. Generate all candidates inside these locked categories until the host unlocks them.` : "";
  const shuffledApprovedCategories = shuffleArray(cleanApprovedCategories);
  const approvedCategoryText = cleanLockedCategories.length
    ? lockedCategoryText
    : categoryExpansionMode
      ? `Use only these approved category names. The category field must exactly match one of these names; do not invent adjacent, similar, or new category names: ${shuffledApprovedCategories.join(", ")}. This list is not in priority order -- do not favor the earlier names.`
      : cleanApprovedCategories.length
      ? `Use only these approved category names. The category field must exactly match one of these names; do not invent adjacent, similar, or new category names: ${shuffledApprovedCategories.join(", ")}. This list is not in priority order -- do not favor the earlier names.`
      : `Use varied broad categories such as: ${shuffleArray(BROAD_CATEGORIES).join(", ")}.`;
  const excludedCategoryText = cleanExcludeCategories.length ? `Do not use these rejected or avoided categories: ${cleanExcludeCategories.join(", ")}.` : "";
  const categoryDiversityText = !cleanLockedCategories.length && safeCount > 1 ? "Spread candidates across as many different categories as the approved list allows. Do not use the same category for more than a couple of candidates unless the approved list is very short." : "";
  const themeText = cleanTheme ? `Theme/vibe/category guidance: ${cleanTheme}. Stay useful to that direction, but avoid repetitive question angles.` : "";
  const tasteProfileText = buildTasteProfileText(styleExamples, cleanSessionContext);
  const hostStyleProfileText = buildHostStyleProfileText(cleanHostStyleProfile);
  const sessionStyleText = sessionStyleProfile?.text || "";
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
  const rejectedText = cleanRejectedQuestions.length || cleanRejectedAnswers.length ? [
    cleanRejectedQuestions.length ? `The host explicitly rejected these generated questions. Do not return them, close rewrites, same-answer variations, or same topic-angle cousins:\n${cleanRejectedQuestions.map((question) => `- ${question}`).join("\n")}` : "",
    cleanRejectedAnswers.length ? `Also do not use these rejected correct answers again for this refresh/regeneration:\n${cleanRejectedAnswers.map((answer) => `- ${answer}`).join("\n")}` : "",
  ].filter(Boolean).join("\n") : "";
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

Priority order:
1. Playable for a US bar-trivia room.
2. Fits the requested question type, category constraints, round, and host style.
3. Fresh angle with a satisfying clue path.
4. Avoids duplicates and stale quiz-bank facts.
If these priorities conflict, choose playable and host-ready over obscure, overly constrained, or technically novel.

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
      "image_url": ""${imagePromptField},
      "style_note": "Based on your previous summer sessions",
      "originality_note": "New question - not previously used"
    }
  ]
}

${fastMode ? "Quick draft mode: move fast. Return complete usable drafts with concise wording, plausible wrong answers when needed, and one short fun fact. If this is a regeneration, prioritize a materially different answer/topic angle over perfect polish." : "Polished mode: spend extra care on clue path, wrong answers, and fun facts."}

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
- fun_fact must be one short sentence of genuinely true additional context about THIS SAME question's specific subject or answer -- not a generic or unrelated trivia tidbit about a different topic, even a true one. It must not spoil another question. If you do not have a real, directly relevant fact for this exact answer, leave fun_fact as an empty string rather than filling it with something unrelated.
- ${config.answerRule}
- question_type must be "${config.outputType}".
- image_url must be "".
- difficulty must be "${difficultyKey}".
${imagePromptRule}
${hostStyleProfileText}
${venueProfileText}
${sessionStyleText}
${hostHardText}
${tasteProfileText}
${sessionContextText}
${styleText}
${themeText}
${excludedCategoryText}
${categoryDiversityText}
${usedText}
${rejectedText}
${duplicateText}
`.trim();
}

function buildStyleExamples(existingQuestions, questionType, approvedCategories, limit = STYLE_EXAMPLE_LIMIT) {
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
  return sampleStable(candidates, limit);
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

function buildSessionStyleProfile(existingQuestions, { cleanTheme = "", cleanSessionContext = null, questionType = "written", difficultyKey = "medium" } = {}) {
  const sessionGroups = new Map();
  (Array.isArray(existingQuestions) ? existingQuestions : [])
    .filter((question) => question?.source === "session" && question.question_text)
    .forEach((question) => {
      const key = question.session_key || question.session_id || `session-${question.session_index || "unknown"}`;
      const existing = sessionGroups.get(key) || { key, meta: question.session_meta || {}, questions: [] };
      existing.questions.push(question);
      sessionGroups.set(key, existing);
    });

  const sessions = [...sessionGroups.values()]
    .map((session) => ({ ...session, score: scoreSessionStyleReference(session, { cleanTheme, cleanSessionContext, questionType }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SESSION_STYLE_REFERENCE_LIMIT)
    .filter((session) => session.questions.length);

  if (!sessions.length) return null;

  const allQuestions = sessions.flatMap((session) => session.questions);
  const typeCounts = countBy(allQuestions, (question) => normalizeFetchedType(question.question_type));
  const categoryCounts = countBy(allQuestions, (question) => cleanText(question.category) || "Uncategorized");
  const roundCounts = countBy(allQuestions, (question) => cleanText(question.round) || cleanText(question.source_slot) || normalizeFetchedType(question.question_type));
  const averageQuestionLength = Math.round(allQuestions.reduce((sum, question) => sum + cleanText(question.question_text).length, 0) / allQuestions.length);
  const funFacts = allQuestions.map((question) => cleanText(question.fun_fact)).filter(Boolean);
  const averageFunFactLength = funFacts.length ? Math.round(funFacts.reduce((sum, fact) => sum + fact.length, 0) / funFacts.length) : 0;
  const typeMix = formatCountList(typeCounts, 5);
  const topCategories = formatCountList(categoryCounts, 12);
  const roundPattern = formatCountList(roundCounts, 8);
  const sessionNames = sessions.map((session) => session.meta.name).filter(Boolean).slice(0, 3);
  const seasonalNote = inferSeasonalStyleNote(cleanTheme, cleanSessionContext, sessions);
  const note = seasonalNote || (sessionNames.length ? `Based on prior sessions like ${sessionNames.join(", ")}` : "Based on your prior session structure");

  return {
    note,
    text: `Session-style reference summary (${sessions.length} relevant past session${sessions.length === 1 ? "" : "s"}). These are training examples for structure, pacing, category balance, wording, and fun fact style only. Do not copy, reuse, lightly rewrite, or return any question or answer from these sessions.
- Usual question-type mix in references: ${typeMix || "mixed"}.
- Common round/category structure in references: ${roundPattern || "varied rounds"}.
- Category balance to echo without repeating exact questions: ${topCategories || "varied broad categories"}.
- Typical question length: about ${averageQuestionLength} characters. Keep clues readable aloud.
- Fun fact style: ${funFacts.length ? `short host note, about ${averageFunFactLength} characters on average` : "short, interesting, host-friendly color when available"}.
- Requested type/difficulty now: ${questionType} / ${difficultyKey}. Match the closest reference pattern while creating entirely new facts and clue angles.
- Candidate labels should include a short style_note such as "${note}" and originality_note "New question - not previously used".`,
  };
}

function scoreSessionStyleReference(session, { cleanTheme = "", cleanSessionContext = null, questionType = "written" } = {}) {
  const themeTerms = new Set(tokenizeSourceQuery(cleanTheme));
  const currentCategories = new Set([
    ...(cleanSessionContext?.activeRoundQuestions || []),
    ...(cleanSessionContext?.builtQuestions || []),
  ].map((question) => categoryKey(question.category)).filter(Boolean));
  const metaText = tokenizeSourceQuery([session.meta?.name, session.meta?.venue, session.meta?.date].join(" "));
  let score = Math.min(10, session.questions.length);
  session.questions.forEach((question) => {
    if (normalizeFetchedType(question.question_type) === questionType) score += 2;
    if (currentCategories.has(categoryKey(question.category))) score += 1;
    if (isLikedQuestion(question)) score += 2;
    if (question.fun_fact) score += 0.5;
    const haystack = tokenizeSourceQuery([question.category, question.question_text, question.correct_answer, question.fun_fact].join(" "));
    haystack.forEach((term) => { if (themeTerms.has(term)) score += 1; });
  });
  metaText.forEach((term) => { if (themeTerms.has(term)) score += 2; });
  return score;
}

function countBy(items, getKey) {
  const counts = new Map();
  items.forEach((item) => {
    const key = cleanText(getKey(item));
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function formatCountList(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => `${label} (${count})`)
    .join(", ");
}

function inferSeasonalStyleNote(cleanTheme, cleanSessionContext, sessions) {
  const text = [cleanTheme, cleanSessionContext?.sessionName, cleanSessionContext?.venue, ...sessions.map((session) => `${session.meta?.name || ""} ${session.meta?.date || ""}`)].join(" ").toLowerCase();
  if (/\b(summer|jun|june|jul|july|aug|august)\b/.test(text)) return "Based on your previous summer sessions";
  if (/\b(fall|autumn|sep|sept|oct|nov|halloween)\b/.test(text)) return "Based on your previous fall sessions";
  if (/\b(winter|dec|jan|feb|holiday|christmas|new year)\b/.test(text)) return "Based on your previous winter sessions";
  if (/\b(spring|mar|apr|may|easter)\b/.test(text)) return "Based on your previous spring sessions";
  return "";
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

function isServerQuestionUsed(question) {
  return Boolean(
    question?.is_used === true ||
    question?.used === true ||
    question?.used_at ||
    Number(question?.times_used || 0) > 0
  );
}

function questionStatus(question) {
  return cleanText(question?.memory_status || question?.rating || question?.status).toLowerCase().replace(/\s+/g, "_");
}

function isReusableQuestion(question) {
  const status = questionStatus(question);
  return Boolean(question?.is_reusable || question?.reusable || status === "reusable" || status === "reuse" || status === "evergreen");
}

function isBlockedSourceQuestion(question, { allowUsedSources = false } = {}) {
  const status = questionStatus(question);
  const blockedStatuses = new Set(["used", "used_recently", "retired", "too_common", "rejected", "needs_rewrite", "disliked", "dislike"]);
  if (isReusableQuestion(question)) return false;
  if (blockedStatuses.has(status)) return !allowUsedSources;
  if (isServerQuestionUsed(question)) return !allowUsedSources;
  return false;
}

function hasReuseIntent(value) {
  return /\b(reuse|re-used|reused|used before|past question|past session|old session|old question|pull from old|from old sessions)\b/i.test(cleanText(value));
}

function hasQuestionBankIntent(value) {
  return /\b(question bank|library|saved question|saved questions|unused question|unused questions|from my questions|from my bank)\b/i.test(cleanText(value));
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

function normalizeCandidates({ candidates, config, questionType, difficultyKey, cleanExcludeCategories, cleanApprovedCategories, cleanLockedCategories, requireApprovedCategories = true, existingFingerprints, existingAnswerPairs, existingAnswers, inBuildFingerprints = new Set(), inBuildAnswerPairs = new Set(), rejectedQuestionFingerprints, rejectedAnswerFingerprints, avoidDuplicates, includeImagePrompt, sourceSeeds = [], sourceBacked = false, sessionStyleProfile = null }) {
  const rejected = [];
  const accepted = [];
  const batchFingerprints = new Set();
  const batchAnswerPairs = new Set();
  const batchAnswers = new Set();
  const batchCategoryCounts = new Map();
  const excludedCategories = new Set(cleanExcludeCategories.map(categoryKey));
  const approvedCategorySet = new Set(cleanApprovedCategories.map(categoryKey));
  const lockedCategorySet = new Set(cleanLockedCategories.map(categoryKey));
  const shouldBlockRepeatedAnswers = questionType !== "true_false";
  // A batch spreading across categories relied entirely on a soft prompt
  // instruction the model doesn't reliably follow -- cap how many candidates
  // in one response can share a category. Skipped when the category pool is
  // deliberately narrow (locked, or an approved list of 2 or fewer), since a
  // cap would just make those batches impossible to fill.
  const maxPerCategory = lockedCategorySet.size > 0 || (approvedCategorySet.size > 0 && approvedCategorySet.size <= 2) ? Infinity : 2;

  if (!Array.isArray(candidates)) throw new Error("No candidates returned");

  candidates.forEach((candidate, index) => {
    const normalized = normalizeCandidate(candidate, config, questionType, difficultyKey, includeImagePrompt, { sourceSeeds, sourceBacked, sessionStyleProfile });
    if (!normalized.ok) {
      rejected.push({ index, reason: normalized.reason });
      return;
    }

    const item = normalized.candidate;
    const itemFingerprint = fingerprint(item.question_text);
    const itemAnswerPair = answerPairFingerprint(item.question_text, item.correct_answer);
    const itemAnswer = answerFingerprint(item.correct_answer);
    const itemCategoryKey = categoryKey(item.category);
    const isOwnSourceCandidate = ["unused_library", "reusable", "question_bank"].includes(item.source_type);
    const hasUsedSourceSeed = sourceSeeds.some((seed) => seed.source_type === "used_before");

    if (item.source_type === "used_before" && !hasUsedSourceSeed) {
      rejected.push({ index, question: item.question_text, reason: "used_question_not_requested" });
      return;
    }
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
    if (isTooSimilarToAny(itemFingerprint, rejectedQuestionFingerprints)) {
      rejected.push({ index, question: item.question_text, reason: "too_similar_to_rejected_question" });
      return;
    }
    if (shouldBlockRepeatedAnswers && rejectedAnswerFingerprints.has(itemAnswer)) {
      rejected.push({ index, question: item.question_text, reason: "rejected_answer_repeated" });
      return;
    }
    // Unconditional -- not gated behind avoidDuplicates -- a question or
    // answer angle already sitting in this in-progress build should never
    // come back as a "new" suggestion.
    if (inBuildFingerprints.has(itemFingerprint) || isTooSimilarToAny(itemFingerprint, inBuildFingerprints)) {
      rejected.push({ index, question: item.question_text, reason: "duplicate_in_current_build" });
      return;
    }
    if (!isOwnSourceCandidate && inBuildAnswerPairs.has(itemAnswerPair)) {
      rejected.push({ index, question: item.question_text, reason: "duplicate_answer_angle_in_current_build" });
      return;
    }
    if (maxPerCategory !== Infinity && (batchCategoryCounts.get(itemCategoryKey) || 0) >= maxPerCategory) {
      rejected.push({ index, question: item.question_text, reason: "category_overrepresented_in_batch" });
      return;
    }
    if (avoidDuplicates) {
      if (existingFingerprints.has(itemFingerprint) || batchFingerprints.has(itemFingerprint)) {
        rejected.push({ index, question: item.question_text, reason: "duplicate_question" });
        return;
      }
      if (isTooSimilarToAny(itemFingerprint, existingFingerprints)) {
        rejected.push({ index, question: item.question_text, reason: "near_duplicate_existing_question" });
        return;
      }
      if (!isOwnSourceCandidate && (existingAnswerPairs.has(itemAnswerPair) || batchAnswerPairs.has(itemAnswerPair))) {
        rejected.push({ index, question: item.question_text, reason: "duplicate_answer_angle" });
        return;
      }
      if (!isOwnSourceCandidate && shouldBlockRepeatedAnswers && itemAnswer && (existingAnswers.has(itemAnswer) || batchAnswers.has(itemAnswer))) {
        rejected.push({ index, question: item.question_text, reason: "duplicate_correct_answer" });
        return;
      }
    }

    batchFingerprints.add(itemFingerprint);
    batchAnswerPairs.add(itemAnswerPair);
    if (shouldBlockRepeatedAnswers && itemAnswer) batchAnswers.add(itemAnswer);
    batchCategoryCounts.set(itemCategoryKey, (batchCategoryCounts.get(itemCategoryKey) || 0) + 1);
    accepted.push(item);
  });

  return { candidates: accepted, rejected };
}

function normalizeCandidate(candidate, config, questionType, difficultyKey, includeImagePrompt, { sourceSeeds = [], sourceBacked = false, sessionStyleProfile = null } = {}) {
  if (!candidate || typeof candidate !== "object") return { ok: false, reason: "candidate_not_object" };

  const category = cleanText(candidate.category);
  const questionText = cleanText(candidate.question_text);
  let correctAnswer = cleanText(candidate.correct_answer);
  const funFact = cleanText(candidate.fun_fact);
  const imagePrompt = includeImagePrompt ? cleanText(candidate.image_prompt) : "";
  const incorrectAnswers = Array.isArray(candidate.incorrect_answers) ? candidate.incorrect_answers.map(cleanText).filter(Boolean) : [];
  const sourceIndex = Math.max(0, Number(candidate.source_index || 0) - 1);
  const sourceSeed = sourceSeeds[sourceIndex] || null;
  const sourceType = normalizeSourceType(cleanText(candidate.source_type) || sourceSeed?.source_type || (sourceBacked ? "external_source" : "ai_fallback"));
  const sourceUrl = cleanText(candidate.source_url) || sourceSeed?.source_url || "";
  const sourceLabel = normalizeSourceLabel(sourceType, cleanText(candidate.source_label) || sourceSeed?.source_label);
  const confidence = clampConfidence(candidate.confidence ?? sourceSeed?.confidence ?? (sourceBacked ? 0.68 : 0.45));
  const originalityScore = clampConfidence(candidate.originality_score ?? sourceSeed?.originality_score ?? (sourceType === "used_before" ? 0.2 : sourceBacked ? 0.7 : 0.4));
  const similarityScore = clampConfidence(candidate.similarity_score ?? sourceSeed?.similarity_score ?? (sourceType === "used_before" ? 1 : 0.25));
  const needsReview = typeof candidate.needsReview === "boolean" ? candidate.needsReview : (!sourceBacked || Boolean(sourceSeed?.needsReview));
  const styleNote = cleanText(candidate.style_note) || sessionStyleProfile?.note || "Based on your prior session style";
  const originalityNote = cleanText(candidate.originality_note) || (sourceType === "used_before" ? "Used before - add only if you chose to reuse it" : "New question - not previously used");

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
      source_type: sourceType,
      source_url: sourceUrl,
      source_label: sourceLabel,
      confidence,
      originality_score: originalityScore,
      similarity_score: similarityScore,
      style_note: styleNote,
      originality_note: originalityNote,
      needsReview,
    },
  };
}

function normalizeSourceType(value) {
  const key = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["question_bank", "library", "unused_question_bank"].includes(key)) return "unused_library";
  if (["open_trivia_db", "wikipedia", "wikidata", "source_pool"].includes(key)) return "external_source";
  if (["ai", "ai_draft", "ai_fallback"].includes(key)) return "ai_fallback";
  if (["used", "used_before", "past_session", "past_question"].includes(key)) return "used_before";
  if (key === "reusable") return "reusable";
  return key || "ai_fallback";
}

function normalizeSourceLabel(sourceType, sourceLabel = "") {
  if (sourceType === "unused_library") return "Unused Library";
  if (sourceType === "reusable") return "Reusable";
  if (sourceType === "external_source") return "External Source";
  if (sourceType === "used_before") return "Used Before";
  if (sourceType === "ai_fallback") return "AI Draft";
  return sourceLabel || "Source";
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric));
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

function extractRejectedAnswer(value) {
  const text = cleanText(value);
  const match = text.match(/\b(?:answer|correct_answer)\s*[:=]\s*([^|;.]+)$/i) || text.match(/\banswer\s*[:=]\s*([^|;.]+)/i);
  return match ? match[1] : "";
}

function isTooSimilarToAny(itemFingerprint, fingerprintSet) {
  if (!itemFingerprint || !fingerprintSet?.size) return false;
  const itemTokens = new Set(itemFingerprint.split(" ").filter(Boolean));
  if (itemTokens.size < 4) return false;
  for (const rejectedFingerprint of fingerprintSet) {
    const rejectedTokens = new Set(String(rejectedFingerprint || "").split(" ").filter(Boolean));
    if (rejectedTokens.size < 4) continue;
    let shared = 0;
    itemTokens.forEach((token) => {
      if (rejectedTokens.has(token)) shared += 1;
    });
    const overlap = shared / Math.min(itemTokens.size, rejectedTokens.size);
    if (overlap >= 0.7 && shared >= 4) return true;
  }
  return false;
}

async function collectSourceSeeds({ cleanTheme, cleanApprovedCategories, cleanLockedCategories, cleanExcludeCategories, normalizedQuestionType, safeCount, existingQuestions, rejectedQuestionFingerprints, rejectedAnswerFingerprints, allowUsedSources = false, allowQuestionBankSources = false }) {
  const blockedCategories = new Set(cleanExcludeCategories.map(categoryKey));
  const preferredCategories = cleanLockedCategories.length ? cleanLockedCategories : cleanApprovedCategories;
  const themeTerms = tokenizeSourceQuery([cleanTheme, ...preferredCategories.slice(0, 5)].join(" "));
  const sourceSeeds = [
    ...(allowQuestionBankSources ? buildQuestionBankSeeds(existingQuestions, { normalizedQuestionType, preferredCategories, themeTerms, blockedCategories, allowUsedSources }) : []),
    ...await fetchOpenTriviaSeeds({ cleanTheme, preferredCategories, safeCount }),
    ...await fetchWikipediaSeeds({ cleanTheme, preferredCategories, safeCount }),
  ]
    .filter((seed) => seed && !blockedCategories.has(categoryKey(seed.category)))
    .filter((seed) => !rejectedQuestionFingerprints.has(fingerprint(seed.question_text || seed.fact || "")))
    .filter((seed) => !isTooSimilarToAny(fingerprint(seed.question_text || seed.fact || ""), rejectedQuestionFingerprints))
    .filter((seed) => !rejectedAnswerFingerprints.has(answerFingerprint(seed.correct_answer || "")));
  return dedupeSourceSeeds(sourceSeeds).slice(0, SOURCE_SEED_LIMIT);
}

function buildQuestionBankSeeds(existingQuestions, { normalizedQuestionType, preferredCategories, themeTerms, blockedCategories, allowUsedSources = false }) {
  const preferredKeys = new Set(preferredCategories.map(categoryKey));
  return (Array.isArray(existingQuestions) ? existingQuestions : [])
    .filter((question) => question.source === "library")
    .filter((question) => !isBlockedSourceQuestion(question, { allowUsedSources }))
    .filter((question) => question.question_text && question.correct_answer)
    .filter((question) => !blockedCategories.has(categoryKey(question.category)))
    .map((question) => {
      const reusable = isReusableQuestion(question);
      const used = isServerQuestionUsed(question) || ["used", "used_recently"].includes(questionStatus(question));
      return {
        source_type: reusable ? "reusable" : used ? "used_before" : "unused_library",
        source_label: reusable ? "Reusable" : used ? "Used Before" : "Unused Library",
        source_url: "",
        category: question.category || "General",
        question_text: question.question_text,
        correct_answer: question.correct_answer,
        fun_fact: question.fun_fact,
        fact: [question.question_text, question.fun_fact].filter(Boolean).join(" "),
        confidence: reusable ? 0.78 : used ? 0.62 : 0.82,
        needsReview: used,
        originality_score: used ? 0.25 : reusable ? 0.55 : 0.72,
        similarity_score: used ? 1 : 0,
        source_priority: used ? 5 : reusable ? 2 : 1,
        score: scoreSourceMatch(question, { normalizedQuestionType, preferredKeys, themeTerms }) + (reusable ? 3 : 0) - (used ? 4 : 0),
      };
    })
    .filter((seed) => seed.score > 0)
    .sort((a, b) => a.source_priority - b.source_priority || b.score - a.score)
    .slice(0, 8);
}

function hasMatchingUsedSourceQuestion(existingQuestions, { normalizedQuestionType, preferredCategories, cleanTheme, blockedCategories }) {
  const preferredKeys = new Set(preferredCategories.map(categoryKey));
  const themeTerms = tokenizeSourceQuery([cleanTheme, ...preferredCategories.slice(0, 5)].join(" "));
  return (Array.isArray(existingQuestions) ? existingQuestions : []).some((question) => {
    if (question.source !== "library") return false;
    if (!isServerQuestionUsed(question) && !["used", "used_recently"].includes(questionStatus(question))) return false;
    if (isReusableQuestion(question)) return false;
    if (!question.question_text || !question.correct_answer) return false;
    if (blockedCategories.has(categoryKey(question.category))) return false;
    return scoreSourceMatch(question, { normalizedQuestionType, preferredKeys, themeTerms }) > 0;
  });
}

function scoreSourceMatch(question, { normalizedQuestionType, preferredKeys, themeTerms }) {
  let score = 0;
  if (question.question_type === normalizedQuestionType) score += 5;
  if (preferredKeys.size && preferredKeys.has(categoryKey(question.category))) score += 7;
  if (isLikedQuestion(question)) score += 5;
  if (isDislikedQuestion(question)) score -= 8;
  const haystack = tokenizeSourceQuery([question.category, question.question_text, question.correct_answer, question.fun_fact].join(" "));
  const overlap = themeTerms.filter((term) => haystack.includes(term)).length;
  score += overlap * 3;
  if (!themeTerms.length && !preferredKeys.size) score += 1;
  return score;
}

// Direct import: unlike fetchOpenTriviaSeeds() below (which only pulls a
// fact/answer pair to hand to the AI rewrite prompt), this keeps Open Trivia
// DB's own question wording and wrong answers intact and never touches the
// LLM -- the whole point is a source of questions that's already correct,
// instead of adding another AI-rewrite pass that can introduce new errors.
const OPENTDB_DIFFICULTY = new Set(["easy", "medium", "hard"]);
async function importFromOpenTrivia({ questionType, count, difficulty, theme, categoryId: explicitCategoryId }) {
  const requestedType = questionType === "true_false" ? "true_false" : "multiple_choice";
  const opentdbType = requestedType === "true_false" ? "boolean" : "multiple";
  const opentdbDifficulty = OPENTDB_DIFFICULTY.has(difficulty) ? difficulty : "";
  const amount = Math.max(1, Math.min(50, Number(count) || 10));
  // An explicit category from the host's own picker always wins; falling
  // back to guessing one from free-text theme only covers older callers.
  const parsedExplicitCategoryId = Number(explicitCategoryId);
  const categoryId = Number.isInteger(parsedExplicitCategoryId) && parsedExplicitCategoryId > 0
    ? parsedExplicitCategoryId
    : chooseOpenTriviaCategory(typeof theme === "string" ? theme.trim() : "", []);

  const fetchBatch = async (withCategory) => {
    const params = new URLSearchParams({ amount: String(amount), type: opentdbType });
    if (opentdbDifficulty) params.set("difficulty", opentdbDifficulty);
    if (withCategory && categoryId) params.set("category", String(categoryId));
    const response = await fetchWithTimeout(`https://opentdb.com/api.php?${params.toString()}`, {}, 8000);
    if (!response.ok) throw new Error(`Open Trivia DB request failed (${response.status})`);
    return response.json();
  };

  let data = await fetchBatch(true);
  let sourceNotice = "";
  if (data?.response_code === 1 && categoryId) {
    // Not enough questions in that category/difficulty/type combo -- broaden
    // to any category rather than failing outright.
    data = await fetchBatch(false);
    sourceNotice = "Not enough matching questions in that category, so results are pulled from all Open Trivia DB categories.";
  }
  if (data?.response_code !== 0 || !Array.isArray(data?.results) || !data.results.length) {
    throw new Error("Open Trivia DB didn't have enough questions for that combination. Try a different type, difficulty, or fewer questions.");
  }

  if (questionType === "written") {
    sourceNotice = [sourceNotice, "Open Trivia DB has no written-answer questions, so multiple choice questions were imported instead."].filter(Boolean).join(" ");
  }

  const candidates = data.results.map((item) => {
    const isBoolean = item.type === "boolean";
    return {
      category: mapOpenTriviaCategory(decodeHtml(item.category)),
      question_text: decodeHtml(item.question),
      question_type: isBoolean ? "true_false" : "multiple_choice",
      correct_answer: isBoolean ? (decodeHtml(item.correct_answer) === "True" ? "True" : "False") : decodeHtml(item.correct_answer),
      incorrect_answers: isBoolean ? null : (Array.isArray(item.incorrect_answers) ? item.incorrect_answers.map(decodeHtml).join("; ") : null),
      fun_fact: "",
      difficulty: item.difficulty || opentdbDifficulty || "medium",
      source_type: "external_source",
      source_label: "Open Trivia DB",
      source_url: "https://opentdb.com/",
      needsReview: false,
      confidence: 0.9,
    };
  });

  return { candidates, source_notice: sourceNotice || undefined };
}

// Re-categorizes a question in place without touching its wording or
// answer -- used to fix Open Trivia DB's own category labels (which are
// often just "General Knowledge" for a lot of its inventory) without
// reintroducing the AI-rewrite risk this import was built to avoid. The
// model only ever sees the question/answer as read-only context for
// picking a label; it has no path to change either one.
async function categorizeQuestion({ questionText, correctAnswer, currentCategory, approvedCategories }) {
  const cleanQuestion = cleanText(questionText);
  const cleanAnswer = cleanText(correctAnswer);
  const cleanApproved = dedupeCategoryStrings(normalizeStringArray(approvedCategories));
  if (!cleanQuestion) return cleanText(currentCategory) || "General";

  if (!process.env.OPENAI_API_KEY) return inferCategoryFromText(`${cleanQuestion} ${cleanAnswer}`);

  const prompt = `Pick the single best trivia category for this question. Do not answer the question or change it in any way -- only classify it.
${cleanApproved.length ? `Prefer one of these exact categories if it genuinely fits (use the exact spelling): ${cleanApproved.join(", ")}. Only pick something else if none of them fit.` : "Pick a broad, useful trivia category, e.g. Movies, Music, Science, History, Geography, Sports, Television, Video Games, Art, Food & Drink, Animals, Technology, Mythology, Literature."}

Question: ${cleanQuestion}
Correct answer: ${cleanAnswer}
Current category: ${cleanText(currentCategory) || "none"}

Return strict JSON: {"category": "..."}`;

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You classify trivia questions into a category. You never write, answer, or alter the question in any way. Return strict JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    }, 12000);
    if (!response.ok) throw new Error(await response.text());
    const json = await response.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}");
    const category = cleanText(parsed.category);
    return category || cleanText(currentCategory) || "General";
  } catch (error) {
    console.warn("Categorize question error:", error.message || error);
    return inferCategoryFromText(`${cleanQuestion} ${cleanAnswer}`);
  }
}

async function fetchOpenTriviaSeeds({ cleanTheme, preferredCategories, safeCount }) {
  const categoryId = chooseOpenTriviaCategory(cleanTheme, preferredCategories);
  const url = `https://opentdb.com/api.php?amount=${Math.min(10, Math.max(4, safeCount * 2))}${categoryId ? `&category=${categoryId}` : ""}`;
  try {
    const response = await fetchWithTimeout(url, {}, 3500);
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data?.results)) return [];
    return data.results.map((item) => ({
      source_type: "external_source",
      source_label: "External Source",
      source_url: "https://opentdb.com/",
      category: mapOpenTriviaCategory(decodeHtml(item.category)),
      question_text: decodeHtml(item.question),
      correct_answer: decodeHtml(item.correct_answer),
      fun_fact: "",
      fact: `${decodeHtml(item.question)} Answer: ${decodeHtml(item.correct_answer)}`,
      confidence: 0.72,
      needsReview: true,
      originality_score: 0.68,
      similarity_score: 0.1,
    }));
  } catch (error) {
    console.warn("Open Trivia DB source fetch failed:", error.message || error);
    return [];
  }
}

async function fetchWikipediaSeeds({ cleanTheme, preferredCategories, safeCount }) {
  const query = buildWikipediaQuery(cleanTheme, preferredCategories);
  if (!query) return [];
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${Math.min(8, Math.max(4, safeCount * 2))}&srsearch=${encodeURIComponent(query)}`;
    const searchResponse = await fetchWithTimeout(searchUrl, {}, 3500);
    if (!searchResponse.ok) return [];
    const searchData = await searchResponse.json();
    const titles = (searchData?.query?.search || []).map((item) => cleanText(item.title)).filter(Boolean).slice(0, 6);
    const summaries = await Promise.all(titles.map(async (title) => {
      try {
        const summaryResponse = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {}, 3500);
        if (!summaryResponse.ok) return null;
        return summaryResponse.json();
      } catch {
        return null;
      }
    }));
    return summaries.filter(Boolean).map((item) => ({
      source_type: "external_source",
      source_label: "External Source",
      source_url: item.content_urls?.desktop?.page || item.content_urls?.mobile?.page || "",
      category: inferCategoryFromText([item.title, item.description, item.extract, ...preferredCategories].join(" ")),
      question_text: "",
      correct_answer: cleanText(item.title),
      fun_fact: cleanText(item.description),
      fact: cleanText(item.extract),
      confidence: 0.82,
      needsReview: false,
      originality_score: 0.75,
      similarity_score: 0.08,
    })).filter((seed) => seed.fact && seed.correct_answer);
  } catch (error) {
    console.warn("Wikipedia source fetch failed:", error.message || error);
    return [];
  }
}

function dedupeSourceSeeds(seeds) {
  const seen = new Set();
  return seeds.filter((seed) => {
    const key = `${answerFingerprint(seed.correct_answer)}::${fingerprint(seed.question_text || seed.fact)}`;
    if (!key.replace(/[:\s]/g, "") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokenizeSourceQuery(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word)).slice(0, 24);
}

function buildWikipediaQuery(cleanTheme, preferredCategories) {
  const terms = tokenizeSourceQuery(cleanTheme);
  if (terms.length) return terms.slice(0, 6).join(" ");
  if (preferredCategories.length) return preferredCategories.slice(0, 2).join(" ");
  return "";
}

function chooseOpenTriviaCategory(cleanTheme, preferredCategories) {
  const text = [cleanTheme, ...preferredCategories].join(" ").toLowerCase();
  const matches = [
    [/movie|film|cinema/, 11],
    [/music|song|band/, 12],
    [/television|tv/, 14],
    [/video game|gaming/, 15],
    [/board game|tabletop/, 16],
    [/science|nature/, 17],
    [/computer|technology|internet/, 18],
    [/math/, 19],
    [/sport/, 21],
    [/geography|map|country|city/, 22],
    [/history/, 23],
    [/art/, 25],
    [/celebrity|pop culture/, 26],
    [/animal/, 27],
    [/vehicle|car/, 28],
    [/comic/, 29],
    [/gadget|technology/, 30],
  ];
  return matches.find(([pattern]) => pattern.test(text))?.[1] || "";
}

function mapOpenTriviaCategory(category) {
  const text = cleanText(category);
  if (/film/i.test(text)) return "Movies";
  if (/music/i.test(text)) return "Music";
  if (/television/i.test(text)) return "Television";
  if (/video games/i.test(text)) return "Video Games";
  if (/science|nature/i.test(text)) return "Science";
  if (/computer|gadget/i.test(text)) return "Technology";
  if (/geography/i.test(text)) return "Geography";
  if (/history/i.test(text)) return "History";
  if (/sports/i.test(text)) return "Sports";
  if (/art/i.test(text)) return "Art";
  if (/animal/i.test(text)) return "Animals";
  if (/vehicle/i.test(text)) return "Cars";
  return text.replace(/^Entertainment:\s*/i, "").replace(/^Science:\s*/i, "") || "General";
}

function inferCategoryFromText(text) {
  const value = cleanText(text).toLowerCase();
  if (/film|movie|actor|director|cinema/.test(value)) return "Movies";
  if (/album|song|music|band|singer/.test(value)) return "Music";
  if (/television|series|episode/.test(value)) return "Television";
  if (/city|country|river|mountain|island|located/.test(value)) return "Geography";
  if (/war|century|king|queen|president|ancient|founded/.test(value)) return "History";
  if (/animal|species|bird|fish|mammal/.test(value)) return "Animals";
  if (/food|drink|dish|cuisine/.test(value)) return "Food & Drink";
  if (/sport|league|team|player/.test(value)) return "Sports";
  if (/science|chemical|planet|biology|physics/.test(value)) return "Science";
  return "General";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value) {
  return cleanText(value)
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchVenueHistory(venueId) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const base = supabaseUrl.replace(/\/$/, "");
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    const encodedVenueId = encodeURIComponent(venueId);

    const sessions = await fetchJsonWithFallback([
      `${base}/rest/v1/sessions?select=id,name,session_name,session_date,event_date,created_at&venue_id=eq.${encodedVenueId}&order=created_at.desc&limit=20`,
    ], headers);
    if (!Array.isArray(sessions) || !sessions.length) return null;

    const sessionIds = sessions.map((session) => session.id).filter(Boolean);
    const idFilter = `(${sessionIds.map((sessionId) => `"${sessionId}"`).join(",")})`;

    const [questionFeedback, categoryFeedback, ideas] = await Promise.all([
      fetchJsonWithFallback([`${base}/rest/v1/session_question_feedback?select=category,sentiment,question_text&session_id=in.${idFilter}&limit=1000`], headers),
      fetchJsonWithFallback([`${base}/rest/v1/session_category_feedback?select=category,sentiment&session_id=in.${idFilter}&limit=1000`], headers),
      fetchJsonWithFallback([`${base}/rest/v1/session_player_ideas?select=category,question&session_id=in.${idFilter}&order=created_at.desc&limit=40`], headers),
    ]);

    return {
      sessionCount: sessions.length,
      mostRecentDate: cleanText(sessions[0]?.session_date || sessions[0]?.event_date || sessions[0]?.created_at),
      pastThemes: sessions.map((session) => cleanText(session.name || session.session_name)).filter(Boolean).slice(0, 10),
      questionFeedback: Array.isArray(questionFeedback) ? questionFeedback : [],
      categoryFeedback: Array.isArray(categoryFeedback) ? categoryFeedback : [],
      ideas: Array.isArray(ideas) ? ideas : [],
    };
  } catch (error) {
    console.error("Venue history fetch failed:", error);
    return null;
  }
}

function buildVenueProfileText(history) {
  if (!history || !history.sessionCount) return "";

  const categoryScores = new Map();
  const bump = (category, sentiment) => {
    const key = cleanText(category);
    if (!key) return;
    const entry = categoryScores.get(key) || { likes: 0, dislikes: 0 };
    if (sentiment === "like") entry.likes += 1;
    else if (sentiment === "dislike") entry.dislikes += 1;
    categoryScores.set(key, entry);
  };
  history.categoryFeedback.forEach((item) => bump(item.category, item.sentiment));
  history.questionFeedback.forEach((item) => bump(item.category, item.sentiment));

  const ranked = [...categoryScores.entries()]
    .map(([category, { likes, dislikes }]) => ({ category, net: likes - dislikes }))
    .sort((a, b) => b.net - a.net);
  const loved = ranked.filter((row) => row.net > 0).slice(0, 8).map((row) => row.category);
  const struggled = ranked.filter((row) => row.net < 0).slice(-8).map((row) => row.category).reverse();

  const likedQuestions = history.questionFeedback.filter((item) => item.sentiment === "like" && item.question_text).slice(0, 4).map((item) => `- ${item.question_text}`);
  const dislikedQuestions = history.questionFeedback.filter((item) => item.sentiment === "dislike" && item.question_text).slice(0, 4).map((item) => `- ${item.question_text}`);
  const ideaLines = history.ideas.filter((idea) => idea.category || idea.question).slice(0, 6).map((idea) => `- ${[idea.category, idea.question].filter(Boolean).join(": ")}`);

  return [
    "Venue history for this location:",
    `- Played here ${history.sessionCount} time${history.sessionCount === 1 ? "" : "s"} before${history.mostRecentDate ? `, most recently ${history.mostRecentDate}` : ""}.`,
    history.pastThemes.length ? `- Past session names here: ${history.pastThemes.join(", ")}` : "",
    loved.length ? `- Categories that have landed well here (live audience thumbs-up outweighing thumbs-down): ${loved.join(", ")}` : "",
    struggled.length ? `- Categories that have struggled here (live audience thumbs-down outweighing thumbs-up): ${struggled.join(", ")}` : "",
    likedQuestions.length ? `Specific questions this crowd liked here:\n${likedQuestions.join("\n")}` : "",
    dislikedQuestions.length ? `Specific questions this crowd disliked here, avoid this style/topic again:\n${dislikedQuestions.join("\n")}` : "",
    ideaLines.length ? `Player-submitted category/question ideas from past nights here:\n${ideaLines.join("\n")}` : "",
    "Lean toward what has worked at this venue before. Avoid repeating categories or angles that have struggled here unless given a genuinely fresh angle.",
  ].filter(Boolean).join("\n");
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
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,is_liked,is_disliked,liked,disliked,rating,status,memory_status,is_reusable,reusable,is_used,used,used_at,times_used&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,is_liked,is_disliked,liked,disliked,rating,status,is_used,used,used_at,times_used&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,rating&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact&order=created_at.desc&limit=${libraryLimit}`,
    ], headers),
    fetchJsonWithFallback([
      `${base}/rest/v1/sessions?select=*&order=created_at.desc&limit=${sessionLimit}`,
      `${base}/rest/v1/sessions?select=true_false_questions,multiple_choice_questions,written_questions,picture_questions&order=created_at.desc&limit=${sessionLimit}`,
    ], headers),
  ]);
  const sessionQuestions = Array.isArray(sessions) ? sessions.flatMap((session, index) => extractSessionQuestions(session, index)) : [];

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
      status: cleanText(q.status),
      memory_status: cleanText(q.memory_status),
      is_reusable: q.is_reusable === true,
      reusable: q.reusable === true,
      is_used: q.is_used === true,
      used: q.used === true,
      used_at: q.used_at || "",
      times_used: Number(q.times_used || 0),
      source: q.source || "library",
      session_key: q.session_key || "",
      session_id: q.session_id || "",
      session_index: q.session_index ?? "",
      session_meta: q.session_meta || null,
      source_slot: q.source_slot || "",
      round: cleanText(q.round || q.round_name),
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

function extractSessionQuestions(session, sessionIndex = 0) {
  const sessionId = cleanText(session?.id) || `session-${sessionIndex}`;
  const sessionMeta = {
    id: sessionId,
    name: cleanText(session?.name || session?.session_name || session?.title),
    venue: cleanText(session?.venue_name || session?.venue || session?.venueName),
    date: cleanText(session?.session_date || session?.event_date || session?.hosted_at || session?.date || session?.created_at),
  };
  const slots = [
    ["true_false", session?.true_false_questions],
    ["multiple_choice", session?.multiple_choice_questions],
    ["written", session?.written_questions],
    ["picture", session?.picture_questions],
  ];
  return slots.flatMap(([slot, value]) => (Array.isArray(value) ? value.map((question, index) => ({
    ...question,
    question_type: question?.question_type || (slot === "picture" ? "written" : slot),
    source_slot: slot,
    source_position: index,
    session_key: sessionId || `session-${sessionIndex}`,
    session_id: sessionId,
    session_index: sessionIndex,
    session_meta: sessionMeta,
  })) : []));
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which", "who", "whom", "whose", "why", "with"]);
