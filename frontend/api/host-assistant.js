const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const fingerprint = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const answerPairFingerprint = (question, answer) => `${fingerprint(question)}::${fingerprint(answer)}`;

const safeList = (value, limit = 20) => Array.isArray(value) ? value.slice(0, limit) : [];
const normalizeStyleProfile = (value = {}) => {
  const source = value && typeof value === "object" ? value : {};
  const cleanExamples = (examples) => safeList(examples, 6).map((item) => ({
    category: clean(item?.category),
    question_type: clean(item?.question_type || item?.type),
    question_text: clean(item?.question_text || item?.question),
    correct_answer: clean(item?.correct_answer || item?.answer),
    fun_fact: clean(item?.fun_fact),
    note: clean(item?.note),
  })).filter((item) => item.question_text && item.correct_answer);
  return {
    preferredDifficulty: clean(source.preferredDifficulty),
    favoriteCategories: safeList(source.favoriteCategories, 18).map(clean).filter(Boolean),
    avoidedCategories: safeList(source.avoidedCategories, 18).map(clean).filter(Boolean),
    preferredRoundStructure: clean(source.preferredRoundStructure),
    writingStyleNotes: clean(source.writingStyleNotes),
    funFactStyle: clean(source.funFactStyle),
    wrongAnswerStyle: clean(source.wrongAnswerStyle),
    categoriesThatPerformWell: safeList(source.categoriesThatPerformWell, 18).map(clean).filter(Boolean),
    categoriesThatPerformPoorly: safeList(source.categoriesThatPerformPoorly, 18).map(clean).filter(Boolean),
    venuePreferences: clean(source.venuePreferences),
    examplesOfGoodQuestions: cleanExamples(source.examplesOfGoodQuestions),
    examplesOfBadQuestions: cleanExamples(source.examplesOfBadQuestions),
  };
};
const styleProfileText = (profile) => {
  const cleanProfile = normalizeStyleProfile(profile);
  if (!Object.values(cleanProfile).some((value) => Array.isArray(value) ? value.length : Boolean(value))) return null;
  return {
    preferredDifficulty: cleanProfile.preferredDifficulty,
    writingStyleNotes: cleanProfile.writingStyleNotes,
    funFactStyle: cleanProfile.funFactStyle,
    wrongAnswerStyle: cleanProfile.wrongAnswerStyle,
    preferredRoundStructure: cleanProfile.preferredRoundStructure,
    favoriteCategories: cleanProfile.favoriteCategories,
    avoidedCategories: cleanProfile.avoidedCategories,
    categoriesThatPerformWell: cleanProfile.categoriesThatPerformWell,
    categoriesThatPerformPoorly: cleanProfile.categoriesThatPerformPoorly,
    venuePreferences: cleanProfile.venuePreferences,
    soundsLikeMe: cleanProfile.examplesOfGoodQuestions.slice(0, 4),
    avoidThisStyle: cleanProfile.examplesOfBadQuestions.slice(0, 4),
    styleRule: "Sound like Jewelzz/Forever Fun Events: unique, slightly hard, fun, concise, category-varied, clean bar trivia. Silently revise anything generic, too easy, too common, overexplained, or not in this voice before returning JSON.",
  };
};

const collectBlockedQuestions = (context = {}) => {
  const build = context.build || {};
  const raw = [
    ...safeList(context.questions, 80),
    ...safeList(build.activeRoundQuestions, 80),
    ...safeList(build.builtQuestions, 160),
  ];
  const textFingerprints = new Set();
  const answerPairs = new Set();
  const answersByCategory = new Set();
  raw.forEach((question) => {
    const text = question?.question_text || question?.question;
    const answer = question?.correct_answer || question?.answer;
    const category = question?.category;
    if (text) textFingerprints.add(fingerprint(text));
    if (text && answer) answerPairs.add(answerPairFingerprint(text, answer));
    if (category && answer) answersByCategory.add(`${fingerprint(category)}::${fingerprint(answer)}`);
  });
  return { textFingerprints, answerPairs, answersByCategory };
};

