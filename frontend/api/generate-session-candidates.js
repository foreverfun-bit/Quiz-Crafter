const QUESTION_TYPES = {
  true_false: {
    label: "True/False",
    outputType: "true_false",
    hasImage: false,
    incorrectCount: 0,
    answerRule: 'correct_answer must be exactly "True" or "False".',
    roundGuidance: "This belongs in Round 1: a fast true/false round. Use claims that are surprising, fair, and cleanly verifiable.",
  },
  multiple_choice: {
    label: "Multiple Choice",
    outputType: "multiple_choice",
    hasImage: false,
    incorrectCount: 3,
    answerRule: "incorrect_answers must contain exactly 3 plausible wrong answers and must not include correct_answer.",
    roundGuidance: "This belongs in Round 2: multiple choice. Wrong answers should be comparable, not silly giveaways.",
  },
  written: {
    label: "Written Answer",
    outputType: "written",
    hasImage: false,
    incorrectCount: 0,
    answerRule: "correct_answer should be concise, specific, and easy for a host to verify.",
    roundGuidance: "This belongs in Round 3: written answer. The answer should be gettable without options and not depend on exact spelling unless famous.",
  },
  picture: {
    label: "Picture-Based Bonus",
    outputType: "written",
    hasImage: true,
    incorrectCount: 0,
    answerRule: "question_text should describe a practical picture bonus prompt, correct_answer should be short, and image_url must be empty.",
    roundGuidance: "This is a picture-based bonus prompt. The host will add or choose the image later, so describe what kind of image to use in the question text.",
  },
};

const DIFFICULTY_PROFILES = {
  easy: {
    label: "Easy",
    guidance: "Accessible for casual players. Avoid trick wording. The average trivia team should have a fair shot.",
  },
  medium: {
    label: "Medium",
    guidance: "Balanced pub-trivia difficulty. Not obvious, but answerable by a good mixed team.",
  },
  hard: {
    label: "Hard",
    guidance: "Challenging but fair. Prefer second-layer knowledge over household-name facts.",
  },
  host_hard: {
    label: "Host Hard",
    guidance:
      "Obscure but fair for a host who has used many questions since 2019. Avoid overused pub trivia, obvious capitals, first-president-style facts, basic Oscar trivia, and stale quiz-bank phrasing. Use interesting angles that feel satisfying when revealed.",
  },
};

const BROAD_CATEGORIES = [
  "Art",
  "Books",
  "Food & Drink",
  "Geography",
  "History",
  "Internet Culture",
  "Local Flavor",
  "Movies",
  "Music",
  "Nature",
  "Pop Culture",
  "Science",
  "Sports",
  "Television",
  "Theater",
  "Video Games",
  "Weird Science",
  "World Culture",
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      sessionId,
      questionType,
      count,
      difficulty = "medium",
      theme,
      excludeUsed = true,
      avoidDuplicates = true,
      excludeCategories = [],
    } = req.body || {};

    if (!sessionId || !questionType) {
      return res.status(400).json({ error: "Missing sessionId or questionType" });
    }

    const config = QUESTION_TYPES[questionType];
    if (!config) {
      return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });
    }

    const safeCount = clampCount(count);
    const difficultyKey = normalizeDifficulty(difficulty);
    const difficultyProfile = DIFFICULTY_PROFILES[difficultyKey];
    const cleanTheme = typeof theme === "string" ? theme.trim() : "";
    const cleanExcludeCategories = normalizeStringArray(excludeCategories);
    const existingQuestions = avoidDuplicates || excludeUsed ? await fetchExistingQuestions() : [];
    const existingFingerprints = new Set(existingQuestions.map((q) => fingerprint(q.question_text)));
    const existingAnswerPairs = new Set(existingQuestions.map((q) => answerPairFingerprint(q.question_text, q.correct_answer)));

    const prompt = buildPrompt({
      config,
      questionType,
      safeCount,
      difficultyKey,
      difficultyProfile,
      cleanTheme,
      cleanExcludeCategories,
      existingQuestions,
      excludeUsed,
      avoidDuplicates,
    });

    const parsed = await requestCandidates(prompt);
    const validation = normalizeCandidates({
      candidates: parsed.candidates,
      config,
      questionType,
      difficultyKey,
      cleanExcludeCategories,
      existingFingerprints,
      existingAnswerPairs,
      avoidDuplicates,
    });

    return res.status(200).json({
      candidates: validation.candidates.slice(0, safeCount),
      rejected: validation.rejected,
      requested: safeCount,
    });
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

