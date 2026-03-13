from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional

import nltk
import numpy as np
from nltk.corpus import stopwords
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "examcip")

mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
mongo_db = mongo_client[MONGODB_DB]
questions_collection = mongo_db["questions"]
evaluations_collection = mongo_db["evaluations"]
feedback_collection = mongo_db["feedback"]

questions_collection.create_index([("questionNumber", ASCENDING)], unique=True)
evaluations_collection.create_index([("questionNumber", ASCENDING), ("timestamp", DESCENDING)])
feedback_collection.create_index([("questionNumber", ASCENDING), ("timestamp", DESCENDING)])


class PreprocessRequest(BaseModel):
    text: str


class SubjectiveEvaluationRequest(BaseModel):
    answerKey: str
    studentAnswer: str
    questionText: str = ""
    questionNumber: Optional[str] = None
    questionType: str = "subjective"
    maxMarks: float = 10.0


class FeedbackCalibrationRequest(BaseModel):
    questionNumber: Optional[str] = None
    questionType: str = "subjective"
    studentAnswer: str
    basePercentage: float


class QuestionPayload(BaseModel):
    questionNumber: str
    questionType: str = "subjective"
    questionText: str
    answerKey: str = ""
    maxMarks: Optional[float] = 10.0
    rubrics: Optional[List[dict]] = []
    ocrText: str = ""
    uploads: Optional[List[dict]] = []
    fileExtractedTextMap: Optional[Dict[str, str]] = {}


def preprocess_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()

    stop_words = set(stopwords.words('english'))
    words = text.split()
    filtered_words = [word for word in words if word not in stop_words]
    return " ".join(filtered_words)


def split_sentences(text: str) -> List[str]:
    return [part.strip() for part in re.split(r"[.!?\n;]+", text) if part.strip()]


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def safe_tfidf_cosine(text_a: str, text_b: str) -> float:
    if not text_a.strip() or not text_b.strip():
        return 0.0

    try:
        vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2))
        matrix = vectorizer.fit_transform([text_a, text_b])
        return float(cosine_similarity(matrix[0:1], matrix[1:2])[0][0])
    except ValueError:
        return 0.0


def safe_char_cosine(text_a: str, text_b: str) -> float:
    if not text_a.strip() or not text_b.strip():
        return 0.0

    try:
        vectorizer = TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5))
        matrix = vectorizer.fit_transform([text_a, text_b])
        return float(cosine_similarity(matrix[0:1], matrix[1:2])[0][0])
    except ValueError:
        return 0.0


def compute_jaccard_similarity(text_a: str, text_b: str) -> float:
    tokens_a = set(text_a.split())
    tokens_b = set(text_b.split())
    if not tokens_a or not tokens_b:
        return 0.0

    union = tokens_a | tokens_b
    return float(len(tokens_a & tokens_b) / len(union)) if union else 0.0


def extract_keyword_coverage(answer_key: str, student_answer: str) -> Dict[str, object]:
    if not answer_key.strip():
        return {
            "coverage": 0.0,
            "keywords": [],
            "matchedKeywords": [],
            "missingKeywords": []
        }

    try:
        vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2), max_features=25)
        matrix = vectorizer.fit_transform([answer_key, student_answer])
        feature_names = vectorizer.get_feature_names_out()
        answer_weights = matrix[0].toarray()[0]
        ranked_keywords = [
            feature_names[idx]
            for idx in np.argsort(answer_weights)[::-1]
            if answer_weights[idx] > 0
        ]
    except ValueError:
        ranked_keywords = []

    keywords = ranked_keywords[:10]
    student_tokens = set(student_answer.split())
    matched_keywords = []
    missing_keywords = []
    match_scores = []

    for keyword in keywords:
        keyword_tokens = [token for token in keyword.split() if token]
        if not keyword_tokens:
            continue

        overlap_ratio = len([token for token in keyword_tokens if token in student_tokens]) / len(keyword_tokens)
        match_scores.append(overlap_ratio)

        if overlap_ratio >= 0.5 or keyword in student_answer:
            matched_keywords.append(keyword)
        else:
            missing_keywords.append(keyword)

    coverage = float(sum(match_scores) / len(match_scores)) if match_scores else 0.0

    return {
        "coverage": coverage,
        "keywords": keywords,
        "matchedKeywords": matched_keywords,
        "missingKeywords": missing_keywords
    }


