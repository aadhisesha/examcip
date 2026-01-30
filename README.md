# AI-Assisted Exam Evaluator (v0.1)

A basic exam evaluator system that extracts text from exam answer sheets using OCR and preprocesses it for subjective evaluation.

## Project Structure

```
exam_eval/
├── backend/
│   ├── main.py              # FastAPI application
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── public/
│   │   └── index.html       # HTML template
│   ├── src/
│   │   ├── App.js           # React main component
│   │   ├── App.css          # Styling
│   │   └── index.js         # React entry point
│   └── package.json         # Node dependencies
└── README.md
```

## Tech Stack

- **Frontend**: React (functional components, hooks)
- **Backend**: Python FastAPI
- **OCR**: Puter AI (img2txt)
- **NLP**: NLTK for text preprocessing

## Features (Phase 1: ~30% Implementation)

✅ File upload (image/PDF)
✅ OCR text extraction via Puter AI
✅ Basic text preprocessing:
  - Lowercase conversion
  - Punctuation removal
  - Extra space normalization
  - Stopword removal
✅ Dual output display (extracted & processed text)

## Setup Instructions

### Backend Setup

1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment:
   ```bash
   python -m venv venv
   venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure Puter API (Optional):
   - Get API key from https://puter.com
   - Update `PUTER_API_KEY` in `main.py` line 25

5. Run the server:
   ```bash
   python main.py
   ```
   Server runs on: `http://localhost:8000`

### Frontend Setup

1. Navigate to frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start React app:
   ```bash
   npm start
   ```
   App opens on: `http://localhost:3000`

## Data Flow

```
File Upload (Frontend)
    ↓
FormData Sent to Backend
    ↓
File Read & Encoded to Base64
    ↓
Puter AI img2txt API Call
    ↓
Extracted Text
    ↓
Text Preprocessing (lowercase, remove punctuation, remove stopwords)
    ↓
JSON Response with Extracted & Processed Text
    ↓
Display in Two Text Areas (Frontend)
```

## API Endpoint

**POST** `/ocr`

Request:
```
multipart/form-data
- file: [image or PDF file]
```

Response:
```json
{
  "extracted_text": "The original OCR output...",
  "processed_text": "cleaned preprocessed text without stopwords..."
}
```

## Preprocessing Details

The `preprocess_text()` function applies:
1. **Lowercase**: Converts all characters to lowercase
2. **Remove Punctuation**: Keeps only alphanumeric and spaces
3. **Normalize Spaces**: Removes extra whitespace
4. **Remove Stopwords**: Filters common English words (the, is, and, etc.)

Output is ready for subjective evaluation in future phases.

## Notes

- Puter API key required for production OCR (demo mode returns placeholder text)
- PDF support requires additional pdf2image conversion
- CORS enabled for local development
- No ML-based evaluation in this version
- Future phases will add: TF-IDF, cosine similarity, and automated grading

## Next Steps (Future Versions)

- [ ] Implement TF-IDF vectorization
- [ ] Add cosine similarity for answer matching
- [ ] Build automated grading logic
- [ ] Add answer key management
- [ ] Implement subjective evaluation metrics
- [ ] Build admin dashboard

---

**Status**: 30% Implementation (Input → OCR → Preprocessing Phase)
