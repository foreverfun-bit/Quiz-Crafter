export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sessionId, questionType } = req.body;

    if (!sessionId || !questionType) {
      return res.status(400).json({ error: "Missing sessionId or questionType" });
    }

    const typeConfigs = {
      true_false: {
        label: "True/False",
        schemaItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string" },
            question_text: { type: "string" },
            correct_answer: { type: "string", enum: ["True", "False"] },
            incorrect_answers: {
              type: "array",
              items: { type: "string" },
            },
            fun_fact: { type: "string" },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            question_type: { type: "string", enum: ["true_false"] },
            has_image: { type: "boolean" },
            image_url: { type: "string" },
          },
          required: [
            "category",
            "question_text",
            "correct_answer",
            "incorrect_answers",
            "fun_fact",
            "difficulty",
            "question_type",
            "has_image",
            "image_url",
          ],
        },
        prompt: `
Generate exactly 5 True/False trivia question candidates.

Rules:
- question_type must be "true_false"
- correct_answer must be exactly "True" or "False"
- incorrect_answers must be []
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
        schemaItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string" },
            question_text: { type: "string" },
            correct_answer: { type: "string" },
            incorrect_answers: {
              type: "array",
              items: { type: "string" },
              minItems: 3,
              maxItems: 3,
            },
            fun_fact: { type: "string" },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            question_type: { type: "string", enum: ["multiple_choice"] },
            has_image: { type: "boolean" },
            image_url: { type: "string" },
          },
          required: [
            "category",
            "question_text",
            "correct_answer",
            "incorrect_answers",
            "fun_fact",
            "difficulty",
            "question_type",
            "has_image",
            "image_url",
          ],
        },
        prompt: `
Generate exactly 5 Multiple Choice trivia question candidates.

Rules:
- question_type must be "multiple_choice"
- each question must have 1 correct answer and exactly 3 incorrect answers
- incorrect_answers must NOT include the correct answer
- all answers should be plausible
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
        schemaItem: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string" },
            question_text: { type: "string" },
            correct_answer: { type: "string" },
            incorrect_answers: {
              type: "array",
              items: { type: "string" },
            },
            fun_fact: { type: "string" },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            question_type: { type: "string", enum: ["written"] },
            has_image: { type: "boolean" },
            image_url: { type: "string" },
          },
          required: [
            "category",
            "question_text",
            "correct_answer",
            "incorrect_answers",
            "fun_fact",
            "difficulty",
            "question_type",
            "has_image",
            "image_url",
          ],
        },
        prompt: `
Generate exactly 5 Written Answer trivia question candidates.

Rules:
- question_type must be "written"
- correct_answer should be short and clear
- incorrect_answers must be []
- has_image must be false
- image_url must be ""
- difficulty should be "medium"
- categories should be broad pub trivia categories
- fun_fact should be one short sentence
- avoid obscure or badly worded questions
        `,
      },
    };

    const config = typeConfigs[questionType];

    if (!config) {
      return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        text: {
          format: {
            type: "json_schema",
            name: "session_candidates",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                candidates: {
                  type: "array",
                  minItems: 5,
                  maxItems: 5,
                  items: config.schemaItem,
                },
              },
              required: ["candidates"],
            },
          },
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a professional pub trivia writer. Write fresh, accurate, medium-difficulty questions suitable for live hosted trivia nights.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
Session ID: ${sessionId}
Question Type: ${config.label}

${config.prompt}

Return only valid JSON matching the required schema.
                `,
              },
            ],
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

    const parsed = data.output_parsed;

    if (!parsed || !Array.isArray(parsed.candidates)) {
      console.error("Unexpected OpenAI response:", data);
      return res.status(500).json({ error: "No AI response received" });
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