def compute_sentence_coverage(answer_key_raw: str, student_answer_raw: str) -> float:
    answer_sentences = split_sentences(answer_key_raw)
    student_sentences = split_sentences(student_answer_raw)

    if not answer_sentences or not student_sentences:
        return 0.0

    try:
        vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2))
        matrix = vectorizer.fit_transform(answer_sentences + student_sentences)
        answer_matrix = matrix[:len(answer_sentences)]
        student_matrix = matrix[len(answer_sentences):]
        similarity_matrix = cosine_similarity(answer_matrix, student_matrix)
        return float(similarity_matrix.max(axis=1).mean())
    except ValueError:
        return 0.0


def compute_length_adequacy(answer_key: str, student_answer: str) -> float:
    answer_length = max(len(answer_key.split()), 1)
    student_length = len(student_answer.split())
    ratio = student_length / answer_length
    target_ratio = 0.85
    adequacy = ratio / target_ratio if ratio < target_ratio else 1.0
    return clamp(adequacy)


def serialize_mongo_document(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None

    output = dict(doc)
    if '_id' in output:
        output['id'] = str(output['_id'])
        del output['_id']
    return output


def load_feedback_records() -> List[dict]:
    try:
        records = list(feedback_collection.find({}))
        return [serialize_mongo_document(record) for record in records]
    except PyMongoError:
        return []


def compute_feedback_adjustment(question_number: Optional[str], question_type: Optional[str], student_answer: str, base_percentage: float) -> Dict[str, object]:
    normalized_type = (question_type or '').strip().lower()

    feedback_records = [
        record for record in load_feedback_records()
        if record.get('extractedText')
        and record.get('correctedMarks') is not None
        and (
            (question_number and record.get('questionNumber') == question_number)
            or (
                not question_number
                and normalized_type
                and str(record.get('questionType', '')).strip().lower() == normalized_type
            )
        )
    ]

    if len(feedback_records) < 2 or not student_answer.strip():
        return {
            "applied": False,
            "adjustedPercentage": base_percentage,
            "feedbackSimilarity": 0.0,
            "samplesUsed": len(feedback_records)
        }

    processed_samples = []
    valid_records = []
    for record in feedback_records:
        processed = preprocess_text(str(record.get('extractedText', '')))
        if processed.strip():
            processed_samples.append(processed)
            valid_records.append(record)

    if len(valid_records) < 2:
        return {
            "applied": False,
            "adjustedPercentage": base_percentage,
            "feedbackSimilarity": 0.0,
            "samplesUsed": len(valid_records)
        }

    try:
        vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2))
        matrix = vectorizer.fit_transform([student_answer] + processed_samples)
        similarities = cosine_similarity(matrix[0:1], matrix[1:]).ravel().tolist()
    except ValueError:
        similarities = []

    weighted_pairs = []
    for similarity, record in zip(similarities, valid_records):
        if similarity <= 0.12:
            continue

        corrected_marks = float(record.get('correctedMarks', 0))
        max_marks = float(record.get('maxMarks') or 10)
        if max_marks <= 0:
            continue

        weighted_pairs.append((similarity, clamp(corrected_marks / max_marks)))

    if not weighted_pairs:
        return {
            "applied": False,
            "adjustedPercentage": base_percentage,
            "feedbackSimilarity": 0.0,
            "samplesUsed": len(valid_records)
        }

    similarity_sum = sum(weight for weight, _ in weighted_pairs)
    learned_percentage = sum(weight * pct for weight, pct in weighted_pairs) / similarity_sum
    strongest_match = max(weight for weight, _ in weighted_pairs)
    blend_weight = clamp(0.18 + strongest_match * 0.18, 0.0, 0.35)
    adjusted_percentage = ((1 - blend_weight) * base_percentage) + (blend_weight * learned_percentage)

    return {
        "applied": True,
        "adjustedPercentage": float(clamp(adjusted_percentage)),
        "feedbackSimilarity": float(strongest_match),
        "samplesUsed": len(weighted_pairs)
    }


