export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sessionId, questionType, count } = req.body;

    if (!sessionId || !questionType) {
      return res.status(400).json({ error: "Missing sessionId or questionType" });
    }

    const safeCount =
      Number.isInteger(Number(count)) && Number(count) > 0 && Number(count) <= 20
        ? Number(count)
        : 5;

    const typeConfigs = {
      true_false: {
        label: "True/False",
        prompt: `
Generate exactly ${safeCount} True/False trivia question candidates.

Rules:
- Return valid JSON only.
- Use this exact shape:
{
  "candidates": [
    {
      "category": "Science",
      "question_text": "Venus is the hottest planet in our solar system.",
      "correct_answer": "True",
      "incorrect_answers": [],
      "fun_fact": "Venus is hotter than Mercury because of its dense atmosphere.",
      "difficulty": "medium",
      "question_type": "true_false",
      "has_image": false,
      "image_url": ""
    }
  ]
}
- correct_answer must be exactly "True" or "False"
- incorrect_answers must be []
- question_type must be "true_false"
- has_image must be false
- image_url must be ""
- difficulty should be "medium"
- categories should be broad pub trivia categories
- fun_fact should be one short sentence
- avoid obscure or badly worded questions
        `,
      },

      multiple_choice: {
        label: "Multiple Choice",
        prompt: `
Generate exactly ${safeCount} Multiple Choice trivia question candidates.

Rules:
- Return valid JSON only.
- Use this exact shape:
{
  "candidates": [
    {
      "category": "History",
      "question_text": "Which empire built Machu Picchu?",
      "correct_answer": "Inca",
      "incorrect_answers": ["Maya", "Aztec", "Roman"],
      "fun_fact": "Machu Picchu was built in the 15th century in Peru.",
      "difficulty": "medium",
      "question_type": "multiple_choice",
      "has_image": false,
      "image_url": ""
    }
  ]
}
- each question must have exactly 3 incorrect answers
- incorrect_answers must NOT include the correct answer
- question_type must be "multiple_choice"
- has_image must be false
- image_url must be ""
- difficulty should be "medium"
- categories should be broad pub trivia categories
- fun_fact should be one short sentence
- avoid obscure or badly worded questions
        `,
      },

      written: {
        label: "Written",
        prompt: `
Generate exactly ${safeCount} Written Answer trivia question candidates.

Rules:
- Return valid JSON only.
- Use this exact shape:
{
  "candidates": [
    {
      "category": "Geography",
      "question_text": "What is the capital of Australia?",
      "correct_answer": "Canberra",
      "incorrect_answers": [],
      "fun_fact": "Many people guess Sydney or Melbourne, but the capital is Canberra.",
      "difficulty": "medium",
      "question_type": "written",
      "has_image": false,
      "image_url": ""
    }
  ]
}
- incorrect_answers must be []
- question_type must be "written"
- has_image must be false
- image_url must be ""
- difficulty should be "medium"
- categories should be broad pub trivia categories
- fun_fact should be one short sentence
- avoid obscure or badly worded questions
        `,
      },

      picture: {
        label: "Picture",
        prompt: `
Generate exactly ${safeCount} Picture-Based trivia question candidates.

Rules:
- Return valid JSON only.
- Use this exact shape:
{
  "candidates": [
    {
      "category": "Movies",
      "question_text": "Name this movie character from the image.",
      "correct_answer": "Indiana Jones",
      "incorrect_answers": [],
      "fun_fact": "Indiana Jones first appeared in Raiders of the Lost Ark in 1981.",
      "difficulty": "medium",
      "question_type": "written",
      "has_image": true,
      "image_url": ""
    }
  ]
}
- these are picture-based questions
- question_type must be "written"
- has_image must be true
- image_url must be ""
- incorrect_answers must be []
- correct_answer should be short and clear
- difficulty should be "medium"
- categories should be broad pub trivia categories
- fun_fact should be one short sentence
- the question should make sense with an image
- do not include markdown
        `,
      },
    };

    const config = typeConfigs[questionType];

    if (!config) {
      return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              "You are a professional pub trivia writer. Return only valid JSON. No markdown. No explanation.",
          },
          {
            role: "user",
            content: `
Session ID: ${sessionId}
Question Type: ${config.label}

${config.prompt}
            `,
          },
        ],
      }),
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error("OpenAI error response:", data);
      return res.status(500).json({
        error: data?.error?.message || "OpenAI request failed",
      });
    }

    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.error("Missing completion content:", data);
      return res.status(500).json({ error: "No AI response received" });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse model JSON:", content);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    if (!parsed || !Array.isArray(parsed.candidates)) {
      console.error("Unexpected parsed response:", parsed);
      return res.status(500).json({ error: "No candidates returned" });
    }

    return res.status(200).json({
      candidates: parsed.candidates,
    });
  } catch (error) {
    console.error("generate-session-candidates error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate candidates",
    });
  }
}
