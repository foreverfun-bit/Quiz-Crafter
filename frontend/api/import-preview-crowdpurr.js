const Papa = require("papaparse");

exports.config = {
  api: {
    bodyParser: false,
  },
};

function readFile(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractFile(buffer) {
  const text = buffer.toString("utf8");
  const boundary = text.split("\r\n")[0];

  if (!boundary) return "";

  const parts = text.split(boundary);

  for (const part of parts) {
    if (part.includes('name="file"')) {
      const start = part.indexOf("\r\n\r\n");
      if (start === -1) continue;

      return part
        .slice(start + 4)
        .replace(/\r\n--$/, "")
        .trim();
    }
  }

  return "";
}

// 🔥 THIS is the fix
function expandRow(row) {
  const questions = [];

  for (let i = 1; i <= 50; i++) {
    const q = row[`Question_${i}`];
    const a = row[`Answer_${i}`];
    const c = row[`Category_${i}`];
    const note = row[`Fun Fact_${i}`];

    if (!q || !a) continue;

    questions.push({
      question: q,
      category: c || "Imported",
      correctAnswer: a,
      incorrectAnswers: null,
      note: note || "",
    });
  }

  return questions;
}

module.exports = async function handler(req, res) {
  try {
    const buffer = await readFile(req);
    const csvText = extractFile(buffer);

    if (!csvText) {
      return res.status(400).json({ error: "No file found" });
    }

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const rows = parsed.data || [];

    let allQuestions = [];

    for (const row of rows) {
      const expanded = expandRow(row);
      allQuestions.push(...expanded);
    }

    if (!allQuestions.length) {
      return res.status(400).json({
        error: "No questions detected (format mismatch)",
      });
    }

    return res.status(200).json({
      format: "crowdpurr",
      row_count: allQuestions.length,
      columns: Object.keys(rows[0] || {}),
      preview: allQuestions.slice(0, 5),
    });

  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Failed to preview Crowdpurr CSV",
    });
  }
};
