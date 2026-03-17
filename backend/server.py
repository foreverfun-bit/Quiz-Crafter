from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import base64
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import csv
import io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Uploads directory
UPLOADS_DIR = ROOT_DIR / 'uploads'
UPLOADS_DIR.mkdir(exist_ok=True)

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
    status: str = "neutral"  # neutral, liked, disliked, used
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
    exclude_questions: List[str] = []

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
    is_past: bool = False  # True for imported/past sessions
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TriviaSessionCreate(BaseModel):
    name: str
    true_false_questions: List[str] = []
    multiple_choice_questions: List[str] = []
    written_questions: List[str] = []
    picture_questions: List[str] = []
    is_past: bool = False

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
    include_used: bool = False,
    current_user: dict = Depends(get_current_user)
):
    # By default, exclude disliked and used questions
    query = {"user_id": current_user["id"], "status": {"$nin": ["disliked", "used"]}}
    
    if include_used:
        query["status"] = {"$ne": "disliked"}  # Only exclude disliked
    
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

@api_router.delete("/questions/all")
async def delete_all_questions(current_user: dict = Depends(get_current_user)):
    """Delete all questions for the current user"""
    result = await db.questions.delete_many({"user_id": current_user["id"]})
    await db.sessions.delete_many({"user_id": current_user["id"]})
    return {"message": f"Deleted {result.deleted_count} questions and all sessions"}

