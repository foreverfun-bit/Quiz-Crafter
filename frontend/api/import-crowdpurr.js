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

function normalizeCrowdpurrRow(row) {
  const questionText = getValue(row, ["Question"]);
  const questionTypeRaw = getValue(row, ["Question Type"]).toLowerCase();
  const note = cleanHtml(getValue(row, ["Question Note"]));
  const correctAnswerRaw = getValue(row, ["Correct Answer(s)"]);
  const additionalAnswersRaw = getValue(row, ["Additional Answers"]);
  const questionImageUrl = getValue(row, ["Question Image URL"]);

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
  let correctAnswerImage = correctParsed.image || null;
  let incorrectAnswers = null;
  let category = "Imported";
  let imageUrl = questionImageUrl || null;

  if (questionTypeRaw === "multiplechoice") {
    questionType = "multiple_choice";
    incorrectAnswers = allExtraAnswers.length
      ? JSON.stringify(allExtraAnswers)
      : null;
  } else if (questionTypeRaw === "text") {
    questionType = "written";
  }

  const answerLower = String(correctAnswer || "").toLowerCase();
  if (answerLower === "true" || answerLower === "false") {
    questionType = "true_false";
    incorrectAnswers = JSON.stringify([
      {
        text: answerLower === "true" ? "False" : "True",
        image: null,
      },
    ]);
    correctAnswerImage = null;
  }

  if (!correctAnswer) return null;

  return {
    category,
    question_text: questionText,
    correct_answer: correctAnswer,
    correct_answer_image: correctAnswerImage,
    question_type: questionType,
    incorrect_answers: incorrectAnswers,
    fun_fact: note || null,
    image_url: imageUrl,
  };
}

function splitByType(questions) {
  return {
    true_false_questions: questions.filter((q) => q.question_type === "true_false"),
    multiple_choice_questions: questions.filter((q) => q.question_type === "multiple_choice"),
    written_questions: questions.filter((q) => q.question_type === "written"),
    picture_questions: questions.filter((q) => q.question_type === "picture"),
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

        const insertPayload = {
          user_id: sessionUserId,
          question_text: normalized.question_text,
          correct_answer: normalized.correct_answer,
        };

        if (normalized.category) insertPayload.category = normalized.category;
        if (normalized.question_type) insertPayload.question_type = normalized.question_type;
        if (normalized.incorrect_answers) insertPayload.incorrect_answers = normalized.incorrect_answers;
        if (normalized.fun_fact) insertPayload.fun_fact = normalized.fun_fact;
        if (normalized.correct_answer_image) insertPayload.correct_answer_image = normalized.correct_answer_image;
        if (normalized.image_url) insertPayload.image_url = normalized.image_url;

        const { error: insertError } = await supabase
          .from("questions")
          .insert(insertPayload);

        if (insertError) throw insertError;

        imported += 1;
      } catch (err) {
        console.error("QUESTION IMPORT ERROR:", err);
        errors.push(err.message || "Question import failed");
      }
    }

    const grouped = splitByType(normalizedQuestions);

    let sessionsCreated = 0;
    let sessionId = null;
    let sessionName = null;
    let sessionErrorMessage = null;

    try {
      const builtSessionName = buildSessionName(originalFilename);

      const sessionPayload = {
        user_id: sessionUserId,
        name: builtSessionName,
        session_name: builtSessionName,
        is_past: true,
        true_false_questions: grouped.true_false_questions,
        multiple_choice_questions: grouped.multiple_choice_questions,
        written_questions: grouped.written_questions,
        picture_questions: grouped.picture_questions,
      };

      const { data: sessionData, error: sessionError } = await supabase
        .from("sessions")
        .insert(sessionPayload)
        .select()
        .single();

      if (sessionError) {
        sessionErrorMessage = sessionError.message || "Failed to create past session";
      } else {
        sessionsCreated = 1;
        sessionId = sessionData.id;
        sessionName = sessionData.name || sessionData.session_name;
      }
    } catch (err) {
      sessionErrorMessage = err.message || "Failed to create past session";
    }

    return res.status(200).json({
      format: "crowdpurr",
      imported,
      skipped,
      errors,
      sessions_created: sessionsCreated,
      session_id: sessionId,
      session_name: sessionName,
      session_error: sessionErrorMessage,
      total_session_questions: normalizedQuestions.length,
    });
  } catch (error) {
    console.error("IMPORT ERROR:", error);
    return res.status(500).json({
      error: error.message || "Failed to import Crowdpurr CSV",
    });
  }
};
