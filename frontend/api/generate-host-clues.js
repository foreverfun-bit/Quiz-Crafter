function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const GENERIC_STYLE_EXAMPLES = [
  "If you want your score to really shine, just apply a little highlighter. While you're at it, pay attention to what's holding the story together, leave no unique patterns behind, and watch out for anything that might flag your visit. See you soon for high stakes and higher scores!",
  "Grab your Bluetooth headsets and call Drew Barrymore's ex-husband, because it's going to get unreal in here tonight!",
  "Hey Trivia Fans! Want a head start? You might want to brush up on the fluffy layers that make a quilt cozy, rare birds that only the best golfers ever score, fun nicknames, and why a doctor's needle might already make you smarter than you think. See you this week!",
  "Ready for another round of trivia? This week is going to be a blast, literally. If you want to stay ahead, look into a snack with an explosive history, keep your Tax Day crunch under control, and remember you do not want to B stuck in last place.",
];

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
  const categoryText = categories.length ? ` You might want to brush up on ${categories.map((category) => category.toLowerCase()).join(", ")}... or at least bring a teammate who does.` : "";
  const name = sessionName || "Trivia Night";
  const tone = direction ? ` ${direction}` : "";

  return {
    social_post: `Grab your sharpest teammates and maybe one wildly specific fact you did not think you needed. ${name} is coming in with clue paths, curveballs, and a few "wait, I know this" moments. See you soon!${tone}${categoryText}`,
  };
}

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    const sessionName = clean(body.sessionName) || "Trivia Night";
    const direction = clean(body.direction) || "Make it playful and useful without giving away answers.";
    const questions = safeQuestions(body.questions);
    const pastPosts = Array.isArray(body.pastPosts) ? body.pastPosts.map(clean).filter(Boolean).slice(0, 6) : [];
    const hasOwnStyle = pastPosts.length >= 2;

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
            content: hasOwnStyle
              ? "You write Facebook-style teaser clues for this trivia host's own show. The style_examples are this host's own real past posts -- study their voice, structure, and tone and match it as closely as possible instead of writing generic trivia-host copy. The teaser should hint at several question topics through sideways clues, wordplay, and everyday references without naming answers or making questions solvable. Return strict JSON only."
              : "You write Facebook-style teaser clues for a trivia host's show. Aim for a warm, playful, lightly punny, conversational, and a little mischievous voice. The teaser should hint at several question topics through sideways clues, wordplay, and everyday references without naming answers or making questions solvable. Return strict JSON only.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "Draft one social post teaser for this trivia session.",
              output_shape: {
                social_post: "1 short social post for promoting the session",
              },
              rules: [
                "Do not include answers.",
                "Do not quote exact question wording.",
                "Do not mention internal tools or AI.",
                "Do not list category names plainly unless the host explicitly asks for that.",
                "Write like a real social post from a local trivia host, not like ad copy.",
                "Use 3-6 indirect clue nods from the actual session questions.",
                "Prefer playful setups like 'you might want to...', 'brush up on...', 'grab your...', 'if you have ever...', 'ready for...'.",
                "Use puns and connective tissue, but keep it readable and natural.",
                "The social_post should be 2-5 sentences.",
                "A few emojis are okay if they fit, but do not overload them.",
                "End the social post with a friendly invite such as 'See you tonight!' or similar when natural.",
              ],
              style_examples: hasOwnStyle ? pastPosts : GENERIC_STYLE_EXAMPLES,
              avoid: [
                "Generic phrases like 'test your knowledge' or 'join us for fun trivia'.",
                "Obvious category list posts.",
                "Explaining the clue mechanics.",
                "Overly polished marketing language.",
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
    const socialPost = clean(parsed.social_post || parsed.socialPost);

    if (!socialPost) {
      throw new Error("AI returned an incomplete clue draft");
    }

    return res.status(200).json({ social_post: socialPost });
  } catch (error) {
    console.error("generate-host-clues error:", error);
    return res.status(500).json({ error: error?.message || "Could not generate clues" });
  }
}

module.exports = handler;