def build_subjective_justification(metrics: Dict[str, float], matched_keywords: List[str], missing_keywords: List[str]) -> str:
    strength = 'strong' if metrics['cosineSimilarity'] >= 0.75 else 'moderate' if metrics['cosineSimilarity'] >= 0.45 else 'limited'
    coverage = 'good' if metrics['keywordCoverage'] >= 0.65 else 'partial' if metrics['keywordCoverage'] >= 0.35 else 'low'

    parts = [f"The answer has {strength} overlap with the key answer and {coverage} concept coverage."]

    if matched_keywords:
        parts.append(f"Covered concepts: {', '.join(matched_keywords[:4])}.")

    if missing_keywords:
        parts.append(f"Needs clearer mention of: {', '.join(missing_keywords[:3])}.")

    return ' '.join(parts)


def evaluate_subjective_answer(payload: SubjectiveEvaluationRequest) -> Dict[str, object]:
    if payload.questionType.lower() != 'subjective':
        raise ValueError('ML evaluation is only available for subjective questions.')

    if not payload.answerKey.strip():
        raise ValueError('Answer key is required for subjective evaluation.')

    processed_answer_key = preprocess_text(payload.answerKey)
    processed_student_answer = preprocess_text(payload.studentAnswer)

    if not processed_student_answer:
        return {
            "evaluationType": "subjective_ml",
            "marks": 0.0,
            "maxMarks": payload.maxMarks,
            "justification": "The submitted answer is empty or too short to compare with the key answer.",
            "confidenceScore": 0.0,
            "method": "Hybrid TF-IDF similarity, keyword coverage, sentence alignment, and feedback calibration",
            "similarityBreakdown": {
                "cosineSimilarity": 0.0,
                "characterSimilarity": 0.0,
                "jaccardSimilarity": 0.0,
                "keywordCoverage": 0.0,
                "sentenceCoverage": 0.0,
                "lengthAdequacy": 0.0,
                "feedbackSimilarity": 0.0
            },
            "matchedKeywords": [],
            "missingKeywords": [],
            "calibrationApplied": False,
            "feedbackSamplesUsed": 0
        }

    cosine_score = safe_tfidf_cosine(processed_answer_key, processed_student_answer)
    char_cosine_score = safe_char_cosine(processed_answer_key, processed_student_answer)
    jaccard_score = compute_jaccard_similarity(processed_answer_key, processed_student_answer)
    keyword_details = extract_keyword_coverage(processed_answer_key, processed_student_answer)
    sentence_score = compute_sentence_coverage(payload.answerKey, payload.studentAnswer)
    length_score = compute_length_adequacy(processed_answer_key, processed_student_answer)

    raw_percentage = clamp(
        (0.24 * cosine_score) +
        (0.22 * char_cosine_score) +
        (0.14 * jaccard_score) +
        (0.22 * float(keyword_details['coverage'])) +
        (0.12 * sentence_score) +
        (0.06 * length_score)
    )

    feedback_adjustment = compute_feedback_adjustment(
        payload.questionNumber,
        payload.questionType,
        processed_student_answer,
        raw_percentage
    )
    final_percentage = float(feedback_adjustment['adjustedPercentage'])
    marks = round(final_percentage * payload.maxMarks, 2)

    metric_values = [cosine_score, char_cosine_score, jaccard_score, float(keyword_details['coverage']), sentence_score, length_score]
    confidence_score = clamp(float(sum(metric_values) / len(metric_values)) - (float(np.std(metric_values)) * 0.15))

    similarity_breakdown = {
        "cosineSimilarity": round(cosine_score, 4),
        "characterSimilarity": round(char_cosine_score, 4),
        "jaccardSimilarity": round(jaccard_score, 4),
        "keywordCoverage": round(float(keyword_details['coverage']), 4),
        "sentenceCoverage": round(sentence_score, 4),
        "lengthAdequacy": round(length_score, 4),
        "feedbackSimilarity": round(float(feedback_adjustment['feedbackSimilarity']), 4)
    }

    return {
        "evaluationType": "subjective_ml",
        "marks": marks,
        "maxMarks": payload.maxMarks,
        "justification": build_subjective_justification(
            similarity_breakdown,
            keyword_details['matchedKeywords'],
            keyword_details['missingKeywords']
        ),
        "confidenceScore": round(confidence_score, 4),
        "method": "Hybrid TF-IDF similarity, keyword coverage, sentence alignment, and feedback calibration",
        "similarityBreakdown": similarity_breakdown,
        "matchedKeywords": keyword_details['matchedKeywords'],
        "missingKeywords": keyword_details['missingKeywords'],
        "calibrationApplied": bool(feedback_adjustment['applied']),
        "feedbackSamplesUsed": int(feedback_adjustment['samplesUsed'])
    }


