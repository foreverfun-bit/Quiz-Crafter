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
        temperature: 0.12,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a careful trivia co-host for a live trivia host who has hosted since 2019. You edit rough question ideas into playable, fair trivia records. You do not invent facts. Return strict JSON only.",
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
You are helping a trivia host build an all-in-one trivia assistant, not a generic quiz site.

Host format context:
- Default show format is 3 rounds.
- Round 1: 9 true/false questions plus 1 picture-based bonus.
- Round 2: 9 multiple choice questions plus 1 picture-based bonus.
- Round 3: 9 written-answer questions plus 1 picture-based bonus.
- The host sometimes runs themed rounds and needs flexibility.
- The host struggles most with fresh categories, fun angles, and non-generic ideas.
- The host has used many common pub trivia questions since 2019, so avoid stale quiz-bank wording and overused bar trivia.

Your job for this request:
Turn the rough input into the cleanest save-ready question record you can, while being honest about uncertainty.

Rough input:
${questionText}

${existingCategory ? `Preferred category if it genuinely fits: ${existingCategory}` : ""}

Return this exact JSON shape:
{
  "question_type": "true_false | multiple_choice | written",
  "category": "Broad useful trivia category",
  "clean_question_text": "Host-ready version of the question",
  "correct_answer": "Concise correct answer",
  "incorrect_answers": ["Wrong choice 1", "Wrong choice 2", "Wrong choice 3"],
  "fun_fact": "One short sentence of context",
  "confidence": 0.0,
  "notes": "Short note explaining type/category and any review needed"
}

Fact-safety rules:
- Do not invent a factual answer that is not clearly present in the rough input or obvious from the wording.
- If the rough input does not include enough information to know the answer, leave correct_answer as an empty string, set confidence below 0.45, and say what needs verification in notes.
- If you are not sure a fact is correct, keep the question close to the user's wording, lower confidence, and mention verification in notes.
- Do not turn a rough idea into a different fact just to make the record complete.
- Fun facts must not introduce risky or unverified claims. Leave fun_fact empty if unsure.

Question-shaping rules:
- Pick true_false only when the input naturally works as a claim that can be judged true or false.
- Pick multiple_choice when choices make the question more playable and the answer belongs to a comparable set.
- Pick written when the answer is short, fair, and gettable without options.
- For multiple_choice, include exactly 3 plausible wrong answers only when you know the answer. Do not include the correct answer in incorrect_answers.
- For true_false, correct_answer must be exactly "True" or "False" when known, and incorrect_answers must be [].
- For written, incorrect_answers must be [].
- Category should help balance a live session. Prefer useful broad categories like History, Movies, Music, Science, Geography, Sports, Food & Drink, Books, Television, Nature, Pop Culture, Art, World Culture, Weird Science, Internet Culture, Local Flavor, or Before & After.
- Prefer obscure-but-fair angles over generic trivia. Avoid common questions like basic capitals, obvious Oscar winners, or first-president style facts unless the input specifically asks for them.
- Keep wording concise, host-friendly, and easy to read aloud.
- The final question should not be too wordy, too academic, or too easy unless the rough input requires it.
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
    incorrect_answers: type === "multiple_choice" && correctAnswer ? normalizeIncorrectAnswers(value.incorrect_answers, correctAnswer) : [],
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
      correct_answer: "",
      incorrect_answers: [],
      fun_fact: "",
      confidence: 0.25,
      notes: "AI assistance is not configured, so this is only a starter shape. Add or verify the answer before saving.",
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
  if (!text) return "";
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
