const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

const SOURCE_LABELS = {
  auto: "Auto Detect",
  crowdpurr: "CrowdPurr",
  trivianow: "TriviaNow",
  generic: "Generic CSV",
  pdf: "PDF",
};

function readRequestBuffer(req) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    if (typeof req.body === "string") return resolve(Buffer.from(req.body));

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function trimCrlf(buffer) {
  let output = buffer;
  while (output.length >= 2 && output.slice(0, 2).toString() === "\r\n") output = output.slice(2);
  while (output.length >= 2 && output.slice(-2).toString() === "\r\n") output = output.slice(0, -2);
  return output;
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

    const rawPart = trimCrlf(buffer.slice(start + boundaryBuffer.length, next));
    const headerEnd = rawPart.indexOf(Buffer.from("\r\n\r\n"));

    if (headerEnd !== -1) {
      const headers = rawPart.slice(0, headerEnd).toString("utf8");
      const body = trimCrlf(rawPart.slice(headerEnd + 4));
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

function extractJsonParts(req, buffer) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("application/json")) return null;

  const parsed = JSON.parse(buffer.toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object") return {};

  const pdfText = String(parsed.pdfText || parsed.text || "");
  return {
    action: parsed.action,
    source: parsed.source,
    sessionUserId: parsed.sessionUserId,
    file: pdfText
      ? {
        filename: parsed.filename || "Imported PDF.pdf",
        contentType: parsed.contentType || "application/pdf",
        buffer: Buffer.from(pdfText, "utf8"),
        text: pdfText,
        extractedText: true,
      }
      : null,
  };
}

function clean(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
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
    .split(/\s*(?:;|\||\n|\*)\s*/)
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

function firstImageUrl(...values) {
  return values.map(clean).find((value) => /^https?:\/\//i.test(value) || /^data:image\//i.test(value)) || "";
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

function getRoundSortValue(value, fallback) {
  const text = clean(value);
  const numberMatch = text.match(/\d+/);
  if (numberMatch) return Number(numberMatch[0]);
  return fallback;
}

function compareRoundNames(a, b) {
  const roundA = Number.isFinite(a.round_order) ? a.round_order : getRoundSortValue(a.round_name || a.category, a.source_order || 0);
  const roundB = Number.isFinite(b.round_order) ? b.round_order : getRoundSortValue(b.round_name || b.category, b.source_order || 0);
  if (roundA !== roundB) return roundA - roundB;

  const nameCompare = clean(a.round_name || a.category).localeCompare(clean(b.round_name || b.category), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameCompare !== 0) return nameCompare;

  return (a.source_order || 0) - (b.source_order || 0);
}

function sortQuestionsByRound(questions) {
  return [...questions].sort(compareRoundNames);
}

function normalizePdfText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean)
    .join("\n");
}

function normalizeRecord(record) {
  const questionText = clean(record.question_text);
  const correctAnswer = clean(record.correct_answer);
  if (!questionText || !correctAnswer) return null;

  let questionType = record.question_type || "written";
  const wrongAnswers = unique(record.incorrect_answers || [], correctAnswer);
  const roundName = clean(record.round_name || record.category) || "Imported";
  const base = {
    category: clean(record.category),
    round_name: roundName,
    round_order: Number.isFinite(Number(record.round_order)) ? Number(record.round_order) : getRoundSortValue(roundName, record.source_order || 0),
    source_order: Number.isFinite(Number(record.source_order)) ? Number(record.source_order) : 0,
    import_order: Number.isFinite(Number(record.import_order)) ? Number(record.import_order) : Number(record.source_order || 0),
  };

  if (questionType === "true_false") {
    const answer = correctAnswer.toLowerCase() === "false" ? "False" : "True";
    return {
      ...base,
      question_text: questionText,
      correct_answer: answer,
      question_type: "true_false",
      incorrect_answers: answer === "True" ? "False" : "True",
      fun_fact: clean(record.fun_fact) || null,
      image_url: clean(record.image_url) || null,
      correct_answer_image: clean(record.correct_answer_image) || null,
    };
  }

  if (questionType === "multiple_choice" && wrongAnswers.length < 2) questionType = "written";

  return {
    ...base,
    question_text: questionText,
    correct_answer: correctAnswer,
    question_type: questionType,
    incorrect_answers: questionType === "multiple_choice" ? wrongAnswers.join("; ") : null,
    fun_fact: clean(record.fun_fact) || null,
    image_url: clean(record.image_url) || null,
    correct_answer_image: clean(record.correct_answer_image) || null,
  };
}

function normalizeCrowdpurrRows(rows) {
  const dataRows = rows.filter((row) => Array.isArray(row) && clean(row[0]) && compactKey(row[0]) !== "question");

  return dataRows.map((row, index) => {
    const question = stripQuestionNumber(row[0]);
    const rawType = clean(row[1]);
    const imageUrl = firstImageUrl(row[4]);
    const funFact = clean(row[5]) || null;
    const parsedCorrect = parseAnswerWithImage(row[7]);
    const wrongAnswers = unique(row.slice(8).map((value) => parseAnswerWithImage(value).text), parsedCorrect.text);
    const questionType = detectQuestionType(rawType, parsedCorrect.text, wrongAnswers, imageUrl);

    return normalizeRecord({
      category: "",
      round_name: "Imported",
      round_order: 1,
      source_order: index + 1,
      import_order: index + 1,
      question_text: question,
      correct_answer: parsedCorrect.text,
      question_type: questionType,
      incorrect_answers: wrongAnswers,
      fun_fact: funFact,
      image_url: imageUrl,
      correct_answer_image: parsedCorrect.image,
    });
  }).filter(Boolean);
}

function normalizeObjectRows(rows, requestedSource) {
  const roundOrderByName = new Map();

  const getStableRoundOrder = (roundName, explicitRoundOrder) => {
    if (explicitRoundOrder) return getRoundSortValue(explicitRoundOrder, roundOrderByName.size + 1);
    const key = compactKey(roundName || "Imported");
    if (!roundOrderByName.has(key)) roundOrderByName.set(key, roundOrderByName.size + 1);
    return roundOrderByName.get(key);
  };

  return rows.map((row, index) => {
    const question = getValue(row, ["Question", "Question Text", "Prompt", "Trivia Question", "Question Title", "Text"]);
    const correctAnswer = getValue(row, ["Correct Answer(s)", "Correct Answer", "Answer", "Correct", "Correct Option", "Right Answer"]);
    const roundName = getValue(row, ["Round", "Round Name", "RoundName", "Round Title", "Game Round"]);
    const category = getValue(row, ["Category", "Topic", "Subject", "Tags"]);
    const rawType = getValue(row, ["Question Type", "Type", "Format", "Kind"]);
    const funFact = getValue(row, ["Question Note", "Fun Fact", "Explanation", "Fact", "Notes"]);
    const imageUrl = firstImageUrl(getValue(row, ["Question Image URL", "Question Image", "Image URL", "Image", "Picture", "Photo", "Media URL", "Media", "Question Media"]));
    const correctAnswerImage = firstImageUrl(getValue(row, ["Correct Answer Image URL", "Correct Answer Image", "Answer Image URL", "Answer Image", "Correct Image", "Correct Photo"]));
    const explicitRoundOrder = getValue(row, ["Round Order", "Round Number", "Round #", "Round No"]);
    const explicitQuestionOrder = getValue(row, ["Question Order", "Question Number", "Question #", "Order"]);

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
    const fallbackRoundName = requestedSource === "trivianow" ? "TriviaNow" : "Imported";
    const finalRoundName = roundName || fallbackRoundName;
    const sourceOrder = explicitQuestionOrder ? getRoundSortValue(explicitQuestionOrder, index + 1) : index + 1;

    return normalizeRecord({
      category,
      round_name: finalRoundName,
      round_order: getStableRoundOrder(finalRoundName, explicitRoundOrder),
      source_order: sourceOrder,
      import_order: index + 1,
      question_text: stripQuestionNumber(question),
      correct_answer: correctAnswer,
      question_type: questionType,
      incorrect_answers: wrongAnswers,
      fun_fact: funFact || null,
      image_url: imageUrl,
      correct_answer_image: correctAnswerImage,
    });
  }).filter(Boolean);
}

function detectCsvSource(rows, requestedSource) {
  if (requestedSource && requestedSource !== "auto") return requestedSource;
  const firstObject = rows.find((row) => row && !Array.isArray(row));
  const headers = Object.keys(firstObject || {}).map(compactKey);

  if (headers.includes("correctanswers") || headers.includes("questionnote")) return "crowdpurr";
  if (headers.some((h) => h.includes("trivianow")) || headers.includes("roundname") || headers.includes("round")) return "trivianow";
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
        questions: sortQuestionsByRound(positionalQuestions),
        warnings: (arrayParsed.errors || []).map((error) => error.message),
      };
    }
  }

  return {
    source,
    columns: objectParsed.meta?.fields || [],
    questions: sortQuestionsByRound(normalizeObjectRows(objectRows, source)),
    warnings: (objectParsed.errors || []).map((error) => error.message),
  };
}

