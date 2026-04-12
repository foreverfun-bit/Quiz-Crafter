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

  if (!boundary) {
    return {};
  }

  const parts = text.split(boundary).filter(
    (part) => part && part !== "--\r\n" && part !== "--"
  );

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

function getValue(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

function splitOptions(value) {
  if (!value) return [];

  if (value.includes(";")) {
    return value.split(";").map((s) => s.trim()).filter(Boolean);
  }

  if (value.includes("|")) {
    return value.split("|").map((s) => s.trim()).filter(Boolean);
  }

  if (value.includes(",")) {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return [value.trim()].filter(Boolean);
}

function cleanOptionPrefix(value) {
  return String(value)
    .replace(/^[A-Da-d][\).\:\-\s]+/, "")
    .trim();
}

function detectCsvFormat(row) {
  const keys = Object.keys(row || {}).map((k) => k.trim().toLowerCase());

  const isCrowdpurr =
    keys.includes("question") &&
    keys.includes("category") &&
    keys.includes("correctanswer");

  const isTrivNow =
    keys.includes("question") &&
    (
      keys.includes("option a") ||
      keys.includes("option b") ||
      keys.includes("option c") ||
      keys.includes("option d") ||
      keys.includes("correct answer")
    );

  if (isCrowdpurr) return "crowdpurr";
  if (isTrivNow) return "trivnow";
  return "generic";
}

function normalizeCrowdpurrRow(row) {
  const questionText = getValue(row, "question", "Question");
  const category = getValue(row, "category", "Category") || "Imported";
  const correctAnswer = getValue(row, "correctAnswer", "correctanswer", "Answer", "answer");
  const incorrectRaw = getValue(row, "incorrectAnswers", "incorrectanswers");
  const note = getValue(row, "note", "Note");
  const round = getValue(row, "round", "Round");

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
    round: round || null,
    has_image: false,
    image_url: null,
    difficulty: "medium",
    source: "imported",
  };
}

function normalizeTrivNowRow(row) {
  const questionText = getValue(row, "Question", "question");
  const category = getValue(row, "Category", "category") || "Imported";
  const correctAnswer = getValue(
    row,
    "Correct Answer",
    "correct answer",
    "Answer",
    "answer"
  );

  const optionA = getValue(row, "Option A", "option a");
  const optionB = getValue(row, "Option B", "option b");
  const optionC = getValue(row, "Option C", "option c");
  const optionD = getValue(row, "Option D", "option d");
  const funFact = getValue(row, "Fun Fact", "fun fact", "Note", "note");

  if (!questionText || !correctAnswer) return null;

  let questionType = "written";
  let incorrectAnswers = null;
  const answerLower = correctAnswer.toLowerCase();

  const options = [optionA, optionB, optionC, optionD]
    .map(cleanOptionPrefix)
    .filter(Boolean);

  if (answerLower === "true" || answerLower === "false") {
    questionType = "true_false";
    incorrectAnswers = answerLower === "true" ? "False" : "True";
  } else if (options.length > 0) {
    questionType = "multiple_choice";
    const wrongOptions = options.filter((opt) => opt.toLowerCase() !== answerLower);
    incorrectAnswers = wrongOptions.length ? wrongOptions.join(";") : null;
  }

  return {
    category,
    question_text: questionText,
    correct_answer: correctAnswer,
    question_type: questionType,
    incorrect_answers: incorrectAnswers,
    fun_fact: funFact || null,
    round: null,
    has_image: false,
    image_url: null,
    difficulty: "medium",
    source: "imported",
  };
}

function normalizeGenericRow(row) {
  const questionText = getValue(row, "Question", "question");
  const correctAnswer = getValue(row, "Answer", "answer", "Correct Answer", "correctAnswer");
  const category = getValue(row, "Category", "category") || "Imported";
  const incorrectRaw = getValue(
    row,
    "Multiple choice options",
    "multiple choice options",
    "incorrectAnswers",
    "incorrectanswers"
  );
  const funFact = getValue(row, "Fun Fact", "fun fact", "note", "Note");

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
    fun_fact: funFact || null,
    round: null,
    has_image: false,
    image_url: null,
    difficulty: "medium",
    source: "imported",
  };
}

function normalizeRowByFormat(row, format) {
  if (format === "crowdpurr") return normalizeCrowdpurrRow(row);
  if (format === "trivnow") return normalizeTrivNowRow(row);
  return normalizeGenericRow(row);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const rawBuffer = await readFileFromRequest(req);
    const parts = extractMultipartParts(rawBuffer);

    const csvText = parts.file || "";
    const sessionUserId = (parts.sessionUserId || "").trim();

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

    if (parsed.errors?.length) {
      return res.status(400).json({
        error: parsed.errors[0].message || "Failed to parse CSV",
      });
    }

    const rows = parsed.data || [];
    if (!rows.length) {
      return res.status(400).json({ error: "CSV contains no rows" });
    }

    const detectedFormat = detectCsvFormat(rows[0]);

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const rawRow of rows) {
      try {
        const normalized = normalizeRowByFormat(rawRow, detectedFormat);

        if (!normalized?.question_text || !normalized?.correct_answer) {
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
        errors.push(err.message || "Row import failed");
      }
    }

    return res.status(200).json({
      format: detectedFormat,
      imported,
      updated: 0,
      sessions_created: 0,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("import-csv error:", error);
    return res.status(500).json({
      error: error.message || "Failed to import CSV",
    });
  }
}