function buildPrompt({
  config,
  safeCount,
  difficultyKey,
  difficultyProfile,
  cleanTheme,
  cleanExcludeCategories,
  existingQuestions,
  excludeUsed,
  avoidDuplicates,
}) {
  const overGenerateCount = Math.min(20, Math.max(safeCount + 4, Math.ceil(safeCount * 1.7)));
  const excludedCategoryText = cleanExcludeCategories.length ? `Do not use these categories: ${cleanExcludeCategories.join(", ")}.` : "";
  const themeText = cleanTheme ? `Theme/vibe/category guidance: ${cleanTheme}. Stay useful to that direction, but avoid repetitive question angles.` : "";
  const duplicateExamples = existingQuestions
    .slice(0, 80)
    .map((q) => `- ${q.question_text}${q.correct_answer ? ` Answer: ${q.correct_answer}` : ""}`)
    .join("\n");
  const duplicateText = avoidDuplicates && duplicateExamples ? `Avoid duplicating, lightly rewording, or using the same answer-angle as these existing questions:\n${duplicateExamples}` : "";
  const usedText = excludeUsed ? "Prefer questions that feel new for a host who has been running weekly trivia since 2019." : "";

  return `
Generate exactly ${overGenerateCount} ${config.label} trivia question candidates so the app can keep the best ${safeCount}.

Host context:
- The host runs live trivia and wants an assistant, not a generic question bank.
- Default format is 3 rounds: 9 true/false, 9 multiple choice, 9 written answer, each round with 1 picture-based bonus.
- The host sometimes runs theme rounds and wants flexibility.
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
      "has_image": ${config.hasImage},
      "image_url": ""
    }
  ]
}

Trivia host style:
- ${config.roundGuidance}
- Difficulty: ${difficultyProfile.label}. ${difficultyProfile.guidance}
- Prefer obscure-but-fair, gettable, satisfying facts over generic quiz-bank material.
- Avoid questions that are just "What is the capital of...", "Who was the first president...", basic Oscar winners, obvious Disney facts, or overused bar trivia.
- Use varied broad categories such as: ${BROAD_CATEGORIES.join(", ")}.
- Avoid repeated categories within this batch when possible.
- Write concise, host-friendly question text that sounds natural when read aloud.
- Avoid ambiguous answers, disputed facts, and answer wording that would cause scoring arguments.
- fun_fact must be one short sentence that adds color without spoiling another question.
- ${config.answerRule}
- question_type must be "${config.outputType}".
- has_image must be ${config.hasImage}.
- image_url must be "".
- difficulty must be "${difficultyKey}".
${themeText}
${excludedCategoryText}
${usedText}
${duplicateText}
`.trim();
}

async function requestCandidates(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in Vercel");
  }

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.62,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a careful, inventive trivia co-host for a weekly live trivia host. Return only valid JSON.",
        },
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
  if (!content) {
    console.error("Missing completion content:", data);
    throw new Error("No AI response received");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    console.error("Failed to parse model JSON:", content);
    throw new Error("AI returned invalid JSON");
  }
}

function normalizeCandidates({ candidates, config, questionType, difficultyKey, cleanExcludeCategories, existingFingerprints, existingAnswerPairs, avoidDuplicates }) {
  const rejected = [];
  const accepted = [];
  const batchFingerprints = new Set();
  const batchAnswerPairs = new Set();
  const excludedCategories = new Set(cleanExcludeCategories.map((category) => category.toLowerCase()));

  if (!Array.isArray(candidates)) throw new Error("No candidates returned");

  candidates.forEach((candidate, index) => {
    const normalized = normalizeCandidate(candidate, config, questionType, difficultyKey);
    if (!normalized.ok) {
      rejected.push({ index, reason: normalized.reason });
      return;
    }

    const item = normalized.candidate;
    const itemFingerprint = fingerprint(item.question_text);
    const itemAnswerPair = answerPairFingerprint(item.question_text, item.correct_answer);
    const categoryKey = item.category.toLowerCase();

    if (excludedCategories.has(categoryKey)) {
      rejected.push({ index, reason: "excluded_category" });
      return;
    }

    if (avoidDuplicates) {
      if (existingFingerprints.has(itemFingerprint) || batchFingerprints.has(itemFingerprint)) {
        rejected.push({ index, reason: "duplicate_question" });
        return;
      }
      if (existingAnswerPairs.has(itemAnswerPair) || batchAnswerPairs.has(itemAnswerPair)) {
        rejected.push({ index, reason: "duplicate_answer_angle" });
        return;
      }
    }

    batchFingerprints.add(itemFingerprint);
    batchAnswerPairs.add(itemAnswerPair);
    accepted.push(item);
  });

  return { candidates: accepted, rejected };
}

function normalizeCandidate(candidate, config, questionType, difficultyKey) {
  if (!candidate || typeof candidate !== "object") return { ok: false, reason: "candidate_not_object" };

  const category = cleanText(candidate.category);
  const questionText = cleanText(candidate.question_text);
  const correctAnswer = cleanText(candidate.correct_answer);
  const funFact = cleanText(candidate.fun_fact);
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
      has_image: config.hasImage,
      image_url: "",
    },
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function fingerprint(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ").filter((word) => word && !STOP_WORDS.has(word)).sort().join(" ");
}

function answerPairFingerprint(questionText, answer) {
  return `${fingerprint(questionText)}::${cleanText(answer).toLowerCase()}`;
}

async function fetchExistingQuestions() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase env vars missing; duplicate filtering will only check generated batch");
    return [];
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/questions?select=question_text,correct_answer,category,question_type&limit=1000`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("Supabase duplicate lookup failed:", text);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("Supabase duplicate lookup crashed:", error);
    return [];
  }
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "with",
]);
