const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

exports.config = {
  api: {
    bodyParser: false,
  },
};

const SOURCE_LABELS = {
  auto: "Auto Detect",
  crowdpurr: "CrowdPurr",
  trivianow: "TriviaNow",
  generic: "Generic CSV",
  pdf: "PDF",
};

function readRequestBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractMultipartParts(req, buffer) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return {};

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = {};
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(boundaryBuffer, cursor);
    if (start === -1) break;

    const next = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (next === -1) break;

    let part = buffer.slice(start + boundaryBuffer.length, next);
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const body = part.slice(headerEnd + 4);
      const name = headers.match(/name="([^"]+)"/)?.[1];
      const filename = headers.match(/filename="([^"]*)"/)?.[1];
      const fieldContentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "";

      if (name) {
        if (filename !== undefined) {
          parts[name] = {
            filename,
            contentType: fieldContentType,
            buffer: body,
            text: body.toString("utf8"),
          };
        } else {
          parts[name] = body.toString("utf8").trim();
        }
      }
    }

    cursor = next;
  }

  return parts;
}

function clean(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getValue(row, keys) {
  if (Array.isArray(row)) return "";
  const wanted = keys.map(compactKey);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(compactKey(key)) && clean(value)) return clean(value);
  }
  return "";
}

function splitAnswers(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const text = clean(value);
  if (!text) return [];
  return text
    .split(/\s*(?:;|\||\n|•)\s*/)
    .map(clean)
    .filter(Boolean);
}

