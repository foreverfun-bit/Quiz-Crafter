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

## What's Been Implemented

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
- **Picture Questions**: Upload own images or AI-generate images (GPT Image 1)

### Question Library
- View all questions with filters (type, status, source, category)
- Search across questions, categories, answers
- Manual question creation/editing
- Like/dislike/neutral status management
- Delete questions
- Image display for picture questions

### Trivia Session Builder
- Select questions by type (9 T/F, 9 MC, 9 Written, 3 Picture)
- Category uniqueness warning
- Save sessions with custom names
- Built sessions auto-move to Past Sessions (is_past: true)
- View session details with copy to clipboard

### CSV Import
- Template download
- Column mapping: Category, Question, Answer, Options, Fun Fact, Venue, Date Used
- Duplicate detection with update capability
- Import progress reporting

### CSV Export
- Export any session as CSV file
- Proper headers: Category, Question, Answer, MC Options, Fun Fact, Type, Venue, Date Used
- Available on both Session Detail and Past Sessions pages

### Theme Round Generator
- Separate tab on Generate page: "Standard" vs "Theme Round"
- Search/type any subject to generate a mixed round
- Generates exactly 3 T/F + 3 MC + 3 Written + 1 Picture per subject
- Multiple theme rounds simultaneously
- Like/dislike/regenerate/delete per round
- Disliked questions excluded on regeneration
- Image upload/AI generation for picture questions
- State persisted to localStorage
- Image upload (JPEG, PNG, GIF, WebP, max 10MB)
- AI image generation via OpenAI GPT Image 1
- Image display in Generate, Library, and Session Detail pages
- Images served from /api/uploads/

### Dashboard
- Stats overview (total, liked, categories, sessions)
- Questions by type breakdown
- Questions by source breakdown
- Quick action cards

### Category Management
- Categories page for viewing all categories
- Dislike categories to hide from future generation
- Restore disliked categories
- Dashboard links to categories page

### State Persistence
- Generate page saves state to localStorage
- Build Session page saves state to localStorage
- Clear/Start Fresh buttons on both pages

## Architecture
- **Frontend**: React 19, Tailwind CSS, Shadcn/UI, React Router
- **Backend**: FastAPI, Motor (async MongoDB), JWT auth
- **AI**: GPT-5.2 via emergentintegrations (text), GPT Image 1 via emergentintegrations (images)
- **Database**: MongoDB
- **File Storage**: Local /app/backend/uploads/ served via /api/uploads/

## Prioritized Backlog

### P0 (Critical) - DONE
- [x] Two-step category/question generation
- [x] Individual category swap
- [x] Question like/dislike
- [x] CSV import
- [x] Session builder
- [x] CSV export
- [x] Picture question image upload
- [x] AI image generation for picture rounds
- [x] Built sessions auto-move to Past Sessions
- [x] Fix DELETE /api/questions/all endpoint
- [x] Fix PUT /api/questions/{id} endpoint

### P1 (High Priority) - Next Phase
- [ ] Session scheduling with calendar integration
- [ ] Session templates (save category sets)
- [ ] Question difficulty rating

### P2 (Medium Priority)
- [ ] Category search in Step 1
- [ ] Favorite categories list
- [ ] Batch export all sessions

### P3 (Nice to Have)
- [ ] Multi-user collaboration
- [ ] Public question library sharing
- [ ] Score tracking integration
- [ ] Mobile-optimized presenter view
