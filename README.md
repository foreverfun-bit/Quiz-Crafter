# Quiz Crafter

Quiz Crafter is a lightweight browser app for building and practicing multiple-choice quizzes. It runs as a static site, so you can open it directly in a browser or host it with GitHub Pages.

## Features

- Create quiz questions with four answer choices.
- Mark the correct answer while editing.
- Add quiz title, category, and difficulty metadata.
- Review questions before starting the quiz.
- Take the quiz with instant progress tracking.
- See a final score and review missed answers.
- Save quiz drafts automatically in the browser.
- Export quizzes as JSON files.
- Import previously exported quiz JSON files.

## Project files

- `index.html` - app structure and controls.
- `styles.css` - responsive visual design.
- `script.js` - quiz builder, quiz runner, scoring, import/export, and local draft storage.

## Run locally

Open `index.html` in your browser.

No package install or build step is required.

## Publish with GitHub Pages

1. Open the repository settings on GitHub.
2. Go to Pages.
3. Set the source to deploy from the `main` branch.
4. Choose the repository root folder.
5. Save the setting and wait for GitHub to publish the site.

## Suggested next improvements

- Add optional time limits for practice mode.
- Track missed answers in a results review section.
- Add edit-in-place support for existing questions.
- Add category filters for larger quizzes.
