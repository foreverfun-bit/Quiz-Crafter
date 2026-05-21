const MAX_QUESTIONS = 40;
const MAX_CLUES = 5;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Vercel");

    const { sessionName = "Trivia Night", direction = "", questions = [] } = req.body || {};
    const safeQuestions = normalizeQuestions(questions).slice(0, MAX_QUESTIONS);
    if (!safeQuestions.length) return res.status(400).json({ error: "No session questions were provided" });

    const prompt = buildPrompt({ sessionName, direction, questions: safeQuestions });
    const parsed = await requestHostClues(prompt);
    const blockedAnswers = safeQuestions.map((question) => question.answer).filter(Boolean);
    const result = normalizeResponse(parsed, blockedAnswers);

    return res.status(200).json(result);
  } catch (error) {
    console.error("generate-host-clues error:", error);
    return res.status(500).json({ error: error?.message || "Failed to generate host clues" });
  }
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions
    .map((question, index) => ({
      number: index + 1,
      category: cleanText(question?.category),
      question: cleanText(question?.question),
      answer: cleanText(question?.answer),
      funFact: cleanText(question?.fun_fact),
    }))
    .filter((question) => question.question && question.answer);
}

function buildPrompt({ sessionName, direction, questions }) {
  const questionLines = questions
    .map((question) => {
      const parts = [
        `${question.number}. [${question.category || "Uncategorized"}] ${question.question}`,
        `Answer: ${question.answer}`,
      ];
      if (question.funFact) parts.push(`Fun fact: ${question.funFact}`);
      return parts.join(" ");
    })
    .join("\n");

  return `
You are writing host-facing player updates for a live trivia host.

Session: ${cleanText(sessionName) || "Trivia Night"}
Host direction: ${cleanText(direction) || "Punny, playful, useful, and not too revealing."}

Questions, answers, and fun facts for spoiler awareness:
${questionLines}

Return JSON only with this exact shape:
{
  "update": "One short in-app clue/update for players, under 280 characters.",
  "social_post": "One short public social post, under 500 characters.",
  "clues": ["3-5 alternate in-app clues or updates"]
}

Rules:
- Do not reveal, rhyme with, acronym, spell out, or strongly point to any exact answer.
- Do not mention question numbers, rounds, or say which category contains the answer.
- Avoid true/false giveaways. Hint at the flavor of the session, not the truth value.
- The update should feel like something a real bar trivia host would send mid-game: playful, concise, and useful.
- Prefer broad nudges, theme texture, fun misdirection, or study-adjacent hints over answer-adjacent clues.
- Make the social post promotional and spoiler-free; it can mention the vibe, difficulty, or categories generally.
- Avoid generic filler like "test your knowledge" unless it has a specific hook from this session.
`.trim();
}

async function requestHostClues(prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_GENERATOR_MODEL || "gpt-4.1",
      temperature: 0.72,
      presence_penalty: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You write careful, spoiler-safe trivia host updates. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No AI response received");

  try {
    return JSON.parse(content);
  } catch {
    console.error("Failed to parse host clues JSON:", content);
    throw new Error("AI returned invalid JSON");
  }
}

function normalizeResponse(parsed, blockedAnswers) {
  const safeClues = Array.isArray(parsed?.clues)
    ? parsed.clues.map(cleanText).filter((clue) => clue && !leaksAnswer(clue, blockedAnswers)).slice(0, MAX_CLUES)
    : [];
  const update = cleanText(parsed?.update);
  const socialPost = cleanText(parsed?.social_post);

  return {
    update: update && !leaksAnswer(update, blockedAnswers) ? update : safeClues[0] || "Tonight's clues reward careful ears, broad knowledge, and the occasional beautifully weird connection.",
    social_post: socialPost && !leaksAnswer(socialPost, blockedAnswers) ? socialPost : "Fresh trivia is on deck: odd angles, fair clues, and plenty for sharp teams to chew on.",
    clues: safeClues,
  };
}

function leaksAnswer(text, answers) {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) return false;

  return answers.some((answer) => {
    const normalizedAnswer = normalizeForMatch(answer);
    if (normalizedAnswer.length < 4) return false;
    return normalizedText.includes(normalizedAnswer);
  });
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeForMatch(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
