import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";

export const config = {
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
  const segments = text.split("\r\n");
  const boundary = segments[0];

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

function splitOptions(value) {
  if (!value) return [];
  if (value.includes(";")) return value.split(";").map((s) => s.trim()).filter(Boolean);
  if (value.includes("|")) return value.split("|").map((s) => s.trim()).filter(Boolean);
  if (value.includes(",")) return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [value.trim()].filter(Boolean);
}

function cleanOptionPrefix(value) {
  return String(value)
    .replace(/^[A-Da-d][\).\:\-\s]+/, "")
    .trim();
}

function getRowValue(row, key) {
  if (row[key] !== undefined && row[key] !== null) return row[key];

  const lowerKey = key.toLowerCase();
  const matchedKey = Object.keys(row).find((k) => String(k).toLowerCase() === lowerKey);
  if (matchedKey) return row[matchedKey];

  return "";
}

function normalizeCrowdpurrRow(row) {
  const questionText = String(getRowValue(row, "question") || "").trim();
  const category = String(getRowValue(row, "category") || "Imported").trim() || "Imported";
  const correctAnswer = String(getRowValue(row, "correctAnswer") || "").trim();
  const incorrectRaw = String(getRowValue(row, "incorrectAnswers") || "").trim();
  const note = String(getRowValue(row, "note") || "").trim();

  if (!questionText || !correctAnswer) return null;

  let questionType = "written";
  let incorrectAnswers = null;

  const answerLower = correctAnswer.toLowerCase();

  if (answerLower === "true" || answerLower === "false") {
    questionType = "true_false";
    incorrectAnswers = answerLower === "true" ? "False" : "True";
  } else if (incorrectRaw) {
    questionType = "multiple_choice";
    const options = splitOptions(incorrectRaw)
      .map(cleanOptionPrefix)
      .filter(Boolean)
      .filter((opt) => opt.toLowerCase() !== answerLower);

    incorrectAnswers = options.length ? options.join(";") : null;
  }

  return {
    category,
    question_text: questionText,
    correct_answer: correctAnswer,
    question_type: questionType,
    incorrect_answers: incorrectAnswers,
    fun_fact: note || null,
    has_image: false,
    image_url: null,
    difficulty: "medium",
    source: "imported",
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    console.log("ENV CHECK:", {
      url: process.env.SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const rawBuffer = await readFileFromRequest(req);
    const parts = extractMultipartParts(rawBuffer);

    const csvText = parts.file || "";
    const sessionUserId = String(parts.sessionUserId || "").trim();

    if (!sessionUserId) {
      return res.status(400).json({ error: "Missing session user id" });
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: "No CSV content found" });
    }

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const rows = parsed.data || [];

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const rawRow of rows) {
      try {
        const normalized = normalizeCrowdpurrRow(rawRow);

        if (!normalized) {
          skipped++;
          continue;
        }

        const { error } = await supabase.from("questions").insert({
          user_id: sessionUserId,
          ...normalized,
        });

        if (error) throw error;

        imported++;
      } catch (err) {
        errors.push(err.message);
      }
    }

    return res.status(200).json({
      imported,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("IMPORT ERROR:", error);
    return res.status(500).json({
      error: error.message,
    });
  }
}
