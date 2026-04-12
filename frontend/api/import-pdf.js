export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    return res.status(200).json({
      imported: 0,
      updated: 0,
      sessions_created: 0,
      skipped: 0,
      detected_questions: 0,
      preview: [],
      notes: [
        "PDF import route is connected.",
        "Next step is adding PDF text extraction and question parsing.",
      ],
    });
  } catch (error) {
    console.error("import-pdf error:", error);
    return res.status(500).json({
      error: error.message || "Failed to process PDF",
    });
  }
}
