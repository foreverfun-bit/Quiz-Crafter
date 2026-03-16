# Trivia Forge - Product Requirements Document

## Original Problem Statement
Build a trivia host app with:
- Format: 9 T/F, 9 Multiple Choice, 9 Written Answer, 3 Picture-based questions
- All categories must be unique and non-repeating
- Generate broad categories at random with ability to swap individual categories
- Generate multiple question options per category to pick from
- Search/filter feature for categories
- Like/Save questions for future trivia sessions
- Dislike questions to track preferences and hide from future suggestions
- CSV import for old trivia sessions (prevents question repetition)
- Simple JWT-based login

## User Personas
1. **Primary**: Trivia Hosts running pub trivia nights who need quick question generation
2. **Secondary**: Casual trivia enthusiasts building personal question libraries

## Core Requirements (Static)
- Two-step question generation workflow
- Unique categories across all question types
- AI-powered question generation (GPT-5.2)
- Manual question entry option
- Question library with like/dislike functionality
- CSV import with duplicate detection
- Trivia session builder

## What's Been Implemented (March 2026)

### Authentication
- JWT-based registration and login
- Protected routes with token refresh

### Two-Step Generate Flow
- **Step 1**: Batch category generation (9 T/F, 9 MC, 9 Written, 3 Picture)
- Category swap/regenerate per slot
- Category editing and removal
- **Step 2**: Question generation per category
- Like/dislike individual questions
- Bulk generation per question type

### Question Library
- View all questions with filters (type, status, source, category)
- Search across questions, categories, answers
- Manual question creation/editing
- Like/dislike/neutral status management
- Delete questions

### Trivia Session Builder
- Select questions by type (9 T/F, 9 MC, 9 Written, 3 Picture)
- Category uniqueness warning
- Save sessions with custom names
- View session details with copy to clipboard

### CSV Import
- Template download
- Column mapping: Category, Question, Answer, Options, Fun Fact, Venue, Date Used
- Duplicate detection
- Import progress reporting

### Dashboard
- Stats overview (total, liked, categories, sessions)
- Questions by type breakdown
- Questions by source breakdown
- Quick action cards

## Architecture
- **Frontend**: React 19, Tailwind CSS, Shadcn/UI, React Router
- **Backend**: FastAPI, Motor (async MongoDB), JWT auth
- **AI**: GPT-5.2 via emergentintegrations library
- **Database**: MongoDB

## Prioritized Backlog

### P0 (Critical) - DONE
- [x] Two-step category/question generation
- [x] Individual category swap
- [x] Question like/dislike
- [x] CSV import
- [x] Session builder

### P1 (High Priority) - Next Phase
- [ ] Picture question image upload
- [ ] AI image suggestions for picture rounds
- [ ] Export session as PDF/printable format
- [ ] Session history with date tracking

### P2 (Medium Priority)
- [ ] Category search in Step 1
- [ ] Favorite categories list
- [ ] Question difficulty rating
- [ ] Session templates (save category sets)

### P3 (Nice to Have)
- [ ] Multi-user collaboration
- [ ] Public question library sharing
- [ ] Score tracking integration
- [ ] Mobile-optimized presenter view

## Next Tasks
1. Add picture question image upload functionality
2. Implement PDF export for sessions
3. Add category search/filter in generation Step 1
4. Session scheduling with calendar integration