function loadPdfParser() {
  try {
    return require("pdf-parse/lib/pdf-parse.js");
  } catch {
    return require("pdf-parse");
  }
}

async function parsePdf(buffer, requestedSource) {
  let text = "";
  try {
    const pdfParse = loadPdfParser();
    const parsed = await pdfParse(buffer);
    text = normalizePdfText(parsed.text || "");
  } catch (error) {
    throw new Error(`Could not read PDF text. If this is a scanned/image-only PDF, export it as CSV or text first. ${error.message}`);
  }

  return parsePdfText(text, requestedSource);
}

async function parsePdfText(text, requestedSource, extraWarnings = []) {
  const normalizedText = normalizePdfText(text);
  const aiQuestions = await extractQuestionsWithAi(text);
  if (aiQuestions.length) {
    return {
      source: requestedSource === "auto" ? "pdf" : requestedSource,
      columns: ["PDF Text"],
      questions: sortQuestionsByRound(aiQuestions.map((question, index) => normalizeRecord({ ...question, source_order: question.source_order || index + 1 })).filter(Boolean)),
      warnings: extraWarnings,
    };
  }

  const canvaQuestions = parseCanvaTriviaText(normalizedText);
  if (canvaQuestions.length) {
    return {
      source: requestedSource === "auto" ? "pdf" : requestedSource,
      columns: ["PDF Text"],
      questions: sortQuestionsByRound(canvaQuestions),
      warnings: [...extraWarnings, "Used Canva-style PDF text parsing. Review the preview before importing."],
    };
  }

  return {
    source: "pdf",
    columns: ["PDF Text"],
    questions: sortQuestionsByRound(parseQuestionsFromText(normalizedText)),
    warnings: [...extraWarnings, "Used simple PDF text parsing. Review the preview before importing."],
  };
}

