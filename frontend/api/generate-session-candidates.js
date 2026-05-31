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
    guidance: "Fresh and host-worthy, but not punishing. Avoid overused pub trivia and basic quiz-bank facts, but keep the question answerable by a strong mixed trivia team or reasonably guessable from the wording. Aim for satisfying 40-60% solve-rate questions, not stumpers that depend on tiny-name recall.",
  },
};

const BROAD_CATEGORIES = ["Art", "Books", "Food & Drink", "Geography", "History", "Internet Culture", "Local Flavor", "Movies", "Music", "Nature", "Pop Culture", "Science", "Sports", "Television", "Theater", "Video Games", "Weird Science", "World Culture"];
const EXISTING_QUESTIONS_CACHE_MS = 5 * 60 * 1000;
const STYLE_EXAMPLE_LIMIT = 12;
const DUPLICATE_EXAMPLE_LIMIT = 55;
let existingQuestionsCache = { expiresAt: 0, data: null, pending: null };

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
    } = req.body || {};

    if (!sessionId || !questionType) return res.status(400).json({ error: "Missing sessionId or questionType" });

    const normalizedQuestionType = questionType === "picture" ? "written" : questionType;
    const config = QUESTION_TYPES[normalizedQuestionType];
    if (!config) return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });

    const safeCount = clampCount(count);
    const difficultyKey = normalizeDifficulty(difficulty);
    const difficultyProfile = DIFFICULTY_PROFILES[difficultyKey];
    const cleanTheme = typeof theme === "string" ? theme.trim() : "";
    const cleanLockedCategories = dedupeStrings(normalizeStringArray(lockedCategories));
    const cleanApprovedCategories = dedupeStrings([...normalizeStringArray(approvedCategories), ...cleanLockedCategories]);
    const cleanRejectedCategories = dedupeStrings(normalizeStringArray(rejectedCategories).filter((category) => !containsCategory(cleanLockedCategories, category)));
    const cleanExcludeCategories = dedupeStrings([...normalizeStringArray(excludeCategories), ...cleanRejectedCategories].filter((category) => !containsCategory(cleanLockedCategories, category)));
    const cleanRejectedQuestions = dedupeStrings([...normalizeStringArray(rejectedQuestions), ...normalizeStringArray(currentBatchQuestions)]);
    const existingQuestions = avoidDuplicates || excludeUsed ? await fetchExistingQuestions() : [];
    const styleExamples = buildStyleExamples(existingQuestions, normalizedQuestionType, cleanApprovedCategories);
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
      cleanRejectedQuestions,
      existingQuestions,
      styleExamples,
      excludeUsed,
      avoidDuplicates,
      includeImagePrompt,
    });
    const parsed = await requestCandidates(prompt);
    const validationInput = {
      candidates: parsed.candidates,
      config,
      questionType: normalizedQuestionType,
      difficultyKey,
      cleanExcludeCategories,
      cleanApprovedCategories,
      cleanLockedCategories,
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

function containsCategory(categories, category) {
  return categories.some((item) => categoryKey(item) === categoryKey(category));
}

function categoryKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildPrompt({ config, safeCount, difficultyKey, difficultyProfile, cleanTheme, cleanExcludeCategories, cleanApprovedCategories, cleanLockedCategories, cleanRejectedQuestions = [], existingQuestions, styleExamples, excludeUsed, avoidDuplicates, includeImagePrompt }) {
  const overGenerateCount = Math.min(18, Math.max(safeCount + 4, Math.ceil(safeCount * 1.7)));
  const lockedCategoryText = cleanLockedCategories.length ? `Locked categories are active. The category field must exactly match one of these locked categories: ${cleanLockedCategories.join(", ")}. Generate all candidates inside these locked categories until the host unlocks them.` : "";
  const approvedCategoryText = cleanLockedCategories.length
    ? lockedCategoryText
    : cleanApprovedCategories.length
      ? `Use these pre-approved categories first. The category field should exactly match one of these names unless the user typed a specific category in the current request: ${cleanApprovedCategories.join(", ")}.`
      : `Use varied broad categories such as: ${BROAD_CATEGORIES.join(", ")}.`;
  const excludedCategoryText = cleanExcludeCategories.length ? `Do not use these rejected or avoided categories: ${cleanExcludeCategories.join(", ")}.` : "";
  const themeText = cleanTheme ? `Theme/vibe/category guidance: ${cleanTheme}. Stay useful to that direction, but avoid repetitive question angles.` : "";
  const styleText = styleExamples.length ? `Use these saved library questions as calibration for the host's style and difficulty. Match the readability, category feel, and answerability. Do not copy, lightly rewrite, reuse their answers, or generate the same topic angles:\n${styleExamples.map(formatStyleExample).join("\n")}` : "";
  const duplicateExamples = existingQuestions.slice(0, DUPLICATE_EXAMPLE_LIMIT).map((q) => `- ${q.question_text}${q.correct_answer ? ` Answer: ${q.correct_answer}` : ""}`).join("\n");
  const duplicateText = avoidDuplicates && duplicateExamples ? `Avoid duplicating, lightly rewording, using the same answer, or using the same answer-angle as these existing and past-session questions:\n${duplicateExamples}` : "";
  const rejectedText = cleanRejectedQuestions.length ? `The host explicitly rejected these generated questions. Do not return them, close rewrites, same-answer variations, or same topic-angle cousins:\n${cleanRejectedQuestions.map((question) => `- ${question}`).join("\n")}` : "";
  const usedText = excludeUsed ? "Assume the host has already used years of common trivia. Do not use standard listicle facts or classroom facts unless the angle is unusually fresh." : "";
  const hostHardText = difficultyKey === "host_hard" ? "Host Hard calibration: make these feel like the host's stronger library questions, not encyclopedia deep cuts. Prefer recognizable subjects with a fresh angle over obscure subjects with no clue path." : "";
  const noveltySeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const imagePromptField = includeImagePrompt ? ',\n      "image_prompt": "A concise visual clue idea that does not reveal the answer"' : ',\n      "image_prompt": ""';
  const imagePromptRule = includeImagePrompt
    ? "- image_prompt must describe a useful generated or uploaded visual clue for this question. It must not reveal the answer, include readable text, or require logos/copyrighted screenshots."
    : "- image_prompt must be empty.";

  return `
Generate exactly ${overGenerateCount} ${config.label} trivia question candidates so the app can keep the best ${safeCount}.

Novelty seed: ${noveltySeed}
Use the novelty seed to deliberately choose less-common subject matter and avoid repeating your usual examples.

Host context:
- The host runs live trivia and wants an assistant, not a generic question bank.
- The host builds flexible rounds with true/false, multiple choice, and written answer questions.
- Pictures are not a question type. Any question can have media attached later.
- The biggest need is fresh categories, fun angles, and non-generic questions.
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

Freshness rules:
- Do not produce classic bar-trivia staples or their reworded cousins.
- Avoid these angles entirely: capitals, first presidents, tallest/highest/largest/longest records, basic planets, basic elements, basic Shakespeare, Mona Lisa, Harry Potter author, obvious Oscar winners, obvious Disney facts, and common holiday myths.
- Prefer second-order facts: unusual origins, production details, regional names, near-misses, odd rules, forgotten firsts, surprising constraints, etymology, hidden design choices, or real-world quirks.
- Ask yourself: "Would this feel fresh to someone who has hosted weekly trivia for years?" If not, replace it.

Trivia host style:
- ${config.roundGuidance}
- Difficulty: ${difficultyProfile.label}. ${difficultyProfile.guidance}
- Prefer obscure-but-fair, gettable, satisfying facts over generic quiz-bank material.
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
  const libraryQuestions = existingQuestions.filter((q) => q.source === "library");
  const matchingType = libraryQuestions.filter((q) => q.question_type === questionType);
  const matchingApproved = matchingType.filter((q) => !approvedSet.size || approvedSet.has(categoryKey(q.category)));
  const candidates = matchingApproved.length >= 8 ? matchingApproved : matchingType.length >= 8 ? matchingType : libraryQuestions;
  return sampleStable(candidates.filter((q) => q.question_text && q.correct_answer), STYLE_EXAMPLE_LIMIT);
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
  if (question.source === "library") score += 8;
  if (question.category) score += 2;
  if (question.fun_fact) score += 2;
  const length = cleanText(question.question_text).length;
  if (length >= 45 && length <= 180) score += 3;
  if (question.question_type === "multiple_choice" || question.question_type === "true_false" || question.question_type === "written") score += 1;
  return score;
}

function formatStyleExample(q) {
  const parts = [`- [${q.category || "Uncategorized"} / ${q.question_type || "written"}] ${q.question_text}`, `Answer: ${q.correct_answer}`];
  if (q.fun_fact) parts.push(`Fun fact style: ${q.fun_fact}`);
  return parts.join(" ");
}

async function requestCandidates(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Vercel");

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_GENERATOR_MODEL || "gpt-4.1",
      temperature: 0.82,
      presence_penalty: 0.35,
      frequency_penalty: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a careful, inventive trivia co-host for a weekly live trivia host. You learn from the host's saved library style, avoid common quiz-bank questions, and return only valid JSON." },
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

function normalizeCandidates({ candidates, config, questionType, difficultyKey, cleanExcludeCategories, cleanApprovedCategories, cleanLockedCategories, existingFingerprints, existingAnswerPairs, existingAnswers, rejectedQuestionFingerprints, rejectedAnswerFingerprints, avoidDuplicates, includeImagePrompt }) {
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
    if (approvedCategorySet.size > 0 && !approvedCategorySet.has(itemCategoryKey)) {
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

async function fetchExistingQuestions() {
  const now = Date.now();
  if (existingQuestionsCache.data && existingQuestionsCache.expiresAt > now) return existingQuestionsCache.data;
  if (existingQuestionsCache.pending) return existingQuestionsCache.pending;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  existingQuestionsCache.pending = fetchExistingQuestionsUncached(supabaseUrl, supabaseKey)
    .then((data) => {
      existingQuestionsCache = { data, expiresAt: Date.now() + EXISTING_QUESTIONS_CACHE_MS, pending: null };
      return data;
    })
    .catch((error) => {
      existingQuestionsCache.pending = null;
      console.error("Existing question fetch failed:", error);
      return existingQuestionsCache.data || [];
    });

  return existingQuestionsCache.pending;
}

async function fetchExistingQuestionsUncached(supabaseUrl, supabaseKey) {
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const [questionsResponse, sessionsResponse] = await Promise.all([
    fetch(`${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact&order=created_at.desc&limit=1500`, { headers }),
    fetch(`${base}/rest/v1/sessions?select=true_false_questions,multiple_choice_questions,written_questions,picture_questions&order=created_at.desc&limit=500`, { headers }),
  ]);

  const libraryQuestions = questionsResponse.ok ? await questionsResponse.json() : [];
  const sessions = sessionsResponse.ok ? await sessionsResponse.json() : [];
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
      source: q.source || "library",
    }))
    .filter((q) => q.question_text);
}

function normalizeFetchedType(value) {
  return value === "true_false" || value === "multiple_choice" || value === "written" ? value : "written";
}

function extractSessionQuestions(session) {
  return [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions]
    .flatMap((value) => (Array.isArray(value) ? value : []));
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which", "who", "whom", "whose", "why", "with"]);
