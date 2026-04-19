const Papa = require("papaparse");

exports.config = {
  api: {
    bodyParser: false,
  },
};

function readFileFromRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractMultipartParts(buffer) {
  const text = buffer.toString("utf8");
  const boundary = text.split("\r\n")[0];

  if (!boundary) return {};

  const parts = text
    .split(boundary)
    .filter((part) => part && part !== "--\r\n" && part !== "--");

  const result = {};

  for (const part of parts) {
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch) continue;

    const fieldName = nameMatch[1];
    const splitIndex = part.indexOf("\r\n\r\n");
    if (splitIndex === -1) continue;

    let value = part.slice(splitIndex + 4);
    value = value.replace(/\r\n--$/, "");
    value = value.replace(/\r\n$/, "");

    result[fieldName] = value;
  }

  return result;
}

function getValue(row, possibleKeys) {
  for (const wanted of possibleKeys) {
    const wantedLower = String(wanted).toLowerCase();

    for (const existingKey of Object.keys(row)) {
      if (String(existingKey).toLowerCase() === wantedLower) {
        const value = row[existingKey];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          return String(value).trim();
        }
      }
    }
  }
  return "";
}

function normalizePreviewRow(row) {
  const question = getValue(row, ["Question"]);
  const category = getValue(row, ["Correct Answer"]);
  const correctAnswer = getValue(row, ["Additional Answers"]);
  const incorrectAnswers = "";

  return {
    question,
    category,
    correctAnswer,
    incorrectAnswers,
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const rawBuffer = await readFileFromRequest(req);
    const parts = extractMultipartParts(rawBuffer);
    const csvText = parts.file || "";

    if (!csvText.trim()) {
      return res.status(400).json({ error: "No CSV content found" });
    }

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => String(header || "").trim(),
    });

    const rows = Array.isArray(parsed.data) ? parsed.data : [];

    const usableRows = rows.filter((row) => {
      const question = getValue(row, ["Question"]);
      const questionType = getValue(row, ["Question Type"]);
      return question && questionType !== "reorder";
    });

    return res.status(200).json({
      format: "crowdpurr",
      columns: parsed.meta?.fields || [],
      row_count: usableRows.length,
      preview: usableRows.slice(0, 5).map(normalizePreviewRow),
      warnings: (parsed.errors || []).map((e) => e.message),
    });
  } catch (error) {
    console.error("import-preview-crowdpurr error:", error);
    return res.status(500).json({
      error: error.message || "Failed to preview Crowdpurr CSV",
    });
  }
};
