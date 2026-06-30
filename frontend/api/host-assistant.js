const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

const safeList = (value, limit = 20) => Array.isArray(value) ? value.slice(0, limit) : [];

const fallback = (request, context) => {
  const sessionName = clean(context?.session?.name || context?.session?.session_name) || "your next trivia night";
  const venueName = clean(context?.venue?.name || context?.venue?.nightName);
  const templateName = clean(context?.template?.name);
  return [
    `Here is a practical host plan for ${sessionName}${venueName ? ` at ${venueName}` : ""}.`,
    templateName ? `Use the ${templateName} structure as the pacing guide.` : "Keep the opening round welcoming, save the sharper pulls for later, and keep a backup written question ready.",
    request ? `For your request: ${request}` : "Tell me what you want to adjust and I can draft a more specific plan.",
  ].join("\n\n");
};

const parseAssistantJson = (content) => {
  const text = clean(content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const normalizeCandidate = (candidate) => {
  if (!candidate || typeof candidate !== "object") return null;
  const questionText = clean(candidate.question_text || candidate.question);
  const correctAnswer = clean(candidate.correct_answer || candidate.answer);
  const category = clean(candidate.category);
  const type = ["true_false", "multiple_choice", "written"].includes(candidate.question_type || candidate.type) ? candidate.question_type || candidate.type : "written";
  if (!questionText || !correctAnswer || !category) return null;
  const incorrect = Array.isArray(candidate.incorrect_answers) ? candidate.incorrect_answers.map(clean).filter(Boolean) : [];
  return {
    category,
    question_text: questionText,
    correct_answer: type === "true_false" ? (correctAnswer.toLowerCase() === "false" ? "False" : "True") : correctAnswer,
    incorrect_answers: type === "multiple_choice" ? incorrect.slice(0, 3) : [],
    fun_fact: clean(candidate.fun_fact),
    difficulty: clean(candidate.difficulty || "medium") || "medium",
    question_type: type,
    image_url: "",
    image_prompt: "",
  };
};

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const request = clean(body.request);
    const context = body.context || {};
    const mode = clean(body.mode);
    if (!request) return res.status(400).json({ error: "Ask the host assistant for something first" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({ answer: fallback(request, context) });
    }

    const buildMode = mode === "build_cohost";
    const editMode = mode === "question_edit";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_HOST_ASSISTANT_MODEL || "gpt-4.1-mini",
        temperature: buildMode || editMode ? 0.62 : 0.55,
        response_format: buildMode || editMode ? { type: "json_object" } : undefined,
        messages: [
          {
            role: "system",
            content: editMode
              ? "You are Quiz Crafter's conversational question editor for an experienced US bar-trivia host. Rewrite the provided question according to the host's instruction while preserving the same trivia idea unless the host explicitly asks for a different fact. Make questions playable, fair, and host-ready. Return valid JSON only."
              : buildMode
              ? "You are Quiz Crafter's private ChatGPT-style co-host for an experienced US bar-trivia host. Help shape the current build with practical, playable, fresh-but-fair questions. Use only approved categories when they are provided. Do not invent categories. Avoid obscure deep cuts, tiny-name answers, sterile textbook facts, and questions with no clue path. Return valid JSON only."
              : "You are Quiz Crafter's private assistant for an experienced weekly trivia host. Be concrete, host-aware, and useful. Help with show planning, rewrites, clue style, pacing, replacements, round balance, fairness, and emergency hosting decisions. Avoid generic trivia-site advice.",
          },
          {
            role: "user",
            content: JSON.stringify({
              request,
              host_context: {
                venue: context.venue || null,
                template: context.template || null,
                session: context.session || null,
                build: context.build || null,
                approved_categories: safeList(context.approvedCategories, 80),
                rejected_categories: safeList(context.rejectedCategories, 80),
                recent_categories: safeList(context.recentSessionCategories, 80),
                recent_feedback: safeList(context.feedback, 30),
                player_ideas: safeList(context.ideas, 30),
                questions: safeList(context.questions, 40),
              },
              response_rules: editMode
                ? [
                    "Return JSON with keys: answer, candidate.",
                    "answer should briefly explain what changed and any caveat the host should know.",
                    "candidate must include category, question_text, correct_answer, incorrect_answers, fun_fact, difficulty, question_type, image_url.",
                    "question_type must be true_false, multiple_choice, or written.",
                    "If the host asks to make it false, create a true_false question whose correct_answer is exactly False.",
                    "If the host asks to make it true, create a true_false question whose correct_answer is exactly True.",
                    "If the host asks to make it easier or harder, keep the same broad trivia idea and category unless impossible.",
                    "For multiple_choice, incorrect_answers must contain exactly 3 plausible wrong answers.",
                    "Do not claim to save or edit anything directly.",
                  ]
                : buildMode
                ? [
                    "Return JSON with keys: answer, candidates.",
                    "answer should be 2-5 short, actionable sentences for the host.",
                    "candidates must be an array of 0-6 usable question objects.",
                    "Each candidate must include category, question_text, correct_answer, incorrect_answers, fun_fact, difficulty, question_type, image_url.",
                    "question_type must be true_false, multiple_choice, or written.",
                    "For multiple_choice, incorrect_answers must contain exactly 3 plausible wrong answers.",
                    "For true_false, correct_answer must be exactly True or False.",
                    "For written, answers must be familiar/gettable enough for a live bar team.",
                    "Use only approved_categories if any are provided.",
                    "Do not claim to save or edit anything directly.",
                  ]
                : [
                    "Answer in short, actionable sections.",
                    "If rewriting or replacing a question, provide the usable question, answer, and brief host note.",
                    "Use the host's venue/template/session memory when relevant.",
                    "Do not claim to have changed the database unless explicitly asked and tool support exists.",
                  ],
            }),
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
    const answer = clean(data.choices?.[0]?.message?.content);
    if (!answer) throw new Error("AI returned an empty answer");
    if (buildMode) {
      const parsed = parseAssistantJson(answer);
      const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates.map(normalizeCandidate).filter(Boolean).slice(0, 6) : [];
      return res.status(200).json({ answer: clean(parsed?.answer) || "I drafted a few co-host suggestions for this build.", candidates });
    }
    if (editMode) {
      const parsed = parseAssistantJson(answer);
      const candidate = normalizeCandidate(parsed?.candidate);
      if (!candidate) throw new Error("AI did not return a usable question edit");
      return res.status(200).json({ answer: clean(parsed?.answer) || "I rewrote the question for you to review.", candidate });
    }
    return res.status(200).json({ answer });
  } catch (error) {
    console.error("host-assistant error:", error);
    return res.status(500).json({ error: error?.message || "Could not run host assistant" });
  }
}

module.exports = handler;