@api_router.delete("/questions/{question_id}")
async def delete_question(question_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.questions.delete_one(
        {"id": question_id, "user_id": current_user["id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"message": "Question deleted"}

class SaveQuestionRequest(BaseModel):
    id: str
    category: str
    question: str
    answer: str
    question_type: str
    options: Optional[List[str]] = None
    fun_fact: Optional[str] = None
    image_url: Optional[str] = None

@api_router.post("/questions/save", response_model=Question)
async def save_question(
    question_data: SaveQuestionRequest,
    current_user: dict = Depends(get_current_user)
):
    """Save a generated question to the library (when liked)"""
    # Check if question already exists
    existing = await db.questions.find_one({
        "id": question_data.id,
        "user_id": current_user["id"]
    })
    
    if existing:
        # Already saved, just update status to liked
        await db.questions.update_one(
            {"id": question_data.id},
            {"$set": {"status": "liked"}}
        )
        updated = await db.questions.find_one({"id": question_data.id}, {"_id": 0})
        return updated
    
    # Create new question with liked status
    question = Question(
        id=question_data.id,
        category=question_data.category,
        question=question_data.question,
        answer=question_data.answer,
        question_type=question_data.question_type,
        options=question_data.options,
        fun_fact=question_data.fun_fact,
        image_url=question_data.image_url,
        user_id=current_user["id"],
        source="ai",
        status="liked"
    )
    
    await db.questions.insert_one(question.model_dump())
    return question

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
    
    # Also get existing questions from DB for this category to avoid repeats
    existing_questions = await db.questions.find(
        {"user_id": current_user["id"], "category": request.category},
        {"_id": 0, "question": 1}
    ).to_list(100)
    existing_texts = [q["question"] for q in existing_questions]
    all_excluded = list(set(request.exclude_questions + existing_texts))
    
    exclude_block = ""
    if all_excluded:
        exclude_block = "\n\nDo NOT generate any of these questions (they were already used or rejected):\n" + "\n".join(f"- {q}" for q in all_excluded[:30])
    
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

Make questions engaging, varied in difficulty, and factually accurate.{exclude_block}"""

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
        
        # Return questions WITHOUT saving to database
        # They will only be saved when user likes them
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
            # NOT saving to database - just returning the question object
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
    import random
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    # Get all categories from user's questions
    all_categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    
    # Get disliked categories to exclude
    disliked_categories = await db.disliked_categories.distinct("category", {"user_id": current_user["id"]})
    
    # Available categories = all - disliked
    available_categories = [c for c in all_categories if c not in disliked_categories]
    
    total_needed = request.true_false_count + request.multiple_choice_count + request.written_count + request.picture_count
    
    # Shuffle available categories
    random.shuffle(available_categories)
    
    # If we have enough existing categories, use them directly
    if len(available_categories) >= total_needed:
        selected = available_categories[:total_needed]
        return BatchCategoryResponse(
            true_false=selected[:request.true_false_count],
            multiple_choice=selected[request.true_false_count:request.true_false_count + request.multiple_choice_count],
            written=selected[request.true_false_count + request.multiple_choice_count:request.true_false_count + request.multiple_choice_count + request.written_count],
            picture=selected[-request.picture_count:] if request.picture_count > 0 else []
        )
    
    # Otherwise, use available categories + generate more with AI
    categories_to_use = available_categories.copy()
    remaining_needed = total_needed - len(categories_to_use)
    
    if remaining_needed > 0:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"batch-category-gen-{uuid.uuid4()}",
            system_message="You are a trivia category generator for pub trivia nights."
        ).with_model("openai", "gpt-5.2")
        
        exclude_str = ", ".join(all_categories + disliked_categories) if (all_categories or disliked_categories) else "none"
        
        prompt = f"""Generate exactly {remaining_needed} unique trivia categories for a pub trivia night.

Use BROAD, GENERAL categories like:
Music, Movies, Television, Sports, History, Geography, Science, Food & Drink, Literature, Art, Animals, Technology, Politics, Celebrities, Video Games, Mythology, Space, Fashion, Business, Medicine

Requirements:
- ALL categories must be COMPLETELY UNIQUE
- Keep categories broad and general (one or two words ideally)
- AVOID these categories: {exclude_str}

Return ONLY a JSON array of category names, like: ["Category 1", "Category 2", ...]"""

        try:
            response = await chat.send_message(UserMessage(text=prompt))
            
            import json
            import re
            
            json_match = re.search(r'\[[\s\S]*\]', response)
            if json_match:
                new_categories = json.loads(json_match.group())
                categories_to_use.extend(new_categories[:remaining_needed])
        except Exception as e:
            logging.error(f"AI category generation error: {str(e)}")
    
    # Pad with defaults if still not enough
    default_categories = ["Music", "Movies", "Sports", "History", "Geography", "Science", "Food & Drink", 
                         "Television", "Literature", "Animals", "Technology", "Celebrities", "Video Games",
                         "Mythology", "Space", "Fashion", "Art", "Nature", "Politics", "Business"]
    while len(categories_to_use) < total_needed:
        for cat in default_categories:
            if cat not in categories_to_use and cat not in disliked_categories:
                categories_to_use.append(cat)
                if len(categories_to_use) >= total_needed:
                    break
    
    return BatchCategoryResponse(
        true_false=categories_to_use[:request.true_false_count],
        multiple_choice=categories_to_use[request.true_false_count:request.true_false_count + request.multiple_choice_count],
        written=categories_to_use[request.true_false_count + request.multiple_choice_count:request.true_false_count + request.multiple_choice_count + request.written_count],
        picture=categories_to_use[-request.picture_count:] if request.picture_count > 0 else []
    )


class SingleCategoryRequest(BaseModel):
    exclude_categories: List[str] = []

class SingleCategoryResponse(BaseModel):
    category: str

@api_router.post("/generate/single-category", response_model=SingleCategoryResponse)
async def generate_single_category(
    request: SingleCategoryRequest,
    current_user: dict = Depends(get_current_user)
):
    import random
    
    # First, try to pick from user's existing categories (same logic as batch)
    all_categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    disliked_categories = await db.disliked_categories.distinct("category", {"user_id": current_user["id"]})
    
    # Available = existing categories minus disliked and minus currently excluded (in-use)
    excluded_set = set(c.lower().strip() for c in request.exclude_categories)
    disliked_set = set(c.lower().strip() for c in disliked_categories)
    
    available_from_library = [
        c for c in all_categories 
        if c.lower().strip() not in excluded_set and c.lower().strip() not in disliked_set
    ]
    
    if available_from_library:
        random.shuffle(available_from_library)
        return SingleCategoryResponse(category=available_from_library[0])
    
    # Fall back to AI generation if no existing categories are available
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    used_categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    all_excluded = list(set(request.exclude_categories + used_categories + disliked_categories))
    
    chat = LlmChat(
        api_key=api_key,
        session_id=f"single-category-gen-{uuid.uuid4()}",
        system_message="You are a trivia category generator."
    ).with_model("openai", "gpt-5.2")
    
    exclude_str = ", ".join(all_excluded[:100]) if all_excluded else "none"
    
    prompt = f"""Generate ONE broad, general trivia category for a pub trivia night.

Examples of good broad categories: Music, Movies, Television, Sports, History, Geography, Science, Food & Drink, Literature, Animals, Technology, Celebrities, Video Games, Mythology, Space, Fashion

Requirements:
- Must be different from: {exclude_str}
- Keep it broad and general (one or two words)

Return ONLY the category name. No quotes, no explanation."""

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        category = response.strip().strip('"').strip("'")
        return SingleCategoryResponse(category=category)
    except Exception as e:
        logging.error(f"Single category generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Category generation failed: {str(e)}")

# ============ IMPORT ROUTES ============

@api_router.post("/import/preview")
async def preview_csv(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Preview CSV file to show detected columns and first few rows"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    content = await file.read()
    try:
        decoded = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            decoded = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            decoded = content.decode('latin-1')
    
    if decoded.startswith('\ufeff'):
        decoded = decoded[1:]
    
    reader = csv.DictReader(io.StringIO(decoded))
    fieldnames = reader.fieldnames or []
    
    # Get first 3 rows as preview
    preview_rows = []
    for i, row in enumerate(reader):
        if i >= 3:
            break
        preview_rows.append(dict(row))
    
    return {
        "columns": fieldnames,
        "preview": preview_rows,
        "row_count": len(preview_rows)
    }

@api_router.post("/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    content = await file.read()
    # Try different encodings
    try:
        decoded = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            decoded = content.decode('utf-8-sig')  # Handle BOM
        except UnicodeDecodeError:
            decoded = content.decode('latin-1')
    
    # Remove BOM if present
    if decoded.startswith('\ufeff'):
        decoded = decoded[1:]
    
    reader = csv.DictReader(io.StringIO(decoded))
    
    # Log the detected fieldnames for debugging
    fieldnames = reader.fieldnames or []
    logging.info(f"CSV Import - Detected columns: {fieldnames}")
    
    # Create a normalized column lookup (case-insensitive, whitespace-stripped)
    def find_column(row, possible_names):
        """Find a column value trying multiple possible header names"""
        for name in possible_names:
            # Direct match
            if name in row and row[name]:
                return row[name].strip()
        # Try case-insensitive match with whitespace handling
        row_lower = {k.lower().strip().replace('\t', ' '): v for k, v in row.items()}
        for name in possible_names:
            name_lower = name.lower().strip()
            if name_lower in row_lower and row_lower[name_lower]:
                return row_lower[name_lower].strip()
        return ''
    
    imported_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    
    # Group questions by date+venue for session creation
    session_groups = {}  # key: "date|venue" -> list of question IDs
    
    for row in reader:
        try:
            # Map CSV columns to question fields using flexible matching
            category = find_column(row, ['Category', 'category', 'CATEGORY'])
            question_text = find_column(row, ['Question', 'question', 'QUESTION'])
            answer = find_column(row, ['Answer', 'answer', 'ANSWER'])
            options_raw = find_column(row, ['Multiple choice options', 'Multiple Choice Options', 'options', 'Options', 'OPTIONS', 'Choices', 'choices'])
            fun_fact = find_column(row, ['Fun Fact', 'Fun fact', 'fun_fact', 'FunFact', 'Funfact', 'fun fact', 'FUN FACT'])
            venue = find_column(row, ['Venue', 'venue', 'VENUE', 'Location', 'location', 'LOCATION', 'Place', 'place'])
            date_used = find_column(row, ['Date Used', 'Date used', 'date used', 'date_used', 'DateUsed', 'DATE USED', 'Date', 'date', 'DATE', 'Used Date', 'used date', 'Used', 'used'])
            
            if not question_text or not answer:
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
            
            # Check if question already exists
            existing = await db.questions.find_one({
                "question": question_text,
                "user_id": current_user["id"]
            }, {"_id": 0})
            
            if existing:
                # Check if any field has new info to update
                updates = {}
                if category and category != existing.get("category"):
                    updates["category"] = category
                if answer != existing.get("answer"):
                    updates["answer"] = answer
                if options and options != existing.get("options"):
                    updates["options"] = options
                    updates["question_type"] = question_type
                if fun_fact and fun_fact != existing.get("fun_fact"):
                    updates["fun_fact"] = fun_fact
                if venue and venue != existing.get("venue"):
                    updates["venue"] = venue
                if date_used and date_used != existing.get("date_used"):
                    updates["date_used"] = date_used
                
                if updates:
                    # Update the existing question with new info
                    await db.questions.update_one(
                        {"id": existing["id"]},
                        {"$set": updates}
                    )
                    updated_count += 1
                    question_id = existing["id"]
                else:
                    # Truly a duplicate with no new info
                    skipped_count += 1
                    question_id = existing["id"]
            else:
                # Create new question
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
                    source="imported",
                    status="used"  # Mark as used so it doesn't appear in build session
                )
                
                await db.questions.insert_one(question.model_dump())
                imported_count += 1
                question_id = question.id
            
            # Group by date+venue for session creation
            if date_used:
                session_key = f"{date_used}|{venue or 'Unknown Venue'}"
                if session_key not in session_groups:
                    session_groups[session_key] = {
                        "date": date_used,
                        "venue": venue or "Unknown Venue",
                        "true_false": [],
                        "multiple_choice": [],
                        "written": [],
                        "picture": []
                    }
                session_groups[session_key][question_type].append(question_id)
            
        except Exception as e:
            errors.append(str(e))
    
    # Create sessions for each date+venue group
    sessions_created = 0
    for session_key, group in session_groups.items():
        # Create session name from date and venue
        session_name = f"{group['venue']} - {group['date']}"
        
        # Check if session already exists with this name
        existing_session = await db.sessions.find_one({
            "name": session_name,
            "user_id": current_user["id"]
        })
        
        if not existing_session:
            session = TriviaSession(
                name=session_name,
                user_id=current_user["id"],
                true_false_questions=group["true_false"],
                multiple_choice_questions=group["multiple_choice"],
                written_questions=group["written"],
                picture_questions=group["picture"],
                is_past=True  # Mark as past session
            )
            await db.sessions.insert_one(session.model_dump())
            sessions_created += 1
    
    return {
        "message": "Import complete",
        "imported": imported_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "sessions_created": sessions_created,
        "errors": errors[:10] if errors else []
    }

# ============ CATEGORIES ROUTES ============

@api_router.get("/categories", response_model=List[str])
async def get_categories(current_user: dict = Depends(get_current_user)):
    # Get all categories from questions
    categories = await db.questions.distinct("category", {"user_id": current_user["id"]})
    # Get disliked categories
    disliked = await db.disliked_categories.distinct("category", {"user_id": current_user["id"]})
    # Return only non-disliked categories
    return sorted([c for c in categories if c not in disliked])

@api_router.get("/categories/disliked", response_model=List[str])
async def get_disliked_categories(current_user: dict = Depends(get_current_user)):
    categories = await db.disliked_categories.distinct("category", {"user_id": current_user["id"]})
    return sorted(categories)

class DislikeCategoryRequest(BaseModel):
    category: str

@api_router.post("/categories/dislike")
async def dislike_category(
    request: DislikeCategoryRequest,
    current_user: dict = Depends(get_current_user)
):
    # Check if already disliked
    existing = await db.disliked_categories.find_one({
        "category": request.category,
        "user_id": current_user["id"]
    })
    if not existing:
        await db.disliked_categories.insert_one({
            "category": request.category,
            "user_id": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    return {"message": f"Category '{request.category}' hidden"}

@api_router.delete("/categories/dislike/{category}")
async def restore_category(
    category: str,
    current_user: dict = Depends(get_current_user)
):
    await db.disliked_categories.delete_one({
        "category": category,
        "user_id": current_user["id"]
    })
    return {"message": f"Category '{category}' restored"}

# ============ SESSIONS ROUTES ============

@api_router.get("/sessions", response_model=List[TriviaSession])
async def get_sessions(
    is_past: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {"user_id": current_user["id"]}
    if is_past is not None:
        query["is_past"] = is_past
    
    sessions = await db.sessions.find(
        query,
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
        picture_questions=session_data.picture_questions,
        is_past=session_data.is_past
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

# ============ SESSION EXPORT ============

@api_router.get("/sessions/{session_id}/export-csv")
async def export_session_csv(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await db.sessions.find_one(
        {"id": session_id, "user_id": current_user["id"]},
        {"_id": 0}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    all_question_ids = (
        session.get("true_false_questions", []) +
        session.get("multiple_choice_questions", []) +
        session.get("written_questions", []) +
        session.get("picture_questions", [])
    )
    
    questions = await db.questions.find(
        {"id": {"$in": all_question_ids}},
        {"_id": 0}
    ).to_list(200)
    questions_map = {q["id"]: q for q in questions}
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Category", "Question", "Answer", "Multiple Choice Options", "Fun Fact", "Question Type", "Venue", "Date Used"])
    
    type_map = {
        "true_false_questions": "true_false",
        "multiple_choice_questions": "multiple_choice",
        "written_questions": "written",
        "picture_questions": "picture"
    }
    
    for field, q_type in type_map.items():
        for qid in session.get(field, []):
            q = questions_map.get(qid)
            if not q:
                continue
            writer.writerow([
                q.get("category", ""),
                q.get("question", ""),
                q.get("answer", ""),
                ", ".join(q.get("options", []) or []),
                q.get("fun_fact", ""),
                q_type.replace("_", " ").title(),
                q.get("venue", ""),
                q.get("date_used", "")
            ])
    
    output.seek(0)
    safe_name = session.get("name", "session").replace(" ", "-")
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="trivia-{safe_name}.csv"'}
    )

# ============ IMAGE UPLOAD & GENERATION ============

@api_router.post("/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="File must be an image (JPEG, PNG, GIF, or WebP)")
    
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = UPLOADS_DIR / filename
    
    with open(filepath, "wb") as f:
        f.write(content)
    
    image_url = f"/api/uploads/{filename}"
    return {"image_url": image_url, "filename": filename}

class GenerateImageRequest(BaseModel):
    prompt: str
    category: str = ""

@api_router.post("/generate/image")
async def generate_image(
    request: GenerateImageRequest,
    current_user: dict = Depends(get_current_user)
):
    from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    image_gen = OpenAIImageGeneration(api_key=api_key)
    
    try:
        images = await image_gen.generate_images(
            prompt=request.prompt,
            model="gpt-image-1",
            number_of_images=1
        )
        
        if not images or len(images) == 0:
            raise HTTPException(status_code=500, detail="No image generated")
        
        filename = f"{uuid.uuid4()}.png"
        filepath = UPLOADS_DIR / filename
        with open(filepath, "wb") as f:
            f.write(images[0])
        
        image_url = f"/api/uploads/{filename}"
        image_b64 = base64.b64encode(images[0]).decode("utf-8")
        
        return {"image_url": image_url, "image_base64": image_b64}
    except Exception as e:
        logging.error(f"Image generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)}")

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

# Serve uploaded images
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

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
