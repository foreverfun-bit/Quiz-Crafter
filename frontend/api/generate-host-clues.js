export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in Vercel");

    const { sessionName = "Trivia Night", direction = "", questions = [] } = req.body || {};
    const safeQuestions = Array.isArray(questions) ? questions.slice(0, 40) : [];
    if (!safeQuestions.length) return res.status(400).json({ error: "No session questions were provided" });

    const prompt = `
You are a live trivia host assistant. Study this session and write useful audience updates.

Session: ${sessionName}
Host direction: ${direction || "Punny, playful, useful, and not too revealing."}

Questions, categories, answers, and fun facts:
${safeQuestions.map((q, index) => `${index + 1}. [${q.category || "Uncategorized"}] ${q.question || ""} Answer: ${q.answer || ""}${q.fun_fact ? ` Fun fact: ${q.fun_fact}` : ""}`).join("\n")}

Return JSON only:
{
  "update": "One short clue/update the host can send to players. It should be punny and helpful but must not reveal any answer.",
  "social_post": "A short promotional social media post for this trivia session. Fun and brand-safe.",
  "clues": ["3-5 extra clue ideas, no answers revealed"]
}

Rules:
- Do not reveal exact answers.
- Avoid clues that make a true/false answer obvious.
- Keep the update under 280 characters.
- Keep the social post under 500 characters.
- Prefer warm host voice over generic marketing copy.
`.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_GENERATOR_MODEL || "gpt-4.1",
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You write playful, careful trivia host clues and updates. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No AI response received");

    return res.status(200).json(JSON.parse(content));
  } catch (error) {
    console.error("generate-host-clues error:", error);
    return res.status(500).json({ error: error?.message || "Failed to generate host clues" });
  }
}
