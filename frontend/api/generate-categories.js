export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
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
            name: "trivia_categories",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                true_false: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 9,
                  maxItems: 9,
                },
                multiple_choice: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 9,
                  maxItems: 9,
                },
                written: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 9,
                  maxItems: 9,
                },
                picture: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 3,
                  maxItems: 3,
                },
              },
              required: ["true_false", "multiple_choice", "written", "picture"],
            },
          },
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You generate fun, broad, pub-trivia-friendly categories.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
Generate trivia categories for one session.

Requirements:
- true_false: exactly 9 categories
- multiple_choice: exactly 9 categories
- written: exactly 9 categories
- picture: exactly 3 categories
- all categories must be unique across all lists
- categories should be broad, fun, and usable for pub trivia
- picture categories should work visually
                `,
              },
            ],
          },
        ],
      }),
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error("OpenAI error:", data);
      return res.status(500).json({
        error: data.error?.message || "OpenAI request failed",
      });
    }

    const parsed =
      data.output_parsed ||
      (() => {
        const text = data.output?.[0]?.content?.find(
          (item) => item.type === "output_text"
        )?.text;
        return text ? JSON.parse(text) : null;
      })();

    if (!parsed) {
      console.error("Unexpected OpenAI response:", data);
      return res.status(500).json({ error: "No AI response received" });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("generate-categories error:", error);
    return res.status(500).json({ error: "Failed to generate categories" });
  }
}
