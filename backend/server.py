from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import csv
import io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET', 'trivia-forge-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Security
security = HTTPBearer()

# Create the main app
app = FastAPI(title="Trivia Forge API")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

# ============ MODELS ============

class UserCreate(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    created_at: str

class TokenResponse(BaseModel):
    token: str
    user: UserResponse

class QuestionType:
    TRUE_FALSE = "true_false"
    MULTIPLE_CHOICE = "multiple_choice"
    WRITTEN = "written"
    PICTURE = "picture"

class Question(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: str
    question: str
    answer: str
    question_type: str  # true_false, multiple_choice, written, picture
    options: Optional[List[str]] = None  # For multiple choice
    fun_fact: Optional[str] = None
    image_url: Optional[str] = None  # For picture questions
    venue: Optional[str] = None
    date_used: Optional[str] = None
    user_id: str
    status: str = "neutral"  # neutral, liked, disliked
    source: str = "manual"  # manual, ai, imported
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class QuestionCreate(BaseModel):
    category: str
    question: str
    answer: str
    question_type: str
    options: Optional[List[str]] = None
    fun_fact: Optional[str] = None
    image_url: Optional[str] = None
    venue: Optional[str] = None
    date_used: Optional[str] = None

class GenerateQuestionsRequest(BaseModel):
    category: str
    question_type: str
    count: int = 5

class CategoryResponse(BaseModel):
    categories: List[str]

class TriviaSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    user_id: str
    true_false_questions: List[str] = []  # Question IDs
    multiple_choice_questions: List[str] = []
    written_questions: List[str] = []
    picture_questions: List[str] = []
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TriviaSessionCreate(BaseModel):
    name: str
    true_false_questions: List[str] = []
    multiple_choice_questions: List[str] = []
    written_questions: List[str] = []
    picture_questions: List[str] = []

# ============ AUTH HELPERS ============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ============ AUTH ROUTES ============

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": user_data.email,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id)
    return TokenResponse(
        token=token,
        user=UserResponse(
            id=user_id,
            email=user_data.email,
            name=user_data.name,
            created_at=user_doc["created_at"]
        )
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user["id"])
    return TokenResponse(
        token=token,
        user=UserResponse(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            created_at=user["created_at"]
        )
    )

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        name=current_user["name"],
        created_at=current_user["created_at"]
    )

# ============ QUESTIONS ROUTES ============

@api_router.get("/questions", response_model=List[Question])
async def get_questions(
    status: Optional[str] = None,
    question_type: Optional[str] = None,
    category: Optional[str] = None,
    source: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {"user_id": current_user["id"], "status": {"$ne": "disliked"}}
    
    if status:
        query["status"] = status
    if question_type:
        query["question_type"] = question_type
    if category:
        query["category"] = {"$regex": category, "$options": "i"}
    if source:
        query["source"] = source
    if search:
        query["$or"] = [
            {"question": {"$regex": search, "$options": "i"}},
            {"category": {"$regex": search, "$options": "i"}},
            {"answer": {"$regex": search, "$options": "i"}}
        ]
    
    questions = await db.questions.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return questions

@api_router.get("/questions/all", response_model=List[Question])
async def get_all_questions(
    include_disliked: bool = False,
    current_user: dict = Depends(get_current_user)
):
    query = {"user_id": current_user["id"]}
    if not include_disliked:
        query["status"] = {"$ne": "disliked"}
    
    questions = await db.questions.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return questions

@api_router.get("/questions/{question_id}", response_model=Question)
async def get_question(question_id: str, current_user: dict = Depends(get_current_user)):
    question = await db.questions.find_one(
        {"id": question_id, "user_id": current_user["id"]},
        {"_id": 0}
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    return question

@api_router.post("/questions", response_model=Question)
async def create_question(question_data: QuestionCreate, current_user: dict = Depends(get_current_user)):
    question = Question(
        category=question_data.category,
        question=question_data.question,
        answer=question_data.answer,
        question_type=question_data.question_type,
        options=question_data.options,
        fun_fact=question_data.fun_fact,
        image_url=question_data.image_url,
        venue=question_data.venue,
        date_used=question_data.date_used,
        user_id=current_user["id"],
        source="manual"
    )
    await db.questions.insert_one(question.model_dump())
    return question

@api_router.put("/questions/{question_id}", response_model=Question)
async def update_question(
    question_id: str,
    question_data: QuestionCreate,
    current_user: dict = Depends(get_current_user)
):
    existing = await db.questions.find_one(
        {"id": question_id, "user_id": current_user["id"]}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Question not found")
    
    update_data = question_data.model_dump(exclude_unset=True)
    await db.questions.update_one(
        {"id": question_id},
        {"$set": update_data}
    )
    
    updated = await db.questions.find_one({"id": question_id}, {"_id": 0})
    return updated

@api_router.delete("/questions/{question_id}")
async def delete_question(question_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.questions.delete_one(
        {"id": question_id, "user_id": current_user["id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question deleted"}

@api_router.patch("/questions/{question_id}/like")
async def like_question(question_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.questions.update_one(
        {"id": question_id, "user_id": current_user["id"]},
        {"$set": {"status": "liked"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question liked"}

@api_router.patch("/questions/{question_id}/dislike")
async def dislike_question(question_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.questions.update_one(
        {"id": question_id, "user_id": current_user["id"]},
        {"$set": {"status": "disliked"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question disliked"}

@api_router.patch("/questions/{question_id}/neutral")
async def neutral_question(question_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.questions.update_one(
        {"id": question_id, "user_id": current_user["id"]},
        {"$set": {"status": "neutral"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question status reset"}

# ============ AI GENERATION ROUTES ============

@api_router.post("/generate/questions", response_model=List[Question])
async def generate_questions(
    request: GenerateQuestionsRequest,
    current_user: dict = Depends(get_current_user)
):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    chat = LlmChat(
        api_key=api_key,
        session_id=f"trivia-gen-{uuid.uuid4()}",
        system_message="You are a trivia question generator. Generate creative, interesting trivia questions with accurate answers."
    ).with_model("openai", "gpt-5.2")
    
    type_instructions = {
        "true_false": "Generate True/False questions. The answer should be exactly 'True' or 'False'.",
        "multiple_choice": "Generate multiple choice questions with exactly 4 options (A, B, C, D). Provide the options as a list and indicate which one is correct.",
        "written": "Generate written answer questions where the answer is a short phrase or word.",
        "picture": "Generate questions that would be good for picture rounds (identifying famous people, places, logos, etc.)."
    }
    
    mc_line = "4. Four answer options (for multiple choice)" if request.question_type == "multiple_choice" else ""
    options_json = '"options": ["A. option1", "B. option2", "C. option3", "D. option4"],' if request.question_type == "multiple_choice" else ""
    
    prompt = f"""Generate {request.count} {request.question_type.replace('_', ' ')} trivia questions about the category: "{request.category}".

{type_instructions.get(request.question_type, '')}

For each question, provide:
1. The question text
2. The correct answer
3. A fun fact related to the answer
{mc_line}

Format your response as JSON array with this structure:
[
  {{
    "question": "question text",
    "answer": "correct answer",
    "fun_fact": "interesting fact",
    {options_json}
  }}
]

Make questions engaging, varied in difficulty, and factually accurate."""

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        
        # Parse JSON from response
        import json
        import re
        
        # Extract JSON from response
        json_match = re.search(r'\[[\s\S]*\]', response)
        if not json_match:
            raise HTTPException(status_code=500, detail="Failed to parse AI response")
        
        questions_data = json.loads(json_match.group())
        
        generated_questions = []
        for q_data in questions_data:
            question = Question(
                category=request.category,
                question=q_data.get("question", ""),
                answer=q_data.get("answer", ""),
                question_type=request.question_type,
                options=q_data.get("options") if request.question_type == "multiple_choice" else None,
                fun_fact=q_data.get("fun_fact"),
                user_id=current_user["id"],
                source="ai"
            )
            await db.questions.insert_one(question.model_dump())
            generated_questions.append(question)
        
        return generated_questions
    except Exception as e:
        logging.error(f"AI generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

@api_router.post("/generate/categories", response_model=CategoryResponse)
async def generate_categories(current_user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    # Get used categories to avoid repetition
    used_categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    
    chat = LlmChat(
        api_key=api_key,
        session_id=f"category-gen-{uuid.uuid4()}",
        system_message="You are a creative trivia category generator."
    ).with_model("openai", "gpt-5.2")
    
    prompt = f"""Generate 30 unique, interesting trivia categories that would work well for a pub trivia night.

Categories should be:
- Broad enough to generate multiple questions
- Interesting and engaging
- Varied (mix of history, pop culture, science, sports, geography, etc.)
- Not too niche or obscure

{"Avoid these already-used categories: " + ", ".join(used_categories[:50]) if used_categories else ""}

Return ONLY a JSON array of category names, like: ["Category 1", "Category 2", ...]"""

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        
        import json
        import re
        
        json_match = re.search(r'\[[\s\S]*\]', response)
        if not json_match:
            raise HTTPException(status_code=500, detail="Failed to parse AI response")
        
        categories = json.loads(json_match.group())
        return CategoryResponse(categories=categories)
    except Exception as e:
        logging.error(f"Category generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Category generation failed: {str(e)}")


class BatchCategoryRequest(BaseModel):
    true_false_count: int = 9
    multiple_choice_count: int = 9
    written_count: int = 9
    picture_count: int = 3

class BatchCategoryResponse(BaseModel):
    true_false: List[str]
    multiple_choice: List[str]
    written: List[str]
    picture: List[str]

@api_router.post("/generate/categories-batch", response_model=BatchCategoryResponse)
async def generate_categories_batch(
    request: BatchCategoryRequest,
    current_user: dict = Depends(get_current_user)
):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    # Get used categories to avoid repetition
    used_categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    
    total_needed = request.true_false_count + request.multiple_choice_count + request.written_count + request.picture_count
    
    chat = LlmChat(
        api_key=api_key,
        session_id=f"batch-category-gen-{uuid.uuid4()}",
        system_message="You are a creative trivia category generator for pub trivia nights."
    ).with_model("openai", "gpt-5.2")
    
    exclude_str = ", ".join(used_categories[:100]) if used_categories else "none"
    
    prompt = f"""Generate exactly {total_needed} unique, broad trivia categories for a pub trivia night.

I need:
- {request.true_false_count} categories suitable for TRUE/FALSE questions
- {request.multiple_choice_count} categories suitable for MULTIPLE CHOICE questions  
- {request.written_count} categories suitable for WRITTEN ANSWER questions
- {request.picture_count} categories suitable for PICTURE ROUND questions (identifying people, places, logos, etc.)

Requirements:
- ALL {total_needed} categories must be COMPLETELY UNIQUE (no duplicates)
- Categories should be broad enough for multiple questions
- Mix of history, pop culture, science, sports, geography, entertainment, food, music, etc.
- Avoid these already-used categories: {exclude_str}

Return ONLY a JSON object with this exact structure:
{{
  "true_false": ["category1", "category2", ...],
  "multiple_choice": ["category1", "category2", ...],
  "written": ["category1", "category2", ...],
  "picture": ["category1", "category2", ...]
}}"""

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        
        import json
        import re
        
        # Extract JSON object from response
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            raise HTTPException(status_code=500, detail="Failed to parse AI response")
        
        data = json.loads(json_match.group())
        
        return BatchCategoryResponse(
            true_false=data.get("true_false", [])[:request.true_false_count],
            multiple_choice=data.get("multiple_choice", [])[:request.multiple_choice_count],
            written=data.get("written", [])[:request.written_count],
            picture=data.get("picture", [])[:request.picture_count]
        )
    except json.JSONDecodeError as e:
        logging.error(f"JSON parse error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response as JSON")
    except Exception as e:
        logging.error(f"Batch category generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Category generation failed: {str(e)}")


class SingleCategoryRequest(BaseModel):
    exclude_categories: List[str] = []

class SingleCategoryResponse(BaseModel):
    category: str

@api_router.post("/generate/single-category", response_model=SingleCategoryResponse)
async def generate_single_category(
    request: SingleCategoryRequest,
    current_user: dict = Depends(get_current_user)
):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    # Also get used categories from database
    used_categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    all_excluded = list(set(request.exclude_categories + used_categories))
    
    chat = LlmChat(
        api_key=api_key,
        session_id=f"single-category-gen-{uuid.uuid4()}",
        system_message="You are a creative trivia category generator."
    ).with_model("openai", "gpt-5.2")
    
    exclude_str = ", ".join(all_excluded[:100]) if all_excluded else "none"
    
    prompt = f"""Generate exactly ONE unique, broad trivia category for a pub trivia night.

Requirements:
- Must be different from these existing categories: {exclude_str}
- Should be broad enough to generate multiple questions
- Can be from any topic: history, pop culture, science, sports, geography, entertainment, etc.

Return ONLY the category name as a plain string, nothing else. No quotes, no JSON, just the category name."""

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        
        # Clean up the response
        category = response.strip().strip('"').strip("'")
        
        return SingleCategoryResponse(category=category)
    except Exception as e:
        logging.error(f"Single category generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Category generation failed: {str(e)}")

# ============ IMPORT ROUTES ============

@api_router.post("/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    content = await file.read()
    decoded = content.decode('utf-8')
    reader = csv.DictReader(io.StringIO(decoded))
    
    imported_count = 0
    skipped_count = 0
    errors = []
    
    for row in reader:
        try:
            # Map CSV columns to question fields
            category = row.get('Category', row.get('category', '')).strip()
            question_text = row.get('Question', row.get('question', '')).strip()
            answer = row.get('Answer', row.get('answer', '')).strip()
            options_raw = row.get('Multiple choice options', row.get('options', '')).strip()
            fun_fact = row.get('Fun Fact', row.get('fun_fact', '')).strip()
            venue = row.get('Venue', row.get('venue', '')).strip()
            date_used = row.get('Date Used', row.get('date_used', '')).strip()
            
            if not question_text or not answer:
                continue
            
            # Check if question already exists
            existing = await db.questions.find_one({
                "question": question_text,
                "user_id": current_user["id"]
            })
            
            if existing:
                skipped_count += 1
                continue
            
            # Determine question type based on answer and options
            options = None
            if options_raw:
                options = [opt.strip() for opt in options_raw.split(',') if opt.strip()]
                question_type = "multiple_choice"
            elif answer.lower() in ['true', 'false']:
                question_type = "true_false"
            else:
                question_type = "written"
            
            question = Question(
                category=category or "Imported",
                question=question_text,
                answer=answer,
                question_type=question_type,
                options=options,
                fun_fact=fun_fact or None,
                venue=venue or None,
                date_used=date_used or None,
                user_id=current_user["id"],
                source="imported"
            )
            
            await db.questions.insert_one(question.model_dump())
            imported_count += 1
            
        except Exception as e:
            errors.append(str(e))
    
    return {
        "message": f"Import complete",
        "imported": imported_count,
        "skipped": skipped_count,
        "errors": errors[:10] if errors else []
    }

# ============ CATEGORIES ROUTES ============

@api_router.get("/categories", response_model=List[str])
async def get_categories(current_user: dict = Depends(get_current_user)):
    categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    return sorted(categories)

# ============ SESSIONS ROUTES ============

@api_router.get("/sessions", response_model=List[TriviaSession])
async def get_sessions(current_user: dict = Depends(get_current_user)):
    sessions = await db.sessions.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return sessions

@api_router.post("/sessions", response_model=TriviaSession)
async def create_session(
    session_data: TriviaSessionCreate,
    current_user: dict = Depends(get_current_user)
):
    session = TriviaSession(
        name=session_data.name,
        user_id=current_user["id"],
        true_false_questions=session_data.true_false_questions,
        multiple_choice_questions=session_data.multiple_choice_questions,
        written_questions=session_data.written_questions,
        picture_questions=session_data.picture_questions
    )
    await db.sessions.insert_one(session.model_dump())
    return session

@api_router.get("/sessions/{session_id}")
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await db.sessions.find_one(
        {"id": session_id, "user_id": current_user["id"]},
        {"_id": 0}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Get all questions for this session
    all_question_ids = (
        session.get("true_false_questions", []) +
        session.get("multiple_choice_questions", []) +
        session.get("written_questions", []) +
        session.get("picture_questions", [])
    )
    
    questions = await db.questions.find(
        {"id": {"$in": all_question_ids}},
        {"_id": 0}
    ).to_list(100)
    
    questions_map = {q["id"]: q for q in questions}
    
    return {
        **session,
        "questions": questions_map
    }

@api_router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.sessions.delete_one(
        {"id": session_id, "user_id": current_user["id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted"}

# ============ STATS ROUTES ============

@api_router.get("/stats")
async def get_stats(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    
    total_questions = await db.questions.count_documents({"user_id": user_id})
    liked_count = await db.questions.count_documents({"user_id": user_id, "status": "liked"})
    disliked_count = await db.questions.count_documents({"user_id": user_id, "status": "disliked"})
    imported_count = await db.questions.count_documents({"user_id": user_id, "source": "imported"})
    ai_count = await db.questions.count_documents({"user_id": user_id, "source": "ai"})
    sessions_count = await db.sessions.count_documents({"user_id": user_id})
    
    # Count by type
    tf_count = await db.questions.count_documents({"user_id": user_id, "question_type": "true_false"})
    mc_count = await db.questions.count_documents({"user_id": user_id, "question_type": "multiple_choice"})
    written_count = await db.questions.count_documents({"user_id": user_id, "question_type": "written"})
    picture_count = await db.questions.count_documents({"user_id": user_id, "question_type": "picture"})
    
    categories = await db.questions.distinct("category", {"user_id": user_id})
    
    return {
        "total_questions": total_questions,
        "liked_count": liked_count,
        "disliked_count": disliked_count,
        "imported_count": imported_count,
        "ai_generated_count": ai_count,
        "sessions_count": sessions_count,
        "categories_count": len(categories),
        "by_type": {
            "true_false": tf_count,
            "multiple_choice": mc_count,
            "written": written_count,
            "picture": picture_count
        }
    }

# Include router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
