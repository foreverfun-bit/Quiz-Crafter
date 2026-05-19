module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured in Vercel");
    }

    const body = req.body || {};
    const questionText = String(body.question_text || "").trim();
    const answer = String(body.correct_answer || "").trim();
    const imagePrompt = String(body.image_prompt || "").trim();
    const category = String(body.category || "Trivia").trim();

    if (!questionText) throw new Error("Question text is required");

    const prompt = [
      "Create a clean trivia question image for a live bar trivia screen.",
      "The image should be useful as a visual clue, not a poster with the answer written on it.",
      "Do not include readable text, logos, watermarks, answer labels, or the correct answer in the image.",
      "Use a bright, inspectable composition that works on a projector or TV.",
      `Category: ${category}.`,
      `Question: ${questionText}.`,
      answer ? `Correct answer to avoid revealing: ${answer}.` : "",
      imagePrompt ? `Visual direction: ${imagePrompt}.` : "",
    ].filter(Boolean).join("\n");

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        quality: "low",
        n: 1,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || "Image generation failed");
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image was returned");

    return res.status(200).json({ image_url: `data:image/png;base64,${b64}` });
  } catch (error) {
    console.error("generate-question-image error:", error);
    return res.status(500).json({ error: error.message || "Failed to generate image" });
  }
};
