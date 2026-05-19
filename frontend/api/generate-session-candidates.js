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
    guidance: "Obscure but fair for a host who has used many questions since 2019. Avoid overused pub trivia, obvious capitals, first-president-style facts, basic Oscar trivia, stale quiz-bank phrasing, and facts that appear on every trivia list. Use interesting angles that feel satisfying when revealed.",
  },
};

const BROAD_CATEGORIES = ["Art", "Books", "Food & Drink", "Geography", "History", "Internet Culture", "Local Flavor", "Movies", "Music", "Nature", "Pop Culture", "Science", "Sports", "Television", "Theater", "Video Games", "Weird Science", "World Culture"];

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
    const cleanApprovedCategories = dedupeStrings(normalizeStringArray(approvedCategories));
    const cleanRejectedCategories = dedupeStrings(normalizeStringArray(rejectedCategories));
    const cleanExcludeCategories = dedupeStrings([...normalizeStringArray(excludeCategories), ...cleanRejectedCategories]);
    const cleanRejectedQuestions = dedupeStrings([...normalizeStringArray(rejectedQuestions), ...normalizeStringArray(currentBatchQuestions)]);
    const existingQuestions = avoidDuplicates || excludeUsed ? await fetchExistingQuestions() : [];
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
      existingQuestions,
      excludeUsed,
      avoidDuplicates,
      includeImagePrompt,
    });
    const parsed = await requestCandidates(prompt);
    const validation = normalizeCandidates({
      candidates: parsed.candidates,
      config,
      questionType: normalizedQuestionType,
      difficultyKey,
      cleanExcludeCategories,
      cleanApprovedCategories,
      existingFingerprints,
      existingAnswerPairs,
      existingAnswers,
      rejectedQuestionFingerprints,
      rejectedAnswerFingerprints,
      avoidDuplicates,
      includeImagePrompt,
    });

    return res.status(200).json({ candidates: validation.candidates.slice(0, safeCount), rejected: validation.rejected, requested: safeCount });
  } catch (error) {
    console.error("generate-session-candidates error:", error);
    return res.status(500).json({ error: error?.message || "Failed to generate candidates" });
  }
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

