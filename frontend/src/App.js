import React, { useState, useEffect } from 'react';
import './App.css';
import { QuestionProvider } from './QuestionContext';
import QuestionDashboard from './QuestionDashboard';
import QuestionUploader from './QuestionUploader';
import { buildApiUrl } from './config';

function App() {
  const [extractedText, setExtractedText] = useState('');
  const [processedText, setProcessedText] = useState('');
  const [activeTab, setActiveTab] = useState('ocr'); // 'ocr' or 'questions'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSource, setLastSource] = useState(''); // 'question' | 'upload'

  // Load Puter script
  useEffect(() => {
    if (window.puter || document.querySelector('script[data-puter-script="true"]')) {
      console.log('Puter script already available');
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;
    script.dataset.puterScript = 'true';
    script.onload = () => console.log('Puter script loaded');
    script.onerror = () => setError('Failed to load Puter script (external).');
    document.body.appendChild(script);
  }, []);

  const handleSetExtractedText = (text) => {
    setExtractedText(text || '');
    setProcessedText('');
    setLastSource('question');
  };

  // Preprocess when text comes from QuestionUploader
  useEffect(() => {
    if (!extractedText || lastSource !== 'question') return;

    (async () => {
      try {
        setLoading(true);
        setError('');
        const preprocessPayload = { text: String(extractedText) };
        const preprocessResponse = await fetch(buildApiUrl('/preprocess'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
    })();
  }, [extractedText, lastSource]);

  return (
    <QuestionProvider>
    <div className="container">
      <header className="header">
        <h1>AI-Assisted Exam Evaluator</h1>
        <p>Upload exam answer sheets for OCR and preprocessing</p>
        <div className="tab-switcher">
          <button
            className={`tab-btn ${activeTab === 'ocr' ? 'active' : ''}`}
            onClick={() => setActiveTab('ocr')}
          >
            OCR
          </button>
          <button
            className={`tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
            onClick={() => setActiveTab('questions')}
          >
            Question Management Dashboard
          </button>
        </div>
      </header>

      <main className="main">
        {activeTab === 'questions' ? (
          <QuestionDashboard />
        ) : (
          <>
          <section className="upload-section">
            <QuestionUploader onSetExtractedText={handleSetExtractedText} />
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
          {loading && <div className="info-chip">Preprocessing...</div>}
          </>
        )}
      </main>

      <footer className="footer">
        <p>Phase: Upload → Puter OCR → Text preprocessing → ML-based subjective answer similarity scoring</p>
      </footer>
    </div>
    </QuestionProvider>
  );
}

export default App;
