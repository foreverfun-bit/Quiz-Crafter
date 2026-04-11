export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sessionId, questionType } = req.body;

    if (!sessionId || !questionType) {
      return res.status(400).json({ error: "Missing sessionId or questionType" });
    }

    if (questionType !== "true_false") {
      return res.status(400).json({ error: "This first version only supports true_false" });
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
            name: "tf_candidates",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                candidates: {
                  type: "array",
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      question_text: { type: "string" },
                      question_type: { type: "string", enum: ["true_false"] },
                      has_image: { type: "boolean" },
                      image_url: { type: "string" },
                      category: { type: "string" },
                      correct_answer: { type: "string", enum: ["True", "False"] },
                      incorrect_answers: {
                        type: "array",
                        items: { type: "string" }
                      },
                      fun_fact: { type: "string" },
                      difficulty: { type: "string", enum: ["easy", "medium", "hard"] }
                    },
                    required: [
                      "question_text",
                      "question_type",
                      "has_image",
                      "image_url",
                      "category",
                      "correct_answer",
                      "incorrect_answers",
                      "fun_fact",
                      "difficulty"
                    ]
                  }
                }
              },
              required: ["candidates"]
            }
          }
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a professional pub trivia writer. Return fresh, accurate, medium-difficulty true/false questions. Avoid duplicates, avoid vague wording, and keep answers factually correct."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
Generate exactly 5 true/false trivia question candidates for a trivia session.

Rules:
- question_type must be "true_false"
- has_image must be false
- image_url must be ""
- incorrect_answers must be []
- correct_answer must be either "True" or "False"
- difficulty must be "medium"
- fun_fact should be one short sentence
- use a mix of broad pub trivia categories like history, science, geography, entertainment, sports, literature, food, etc.
- avoid overly obscure facts
- avoid trick wording
- do not repeat categories too much
                `
              }
            ]
          }
        ]
      })
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error("OpenAI error response:", data);
      return res.status(500).json({
        error: data?.error?.message || "OpenAI request failed",
      });
    }

    const parsed = data.output_parsed;

    if (!parsed || !parsed.candidates || !Array.isArray(parsed.candidates)) {
      console.error("Unexpected OpenAI response:", data);
      return res.status(500).json({ error: "No AI response received" });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("generate-session-candidates error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate candidates",
    });
  }
}
