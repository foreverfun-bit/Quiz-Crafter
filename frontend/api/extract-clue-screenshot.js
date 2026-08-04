function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    const image = String(body.image || "");
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image)) {
      return res.status(400).json({ error: "No screenshot provided" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Screenshot reading isn't configured for this deployment" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_HOST_TOOLS_MODEL || "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You read screenshots of social media posts (Facebook, Instagram, X, etc.) advertising a bar trivia night and transcribe them exactly. Return strict JSON only.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  task: "Transcribe the exact text of the post/caption shown in this screenshot -- the trivia clue teaser itself, not comments, replies, usernames, handles, timestamps in the UI chrome, like/share counts, or surrounding app UI.",
                  rules: [
                    "Return the post text verbatim, including its original line breaks and emojis.",
                    "If multiple posts are visible, transcribe only the main/largest one.",
                    "If a posted date or time is visible in the screenshot (e.g. '3h', 'July 21 at 6:00 PM', 'Yesterday'), include it as posted_at exactly as shown; otherwise return an empty string.",
                    "If no readable post text is visible at all, return an empty string for text.",
                  ],
                  output_shape: { text: "the exact post text, verbatim", posted_at: "the visible date/time label, or empty string" },
                }),
              },
              { type: "image_url", image_url: { url: image } },
            ],
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
    const text = clean(parsed.text);
    if (!text) throw new Error("Could not find any post text in that screenshot");

    return res.status(200).json({ text, postedAt: clean(parsed.posted_at) });
  } catch (error) {
    console.error("extract-clue-screenshot error:", error);
    return res.status(500).json({ error: error?.message || "Could not read that screenshot" });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
};