async function extractQuestionsWithAi(text) {
  if (!process.env.OPENAI_API_KEY || !text) return [];

  const chunks = splitPdfTextForAi(text);
  if (chunks.length > 1) {
    const settled = await Promise.all(chunks.map((chunk) => callQuestionExtractionAi(chunk, 35, 18000)));
    return settled.flat();
  }

  return callQuestionExtractionAi(text, 80, 26000);
}

function splitPdfTextForAi(text) {
  const lines = normalizePdfText(text).split(/\n+/).filter(Boolean);
  const chunks = [];
  let current = [];

  lines.forEach((line) => {
    if (current.length && isRoundHeading(line)) {
      chunks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  });
  if (current.length) chunks.push(current.join("\n"));

  const usefulChunks = chunks.filter((chunk) => /(?:\?|true or false|yes or no|bonus|[abcd]\n)/i.test(chunk));
  if (usefulChunks.length < 2 || normalizePdfText(text).length < 3000) return [text];
  return usefulChunks;
}

async function callQuestionExtractionAi(text, limit, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.1,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Extract trivia questions from messy Canva/PDF text for a trivia host. Return strict JSON only." },
          {
            role: "user",
            content: `Extract up to ${limit} trivia questions from this Canva/PDF text.

Rules:
- Text may be duplicated because Canva exports animation states or repeated slides; remove duplicate copies of the same question.
- Preserve round order and question order.
- Recognize headings like "Easy Round", "ROUND 1 (25 POINTS)", "BONUS", "Average Round", and "Difficult Round".
- Ignore rules pages, winner/drumroll slides, icons pages, and decorative text.
- For true/false or yes/no questions, use question_type "true_false" and correct_answer "True" or "False" when the answer can be inferred from the answer/fun fact text. If the answer cannot be inferred, omit that question.
- For multiple choice, collect choices as incorrect_answers excluding correct_answer. Infer the correct answer from answer text, fun facts, or common trivia knowledge when it is clear.
- Fun facts often follow "FUN FACT"; attach the fun fact to the previous question.
- Media/picture questions are not a separate type unless no written prompt exists; keep them as written if the answer can be extracted.

Return {"questions":[{"category":"","round_name":"Round 1","round_order":1,"source_order":1,"question_text":"...","correct_answer":"...","question_type":"true_false|multiple_choice|written|picture","incorrect_answers":["..."],"fun_fact":"..."}]}

TEXT:
${text.slice(0, 70000)}`,
          },
        ],
      }),
    });

    if (!response.ok) return [];
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.questions) ? parsed.questions : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function isPdfHeading(line) {
  const text = clean(line);
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  return /^(trivia night|rules!?|bonus rules!?|drumroll|please!|and the winner|insert name|icons page|fun factfun fact|truefalse|truetrue|falsefalse)$/i.test(text);
}