async def extract_text_from_file(file_content: bytes, file_name: str) -> str:
    try:
        encoded_file = base64.b64encode(file_content).decode('utf-8')

        file_ext = file_name.lower().split('.')[-1]
        if file_ext == 'pdf':
            mime_type = "application/pdf"
        else:
            mime_type = f"image/{file_ext}"

        return f"data:{mime_type};base64,{encoded_file}"
    except Exception as e:
        print(f"Error processing file: {str(e)}")
        return ""


@app.post("/ocr")
async def ocr_endpoint(file: UploadFile = File(...)):
    try:
        file_content = await file.read()
        data_url = await extract_text_from_file(file_content, file.filename)
        return {
            "data_url": data_url,
            "file_name": file.filename
        }
    except Exception as e:
        return {
            "error": str(e),
            "data_url": "",
            "file_name": ""
        }


@app.post("/preprocess")
async def preprocess_endpoint(request: PreprocessRequest):
    try:
        text = request.text
        if not text or not isinstance(text, str):
            return {
                "error": "Invalid text input",
                "extracted_text": "",
                "processed_text": ""
            }

        return {
            "extracted_text": text,
            "processed_text": preprocess_text(text)
        }
    except Exception as e:
        print(f"Preprocess error: {str(e)}")
        return {
            "error": str(e),
            "extracted_text": getattr(request, 'text', ''),
            "processed_text": ""
        }


@app.post("/evaluate-subjective")
async def evaluate_subjective_endpoint(request: SubjectiveEvaluationRequest):
    try:
        return evaluate_subjective_answer(request)
    except ValueError as e:
        return {
            "error": str(e),
            "evaluationType": "subjective_ml",
            "marks": 0.0,
            "maxMarks": request.maxMarks,
            "justification": "",
            "confidenceScore": 0.0,
            "similarityBreakdown": {
                "cosineSimilarity": 0.0,
                "characterSimilarity": 0.0,
                "jaccardSimilarity": 0.0,
                "keywordCoverage": 0.0,
                "sentenceCoverage": 0.0,
                "lengthAdequacy": 0.0,
                "feedbackSimilarity": 0.0
            }
        }


