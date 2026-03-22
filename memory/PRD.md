# Trivia Forge - Product Requirements Document

## Original Problem Statement
Build a trivia host app with:
- Format: 9 T/F, 9 Multiple Choice, 9 Written Answer, 3 Picture-based questions
- All categories must be unique and non-repeating
- AI-powered question generation with category management
- Like/Save/Dislike questions, CSV import
- **Live hosting platform** similar to TrivNow — host controls game from laptop, projector shows questions/scores, players join via phone with room code

## Architecture
- **Frontend**: React 19, Tailwind CSS, Shadcn/UI, React Router
- **Backend**: FastAPI, Motor (async MongoDB), JWT auth, WebSocket for live games
- **AI**: GPT-5.2 via emergentintegrations (text), GPT Image 1 (images)
- **Real-time**: FastAPI WebSocket, in-memory game state
- **Database**: MongoDB (questions, sessions, users, categories)

## What's Been Implemented

### Authentication
- JWT-based registration and login

### Two-Step Generate Flow + Theme Round
- Standard mode: batch category generation, per-category questions
- Theme Round mode: single subject generates 3 T/F + 3 MC + 3 Written + 1 Picture
- Like/dislike with exclusion tracking, per-question regeneration
- Save as Session directly from Generate page

### Question Library
- View, filter, search, create, edit, delete questions
- Image display for picture questions

### Trivia Session Builder
- Select questions by type, save as past session
- Session detail view with copy to clipboard

### CSV Import/Export
- Import with duplicate detection and update
- CSV export endpoint (download-csv with token auth)

### Picture-Based Questions
- Image upload (JPEG/PNG/GIF/WebP, max 10MB)
- AI image generation via GPT Image 1

### Category Management
- View, search, dislike/restore categories

### Live Trivia Hosting Platform
- **Game Creation**: Host creates game from any session, gets 4-digit room code
- **Player Join**: No account needed — enter code + name at /join
- **Host Control Panel** (/host/:id): Advance questions, reveal answers, show scores, override scores, end game
- **Presentation View** (/present/:code): Projector-optimized display with large question text, colored MC options, scoreboard, player lobby, wagering phase
- **Player View** (/play/:id): Mobile-optimized answer submission — T/F buttons, MC option taps, written text input
- **Auto-Scoring**: Exact match for T/F/MC, fuzzy match for written (>=70%)
- **Manual Override**: Host can edit any player's answer (re-scored) or directly override score
- **Configurable Points**: Host can set custom points per question
- **Wagering System**: Picture questions trigger a wagering phase — players bet points capped at their current score. Correct = +wager, Incorrect = -wager
- **WebSocket Real-time**: All views update live via WebSocket broadcasts
- **Game Flow**: Lobby → Question|Wagering → (Start Answering) → Question → Answer Reveal → Scoreboard → Next → ... → Game Over
- **Presentation filter**: `__presentation__` pseudo-player filtered from all player lists/scoreboards

## DB Schema
- **users**: {id, email, hashed_password}
- **questions**: {id, user_id, question_text, answer, question_type, category, options, fun_fact, image_url, liked, disliked, used, venue, date_used}
- **sessions**: {id, user_id, name, questions by type, is_past}
- **categories**: {id, user_id, name, is_disliked}
- **games**: In-memory only {id, code, host_user_id, session_id, status, questions, players, answers, wagers}

## Key API Endpoints
- `/api/auth/{register, login}` - Authentication
- `/api/generate/{categories-batch, single-category, questions, theme-round, image}` - AI generation
- `/api/questions[/all, /save]` - Question CRUD
- `/api/sessions` - Session CRUD
- `/api/sessions/{id}/download-csv` - CSV export
- `/api/upload/image` - Image upload
- `/api/games/{create, join, {id}/next, {id}/reveal, {id}/scores, {id}/override, {id}/end, {id}/set-points, {id}/change-answer, {id}/start-answering, {id}/wager}` - Live game
- `/api/ws/game/{id}` - WebSocket for real-time updates

## Prioritized Backlog

### P0 — Done
- [x] All core features implemented and tested
- [x] Wagering system for picture questions (tested Mar 2026)
- [x] Configurable points per question (tested Mar 2026)
- [x] Host manual answer change & score override (tested Mar 2026)
- [x] PresentView wagering phase display (tested Mar 2026)
- [x] Filter __presentation__ from player lists (fixed Mar 2026)

### P1 — Next
- [ ] Timer for questions (configurable per-question countdown)
- [ ] Persistent game state (save to MongoDB for restart resilience)
- [ ] Save game history/scores to DB after game ends

### P2 — Medium
- [ ] Sound effects for correct/wrong answers
- [ ] Session templates (save category sets for reuse)
- [ ] Question difficulty rating
- [ ] Fix CSV download in Chrome (known issue — fetch+blob approach implemented but user reports still not working)

### P3 — Nice to Have
- [ ] Multi-user collaboration
- [ ] Public question library sharing
- [ ] Score tracking across multiple game nights
- [ ] Mobile-optimized presenter view
- [ ] Category search in Generate Step 1