function isRoundHeading(line) {
  return /^(easy|average|difficult)\s+round$/i.test(clean(line)) || /^round\s+\d+/i.test(clean(line));
}

function getRoundFromHeading(line, currentRound) {
  const text = clean(line);
  const numbered = text.match(/^round\s+(\d+)/i);
  if (numbered) return { name: `Round ${Number(numbered[1])}`, order: Number(numbered[1]) };
  if (/^easy round$/i.test(text)) return { name: "Round 1", order: 1 };
  if (/^average round$/i.test(text)) return { name: "Round 2", order: 2 };
  if (/^difficult round$/i.test(text)) return { name: "Round 3", order: 3 };
  return currentRound;
}

function blockEquals(lines, aStart, bStart, length) {
  for (let offset = 0; offset < length; offset += 1) {
    if (compactKey(lines[aStart + offset]) !== compactKey(lines[bStart + offset])) return false;
  }
  return true;
}

function findRepeatedBlockLength(lines, start) {
  for (let length = 1; length <= 6; length += 1) {
    if (start + length * 2 > lines.length) continue;
    const text = clean(lines.slice(start, start + length).join(" "));
    if (text.length < 14 || isPdfHeading(text) || isRoundHeading(text)) continue;
    if (blockEquals(lines, start, start + length, length)) return length;
  }
  return 0;
}

function startsWithQuestionBlock(lines, start, questionLines) {
  if (start + questionLines.length > lines.length) return false;
  return questionLines.every((line, index) => compactKey(lines[start + index]) === compactKey(line));
}

function looksLikeRepeatedQuestionStart(lines, start) {
  return findRepeatedBlockLength(lines, start) > 0;
}

function looksLikeQuestionLead(line) {
  return /^(what|which|who|where|when|why|how|did|is|was|relative to|the eiffel tower|alaska had)\b/i.test(clean(line));
}

function collectFunFact(lines, start) {
  let cursor = start;
  if (!/^fun fact$/i.test(clean(lines[cursor] || ""))) return { funFact: "", next: start };
  cursor += 1;
  const factLines = [];
  while (cursor < lines.length) {
    const line = clean(lines[cursor]);
    if (!line || isRoundHeading(line) || /^bonus$/i.test(line) || /\?$/.test(line)) break;
    if (/^(yes or no|true or false)$/i.test(line)) break;
    factLines.push(line);
    cursor += 1;
  }
  return { funFact: factLines.join(" "), next: cursor };
}

function skipTrailingFactBlock(lines, start) {
  for (let cursor = start; cursor < Math.min(lines.length, start + 12); cursor += 1) {
    const line = clean(lines[cursor]);
    if (/^fun fact$/i.test(line)) return cursor + 1;
    if (cursor > start && (looksLikeRepeatedQuestionStart(lines, cursor) || looksLikeQuestionLead(line))) return start;
    if (isRoundHeading(line) || /^bonus$/i.test(line)) return start;
  }
  return start;
}

