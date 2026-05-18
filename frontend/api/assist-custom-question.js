const QUESTION_TYPES = ["true_false", "multiple_choice", "written"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const questionText = String(req.body?.question_text || "").trim();
    const existingCategory = String(req.body?.category || "").trim();

    if (!questionText) {
      return res.status(400).json({ error: "Question text is required" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json(buildHeuristicSuggestion(questionText, existingCategory));
    }

    const prompt = buildPrompt(questionText, existingCategory);
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You help a trivia host turn rough custom questions into clean library-ready trivia records. Return strict JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      throw new Error(text || "OpenAI request failed");
    }

    const json = await openaiRes.json();
    const content = json.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return res.status(200).json(normalizeSuggestion(parsed, questionText, existingCategory));
  } catch (error) {
    console.error("assist-custom-question error:", error);
    return res.status(500).json({ error: error?.message || "Failed to assist question" });
  }
}

function buildPrompt(questionText, existingCategory) {
  return `
Analyze this rough trivia question and suggest the best structure for saving it.

Question:
${questionText}

${existingCategory ? `Preferred category if it fits: ${existingCategory}` : ""}

Return this exact JSON shape:
{
  "question_type": "true_false | multiple_choice | written",
  "category": "Broad useful trivia category",
  "clean_question_text": "Host-ready version of the question",
  "correct_answer": "Concise correct answer",
  "incorrect_answers": ["Wrong choice 1", "Wrong choice 2", "Wrong choice 3"],
  "fun_fact": "One short sentence of context",
  "confidence": 0.0,
  "notes": "Short note explaining why this type/category fits"
}

Rules:
- Pick true_false only if the question naturally works as a true/false statement.
- Pick multiple_choice when believable wrong answers would help players and the correct answer is one of several comparable options.
- Pick written when the answer is short and fair without choices.
- For multiple_choice, include exactly 3 incorrect_answers and do not include the correct answer in that array.
- For true_false, correct_answer must be exactly "True" or "False" and incorrect_answers must be [].
- For written, incorrect_answers must be [].
- Category should be broad enough to balance a trivia session, like History, Movies, Music, Science, Geography, Sports, Food & Drink, Books, Television, Nature, Pop Culture, Art, or World Culture.
- Keep wording concise, fair, and host-friendly.
`.trim();
}

function normalizeSuggestion(value, originalQuestion, existingCategory) {
  const type = QUESTION_TYPES.includes(value.question_type) ? value.question_type : inferType(originalQuestion);
  const cleanQuestion = String(value.clean_question_text || originalQuestion).trim();
  const correctAnswer = normalizeAnswer(value.correct_answer, type);

  return {
    question_type: type,
    category: String(value.category || existingCategory || "General").trim(),
    clean_question_text: cleanQuestion,
    correct_answer: correctAnswer,
    incorrect_answers: type === "multiple_choice" ? normalizeIncorrectAnswers(value.incorrect_answers, correctAnswer) : [],
    fun_fact: String(value.fun_fact || "").trim(),
    confidence: clampConfidence(value.confidence),
    notes: String(value.notes || "Review the suggestion, then adjust anything before saving.").trim(),
  };
}

function buildHeuristicSuggestion(questionText, existingCategory) {
  const type = inferType(questionText);
  return normalizeSuggestion(
    {
      question_type: type,
      category: existingCategory || inferCategory(questionText),
      clean_question_text: questionText,
      correct_answer: type === "true_false" ? "True" : "",
      incorrect_answers: [],
      fun_fact: "",
      confidence: 0.35,
      notes: "AI assistance is not configured, so this is a simple starter suggestion.",
    },
    questionText,
    existingCategory
  );
}

function inferType(questionText) {
  const lower = questionText.toLowerCase();
  if (lower.startsWith("true or false") || lower.startsWith("true/false") || lower.includes(" true or false")) {
    return "true_false";
  }
  if (lower.startsWith("which ") || lower.startsWith("what ") || lower.startsWith("who ") || lower.startsWith("where ")) {
    return "written";
  }
  return "written";
}

function inferCategory(questionText) {
  const lower = questionText.toLowerCase();
  if (/movie|film|actor|actress|oscar/.test(lower)) return "Movies";
  if (/song|album|band|singer|music/.test(lower)) return "Music";
  if (/country|city|capital|river|mountain/.test(lower)) return "Geography";
  if (/war|president|king|queen|century|ancient/.test(lower)) return "History";
  if (/planet|animal|chemical|science|space/.test(lower)) return "Science";
  if (/team|sport|nba|nfl|mlb|soccer/.test(lower)) return "Sports";
  return "General";
}

function normalizeAnswer(answer, type) {
  const text = String(answer || "").trim();
  if (type !== "true_false") return text;
  return text.toLowerCase() === "false" ? "False" : "True";
}

function normalizeIncorrectAnswers(values, correctAnswer) {
  if (!Array.isArray(values)) return [];
  const correctKey = correctAnswer.toLowerCase();
  const seen = new Set();
  return values
    .map((value) => String(value).trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || key === correctKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}