const fallback = (request, context) => {
  const sessionName = clean(context?.session?.name || context?.session?.session_name) || "your next trivia night";
  const venueName = clean(context?.venue?.name || context?.venue?.nightName);
  const templateName = clean(context?.template?.name);
  return [
    `Here is a practical host plan for ${sessionName}${venueName ? ` at ${venueName}` : ""}.`,
    templateName ? `Use the ${templateName} structure as the pacing guide.` : "Keep the opening round welcoming, save the sharper pulls for later, and keep a backup written question ready.",
    request ? `For your request: ${request}` : "Tell me what you want to adjust and I can draft a more specific plan.",
  ].join("\n\n");
};

const parseAssistantJson = (content) => {
  const text = clean(content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const normalizeCandidate = (candidate) => {
  if (!candidate || typeof candidate !== "object") return null;
  const questionText = clean(candidate.question_text || candidate.question);
  const correctAnswer = clean(candidate.correct_answer || candidate.answer);
  const category = clean(candidate.category);
  const type = ["true_false", "multiple_choice", "written"].includes(candidate.question_type || candidate.type) ? candidate.question_type || candidate.type : "written";
  if (!questionText || !correctAnswer || !category) return null;
  const incorrect = Array.isArray(candidate.incorrect_answers) ? candidate.incorrect_answers.map(clean).filter(Boolean) : [];
  return {
    category,
    question_text: questionText,
    correct_answer: type === "true_false" ? (correctAnswer.toLowerCase() === "false" ? "False" : "True") : correctAnswer,
    incorrect_answers: type === "multiple_choice" ? incorrect.slice(0, 3) : [],
    fun_fact: clean(candidate.fun_fact),
    difficulty: clean(candidate.difficulty || "medium") || "medium",
    question_type: type,
    image_url: "",
    image_prompt: "",
  };
};

const isBlockedCandidate = (candidate, blocked) => {
  if (!candidate) return true;
  const textKey = fingerprint(candidate.question_text);
  const pairKey = answerPairFingerprint(candidate.question_text, candidate.correct_answer);
  const categoryAnswerKey = `${fingerprint(candidate.category)}::${fingerprint(candidate.correct_answer)}`;
  return blocked.textFingerprints.has(textKey) || blocked.answerPairs.has(pairKey) || blocked.answersByCategory.has(categoryAnswerKey);
};

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const request = clean(body.request);
    const context = body.context || {};
    const mode = clean(body.mode);
    if (!request) return res.status(400).json({ error: "Ask the host assistant for something first" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({ answer: fallback(request, context) });
    }

    const buildMode = mode === "build_cohost";
    const editMode = mode === "question_edit";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_HOST_ASSISTANT_MODEL || "gpt-4.1-mini",
        temperature: buildMode || editMode ? 0.62 : 0.55,
        response_format: buildMode || editMode ? { type: "json_object" } : undefined,
        messages: [
          {
            role: "system",
            content: editMode
              ? "You are Quiz Crafter's conversational question editor for an experienced US bar-trivia host. Rewrite the provided question according to the host's instruction while preserving the same trivia idea unless the host explicitly asks for a different fact. Make questions playable, fair, and host-ready. Return valid JSON only."
              : buildMode
              ? "You are Quiz Crafter's private ChatGPT-style co-host for an experienced US bar-trivia host. Help shape the current build with practical, playable, fresh-but-fair questions. Use only approved categories when they are provided. Do not invent categories. Avoid obscure deep cuts, tiny-name answers, sterile textbook facts, and questions with no clue path. Return valid JSON only."
              : "You are Quiz Crafter's predictable collaborative editor for an experienced weekly trivia host. Chat is a scratchpad: draft options, revise them, explain tradeoffs, and wait for the host to approve before any app changes happen. Be concrete, host-aware, and useful. Avoid generic trivia-site advice.",
          },
          {
            role: "user",
            content: JSON.stringify({
              request,
              host_context: {
                venue: context.venue || null,
                template: context.template || null,
                session: context.session || null,
                build: context.build || null,
                // What's actually on the host's screen right now (e.g. the
                // Clue Builder's selected questions and drafted post, or a
                // Build page's active round) -- pushed live by the current
                // page via updatePageContext(). This used to be captured on
                // the frontend and then silently dropped here, so the chat
                // assistant never knew what the host was looking at or had
                // just been given, even when the host referred to "this".
                page_live_context: context.pageLiveContext && typeof context.pageLiveContext === "object" ? context.pageLiveContext : null,
                approved_categories: safeList(context.approvedCategories, 80),
                rejected_categories: safeList(context.rejectedCategories, 80),
                recent_categories: safeList(context.recentSessionCategories, 80),
                conversation: safeList(context.conversation, 12),
                recent_feedback: safeList(context.feedback, 30),
                player_ideas: safeList(context.ideas, 30),
                questions: safeList(context.questions, 40),
                host_style_profile: styleProfileText(context.hostStyleProfile),
              },
              response_rules: editMode
                ? [
                    "The question you are editing is host_context.questions[0], and only that one. Everything else in host_context (host_context.build.activeRoundQuestions, host_context.build.builtQuestions, host_context.host_style_profile examples, etc.) is background for style and avoiding duplicates only -- never copy, answer, or draw facts from any of those other questions.",
                    "Return JSON with keys: answer, candidate.",
                    "answer should briefly explain what changed and any caveat the host should know.",
                    "candidate must include category, question_text, correct_answer, incorrect_answers, fun_fact, difficulty, question_type, image_url.",
                    "question_type must be true_false, multiple_choice, or written.",
                    "If the host asks to make it false, create a true_false question whose correct_answer is exactly False.",
                    "If the host asks to make it true, create a true_false question whose correct_answer is exactly True.",
                    "If the host asks to make it easier or harder, keep the same broad trivia idea and category unless impossible.",
                    "When asked to add a missing correct_answer, it must be the real, verifiably correct answer to host_context.questions[0]'s exact question_text -- if you are not confident of a real answer to that specific question, say so in answer and omit candidate rather than guessing or substituting an answer to a different question.",
                    "For multiple_choice, incorrect_answers must contain exactly 3 plausible wrong answers.",
                    "fun_fact must be one short sentence of genuinely true additional context about THIS SAME question's specific subject or answer -- never a generic or unrelated trivia tidbit about a different topic, even a true one. If you were only asked to add a fun fact and have no real fact directly relevant to this exact question/answer, return fun_fact as an empty string rather than inventing an unrelated one.",
                    "Do not claim to save or edit anything directly.",
                  ]
                : buildMode
                ? [
                    "Return JSON with keys: answer, candidates.",
                    "answer should be 2-5 short, actionable sentences for the host.",
                    "Use the conversation history to continue refining instead of restarting the task.",
                    "Treat the newest user request as the highest priority.",
                    "Never suggest a question already present in host_context.questions, host_context.build.activeRoundQuestions, or host_context.build.builtQuestions.",
                    "Never reuse the same correct answer in the same category as an existing built question.",
                    "If the host rejects a direction, do not defend it; pivot and produce a materially different approach.",
                    "If you cannot satisfy the directions without duplicates, return fewer candidates and explain what constraint blocked you.",
                    "candidates must be an array of 0-6 usable question objects.",
                    "Each candidate must include category, question_text, correct_answer, incorrect_answers, fun_fact, difficulty, question_type, image_url.",
                    "question_type must be true_false, multiple_choice, or written.",
                    "If host_context.session.targetType is set to true_false, multiple_choice, or written, every candidate's question_type must match it -- unless the host's request explicitly asks for a mix of types or a specific different type, in which case follow the request instead.",
                    "For multiple_choice, incorrect_answers must contain exactly 3 plausible wrong answers.",
                    "For true_false, correct_answer must be exactly True or False.",
                    "For written, answers must be familiar/gettable enough for a live bar team.",
                    "fun_fact must be one short sentence of genuinely true additional context about THAT SAME candidate's specific subject or answer -- never a generic or unrelated trivia tidbit about a different topic, even a true one. If you have no real fact directly relevant to that exact question/answer, return fun_fact as an empty string rather than inventing an unrelated one.",
                    "Use only approved_categories if any are provided.",
                    "Do not give more than 2 of the returned candidates the same category, and prefer categories not already heavily represented in host_context.build.builtQuestions, unless the host's request specifically asks for a category or only a couple approved categories are available.",
                    "If host_context.venue.insights is present, prefer categories listed under loved there and avoid repeating categories or specific questions listed under struggled/disliked there, unless the host explicitly asks otherwise.",
                    "Do not claim to save or edit anything directly.",
                  ]
                : [
                    "Conversation is the default. Answer directly unless the host explicitly confirms an application action.",
                    "Do not claim you saved, replaced, added, deleted, imported, exported, duplicated, or changed anything.",
                    "Do not say to check the Build workspace or that you sent something to another tool.",
                    "For creative requests like try again, make it harder, give me another, rewrite this, suggest categories, or improve this fun fact, respond in chat with the improved content or explanation only.",
                    "When the host asks for a trivia question, provide 1-3 candidate questions with category, type, question, answer, and a short fun fact. Do not say they were added.",
                    "If the host says try again, harder, easier, less obvious, more beachy, or similar, revise the previous idea rather than acting on the app.",
                    "Answer in short, actionable sections.",
                    "If rewriting or replacing a question, provide the usable question, answer, and brief host note.",
                    "Use the host's venue/template/session memory when relevant.",
                    "Do not claim to have changed the database unless explicitly asked and tool support exists.",
                    "host_context.page_live_context is exactly what the host is currently looking at on screen -- e.g. on the Clues tab it holds the questions they selected and the social post already drafted for them; on a Build page it holds the active round's real questions. When the host says 'this', 'that clue', 'the post', or asks to add/change something in it, ground your answer in page_live_context first instead of asking what they mean or drafting from scratch.",
                    "When revising a drafted social post from page_live_context, return the full replacement text so the host can copy it back in, not just a description of the change.",
                  ],
            }),
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
    const answer = clean(data.choices?.[0]?.message?.content);
    if (!answer) throw new Error("AI returned an empty answer");
    if (buildMode) {
      const parsed = parseAssistantJson(answer);
      const blocked = collectBlockedQuestions(context);
      const normalized = Array.isArray(parsed?.candidates) ? parsed.candidates.map(normalizeCandidate).filter(Boolean) : [];
      // "Don't repeat a category" is only a prompt instruction above, and the
      // model doesn't reliably follow it -- cap it mechanically too, same as
      // generate-session-candidates.js does for the main draft flow.
      const categoryCounts = new Map();
      const candidates = normalized
        .filter((candidate) => !isBlockedCandidate(candidate, blocked))
        .filter((candidate) => {
          const key = fingerprint(candidate.category);
          const count = categoryCounts.get(key) || 0;
          if (count >= 2) return false;
          categoryCounts.set(key, count + 1);
          return true;
        })
        .slice(0, 6);
      const dropped = normalized.length - candidates.length;
      const assistantAnswer = clean(parsed?.answer) || "I drafted a few co-host suggestions for this build.";
      return res.status(200).json({
        answer: dropped > 0 ? `${assistantAnswer}\n\nI filtered out ${dropped} suggestion${dropped === 1 ? "" : "s"} because they repeated questions or answers already in this build.` : assistantAnswer,
        candidates,
        dropped,
      });
    }
    if (editMode) {
      const parsed = parseAssistantJson(answer);
      const candidate = normalizeCandidate(parsed?.candidate);
      if (!candidate) throw new Error("AI did not return a usable question edit");
      return res.status(200).json({ answer: clean(parsed?.answer) || "I rewrote the question for you to review.", candidate });
    }
    return res.status(200).json({ answer });
  } catch (error) {
    console.error("host-assistant error:", error);
    return res.status(500).json({ error: error?.message || "Could not run host assistant" });
  }
}

module.exports = handler;