function parseCanvaTriviaText(text) {
  const lines = normalizePdfText(text).split(/\n+/).map(cleanLine).filter(Boolean);
  const questions = [];
  const seen = new Set();
  const seenQuestions = new Set();
  let currentRound = { name: "PDF", order: 1 };
  let sourceOrder = 1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = clean(lines[i]);
    if (isRoundHeading(line)) {
      currentRound = getRoundFromHeading(line, currentRound);
      continue;
    }
    if (/^bonus$/i.test(line)) {
      const questionText = clean(lines[i + 1]);
      const answer = clean(lines[i + 2]);
      if (questionText && /\?$/.test(questionText) && answer && !isRoundHeading(answer) && !isPdfHeading(answer)) {
        const key = compactKey(`${currentRound.name}:bonus:${questionText}:${answer}`);
        if (!seen.has(key)) {
          seen.add(key);
          const normalized = normalizeRecord({
            category: "Bonus",
            round_name: currentRound.name,
            round_order: currentRound.order,
            source_order: sourceOrder,
            import_order: sourceOrder,
            question_text: questionText,
            correct_answer: answer,
            question_type: "written",
            incorrect_answers: [],
          });
          if (normalized) questions.push(normalized);
          sourceOrder += 1;
        }
      }
      continue;
    }
    if (isPdfHeading(line) || /^fun fact$/i.test(line) || /^(yes or no|true or false)$/i.test(line)) continue;
    if (currentRound.order < 3) continue;

    let questionLines = [];
    let answerStart = -1;
    const repeatedLength = findRepeatedBlockLength(lines, i);
    if (repeatedLength) {
      questionLines = lines.slice(i, i + repeatedLength);
      answerStart = i + repeatedLength * 2;
    } else {
      for (let length = 1; length <= 6 && i + length <= lines.length; length += 1) {
        questionLines = lines.slice(i, i + length);
        if (/\?$/.test(clean(questionLines.join(" ")))) {
          answerStart = i + length;
          break;
        }
      }
    }

    if (answerStart === -1) continue;

    const questionText = clean(questionLines.join(" "));
    if (!questionText || questionText.length < 12 || isPdfHeading(questionText)) continue;
    if (/\b(?:yes or no|true or false|[abcd]\s+[A-Z][a-z])/i.test(questionText)) continue;

    let answerCursor = answerStart;
    if (startsWithQuestionBlock(lines, answerCursor, questionLines)) answerCursor += questionLines.length;

    const answerLines = [];
    while (answerCursor < lines.length && answerLines.length < 3) {
      const answerLine = clean(lines[answerCursor]);
      if (!answerLine || isRoundHeading(answerLine) || isPdfHeading(answerLine) || /^fun fact$/i.test(answerLine)) break;
      if (startsWithQuestionBlock(lines, answerCursor, questionLines)) break;
      if (answerLines.length && looksLikeRepeatedQuestionStart(lines, answerCursor)) break;
      if (answerLines.length && looksLikeQuestionLead(answerLine)) break;
      if (/\?$/.test(answerLine) && answerLines.length) break;
      if (answerLines.length) {
        const previous = answerLines[answerLines.length - 1];
        const shortContinuation = answerLines.length === 1 && previous.length <= 25 && answerLine.length <= 25;
        if (!/,\s*$/.test(previous) && !/^&/.test(answerLine) && !shortContinuation) break;
      }
      answerLines.push(answerLine);
      answerCursor += 1;
    }

    if (startsWithQuestionBlock(lines, answerCursor, questionLines)) answerCursor += questionLines.length;
    const fact = collectFunFact(lines, answerCursor);
    if (!fact.funFact) fact.next = skipTrailingFactBlock(lines, answerCursor);
    const answer = clean(answerLines.join(" "));
    const key = compactKey(`${currentRound.name}:${questionText}:${answer}`);
    const questionKey = compactKey(`${currentRound.name}:${questionText}`);
    if (/^(yes or no|true or false|[abcd])$/i.test(answer) || /\b[abcd]\s+[A-Z][a-z]/.test(answer)) continue;

    if (answer && !seen.has(key) && !seenQuestions.has(questionKey)) {
      seen.add(key);
      seenQuestions.add(questionKey);
      const questionType = /^(true|false)$/i.test(answer) ? "true_false" : "written";
      const normalized = normalizeRecord({
        category: "",
        round_name: currentRound.name,
        round_order: currentRound.order,
        source_order: sourceOrder,
        import_order: sourceOrder,
        question_text: questionText,
        correct_answer: answer,
        question_type: questionType,
        incorrect_answers: [],
        fun_fact: fact.funFact || null,
      });
      if (normalized) questions.push(normalized);
      sourceOrder += 1;
    }

    i = Math.max(i, (fact.next || answerCursor) - 1);
  }

  return questions;
}

