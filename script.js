const STORAGE_KEY = "quiz-crafter-draft";
const CHOICE_COUNT = 4;

const defaultMeta = {
  title: "",
  category: "",
  difficulty: "Mixed"
};

const savedDraft = loadDraft();

const state = {
  meta: savedDraft.meta,
  questions: savedDraft.questions,
  currentView: "builder",
  currentQuestionIndex: 0,
  score: 0,
  hasAnsweredCurrent: false
};

const elements = {
  choiceGrid: document.querySelector("#choice-grid"),
  choiceTemplate: document.querySelector("#choice-template"),
  clearForm: document.querySelector("#clear-form"),
  clearQuiz: document.querySelector("#clear-quiz"),
  emptyBuilder: document.querySelector("#empty-builder"),
  exportQuiz: document.querySelector("#export-quiz"),
  form: document.querySelector("#question-form"),
  importFile: document.querySelector("#import-file"),
  importQuiz: document.querySelector("#import-quiz"),
  importStatus: document.querySelector("#import-status"),
  modeTabs: document.querySelectorAll(".mode-tab"),
  nextQuestion: document.querySelector("#next-question"),
  practiceCard: document.querySelector("#practice-card"),
  practiceChoices: document.querySelector("#practice-choices"),
  practiceEmpty: document.querySelector("#practice-empty"),
  practiceFeedback: document.querySelector("#practice-feedback"),
  practiceLabel: document.querySelector("#practice-label"),
  practiceProgress: document.querySelector("#practice-progress"),
  practiceQuestion: document.querySelector("#practice-question"),
  practiceScore: document.querySelector("#practice-score"),
  questionCount: document.querySelector("#question-count"),
  questionList: document.querySelector("#question-list"),
  questionText: document.querySelector("#question-text"),
  quizCategory: document.querySelector("#quiz-category"),
  quizDifficulty: document.querySelector("#quiz-difficulty"),
  quizSummary: document.querySelector("#quiz-summary"),
  quizTitle: document.querySelector("#quiz-title"),
  restartQuiz: document.querySelector("#restart-quiz"),
  resultsCard: document.querySelector("#results-card"),
  resultsDetail: document.querySelector("#results-detail"),
  resultsTitle: document.querySelector("#results-title")
};

function init() {
  buildChoiceInputs();
  bindEvents();
  renderMetaFields();
  renderBuilder();
  renderPractice();
}