@app.post("/feedback-calibration")
async def feedback_calibration_endpoint(request: FeedbackCalibrationRequest):
    try:
        processed_answer = preprocess_text(request.studentAnswer)
        adjustment = compute_feedback_adjustment(
            request.questionNumber,
            request.questionType,
            processed_answer,
            clamp(request.basePercentage)
        )
        return {
            "status": "ok",
            "applied": bool(adjustment['applied']),
            "adjustedPercentage": float(adjustment['adjustedPercentage']),
            "feedbackSimilarity": float(adjustment['feedbackSimilarity']),
            "samplesUsed": int(adjustment['samplesUsed'])
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "applied": False,
            "adjustedPercentage": clamp(request.basePercentage),
            "feedbackSimilarity": 0.0,
            "samplesUsed": 0
        }


@app.get("/")
def read_root():
    return {"message": "Exam Evaluator API - OCR and subjective ML evaluation ready"}


@app.post('/feedback')
async def feedback_endpoint(payload: dict):
    try:
        record = dict(payload)
        record['timestamp'] = time.time()
        if record.get('correctedMarks') is not None and record.get('maxMarks') is None:
            record['maxMarks'] = payload.get('maxMarks', 10)
        if record.get('questionType') is None:
            record['questionType'] = str(payload.get('questionType', 'subjective')).lower()

        insert_result = feedback_collection.insert_one(record)
        return {'status': 'ok', 'id': str(insert_result.inserted_id)}
    except PyMongoError as e:
        return {'status': 'error', 'error': f'MongoDB error: {str(e)}'}
    except Exception as e:
        return {'status': 'error', 'error': str(e)}


@app.get('/questions')
async def list_questions():
    try:
        questions = [serialize_mongo_document(doc) for doc in questions_collection.find({}, {'_id': 1, 'questionNumber': 1, 'questionType': 1, 'questionText': 1, 'answerKey': 1, 'maxMarks': 1, 'rubrics': 1, 'ocrText': 1, 'uploads': 1, 'fileExtractedTextMap': 1})]
        questions = sorted(questions, key=lambda item: item.get('questionNumber', ''))

        for question in questions:
            latest_eval = evaluations_collection.find_one(
                {'questionNumber': question.get('questionNumber')},
                sort=[('timestamp', DESCENDING)]
            )
            question['lastEvaluation'] = serialize_mongo_document(latest_eval)

        return {'status': 'ok', 'questions': questions}
    except PyMongoError as e:
        return {'status': 'error', 'error': f'MongoDB error: {str(e)}', 'questions': []}


@app.post('/questions')
async def save_question(payload: QuestionPayload):
    try:
        question_doc = payload.dict()
        if not question_doc.get('questionNumber'):
            return {'status': 'error', 'error': 'questionNumber is required'}

        questions_collection.update_one(
            {'questionNumber': question_doc['questionNumber']},
            {'$set': question_doc},
            upsert=True
        )
        return {'status': 'ok'}
    except PyMongoError as e:
        return {'status': 'error', 'error': f'MongoDB error: {str(e)}'}


@app.delete('/questions/{question_number}')
async def delete_question(question_number: str):
    try:
        questions_collection.delete_one({'questionNumber': question_number})
        evaluations_collection.delete_many({'questionNumber': question_number})
        return {'status': 'ok'}
    except PyMongoError as e:
        return {'status': 'error', 'error': f'MongoDB error: {str(e)}'}


@app.post('/evaluations')
async def save_evaluation(payload: dict):
    try:
        question_number = str(payload.get('questionNumber', '')).strip()
        if not question_number:
            return {'status': 'error', 'error': 'questionNumber is required'}

        evaluation_doc = dict(payload)
        evaluation_doc['questionNumber'] = question_number
        evaluation_doc['timestamp'] = time.time()

        insert_result = evaluations_collection.insert_one(evaluation_doc)
        saved_doc = serialize_mongo_document(evaluation_doc)
        saved_doc['id'] = str(insert_result.inserted_id)
        return {'status': 'ok', 'evaluation': saved_doc}
    except PyMongoError as e:
        return {'status': 'error', 'error': f'MongoDB error: {str(e)}'}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
