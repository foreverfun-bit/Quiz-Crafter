function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeQuestions(value) {
  return Array.isArray(value)
    ? value
        .map((question) => ({
          category: clean(question.category),
          question: clean(question.question),
          answer: clean(question.answer),
          fun_fact: clean(question.fun_fact),
        }))
        .filter((question) => question.question && question.answer)
        .slice(0, 40)
    : [];
}

function fallbackClues(sessionName, questions, direction) {
  const categories = [...new Set(questions.map((question) => question.category).filter(Boolean))].slice(0, 4);
  const categoryText = categories.length ? ` Expect a little ${categories.join(", ")} energy.` : "";
  const name = sessionName || "Trivia Night";
  const tone = direction ? ` ${direction}` : "";

  return {
    update: `${name} hint: tonight's set has some sneaky clue paths, a few satisfying reveals, and no free answers in this message.${categoryText}${tone}`,
    social_post: `${name} is coming in hot. Study broadly, trust your table, and keep an eye out for the clue hiding in plain sight.${categoryText}`,
  };
}

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    const sessionName = clean(body.sessionName) || "Trivia Night";
    const direction = clean(body.direction) || "Make it playful and useful without giving away answers.";
    const questions = safeQuestions(body.questions);

    if (!questions.length) {
      return res.status(400).json({ error: "No usable session questions found for clue drafting" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json(fallbackClues(sessionName, questions, direction));
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_HOST_TOOLS_MODEL || "gpt-4.1-mini",
        temperature: 0.75,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write teaser clues and social posts for a live trivia host. Be playful, modern, and useful, but never reveal answers or make the actual questions solvable from the teaser alone. Return strict JSON only.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Draft one in-app player update and one social post teaser for this trivia session.",
              output_shape: {
                update: "1-2 short sentences for players who already joined the game",
                social_post: "1 short social post for promoting the session",
              },
              rules: [
                "Do not include answers.",
                "Do not quote exact question wording.",
                "Do not mention internal tools or AI.",
                "Use category-level hints, wordplay, and vibe.",
                "Keep it suitable for a trivia host posting before or during an event.",
              ],
              session_name: sessionName,
              host_direction: direction,
              questions,
            }),
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "OpenAI request failed");
    }

    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const update = clean(parsed.update);
    const socialPost = clean(parsed.social_post || parsed.socialPost);

    if (!update || !socialPost) {
      throw new Error("AI returned an incomplete clue draft");
    }

    return res.status(200).json({ update, social_post: socialPost });
  } catch (error) {
    console.error("generate-host-clues error:", error);
    return res.status(500).json({ error: error?.message || "Could not generate clues" });
  }
}

module.exports = handler;