function buildChoiceInputs() {
  elements.choiceGrid.innerHTML = "";

  for (let index = 0; index < CHOICE_COUNT; index += 1) {
    const choice = elements.choiceTemplate.content.firstElementChild.cloneNode(true);
    const radio = choice.querySelector("input[type='radio']");
    const input = choice.querySelector(".choice-input__text");

    radio.value = String(index);
    radio.checked = index === 0;
    input.placeholder = `Choice ${index + 1}`;

    elements.choiceGrid.append(choice);
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", handleQuestionSubmit);
  elements.clearForm.addEventListener("click", resetForm);
  elements.clearQuiz.addEventListener("click", clearQuiz);
  elements.exportQuiz.addEventListener("click", exportQuiz);
  elements.importQuiz.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", importQuiz);
  elements.nextQuestion.addEventListener("click", moveToNextQuestion);
  elements.restartQuiz.addEventListener("click", restartPractice);

  [elements.quizTitle, elements.quizCategory, elements.quizDifficulty].forEach((input) => {
    input.addEventListener("input", updateMetaFromFields);
  });

  elements.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
}

function handleQuestionSubmit(event) {
  event.preventDefault();

  const questionText = elements.questionText.value.trim();
  const choices = getChoiceInputs().map((input) => input.value.trim());
  const correctInput = document.querySelector("input[name='correct-choice']:checked");
  const correctIndex = Number(correctInput.value);

  if (!questionText || choices.some((choice) => !choice)) {
    return;
  }

  state.questions.push({
    id: createQuestionId(),
    text: questionText,
    choices,
    correctIndex
  });

  saveDraft();
  resetForm();
  renderBuilder();
  renderPractice();
}

function getChoiceInputs() {
  return Array.from(document.querySelectorAll(".choice-input__text"));
}

function resetForm() {
  elements.questionText.value = "";
  getChoiceInputs().forEach((input) => {
    input.value = "";
  });
  const firstRadio = document.querySelector("input[name='correct-choice']");
  firstRadio.checked = true;
  elements.questionText.focus();
}

function updateMetaFromFields() {
  state.meta = {
    title: elements.quizTitle.value.trim(),
    category: elements.quizCategory.value.trim(),
    difficulty: elements.quizDifficulty.value
  };

  saveDraft();
  renderQuizSummary();
  renderPracticeLabel();
  setImportStatus("");
}

function renderMetaFields() {
  elements.quizTitle.value = state.meta.title;
  elements.quizCategory.value = state.meta.category;
  elements.quizDifficulty.value = state.meta.difficulty || defaultMeta.difficulty;
}

function clearQuiz() {
  if (!state.questions.length) {
    return;
  }

  state.questions = [];
  saveDraft();
  restartPractice();
  renderBuilder();
  renderPractice();
  setImportStatus("Quiz questions cleared.", "success");
}

function removeQuestion(id) {
  state.questions = state.questions.filter((question) => question.id !== id);
  saveDraft();
  restartPractice();
  renderBuilder();
  renderPractice();
}

function exportQuiz() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    meta: state.meta,
    questions: state.questions
  };
  const fileName = `${slugify(state.meta.title || "quiz-crafter")}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setImportStatus("Quiz exported as JSON.", "success");
}

function importQuiz() {
  const file = elements.importFile.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(reader.result);
      const draft = normalizeDraft(payload);
      state.meta = draft.meta;
      state.questions = draft.questions;
      saveDraft();
      renderMetaFields();
      restartPractice();
      renderBuilder();
      renderPractice();
      setImportStatus(`Imported ${state.questions.length} questions.`, "success");
    } catch (error) {
      setImportStatus(error.message || "That file could not be imported.", "error");
    } finally {
      elements.importFile.value = "";
    }
  });

  reader.addEventListener("error", () => {
    setImportStatus("That file could not be read.", "error");
    elements.importFile.value = "";
  });

  reader.readAsText(file);
}

function renderBuilder() {
  elements.questionCount.textContent = state.questions.length;
  elements.questionList.innerHTML = "";
  elements.emptyBuilder.hidden = state.questions.length > 0;
  elements.clearQuiz.disabled = state.questions.length === 0;
  elements.exportQuiz.disabled = state.questions.length === 0;
  renderQuizSummary();

  state.questions.forEach((question, index) => {
    const item = document.createElement("li");
    item.className = "question-item";

    const title = document.createElement("p");
    title.textContent = `${index + 1}. ${question.text}`;

    const choices = document.createElement("ul");
    question.choices.forEach((choice, choiceIndex) => {
      const choiceItem = document.createElement("li");
      choiceItem.textContent = choiceIndex === question.correctIndex ? `${choice} (correct)` : choice;
      choices.append(choiceItem);
    });

    const actions = document.createElement("div");
    actions.className = "question-item__actions";

    const removeButton = document.createElement("button");
    removeButton.className = "text-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeQuestion(question.id));

    actions.append(removeButton);
    item.append(title, choices, actions);
    elements.questionList.append(item);
  });
}

function renderQuizSummary() {
  const title = state.meta.title || "Untitled quiz";
  const descriptors = [state.meta.category, state.meta.difficulty].filter(Boolean);
  elements.quizSummary.textContent = descriptors.length ? `${title} - ${descriptors.join(" - ")}` : title;
}

function switchView(view) {
  state.currentView = view;

  elements.modeTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });

  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `${view}-view`);
  });

  if (view === "practice") {
    restartPractice();
  }
}

function restartPractice() {
  state.currentQuestionIndex = 0;
  state.score = 0;
  state.hasAnsweredCurrent = false;
  elements.resultsCard.hidden = true;
  renderPractice();
}

function renderPractice() {
  const hasQuestions = state.questions.length > 0;
  elements.practiceEmpty.hidden = hasQuestions;
  elements.practiceCard.hidden = !hasQuestions || elements.resultsCard.hidden === false;

  if (!hasQuestions || elements.practiceCard.hidden) {
    return;
  }

  const question = state.questions[state.currentQuestionIndex];
  elements.practiceChoices.innerHTML = "";
  elements.practiceFeedback.textContent = "";
  elements.nextQuestion.hidden = true;
  elements.practiceProgress.textContent = `Question ${state.currentQuestionIndex + 1} of ${state.questions.length}`;
  elements.practiceScore.textContent = `Score ${state.score}`;
  elements.practiceQuestion.textContent = question.text;
  state.hasAnsweredCurrent = false;
  renderPracticeLabel();

  question.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "practice-choice";
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => answerQuestion(index));
    elements.practiceChoices.append(button);
  });
}

function renderPracticeLabel() {
  if (!elements.practiceLabel) {
    return;
  }

  const title = state.meta.title || "Untitled quiz";
  const descriptors = [state.meta.category, state.meta.difficulty].filter(Boolean);
  elements.practiceLabel.textContent = descriptors.length ? `${title} - ${descriptors.join(" - ")}` : title;
}

function answerQuestion(selectedIndex) {
  if (state.hasAnsweredCurrent) {
    return;
  }

  state.hasAnsweredCurrent = true;
  const question = state.questions[state.currentQuestionIndex];
  const buttons = Array.from(elements.practiceChoices.children);
  const isCorrect = selectedIndex === question.correctIndex;

  if (isCorrect) {
    state.score += 1;
    elements.practiceFeedback.textContent = "Correct.";
  } else {
    elements.practiceFeedback.textContent = `Not quite. Correct answer: ${question.choices[question.correctIndex]}`;
  }

  buttons.forEach((button, index) => {
    button.disabled = true;
    button.classList.toggle("is-correct", index === question.correctIndex);
    button.classList.toggle("is-wrong", index === selectedIndex && !isCorrect);
  });

  elements.practiceScore.textContent = `Score ${state.score}`;
  elements.nextQuestion.textContent = isLastQuestion() ? "See results" : "Next";
  elements.nextQuestion.hidden = false;
}

function moveToNextQuestion() {
  if (isLastQuestion()) {
    showResults();
    return;
  }

  state.currentQuestionIndex += 1;
  renderPractice();
}

function isLastQuestion() {
  return state.currentQuestionIndex === state.questions.length - 1;
}

function showResults() {
  elements.practiceCard.hidden = true;
  elements.resultsCard.hidden = false;
  elements.resultsTitle.textContent = `${state.score} of ${state.questions.length} correct`;
  elements.resultsDetail.textContent = getResultsMessage();
}

function getResultsMessage() {
  const percentage = state.score / state.questions.length;

  if (percentage === 1) {
    return "Perfect score. This quiz is ready for a tougher draft.";
  }

  if (percentage >= 0.7) {
    return "Strong run. Review the missed questions and try once more.";
  }

  return "Keep refining. A few clearer choices may make this quiz stronger.";
}

function loadDraft() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeDraft(JSON.parse(saved)) : { meta: { ...defaultMeta }, questions: [] };
  } catch (error) {
    return { meta: { ...defaultMeta }, questions: [] };
  }
}

function normalizeDraft(payload) {
  const sourceQuestions = Array.isArray(payload) ? payload : payload.questions;
  const questions = normalizeQuestions(sourceQuestions);
  const payloadMeta = Array.isArray(payload) ? {} : payload.meta || {};

  return {
    meta: {
      ...defaultMeta,
      title: typeof payloadMeta.title === "string" ? payloadMeta.title.trim() : "",
      category: typeof payloadMeta.category === "string" ? payloadMeta.category.trim() : "",
      difficulty: normalizeDifficulty(payloadMeta.difficulty)
    },
    questions
  };
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) {
    throw new Error("Import failed: JSON must include a questions array.");
  }

  return questions.map((question, index) => {
    const text = typeof question.text === "string" ? question.text.trim() : "";
    const choices = Array.isArray(question.choices)
      ? question.choices.map((choice) => String(choice).trim())
      : [];
    const correctIndex = Number(question.correctIndex);

    if (!text || choices.length !== CHOICE_COUNT || choices.some((choice) => !choice)) {
      throw new Error(`Import failed: question ${index + 1} needs text and ${CHOICE_COUNT} choices.`);
    }

    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= CHOICE_COUNT) {
      throw new Error(`Import failed: question ${index + 1} has an invalid correct answer.`);
    }

    return {
      id: typeof question.id === "string" && question.id ? question.id : createQuestionId(),
      text,
      choices,
      correctIndex
    };
  });
}

function normalizeDifficulty(value) {
  const allowed = ["Mixed", "Easy", "Medium", "Hard"];
  return allowed.includes(value) ? value : defaultMeta.difficulty;
}

function saveDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    meta: state.meta,
    questions: state.questions
  }));
}

function createQuestionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "quiz-crafter";
}

function setImportStatus(message, type = "") {
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle("is-error", type === "error");
  elements.importStatus.classList.toggle("is-success", type === "success");
}

init();
