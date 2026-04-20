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

function splitOptions(value) {
  if (!value) return [];
  if (value.includes(";")) return value.split(";").map((s) => s.trim()).filter(Boolean);
  if (value.includes("|")) return value.split("|").map((s) => s.trim()).filter(Boolean);
  if (value.includes(",")) return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [value.trim()].filter(Boolean);
}

function cleanHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAnswerWithImage(value) {
  if (!value) {
    return { text: "", image: null };
  }

  const parts = String(value).split("%%%");

  return {
    text: parts[0]?.trim() || "",
    image: parts[1]?.trim() || null,
  };
}

function uniqueAnswerObjects(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const text = String(item?.text || "").trim();
    const image = String(item?.image || "").trim();
    const key = `${text.toLowerCase()}|||${image.toLowerCase()}`;
    if (!text && !image) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      text,
      image: image || null,
    });
  }

  return result;
}

function normalizeCrowdpurrPreviewRow(row) {
  const questionText = getValue(row, ["Question"]);
  const questionTypeRaw = getValue(row, ["Question Type"]).toLowerCase();
  const note = cleanHtml(getValue(row, ["Question Note"]));
  const correctAnswerRaw = getValue(row, ["Correct Answer(s)"]);
  const additionalAnswersRaw = getValue(row, ["Additional Answers"]);

  if (!questionText) return null;
  if (questionTypeRaw === "reorder") return null;

  const correctParsed = parseAnswerWithImage(correctAnswerRaw);

  const knownKeys = new Set(
    [
      "Question",
      "Question Type",
      "Question Points (Leave Blank For Polls)",
      "Question Time",
      "Question Image URL",
      "Question Note",
      "Question Link",
      "Correct Answer(s)",
      "Additional Answers",
      "__parsed_extra",
    ].map((k) => k.toLowerCase())
  );

  const overflowNamedAnswers = Object.entries(row)
    .filter(([key, value]) => {
      if (!key) return false;
      if (knownKeys.has(String(key).toLowerCase())) return false;
      return value !== undefined && value !== null && String(value).trim() !== "";
    })
    .map(([, value]) => parseAnswerWithImage(value));

  const parsedExtraAnswers = Array.isArray(row.__parsed_extra)
    ? row.__parsed_extra.map((value) => parseAnswerWithImage(value))
    : row.__parsed_extra
    ? [parseAnswerWithImage(row.__parsed_extra)]
    : [];

  const splitAdditionalAnswers = splitOptions(additionalAnswersRaw).map((value) =>
    parseAnswerWithImage(value)
  );

  const allExtraAnswers = uniqueAnswerObjects([
    ...splitAdditionalAnswers,
    ...overflowNamedAnswers,
    ...parsedExtraAnswers,
  ]).filter(
    (item) => item.text.toLowerCase() !== String(correctParsed.text || "").toLowerCase()
  );

  let questionType = "written";
  let correctAnswer = correctParsed.text;
  let incorrectAnswers = "";
  let category = "Imported";

  if (questionTypeRaw === "multiplechoice") {
    questionType = "multiple_choice";
    incorrectAnswers = allExtraAnswers.map((a) => a.text).filter(Boolean).join("; ");
  } else if (questionTypeRaw === "text") {
    questionType = "written";
  }

  const answerLower = String(correctAnswer || "").toLowerCase();
  if (answerLower === "true" || answerLower === "false") {
    questionType = "true_false";
    incorrectAnswers = answerLower === "true" ? "False" : "True";
  }

  if (!correctAnswer) return null;

  return {
    question: questionText,
    category,
    correctAnswer,
    incorrectAnswers,
    questionType,
    note,
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
    const previewRows = rows
      .map(normalizeCrowdpurrPreviewRow)
      .filter(Boolean);

    return res.status(200).json({
      format: "crowdpurr",
      columns: parsed.meta?.fields || [],
      row_count: previewRows.length,
      preview: previewRows.slice(0, 5),
      warnings: (parsed.errors || []).map((e) => e.message),
    });
  } catch (error) {
    console.error("import-preview-crowdpurr error:", error);
    return res.status(500).json({
      error: error.message || "Failed to preview Crowdpurr CSV",
    });
  }
};
