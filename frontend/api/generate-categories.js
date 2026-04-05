export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `
Generate trivia categories for a session.

Return ONLY valid JSON in this exact shape:
{
  "true_false": ["cat1", "cat2", "cat3", "cat4", "cat5", "cat6", "cat7", "cat8", "cat9"],
  "multiple_choice": ["cat1", "cat2", "cat3", "cat4", "cat5", "cat6", "cat7", "cat8", "cat9"],
  "written": ["cat1", "cat2", "cat3", "cat4", "cat5", "cat6", "cat7", "cat8", "cat9"],
  "picture": ["cat1", "cat2", "cat3"]
}

Rules:
- all categories must be unique across all lists
- categories should be broad, fun, pub-trivia friendly
- picture categories should work visually
- no explanation, no markdown, JSON only
        `,
      }),
    });

    const data = await response.json();

    const text = data.output?.[0]?.content?.[0]?.text;

    if (!text) {
      return res.status(500).json({ error: "No AI response received" });
    }

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("generate-categories error:", error);
    return res.status(500).json({ error: "Failed to generate categories" });
  }
}
