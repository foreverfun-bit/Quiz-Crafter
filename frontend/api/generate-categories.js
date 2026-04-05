export default async function handler(req, res) {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Generate 9 unique trivia categories suitable for:
        - True/False
        - Multiple Choice
        - Written Answer
        Also generate 3 picture round categories.
        Return as a JSON array.`
      }),
    });

    const data = await response.json();

    res.status(200).json(data.output[0].content[0].text);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate categories" });
  }
}
