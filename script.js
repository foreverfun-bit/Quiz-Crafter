const STORAGE_KEY = "quiz-crafter-draft";
const CHOICE_COUNT = 4;

const state = {
  questions: loadQuestions(),
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
  form: document.querySelector("#question-form"),
  modeTabs: document.querySelectorAll(".mode-tab"),
  nextQuestion: document.querySelector("#next-question"),
  practiceCard: document.querySelector("#practice-card"),
  practiceChoices: document.querySelector("#practice-choices"),
  practiceEmpty: document.querySelector("#practice-empty"),
  practiceFeedback: document.querySelector("#practice-feedback"),
  practiceProgress: document.querySelector("#practice-progress"),
  practiceQuestion: document.querySelector("#practice-question"),
  practiceScore: document.querySelector("#practice-score"),
  questionCount: document.querySelector("#question-count"),
  questionList: document.querySelector("#question-list"),
  questionText: document.querySelector("#question-text"),
  restartQuiz: document.querySelector("#restart-quiz"),
  resultsCard: document.querySelector("#results-card"),
  resultsDetail: document.querySelector("#results-detail"),
  resultsTitle: document.querySelector("#results-title")
};

function init() {
  buildChoiceInputs();
  bindEvents();
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
  elements.nextQuestion.addEventListener("click", moveToNextQuestion);
  elements.restartQuiz.addEventListener("click", restartPractice);

  elements.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
}

function handleQuestionSubmit(event) {
  event.preventDefault();

  const questionText = elements.questionText.value.trim();
  const choices = getChoiceInputs().map((input) => input.value.trim());
  const correctIndex = Number(document.querySelector("input[name='correct-choice']:checked").value);

  if (!questionText || choices.some((choice) => !choice)) {
    return;
  }

  state.questions.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    text: questionText,
    choices,
    correctIndex
  });

  saveQuestions();
  resetForm();
  renderBuilder();
  renderPractice();
}

function getChoiceInputs() {
  return Array.from(document.querySelectorAll(".choice-input__text"));
}

function resetForm() {
  elements.form.reset();
  const firstRadio = document.querySelector("input[name='correct-choice']");
  firstRadio.checked = true;
  elements.questionText.focus();
}

function clearQuiz() {
  if (!state.questions.length) {
    return;
  }

  state.questions = [];
  saveQuestions();
  restartPractice();
  renderBuilder();
  renderPractice();
}

function removeQuestion(id) {
  state.questions = state.questions.filter((question) => question.id !== id);
  saveQuestions();
  restartPractice();
  renderBuilder();
  renderPractice();
}

function renderBuilder() {
  elements.questionCount.textContent = state.questions.length;
  elements.questionList.innerHTML = "";
  elements.emptyBuilder.hidden = state.questions.length > 0;
  elements.clearQuiz.disabled = state.questions.length === 0;

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

  question.choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "practice-choice";
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => answerQuestion(index));
    elements.practiceChoices.append(button);
  });
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

function loadQuestions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

function saveQuestions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.questions));
}

init();
