// Shared with generate-session-candidates.js's own fetchExistingQuestions --
// duplicated here rather than imported from that file because that file is a
// Vercel route handler, not a library module. Pulls every question the host
// has ever saved to their library or used in a past session, so any caller
// (bulk generation, the AI co-host chat, the floating assistant) can ground
// "don't repeat yourself" in everything the host has actually built, not
// just whatever's visible on the host's screen right now.

const EXISTING_QUESTIONS_CACHE_MS = 5 * 60 * 1000;
const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "does", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which", "who", "whom", "whose", "why", "with"]);

let existingQuestionsCache = { expiresAt: 0, data: null, pending: null, libraryLimit: 0, sessionLimit: 0 };

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function fingerprint(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ").filter((word) => word && !STOP_WORDS.has(word)).sort().join(" ");
}

function answerFingerprint(answer) {
  return cleanText(answer).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function normalizeFetchedType(value) {
  return value === "true_false" || value === "multiple_choice" || value === "written" ? value : "written";
}

function extractSessionQuestions(session, sessionIndex = 0) {
  const sessionId = cleanText(session?.id) || `session-${sessionIndex}`;
  const sessionMeta = {
    id: sessionId,
    name: cleanText(session?.name || session?.session_name || session?.title),
    venue: cleanText(session?.venue_name || session?.venue || session?.venueName),
    date: cleanText(session?.session_date || session?.event_date || session?.hosted_at || session?.date || session?.created_at),
  };
  const slots = [
    ["true_false", session?.true_false_questions],
    ["multiple_choice", session?.multiple_choice_questions],
    ["written", session?.written_questions],
    ["picture", session?.picture_questions],
  ];
  return slots.flatMap(([slot, value]) => (Array.isArray(value) ? value.map((question, index) => ({
    ...question,
    question_type: question?.question_type || (slot === "picture" ? "written" : slot),
    source_slot: slot,
    source_position: index,
    session_key: sessionId || `session-${sessionIndex}`,
    session_id: sessionId,
    session_index: sessionIndex,
    session_meta: sessionMeta,
  })) : []));
}

async function fetchJsonWithFallback(urls, headers) {
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response.json();
    } catch {
      // Try the next shape; Supabase schemas vary across deployments.
    }
  }
  return [];
}

async function fetchExistingQuestionsUncached(supabaseUrl, supabaseKey, libraryLimit, sessionLimit) {
  const base = supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const [libraryQuestions, sessions] = await Promise.all([
    fetchJsonWithFallback([
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,is_liked,is_disliked,liked,disliked,rating,status,memory_status,is_reusable,reusable,is_used,used,used_at,times_used&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,is_liked,is_disliked,liked,disliked,rating,status,is_used,used,used_at,times_used&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact,rating&order=created_at.desc&limit=${libraryLimit}`,
      `${base}/rest/v1/questions?select=question_text,correct_answer,category,question_type,fun_fact&order=created_at.desc&limit=${libraryLimit}`,
    ], headers),
    fetchJsonWithFallback([
      `${base}/rest/v1/sessions?select=*&order=created_at.desc&limit=${sessionLimit}`,
      `${base}/rest/v1/sessions?select=true_false_questions,multiple_choice_questions,written_questions,picture_questions&order=created_at.desc&limit=${sessionLimit}`,
    ], headers),
  ]);
  const sessionQuestions = Array.isArray(sessions) ? sessions.flatMap((session, index) => extractSessionQuestions(session, index)) : [];

  return [
    ...(Array.isArray(libraryQuestions) ? libraryQuestions.map((q) => ({ ...q, source: "library" })) : []),
    ...sessionQuestions.map((q) => ({ ...q, source: "session" })),
  ]
    .map((q) => ({
      question_text: cleanText(q.question_text || q.question),
      correct_answer: cleanText(q.correct_answer || q.answer),
      category: cleanText(q.category),
      question_type: normalizeFetchedType(q.question_type),
      fun_fact: cleanText(q.fun_fact),
      is_liked: Boolean(q.is_liked || q.liked),
      is_disliked: Boolean(q.is_disliked || q.disliked),
      source: q.source || "library",
      round: cleanText(q.round || q.round_name),
    }))
    .filter((q) => q.question_text);
}

async function fetchExistingQuestions(libraryLimit = 500, sessionLimit = 300) {
  const now = Date.now();
  if (existingQuestionsCache.data && existingQuestionsCache.expiresAt > now && existingQuestionsCache.libraryLimit >= libraryLimit && existingQuestionsCache.sessionLimit >= sessionLimit) {
    return existingQuestionsCache.data.slice(0, libraryLimit + sessionLimit);
  }
  if (existingQuestionsCache.pending) return existingQuestionsCache.pending;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  existingQuestionsCache.pending = fetchExistingQuestionsUncached(supabaseUrl, supabaseKey, libraryLimit, sessionLimit)
    .then((data) => {
      existingQuestionsCache = { data, expiresAt: Date.now() + EXISTING_QUESTIONS_CACHE_MS, pending: null, libraryLimit, sessionLimit };
      return data;
    })
    .catch((error) => {
      existingQuestionsCache.pending = null;
      console.error("Existing question fetch failed:", error);
      return existingQuestionsCache.data || [];
    });

  return existingQuestionsCache.pending;
}

module.exports = { fetchExistingQuestions, fingerprint, answerFingerprint, cleanText };
