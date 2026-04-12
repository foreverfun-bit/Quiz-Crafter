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

function extractCsvTextFromMultipart(buffer) {
  const text = buffer.toString("utf8");
  const parts = text.split("\r\n\r\n");
  if (parts.length < 2) return "";
  const filePart = parts.slice(1).join("\r\n\r\n");
  const endBoundaryIndex = filePart.lastIndexOf("\r\n------");
  return endBoundaryIndex >= 0 ? filePart.slice(0, endBoundaryIndex) : filePart;
}

function normalizeRow(row) {
  const get = (...keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
    }
    return "";
  };

  const questionText = get("Question", "question");
  const answer = get("Answer", "answer");
  const category = get("Category", "category") || "Imported";
  const options = get("Multiple choice options", "multiple choice options", "options");
  const funFact = get("Fun Fact", "fun fact");
  const venue = get("Venue", "venue");
  const dateUsed = get("Date Used", "date used", "date_used");

  let questionType = "written";
  let incorrectAnswers = null;

  if (answer.toLowerCase() === "true" || answer.toLowerCase() === "false") {
    questionType = "true_false";
  } else if (options) {
    questionType = "multiple_choice";
    const optionList = options
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => s.toLowerCase() !== answer.toLowerCase());
    incorrectAnswers = optionList.length ? optionList.join(";") : null;
  }

  return {
    category,
    question_text: questionText,
    correct_answer: answer,
    question_type: questionType,
    incorrect_answers: incorrectAnswers,
    fun_fact: funFact || null,
    venue: venue || null,
    date_used: dateUsed || null,
    has_image: false,
    image_url: null,
    difficulty: "medium",
    source: "imported",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const rawBuffer = await readFileFromRequest(req);
    const csvText = extractCsvTextFromMultipart(rawBuffer);

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
    let imported = 0;
    let skipped = 0;
    const errors = [];

    const {
      data: { users },
      error: userError,
    } = await supabase.auth.admin.listUsers();

    if (userError || !users?.length) {
      return res.status(500).json({ error: "Could not determine import user" });
    }

    const userId = users[0].id;

    for (const rawRow of rows) {
      try {
        const row = normalizeRow(rawRow);

        if (!row.question_text || !row.correct_answer) {
          skipped += 1;
          continue;
        }

        const { data: existing } = await supabase
          .from("questions")
          .select("id")
          .eq("question_text", row.question_text)
          .limit(1)
          .maybeSingle();

        if (existing?.id) {
          skipped += 1;
          continue;
        }

        const { error: insertError } = await supabase.from("questions").insert({
          user_id: userId,
          category: row.category,
          question_text: row.question_text,
          correct_answer: row.correct_answer,
          question_type: row.question_type,
          incorrect_answers: row.incorrect_answers,
          fun_fact: row.fun_fact,
          has_image: row.has_image,
          image_url: row.image_url,
          difficulty: row.difficulty,
          source: row.source,
        });

        if (insertError) throw insertError;

        imported += 1;
      } catch (err) {
        errors.push(err.message || "Row import failed");
      }
    }

    return res.status(200).json({
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