function buildPrompt({ config, safeCount, difficultyKey, difficultyProfile, cleanTheme, cleanExcludeCategories, cleanApprovedCategories, existingQuestions, excludeUsed, avoidDuplicates, includeImagePrompt }) {
  const overGenerateCount = Math.min(30, Math.max(safeCount + 8, Math.ceil(safeCount * 2.5)));
  const approvedCategoryText = cleanApprovedCategories.length ? `Use only these pre-approved categories. The category field must exactly match one of these names: ${cleanApprovedCategories.join(", ")}.` : `Use varied broad categories such as: ${BROAD_CATEGORIES.join(", ")}.`;
  const excludedCategoryText = cleanExcludeCategories.length ? `Do not use these rejected or avoided categories: ${cleanExcludeCategories.join(", ")}.` : "";
  const themeText = cleanTheme ? `Theme/vibe/category guidance: ${cleanTheme}. Stay useful to that direction, but avoid repetitive question angles.` : "";
  const duplicateExamples = existingQuestions.slice(0, 180).map((q) => `- ${q.question_text}${q.correct_answer ? ` Answer: ${q.correct_answer}` : ""}`).join("\n");
  const duplicateText = avoidDuplicates && duplicateExamples ? `Avoid duplicating, lightly rewording, using the same answer, or using the same answer-angle as these existing and past-session questions:\n${duplicateExamples}` : "";
  const usedText = excludeUsed ? "Assume the host has already used years of common trivia. Do not use standard listicle facts or classroom facts unless the angle is unusually fresh." : "";
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
- Avoid repeated categories within this batch when possible.
- Avoid repeating a correct answer anywhere in the batch.
- Write concise, host-friendly question text that sounds natural when read aloud.
- Avoid ambiguous answers, disputed facts, and answer wording that would cause scoring arguments.
- fun_fact must be one short sentence that adds color without spoiling another question.
- ${config.answerRule}
- question_type must be "${config.outputType}".
- image_url must be "".
- difficulty must be "${difficultyKey}".
${imagePromptRule}
${themeText}
${excludedCategoryText}
${usedText}
${duplicateText}
`.trim();
}

async function requestCandidates(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Vercel");

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_GENERATOR_MODEL || "gpt-4.1",
      temperature: 0.9,
      presence_penalty: 0.45,
      frequency_penalty: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a careful, inventive trivia co-host for a weekly live trivia host. You avoid common quiz-bank questions and return only valid JSON." },
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

function normalizeCandidates({ candidates, config, questionType, difficultyKey, cleanExcludeCategories, cleanApprovedCategories, existingFingerprints, existingAnswerPairs, existingAnswers, rejectedQuestionFingerprints, rejectedAnswerFingerprints, avoidDuplicates, includeImagePrompt }) {
  const rejected = [];
  const accepted = [];
  const batchFingerprints = new Set();
  const batchAnswerPairs = new Set();
  const batchAnswers = new Set();
  const excludedCategories = new Set(cleanExcludeCategories.map((category) => category.toLowerCase()));
  const approvedCategorySet = new Set(cleanApprovedCategories.map((category) => category.toLowerCase()));

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
    const categoryKey = item.category.toLowerCase();

    if (isGenericQuestion(item.question_text)) {
      rejected.push({ index, question: item.question_text, reason: "generic_overused_trivia_pattern" });
      return;
    }
    if (approvedCategorySet.size > 0 && !approvedCategorySet.has(categoryKey)) {
      rejected.push({ index, question: item.question_text, reason: "not_approved_category" });
      return;
    }
    if (excludedCategories.has(categoryKey)) {
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
  const correctAnswer = cleanText(candidate.correct_answer);
  const funFact = cleanText(candidate.fun_fact);
  const imagePrompt = includeImagePrompt ? cleanText(candidate.image_prompt) : "";
  const incorrectAnswers = Array.isArray(candidate.incorrect_answers) ? candidate.incorrect_answers.map(cleanText).filter(Boolean) : [];

  if (!category || !questionText || !correctAnswer) return { ok: false, reason: "missing_required_text" };
  if (config.incorrectCount === 0 && incorrectAnswers.length !== 0) return { ok: false, reason: "unexpected_incorrect_answers" };

  if (config.incorrectCount > 0) {
    const uniqueIncorrect = [...new Set(incorrectAnswers.map((answer) => answer.trim()))];
    const duplicatesCorrect = uniqueIncorrect.some((answer) => answer.toLowerCase() === correctAnswer.toLowerCase());
    if (uniqueIncorrect.length !== config.incorrectCount || duplicatesCorrect) return { ok: false, reason: "invalid_multiple_choice_answers" };
  }

  if (questionType === "true_false" && !["True", "False"].includes(correctAnswer)) return { ok: false, reason: "invalid_true_false_answer" };

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
  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const [questionsResponse, sessionsResponse] = await Promise.all([
      fetch(`${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type&limit=2000`, { headers }),
      fetch(`${base}/rest/v1/sessions?select=true_false_questions,multiple_choice_questions,written_questions,picture_questions&limit=1000`, { headers }),
    ]);

    const libraryQuestions = questionsResponse.ok ? await questionsResponse.json() : [];
    const sessions = sessionsResponse.ok ? await sessionsResponse.json() : [];
    const sessionQuestions = Array.isArray(sessions) ? sessions.flatMap(extractSessionQuestions) : [];

    return [...(Array.isArray(libraryQuestions) ? libraryQuestions : []), ...sessionQuestions]
      .map((q) => ({
        question_text: cleanText(q.question_text || q.question),
        correct_answer: cleanText(q.correct_answer || q.answer),
        category: cleanText(q.category),
        question_type: q.question_type || "written",
      }))
      .filter((q) => q.question_text);
  } catch (error) {
    console.error("Existing question fetch failed:", error);
    return [];
  }
}

function extractSessionQuestions(session) {
  return [session?.true_false_questions, session?.multiple_choice_questions, session?.written_questions, session?.picture_questions]
    .flatMap((value) => (Array.isArray(value) ? value : []));
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which", "who", "whom", "whose", "why", "with"]);
