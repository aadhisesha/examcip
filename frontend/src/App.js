import React, { useState, useEffect } from 'react';
import './App.css';
import { QuestionProvider } from './QuestionContext';
import QuestionDashboard from './QuestionDashboard';

function App() {
  const [file, setFile] = useState(null);
  const [extractedText, setExtractedText] = useState('');
  const [processedText, setProcessedText] = useState('');
  const [activeTab, setActiveTab] = useState('ocr'); // 'ocr' or 'questions'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load Puter script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setError('');
    setExtractedText('');
    setProcessedText('');

    try {
      // Step 1: Upload file to backend
      const formData = new FormData();
      formData.append('file', file);

      const uploadResponse = await fetch('http://localhost:8000/ocr', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }

      const uploadData = await uploadResponse.json();
      
      if (uploadData.error) {
        throw new Error(uploadData.error);
      }

      const dataUrl = uploadData.data_url;

      // Step 2: Use Puter chat API with GPT-5 nano for image analysis
      if (!window.puter) {
        throw new Error('Puter library not loaded. Please check your internet connection.');
      }

      let extractedTextContent = '';
      
      try {
        extractedTextContent = await window.puter.ai.chat(
          'Extract all the text from this image and return it as a paragraph. Only return the text, nothing else.',
          dataUrl,
          { model: 'gpt-5-nano' }
        );
      } catch (puterError) {
        throw new Error(`Puter chat API failed: ${puterError.message}`);
      }

      setExtractedText(extractedTextContent);

      // Step 3: Send extracted text to backend for preprocessing
      console.log('Sending text to preprocess:', extractedTextContent);
      
      const preprocessPayload = { text: String(extractedTextContent) };
      console.log('Payload:', JSON.stringify(preprocessPayload));
      
      const preprocessResponse = await fetch('http://localhost:8000/preprocess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preprocessPayload),
      });

      if (!preprocessResponse.ok) {
        const errorData = await preprocessResponse.json().catch(() => ({}));
        console.error('Preprocess error:', errorData);
        throw new Error(`Failed to preprocess text: ${preprocessResponse.status}`);
      }

      const preprocessData = await preprocessResponse.json();
      setProcessedText(preprocessData.processed_text || '');

    } catch (err) {
      setError(`Error: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <QuestionProvider>
    <div className="container">
      <header className="header">
        <h1>AI-Assisted Exam Evaluator</h1>
        <p>Upload exam answer sheets for OCR and preprocessing</p>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setActiveTab('ocr')} style={{ marginRight: 8, fontWeight: activeTab === 'ocr' ? '700' : '400' }}>OCR</button>
          <button onClick={() => setActiveTab('questions')} style={{ fontWeight: activeTab === 'questions' ? '700' : '400' }}>Question Management Dashboard</button>
        </div>
      </header>

      <main className="main">
        {activeTab === 'questions' ? (
          <QuestionDashboard />
        ) : (
          <>
        <section className="upload-section">
          <form onSubmit={handleUpload}>
            <div className="file-input-wrapper">
              <label htmlFor="file-input" className="file-label">
                Choose Image or PDF
              </label>
              <input
                id="file-input"
                type="file"
                onChange={handleFileChange}
                accept="image/*,.pdf"
                disabled={loading}
              />
              {file && <p className="file-name">Selected: {file.name}</p>}
            </div>

            <button 
              type="submit" 
              className="upload-btn"
              disabled={loading || !file}
            >
              {loading ? 'Processing...' : 'Upload & Process'}
            </button>
          </form>

          {error && <div className="error-message">{error}</div>}
          </section>

          <section className="results-section">
            <div className="text-area-wrapper">
              <label htmlFor="extracted">Extracted Text (Puter AI Chat)</label>
              <textarea
                id="extracted"
                value={extractedText}
                readOnly
                placeholder="OCR extracted text will appear here..."
              />
            </div>

            <div className="text-area-wrapper">
              <label htmlFor="processed">Preprocessed Text</label>
              <textarea
                id="processed"
                value={processedText}
                readOnly
                placeholder="Cleaned and preprocessed text will appear here..."
              />
            </div>
          </section>
          </>
        )}
      </main>

      <footer className="footer">
        <p>Phase: Upload → Puter Chat GPT-5 nano → Text Preprocessing | Ready for subjective evaluation</p>
      </footer>
    </div>
    </QuestionProvider>
  );
}

export default App;