function parseQuestionsFromText(text) {
  const lines = String(text || "").split(/\n+/).map(clean).filter(Boolean);
  const questions = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inlineMatch = line.match(/^(?:q[:.)\-]?\s*)?(.*\?)\s*(?:a(?:nswer)?[:.)\-]\s*)(.+)$/i);
    if (inlineMatch) {
      questions.push(normalizeRecord({ category: "", round_name: "PDF", source_order: i + 1, question_text: inlineMatch[1], correct_answer: inlineMatch[2], question_type: "written", incorrect_answers: [] }));
      continue;
    }

    if (/\?$/.test(line) && lines[i + 1]) {
      const answerLine = lines[i + 1].replace(/^a(?:nswer)?[:.)\-]\s*/i, "");
      questions.push(normalizeRecord({ category: "", round_name: "PDF", source_order: i + 1, question_text: line, correct_answer: answerLine, question_type: "written", incorrect_answers: [] }));
      i += 1;
    }
  }

  return questions.filter(Boolean);
}

async function parseUploadedFile(file, requestedSource) {
  const filename = file.filename || "";
  const lower = filename.toLowerCase();
  const source = requestedSource || "auto";

  if (lower.endsWith(".pdf") || file.contentType.includes("pdf") || source === "pdf") {
    if (file.extractedText) {
      return parsePdfText(file.text, source, ["Extracted PDF text in your browser to avoid the hosted upload size limit."]);
    }
    return parsePdf(file.buffer, source);
  }

  return parseCsv(file.text, source);
}

function stripQuestionMetadata(question) {
  const { round_name, round_order, source_order, import_order, source, has_image, ...dbQuestion } = question;
  return dbQuestion;
}

function groupByType(questions) {
  const sorted = sortQuestionsByRound(questions);
  return {
    true_false_questions: sorted.filter((q) => q.question_type === "true_false"),
    multiple_choice_questions: sorted.filter((q) => q.question_type === "multiple_choice"),
    written_questions: sorted.filter((q) => q.question_type === "written"),
    picture_questions: sorted.filter((q) => q.question_type === "picture"),
  };
}

function buildSessionName(filename) {
  return clean(filename).replace(/\.(csv|tsv|txt|pdf)$/i, "").replace(/[_-]+/g, " ") || `Imported Session ${new Date().toLocaleDateString()}`;
}

function describeQuestion(question, reason) {
  return {
    row: question.source_order || null,
    round: question.round_name || question.category || "Imported",
    category: question.category || "",
    type: question.question_type || "written",
    question: question.question_text || "Untitled question",
    answer: question.correct_answer || "",
    reason,
  };
}

function sameQuestionIdentity(question, existing) {
  return (
    compactKey(question.correct_answer) === compactKey(existing.correct_answer) &&
    clean(question.image_url) === clean(existing.image_url) &&
    clean(question.correct_answer_image) === clean(existing.correct_answer_image)
  );
}

async function findExistingImportedQuestion(supabase, question, userId) {
  const selectVariants = [
    "id, correct_answer, image_url, correct_answer_image",
    "id, correct_answer, image_url",
    "id, correct_answer",
  ];

  let lastError = null;
  for (const columns of selectVariants) {
    const { data, error } = await supabase
      .from("questions")
      .select(columns)
      .eq("user_id", userId)
      .eq("question_text", question.question_text)
      .limit(25);

    if (error) {
      lastError = error;
      if (/schema cache|column|Could not find/i.test(error.message || "")) continue;
      throw error;
    }

    return (data || []).find((existing) => sameQuestionIdentity(question, existing)) || null;
  }

  if (lastError) throw lastError;
  return null;
}

async function insertQuestionWithUsedFallback(supabase, question, userId) {
  const basePayload = { ...stripQuestionMetadata(question), user_id: userId };
  Object.keys(basePayload).forEach((key) => {
    if (basePayload[key] === undefined || basePayload[key] === null) delete basePayload[key];
  });

  const mediaVariants = [
    basePayload,
    (({ correct_answer_image, ...rest }) => rest)(basePayload),
    (({ correct_answer_image, image_url, ...rest }) => rest)(basePayload),
  ];
  const usedPayloads = [
    { is_used: true, used_at: new Date().toISOString(), times_used: 1 },
    { is_used: true },
    { used: true },
    {},
  ];

  let lastError = null;
  for (const mediaPayload of mediaVariants) {
    for (const extra of usedPayloads) {
      const payload = { ...mediaPayload, ...extra };
      const { error } = await supabase.from("questions").insert(payload);
      if (!error) return;
      lastError = error;
      if (!/schema cache|column|Could not find/i.test(error.message || "")) throw error;
    }
  }

  throw lastError;
}

