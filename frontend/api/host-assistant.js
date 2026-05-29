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

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const request = clean(body.request);
    const context = body.context || {};
    if (!request) return res.status(400).json({ error: "Ask the host assistant for something first" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({ answer: fallback(request, context) });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_HOST_ASSISTANT_MODEL || "gpt-4.1-mini",
        temperature: 0.55,
        messages: [
          {
            role: "system",
            content: "You are Quiz Crafter's private assistant for an experienced weekly trivia host. Be concrete, host-aware, and useful. Help with show planning, rewrites, clue style, pacing, replacements, round balance, fairness, and emergency hosting decisions. Avoid generic trivia-site advice.",
          },
          {
            role: "user",
            content: JSON.stringify({
              request,
              host_context: {
                venue: context.venue || null,
                template: context.template || null,
                session: context.session || null,
                recent_feedback: safeList(context.feedback, 30),
                player_ideas: safeList(context.ideas, 30),
                questions: safeList(context.questions, 40),
              },
              response_rules: [
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
    return res.status(200).json({ answer });
  } catch (error) {
    console.error("host-assistant error:", error);
    return res.status(500).json({ error: error?.message || "Could not run host assistant" });
  }
}

module.exports = handler;
