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

    const filenameMatch = part.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      result._filename = filenameMatch[1];
    }
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

function normalizeCrowdpurrRow(row) {
  const questionText = getValue(row, ["Question"]);
  const questionTypeRaw = getValue(row, ["Question Type"]).toLowerCase();
  const note = cleanHtml(getValue(row, ["Question Note"]));
  const categoryOrRound = getValue(row, ["Correct Answer"]);
  const additionalAnswers = getValue(row, ["Additional Answers"]);

  if (!questionText) return null;

  // Skip round/category header rows like "Round 1 Category"
  if (questionTypeRaw === "reorder") {
    return null;
  }

  let questionType = "written";
  let correctAnswer = categoryOrRound;
  let incorrectAnswers = null;
  let category = "Imported";

  if (questionTypeRaw === "multiplechoice") {
    questionType = "multiple_choice";

    const allAnswers = [categoryOrRound, ...splitOptions(additionalAnswers)].filter(Boolean);

    if (allAnswers.length > 0) {
      correctAnswer = allAnswers[0];
      incorrectAnswers = allAnswers.slice(1).join(";");
    }
  } else if (questionTypeRaw === "text") {
    questionType = "written";
    correctAnswer = categoryOrRound;
  }

  const answerLower = String(correctAnswer || "").toLowerCase();
  if (answerLower === "true" || answerLower === "false") {
    questionType = "true_false";
    incorrectAnswers = answerLower === "true" ? "False" : "True";
  }

  if (!correctAnswer) return null;

  return {
    category,
    question_text: questionText,
    correct_answer: correctAnswer,
    question_type: questionType,
    incorrect_answers: incorrectAnswers || null,
    fun_fact: note || null,
  };
}

function splitByType(questions) {
  return {
    true_false_questions: questions.filter((q) => q.question_type === "true_false"),
    multiple_choice_questions: questions.filter((q) => q.question_type === "multiple_choice"),
    written_questions: questions.filter((q) => q.question_type === "written"),
    picture_questions: [],
  };
}

function buildSessionName(filename) {
  if (!filename) return `Imported Session ${new Date().toLocaleDateString()}`;
  return filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim();
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
    const originalFilename = parts._filename || "";

    if (!sessionUserId) {
      return res.status(400).json({ error: "Missing session user id" });
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: "No CSV content found" });
    }

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => String(header || "").trim(),
    });

    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const normalizedQuestions = rows
      .map(normalizeCrowdpurrRow)
      .filter(Boolean);

    if (!normalizedQuestions.length) {
      return res.status(400).json({
        error: "No valid questions found in CSV",
      });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const normalized of normalizedQuestions) {
      try {
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
        });

        if (insertError) throw insertError;

        imported += 1;
      } catch (err) {
        console.error("QUESTION IMPORT ERROR:", err);
        errors.push(err.message || "Question import failed");
      }
    }

    const grouped = splitByType(normalizedQuestions);

    const { data: sessionData, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        user_id: sessionUserId,
        name: buildSessionName(originalFilename),
        is_past: true,
        true_false_questions: grouped.true_false_questions,
        multiple_choice_questions: grouped.multiple_choice_questions,
        written_questions: grouped.written_questions,
        picture_questions: grouped.picture_questions,
      })
      .select()
      .single();

    if (sessionError) {
      return res.status(500).json({
        error: sessionError.message || "Questions imported, but failed to create past session",
        imported,
        skipped,
        errors,
      });
    }

    return res.status(200).json({
      format: "crowdpurr",
      imported,
      skipped,
      errors,
      sessions_created: 1,
      session_id: sessionData.id,
      session_name: sessionData.name,
      total_session_questions: normalizedQuestions.length,
    });
  } catch (error) {
    console.error("IMPORT ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to import Crowdpurr CSV",
    });
  }
};
