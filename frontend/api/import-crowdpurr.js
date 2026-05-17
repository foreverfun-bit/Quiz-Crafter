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

function cleanHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCell(value) {
  return String(value || "").trim();
}

function parseAnswerWithImage(value) {
  const raw = cleanCell(value);
  if (!raw) return { text: "", image: null };

  const parts = raw.split("%%%");

  return {
    text: cleanCell(parts[0]),
    image: parts[1] ? cleanCell(parts[1]) : null,
  };
}

function uniqueAnswerObjects(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const text = cleanCell(item?.text);
    const image = cleanCell(item?.image);
    if (!text && !image) continue;

    const key = `${text.toLowerCase()}|||${image.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push({
      text,
      image: image || null,
    });
  }

  return result;
}

function stripQuestionNumber(question) {
  return cleanCell(question).replace(/^\d+\.\s*/, "");
}

function detectQuestionType(rawType, correctAnswer, questionImage) {
  const type = cleanCell(rawType).toLowerCase();
  const answer = cleanCell(correctAnswer).toLowerCase();

  if (answer === "true" || answer === "false") return "true_false";
  if (type === "text") return "written";
  if (type === "picture") return "picture";
  if (questionImage && type === "text") return "picture";
  if (type === "multiplechoice") return "multiple_choice";

  return "written";
}

function normalizeCrowdpurrArrayRow(row) {
  /*
    Crowdpurr column positions from export:
    A / 0 = Question
    B / 1 = Question Type
    C / 2 = Question Points
    D / 3 = Question Time
    E / 4 = Question Image
    F / 5 = Question Note
    G / 6 = Question Link
    H / 7 = Correct Answer(s)
    I+ / 8+ = Additional Answers / extra answer columns
  */

  const questionRaw = cleanCell(row[0]);
  const questionTypeRaw = cleanCell(row[1]);
  const questionImageRaw = cleanCell(row[4]);
  const noteRaw = cleanCell(row[5]);
  const correctAnswerRaw = cleanCell(row[7]);

  if (!questionRaw) return null;
  if (!correctAnswerRaw) return null;
  if (questionTypeRaw.toLowerCase() === "reorder") return null;

  const correctParsed = parseAnswerWithImage(correctAnswerRaw);

  if (!correctParsed.text) return null;

  const questionType = detectQuestionType(
    questionTypeRaw,
    correctParsed.text,
    questionImageRaw
  );

  const additionalRawValues = row
    .slice(8)
    .map(cleanCell)
    .filter(Boolean);

  const additionalAnswers = uniqueAnswerObjects(
    additionalRawValues.map(parseAnswerWithImage)
  ).filter(
    (answer) =>
      answer.text.toLowerCase() !== correctParsed.text.toLowerCase()
  );

  let incorrectAnswers = null;
  let correctAnswerImage = correctParsed.image || null;

  if (questionType === "true_false") {
    const correctLower = correctParsed.text.toLowerCase();
    incorrectAnswers = JSON.stringify([
      {
        text: correctLower === "true" ? "False" : "True",
        image: null,
      },
    ]);
    correctAnswerImage = null;
  } else if (questionType === "multiple_choice" || questionType === "picture") {
    incorrectAnswers = JSON.stringify(additionalAnswers);
  } else {
    incorrectAnswers = JSON.stringify([]);
  }

  return {
    category: "Imported",
    question_text: stripQuestionNumber(questionRaw),
    correct_answer: correctParsed.text,
    correct_answer_image: correctAnswerImage,
    question_type: questionType,
    incorrect_answers: incorrectAnswers,
    fun_fact: cleanHtml(noteRaw) || null,
    image_url: questionImageRaw || null,
  };
}

function splitByType(questions) {
  return {
    true_false_questions: questions.filter(
      (q) => q.question_type === "true_false"
    ),
    multiple_choice_questions: questions.filter(
      (q) => q.question_type === "multiple_choice"
    ),
    written_questions: questions.filter(
      (q) => q.question_type === "written"
    ),
    picture_questions: questions.filter(
      (q) => q.question_type === "picture"
    ),
  };
}

function buildSessionName(filename) {
  if (!filename) return `Imported Session ${new Date().toLocaleDateString()}`;

  return filename
    .replace(/\.csv$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
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
    const sessionUserId = cleanCell(parts.sessionUserId);
    const originalFilename = parts._filename || "";

    if (!sessionUserId) {
      return res.status(400).json({ error: "Missing session user id" });
    }

    if (!csvText.trim()) {
      return res.status(400).json({ error: "No CSV content found" });
    }

    const parsed = Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
    });

    const rows = Array.isArray(parsed.data) ? parsed.data : [];

    const dataRows = rows.filter((row, index) => {
      if (!Array.isArray(row)) return false;
      if (index === 0) return false;

      const firstCell = cleanCell(row[0]).toLowerCase();
      if (!firstCell) return false;
      if (firstCell === "question") return false;

      return true;
    });

    const normalizedQuestions = dataRows
      .map(normalizeCrowdpurrArrayRow)
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
          category: normalized.category,
          question_text: normalized.question_text,
          correct_answer: normalized.correct_answer,
          question_type: normalized.question_type,
          incorrect_answers: normalized.incorrect_answers,
          fun_fact: normalized.fun_fact,
          correct_answer_image: normalized.correct_answer_image,
          image_url: normalized.image_url,
        };

        Object.keys(insertPayload).forEach((key) => {
          if (
            insertPayload[key] === undefined ||
            insertPayload[key] === null ||
            insertPayload[key] === ""
          ) {
            delete insertPayload[key];
          }
        });

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
        sessionErrorMessage =
          sessionError.message || "Failed to create past session";
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