async function updateExistingQuestionFromImport(supabase, question, existingId) {
  const basePayload = {};
  if (question.image_url) basePayload.image_url = question.image_url;
  if (question.correct_answer_image) basePayload.correct_answer_image = question.correct_answer_image;
  if (question.fun_fact) basePayload.fun_fact = question.fun_fact;

  const mediaVariants = [
    basePayload,
    (({ correct_answer_image, ...rest }) => rest)(basePayload),
    (({ correct_answer_image, image_url, ...rest }) => rest)(basePayload),
  ];
  const usedPayloads = [
    { is_used: true, used_at: new Date().toISOString(), times_used: 1 },
    { is_used: true },
    { used: true },
    {},
  ];

  let lastError = null;
  for (const mediaPayload of mediaVariants) {
    for (const extra of usedPayloads) {
      const payload = { ...mediaPayload, ...extra };
      if (!Object.keys(payload).length) return;
      const { error } = await supabase.from("questions").update(payload).eq("id", existingId);
      if (!error) return;
      lastError = error;
      if (!/schema cache|column|Could not find/i.test(error.message || "")) throw error;
    }
  }

  if (lastError) throw lastError;
}

async function importQuestions({ questions, userId, filename }) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl) throw new Error("Missing Supabase URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const sortedQuestions = sortQuestionsByRound(questions);
  let imported = 0;
  let skipped = 0;
  const errors = [];
  const skippedDetails = [];

  for (const question of sortedQuestions) {
    try {
      const existing = await findExistingImportedQuestion(supabase, question, userId);
      if (existing?.id) {
        await updateExistingQuestionFromImport(supabase, question, existing.id);
        skipped += 1;
        skippedDetails.push(describeQuestion(question, "Already exists in your question library with the same answer and media; marked used and refreshed media when available"));
        continue;
      }

      await insertQuestionWithUsedFallback(supabase, question, userId);
      imported += 1;
    } catch (error) {
      const reason = error.message || "Question import failed";
      errors.push(reason);
      skippedDetails.push(describeQuestion(question, reason));
    }
  }

  let sessionsCreated = 0;
  let sessionId = null;
  let sessionName = null;
  let sessionError = null;

  try {
    const grouped = groupByType(sortedQuestions);
    const builtSessionName = buildSessionName(filename);
    const { data, error } = await supabase
      .from("sessions")
      .insert({ user_id: userId, name: builtSessionName, session_name: builtSessionName, is_past: true, ...grouped })
      .select()
      .single();

    if (error) throw error;
    sessionsCreated = 1;
    sessionId = data.id;
    sessionName = data.name || data.session_name;
  } catch (error) {
    sessionError = error.message || "Failed to create past session";
  }

  return { imported, skipped, errors, skippedDetails, sessionsCreated, sessionId, sessionName, sessionError };
}

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const buffer = await readRequestBuffer(req);
    const parts = extractJsonParts(req, buffer) || extractMultipartParts(req, buffer);
    const file = parts.file;
    const action = clean(parts.action || "preview");
    const requestedSource = clean(parts.source || "auto").toLowerCase();
    const userId = clean(parts.sessionUserId);

    if (!file?.buffer?.length) {
      return res.status(400).json({
        error: "No file found in upload. Please choose the file again and retry.",
        debug: { contentType: req.headers["content-type"] || "", bytesReceived: buffer.length, fieldsFound: Object.keys(parts) },
      });
    }

    const parsed = await parseUploadedFile(file, requestedSource);
    const questions = sortQuestionsByRound(parsed.questions || []);

    if (action === "preview") {
      return res.status(200).json({
        format: SOURCE_LABELS[parsed.source] || parsed.source || "Imported",
        source: parsed.source,
        columns: parsed.columns || [],
        row_count: questions.length,
        preview: questions.slice(0, 8).map((question) => ({
          round: question.round_name || question.category,
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
      skipped_details: result.skippedDetails,
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
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
