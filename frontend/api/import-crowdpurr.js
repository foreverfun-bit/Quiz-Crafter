const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

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

function normalizeHeader(header, seen) {
  const cleaned = String(header || "").trim();
  const key = cleaned.toLowerCase();

  if (!seen[key]) {
    seen[key] = 1;
    return cleaned;
  }

  const suffix = seen[key];
  seen[key] += 1;
  return `${cleaned}_${suffix}`;
}

function getRowValue(row, possibleKeys) {
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

function cleanOptionPrefix(value) {
  return String(value)
    .replace(/^[A-Da-d][\).\:\-\s]+/, "")
    .trim();
}

function normalizeCrowdpurrRow(row) {
  const questionText = getRowValue(row, [
    "question",
    "Question",
    "prompt",
    "Prompt",
  ]);

  const category = getRowValue(row, [
    "category",
    "Category",
    "round",
    "Round",
  ]) || "Imported";

  const correctAnswer = getRowValue(row, [
    "correctAnswer",
    "Correct Answer",
    "correct_answer",
    "answer",
    "Answer",
  ]);

  const note = getRowValue(row, [
    "note",
    "Note",
    "fun_fact",
    "Fun Fact",
    "explanation",
    "Explanation",
  ]);

  const incorrectJoined = getRowValue(row, [
    "incorrectAnswers",
    "incorrect_answers",
  ]);

  const fallbackIncorrect = [
    getRowValue(row, ["Answer 2"]),
    getRowValue(row, ["Answer 3"]),
    getRowValue(row, ["Answer 4"]),
    getRowValue(row, ["Option A"]),
    getRowValue(row, ["Option B"]),
    getRowValue(row, ["Option C"]),
    getRowValue(row, ["Option D"]),
  ]
    .filter(Boolean)
    .join(";");

  const incorrectRaw = incorrectJoined || fallbackIncorrect;

  console.log("ROW MAPPING CHECK:", {
    keys: Object.keys(row),
    questionText,
    correctAnswer,
    category,
  });

  if (!questionText || !correctAnswer) {
    return null;
  }

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

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl) {
      return res.status(500).json({ error: "Missing SUPABASE_URL" });
    }

    if (!serviceRoleKey) {
      return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

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

    const seen = {};
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => normalizeHeader(header, seen),
    });

    // Ignore duplicate-header warnings here too.
    const realErrors = (parsed.errors || []).filter((err) => {
      const msg = String(err.message || "");
      return !msg.includes("Duplicate headers found and renamed");
    });

    if (realErrors.length > 0) {
      return res.status(400).json({
        error: realErrors[0].message || "Failed to parse CSV",
      });
    }

    const rows = Array.isArray(parsed.data) ? parsed.data : [];

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const rawRow of rows) {
      try {
        const normalized = normalizeCrowdpurrRow(rawRow);

        if (!normalized) {
          console.log("SKIPPED (invalid row):", rawRow);
          skipped += 1;
          continue;
        }

        const { data: existing, error: lookupError } = await supabase
          .from("questions")
          .select("id")
          .eq("question_text", normalized.question_text)
          .limit(1)
          .maybeSingle();

        if (lookupError) throw lookupError;

        if (existing?.id) {
          console.log("SKIPPED (duplicate):", normalized.question_text);
          skipped += 1;
          continue;
        }

        const { error: insertError } = await supabase.from("questions").insert({
          user_id: sessionUserId,
          category: normalized.category,
          question_text: normalized.question_text,
          correct_answer: normalized.correct_answer,
          question_type: normalized.question_type,
          incorrect_answers: normalized.incorrect_answers,
          fun_fact: normalized.fun_fact,
          has_image: normalized.has_image,
          image_url: normalized.image_url,
          difficulty: normalized.difficulty,
          source: normalized.source,
        });

        if (insertError) throw insertError;

        imported += 1;
      } catch (err) {
        console.error("ROW ERROR:", err);
        errors.push(err.message || "Row import failed");
      }
    }

    return res.status(200).json({
      format: "crowdpurr",
      imported,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("IMPORT ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to import Crowdpurr CSV",
    });
  }
};