function unique(values, correctAnswer = "") {
  const seen = new Set();
  const correctKey = correctAnswer.toLowerCase();
  return values.filter((value) => {
    const cleaned = clean(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || key === correctKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripQuestionNumber(value) {
  return clean(value).replace(/^(?:q(?:uestion)?\s*)?\d+[.)\-:]\s*/i, "");
}

function parseAnswerWithImage(value) {
  const [text, image] = String(value || "").split("%%%");
  return { text: clean(text), image: clean(image) || null };
}

function detectQuestionType(rawType, correctAnswer, wrongAnswers, imageUrl) {
  const type = compactKey(rawType);
  const answer = clean(correctAnswer).toLowerCase();

  if (answer === "true" || answer === "false") return "true_false";
  if (type.includes("truefalse") || type === "tf") return "true_false";
  if (type.includes("multiple") || type.includes("choice") || wrongAnswers.length >= 2) return "multiple_choice";
  if (type.includes("picture") || imageUrl) return "picture";
  return "written";
}

function normalizeCrowdpurrRows(rows) {
  const dataRows = rows.filter((row) => Array.isArray(row) && clean(row[0]) && compactKey(row[0]) !== "question");

  return dataRows.map((row) => {
    const question = stripQuestionNumber(row[0]);
    const rawType = clean(row[1]);
    const imageUrl = clean(row[4]);
    const funFact = clean(row[5]) || null;
    const parsedCorrect = parseAnswerWithImage(row[7]);
    const wrongAnswers = unique(row.slice(8).map((value) => parseAnswerWithImage(value).text), parsedCorrect.text);
    const questionType = detectQuestionType(rawType, parsedCorrect.text, wrongAnswers, imageUrl);

    return normalizeRecord({
      category: "Imported",
      question_text: question,
      correct_answer: parsedCorrect.text,
      question_type: questionType,
      incorrect_answers: wrongAnswers,
      fun_fact: funFact,
      image_url: imageUrl,
    });
  }).filter(Boolean);
}

function normalizeObjectRows(rows, requestedSource) {
  return rows.map((row) => {
    const question = getValue(row, [
      "Question",
      "Question Text",
      "Prompt",
      "Trivia Question",
      "Question Title",
      "Text",
    ]);
    const correctAnswer = getValue(row, [
      "Correct Answer(s)",
      "Correct Answer",
      "Answer",
      "Correct",
      "Correct Option",
      "Right Answer",
    ]);
    const category = getValue(row, ["Category", "Round", "Topic", "Subject", "Tags"]);
    const rawType = getValue(row, ["Question Type", "Type", "Format", "Kind"]);
    const funFact = getValue(row, ["Question Note", "Fun Fact", "Explanation", "Fact", "Notes"]);
    const imageUrl = getValue(row, ["Question Image URL", "Image URL", "Image", "Picture", "Media URL"]);

    const optionValues = [
      getValue(row, ["Additional Answers", "Incorrect Answers", "Wrong Answers", "Distractors"]),
      getValue(row, ["Option A", "Answer A", "Choice A"]),
      getValue(row, ["Option B", "Answer B", "Choice B"]),
      getValue(row, ["Option C", "Answer C", "Choice C"]),
      getValue(row, ["Option D", "Answer D", "Choice D"]),
      getValue(row, ["Option 1", "Choice 1"]),
      getValue(row, ["Option 2", "Choice 2"]),
      getValue(row, ["Option 3", "Choice 3"]),
      getValue(row, ["Option 4", "Choice 4"]),
    ];

    const wrongAnswers = unique(optionValues.flatMap(splitAnswers), correctAnswer);
    const questionType = detectQuestionType(rawType, correctAnswer, wrongAnswers, imageUrl);

    return normalizeRecord({
      category: category || (requestedSource === "trivianow" ? "TriviaNow" : "Imported"),
      question_text: stripQuestionNumber(question),
      correct_answer: correctAnswer,
      question_type: questionType,
      incorrect_answers: wrongAnswers,
      fun_fact: funFact || null,
      image_url: imageUrl,
    });
  }).filter(Boolean);
}

function normalizeRecord(record) {
  const questionText = clean(record.question_text);
  const correctAnswer = clean(record.correct_answer);
  if (!questionText || !correctAnswer) return null;

  let questionType = record.question_type || "written";
  let wrongAnswers = unique(record.incorrect_answers || [], correctAnswer);

  if (questionType === "true_false") {
    const answer = correctAnswer.toLowerCase() === "false" ? "False" : "True";
    return {
      category: clean(record.category) || "Imported",
      question_text: questionText,
      correct_answer: answer,
      question_type: "true_false",
      incorrect_answers: answer === "True" ? "False" : "True",
      fun_fact: clean(record.fun_fact) || null,
      image_url: null,
      has_image: false,
      source: "imported",
    };
  }

  if (questionType === "multiple_choice" && wrongAnswers.length < 2) questionType = "written";

  return {
    category: clean(record.category) || "Imported",
    question_text: questionText,
    correct_answer: correctAnswer,
    question_type: questionType,
    incorrect_answers: questionType === "multiple_choice" ? wrongAnswers.join("; ") : null,
    fun_fact: clean(record.fun_fact) || null,
    image_url: clean(record.image_url) || null,
    has_image: questionType === "picture" || Boolean(clean(record.image_url)),
    source: "imported",
  };
}

function detectCsvSource(rows, requestedSource) {
  if (requestedSource && requestedSource !== "auto") return requestedSource;
  const firstObject = rows.find((row) => row && !Array.isArray(row));
  const headers = Object.keys(firstObject || {}).map(compactKey);

  if (headers.includes("correctanswers") || headers.includes("questionnote")) return "crowdpurr";
  if (headers.some((h) => h.includes("trivianow")) || headers.includes("roundname")) return "trivianow";
  return "generic";
}

function parseCsv(text, requestedSource) {
  const objectParsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => clean(header),
  });
  const objectRows = Array.isArray(objectParsed.data) ? objectParsed.data : [];
  const source = detectCsvSource(objectRows, requestedSource);

  if (source === "crowdpurr") {
    const arrayParsed = Papa.parse(text, { header: false, skipEmptyLines: true });
    const positionalQuestions = normalizeCrowdpurrRows(arrayParsed.data || []);
    if (positionalQuestions.length) {
      return {
        source,
        columns: arrayParsed.data?.[0] || objectParsed.meta?.fields || [],
        questions: positionalQuestions,
        warnings: (arrayParsed.errors || []).map((error) => error.message),
      };
    }
  }

  return {
    source,
    columns: objectParsed.meta?.fields || [],
    questions: normalizeObjectRows(objectRows, source),
    warnings: (objectParsed.errors || []).map((error) => error.message),
  };
}

async function parsePdf(buffer, requestedSource) {
  let text = "";
  try {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(buffer);
    text = clean(parsed.text || "");
  } catch (error) {
    throw new Error(`Could not read PDF text: ${error.message}`);
  }

  const aiQuestions = await extractQuestionsWithAi(text);
  if (aiQuestions.length) {
    return {
      source: requestedSource === "auto" ? "pdf" : requestedSource,
      columns: ["PDF Text"],
      questions: aiQuestions.map(normalizeRecord).filter(Boolean),
      warnings: [],
    };
  }

  return {
    source: "pdf",
    columns: ["PDF Text"],
    questions: parseQuestionsFromText(text),
    warnings: ["Used simple PDF text parsing. Review the preview before importing."],
  };
}

async function extractQuestionsWithAi(text) {
  if (!process.env.OPENAI_API_KEY || !text) return [];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Extract trivia questions from messy PDF text. Return strict JSON only.",
        },
        {
          role: "user",
          content: `Extract up to 150 trivia questions from this text. Return {"questions":[{"category":"Imported","question_text":"...","correct_answer":"...","question_type":"true_false|multiple_choice|written|picture","incorrect_answers":["..."],"fun_fact":"..."}]}\n\nTEXT:\n${text.slice(0, 60000)}`,
        },
      ],
    }),
  });

  if (!response.ok) return [];
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.questions) ? parsed.questions : [];
}

