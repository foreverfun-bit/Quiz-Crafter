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
- **Real-time**: FastAPI WebSocket, in-memory game state with MongoDB persistence
- **Database**: MongoDB (questions, sessions, users, categories, game_history, active_games)

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

### Build Session (Enhanced Mar 2026)
- Library Selection with category conflict warnings
- Write Custom Questions inline with type-specific forms
- Scoring Options: per-type point values saved with session

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
- **Host Control Panel** (/host/:id): Advance questions, reveal answers, show scores, override scores, inline answer editing in sidebar
- **Presentation View** (/present/:code): Projector-optimized display with countdown timer circle, wagering phase
- **Player View** (/play/:id): Mobile-optimized with countdown, Time's Up lockout
- **Auto-Scoring**: Exact match for T/F/MC, fuzzy match for written (>=70%)
- **Manual Override**: Host can edit any player's answer or override score from sidebar
- **Configurable Points**: Per-type scoring from session + host can adjust per-question
- **Wagering System**: Picture questions trigger wagering phase, capped at player's current score
- **Configurable Timer** (NEW Mar 2026): Host sets countdown (Off/15s/30s/45s/60s/90s). Timer starts on question display, all views show countdown, player answers locked on expiry.
- **WebSocket Real-time**: All views update live via WebSocket broadcasts

### Game History (NEW Mar 2026)
- Automatic save of final scoreboard, all answers, and game metadata to MongoDB when game ends
- Game History page (/game-history) lists past games with session names, codes, dates, top 3 scores
- Detail page shows full scoreboard and per-question breakdown with every player's answer
- Duplicate prevention (no double-saves on natural finish + explicit end)

### Crash Resilience (NEW Mar 2026)
- Active game state persisted to MongoDB (active_games collection) on each major state change
- Games automatically restored from DB on server restart
- Active game cleaned up from DB when game ends

## DB Schema
- **users**: {id, email, hashed_password}
- **questions**: {id, user_id, question, answer, question_type, category, options, fun_fact, image_url}
- **sessions**: {id, user_id, name, questions by type, scoring, is_past}
- **categories**: {id, user_id, name, is_disliked}
- **game_history**: {id, game_id, code, session_name, host_user_id, scoreboard, question_results, player_count, created_at, ended_at}
- **active_games**: Full game state for crash recovery

## Key API Endpoints
- `/api/auth/{register, login}` - Authentication
- `/api/generate/{categories-batch, single-category, questions, theme-round, image}` - AI generation
- `/api/questions[/all, /save]` - Question CRUD
- `/api/sessions` - Session CRUD (with optional scoring)
- `/api/sessions/{id}/download-csv` - CSV export
- `/api/upload/image` - Image upload
- `/api/games/{create, join, {id}/next, {id}/reveal, {id}/scores, {id}/override, {id}/end}` - Live game
- `/api/games/{id}/set-points` - Configurable points
- `/api/games/{id}/set-timer` - Timer configuration
- `/api/games/{id}/change-answer` - Host answer change
- `/api/games/{id}/start-answering` - Start after wagering
- `/api/games/{id}/wager` - Player wagering
- `/api/game-history` - Past game list
- `/api/game-history/{id}` - Past game detail
- `/api/ws/game/{id}` - WebSocket for real-time updates

## Prioritized Backlog

### P0 — Done
- [x] All core features implemented and tested
- [x] Wagering system, configurable points, manual overrides (Mar 2026)
- [x] Build Session: Library + Write Custom + Scoring (Mar 2026)
- [x] Configurable question timer (Mar 2026)
- [x] Game history saved to DB (Mar 2026)
- [x] Crash resilience with DB persistence (Mar 2026)

### P1 — Next
- [ ] Sound effects for correct/wrong answers in live games
- [ ] Session templates (save category sets for reuse)
- [ ] Question difficulty rating

### P2 — Medium
- [ ] Fix CSV download in Chrome (known recurring issue)
- [ ] Refactor Generate.jsx (~1400 lines) into smaller components
- [ ] Category search in Generate Step 1

### P3 — Nice to Have
- [ ] Multi-user collaboration
- [ ] Public question library sharing
- [ ] Score tracking across multiple game nights
- [ ] Mobile-optimized presenter view
- [ ] Question randomizer within rounds
- [ ] Team mode with combined scoring
