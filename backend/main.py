from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import re
from nltk.corpus import stopwords
import nltk
from pathlib import Path

# Download stopwords if not already present
try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

app = FastAPI()

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create temp directory for uploaded files
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Pydantic model for preprocessing request
class PreprocessRequest(BaseModel):
    text: str

def preprocess_text(text: str) -> str:
    """
    Preprocess extracted text for subjective evaluation:
    - Convert to lowercase
    - Remove punctuation and special characters
    - Remove extra spaces
    - Remove common English stopwords
    """
    # Convert to lowercase
    text = text.lower()
    
    # Remove punctuation and special characters (keep alphanumeric and spaces)
    text = re.sub(f"[^a-z0-9\s]", "", text)
    
    # Remove extra spaces
    text = re.sub(r"\s+", " ", text).strip()
    
    # Remove stopwords
    stop_words = set(stopwords.words('english'))
    words = text.split()
    filtered_words = [word for word in words if word not in stop_words]
    processed_text = " ".join(filtered_words)
    
    return processed_text

async def extract_text_from_file(file_content: bytes, file_name: str) -> str:
    """
    Extract text from uploaded file.
    Converts to base64 data URL for frontend Puter chat API processing.
    Frontend uses puter.ai.chat() with GPT-5 nano for better OCR.
    """
    try:
        # Encode file to base64 for data URL
        encoded_file = base64.b64encode(file_content).decode('utf-8')
        
        # Determine MIME type
        file_ext = file_name.lower().split('.')[-1]
        if file_ext == 'pdf':
            mime_type = "application/pdf"
        else:
            mime_type = f"image/{file_ext}"
        
        # Create data URL
        data_url = f"data:{mime_type};base64,{encoded_file}"
        
        # Return data URL - frontend will use Puter's chat API with image analysis
        return data_url
    
    except Exception as e:
        print(f"Error processing file: {str(e)}")
        return ""

@app.post("/ocr")
async def ocr_endpoint(file: UploadFile = File(...)):
    """
    Main OCR endpoint:
    1. Accepts uploaded file (image or PDF)
    2. Returns data URL for frontend processing
    3. Frontend uses Puter chat API with GPT-5 nano for text extraction
    """
    try:
        # Read uploaded file
        file_content = await file.read()
        
        # Get data URL for frontend processing
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
    """
    Preprocess OCR extracted text for evaluation.
    Called by frontend after Puter chat extracts text.
    Expects JSON: {"text": "extracted text content"}
    """
    try:
        text = request.text
        if not text or not isinstance(text, str):
            return {
                "error": "Invalid text input",
                "extracted_text": "",
                "processed_text": ""
            }
        
        processed_text = preprocess_text(text)
        
        return {
            "extracted_text": text,
            "processed_text": processed_text
        }
    
    except Exception as e:
        print(f"Preprocess error: {str(e)}")
        return {
            "error": str(e),
            "extracted_text": getattr(request, 'text', ''),
            "processed_text": ""
        }

@app.get("/")
def read_root():
    return {"message": "Exam Evaluator API - OCR Service Ready"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