function parseQuestionsFromText(text) {
  const lines = String(text || "").split(/\n+/).map(clean).filter(Boolean);
  const questions = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inlineMatch = line.match(/^(?:q[:.)\-]?\s*)?(.*\?)\s*(?:a(?:nswer)?[:.)\-]\s*)(.+)$/i);
    if (inlineMatch) {
      questions.push(normalizeRecord({
        category: "PDF",
        question_text: inlineMatch[1],
        correct_answer: inlineMatch[2],
        question_type: "written",
        incorrect_answers: [],
      }));
      continue;
    }

    if (/\?$/.test(line) && lines[i + 1]) {
      const answerLine = lines[i + 1].replace(/^a(?:nswer)?[:.)\-]\s*/i, "");
      questions.push(normalizeRecord({
        category: "PDF",
        question_text: line,
        correct_answer: answerLine,
        question_type: "written",
        incorrect_answers: [],
      }));
      i += 1;
    }
  }

  return questions.filter(Boolean);
}

async function parseUploadedFile(file, requestedSource) {
  const filename = file.filename || "";
  const lower = filename.toLowerCase();
  const source = requestedSource || "auto";

  if (lower.endsWith(".pdf") || file.contentType.includes("pdf")) {
    return parsePdf(file.buffer, source);
  }

  return parseCsv(file.text, source);
}

function groupByType(questions) {
  return {
    true_false_questions: questions.filter((q) => q.question_type === "true_false"),
    multiple_choice_questions: questions.filter((q) => q.question_type === "multiple_choice"),
    written_questions: questions.filter((q) => q.question_type === "written"),
    picture_questions: questions.filter((q) => q.question_type === "picture"),
  };
}

function buildSessionName(filename) {
  return clean(filename)
    .replace(/\.(csv|tsv|txt|pdf)$/i, "")
    .replace(/[_-]+/g, " ") || `Imported Session ${new Date().toLocaleDateString()}`;
}

async function importQuestions({ questions, userId, filename }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl) throw new Error("Missing Supabase URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const question of questions) {
    try {
      const { data: existing, error: lookupError } = await supabase
        .from("questions")
        .select("id")
        .eq("question_text", question.question_text)
        .limit(1)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (existing?.id) {
        skipped += 1;
        continue;
      }

      const payload = { ...question, user_id: userId };
      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined || payload[key] === "") delete payload[key];
      });

      const { error: insertError } = await supabase.from("questions").insert(payload);
      if (insertError) throw insertError;
      imported += 1;
    } catch (error) {
      errors.push(error.message || "Question import failed");
    }
  }

  let sessionsCreated = 0;
  let sessionId = null;
  let sessionName = null;
  let sessionError = null;

  try {
    const grouped = groupByType(questions);
    const builtSessionName = buildSessionName(filename);
    const { data, error } = await supabase
      .from("sessions")
      .insert({
        user_id: userId,
        name: builtSessionName,
        session_name: builtSessionName,
        is_past: true,
        ...grouped,
      })
      .select()
      .single();

    if (error) throw error;
    sessionsCreated = 1;
    sessionId = data.id;
    sessionName = data.name || data.session_name;
  } catch (error) {
    sessionError = error.message || "Failed to create past session";
  }

  return { imported, skipped, errors, sessionsCreated, sessionId, sessionName, sessionError };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const buffer = await readRequestBuffer(req);
    const parts = extractMultipartParts(req, buffer);
    const file = parts.file;
    const action = clean(parts.action || "preview");
    const requestedSource = clean(parts.source || "auto").toLowerCase();
    const userId = clean(parts.sessionUserId);

    if (!file?.buffer?.length) return res.status(400).json({ error: "No file found" });

    const parsed = await parseUploadedFile(file, requestedSource);
    const questions = parsed.questions || [];

    if (action === "preview") {
      return res.status(200).json({
        format: SOURCE_LABELS[parsed.source] || parsed.source || "Imported",
        source: parsed.source,
        columns: parsed.columns || [],
        row_count: questions.length,
        preview: questions.slice(0, 8).map((question) => ({
          question: question.question_text,
          category: question.category,
          correctAnswer: question.correct_answer,
          incorrectAnswers: question.incorrect_answers || "",
          questionType: question.question_type,
        })),
        warnings: parsed.warnings || [],
      });
    }

    if (!userId) return res.status(400).json({ error: "Missing session user id" });
    if (!questions.length) return res.status(400).json({ error: "No valid questions found" });

    const result = await importQuestions({ questions, userId, filename: file.filename });

    return res.status(200).json({
      format: SOURCE_LABELS[parsed.source] || parsed.source || "Imported",
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
      sessions_created: result.sessionsCreated,
      session_id: result.sessionId,
      session_name: result.sessionName,
      session_error: result.sessionError,
      total_session_questions: questions.length,
    });
  } catch (error) {
    console.error("import-questions error:", error);
    return res.status(500).json({ error: error.message || "Import failed" });
  }
};
