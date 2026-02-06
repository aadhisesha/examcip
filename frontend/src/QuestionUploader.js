import React, { useContext, useEffect, useRef, useState } from 'react';
import { QuestionContext } from './QuestionContext';

// Simple image cropper canvas component
function ImageCropper({ dataUrl, onCrop }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [rect, setRect] = useState(null);
  const dragging = useRef(false);
  const start = useRef([0, 0]);

  useEffect(() => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
  }, [dataUrl]);

  const redraw = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    if (rect) {
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  };

  useEffect(redraw, [rect]);

  const onDown = (e) => {
    const canvas = canvasRef.current;
    const rectCanvas = canvas.getBoundingClientRect();
    const x = e.clientX - rectCanvas.left;
    const y = e.clientY - rectCanvas.top;
    start.current = [x, y];
    dragging.current = true;
    setRect({ x, y, w: 0, h: 0 });
  };

  const onMove = (e) => {
    if (!dragging.current) return;
    const canvas = canvasRef.current;
    const rectCanvas = canvas.getBoundingClientRect();
    const x = e.clientX - rectCanvas.left;
    const y = e.clientY - rectCanvas.top;
    const sx = start.current[0];
    const sy = start.current[1];
    setRect({ x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) });
  };

  const onUp = () => {
    dragging.current = false;
  };

  const handleCrop = () => {
    if (!rect) return;
    const canvas = document.createElement('canvas');
    canvas.width = rect.w;
    canvas.height = rect.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgRef.current, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    canvas.toBlob((b) => {
      const croppedUrl = URL.createObjectURL(b);
      onCrop(b, croppedUrl);
    }, 'image/png');
  };

  return (
    <div>
      <canvas ref={canvasRef} style={{ border: '1px solid #ccc', maxWidth: '100%' }} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} />
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={handleCrop}>Crop Selection</button>
      </div>
    </div>
  );
}

export default function QuestionUploader({ onSetExtractedText, getExtractedText }) {
  const { questions, addOrUpdateQuestion, getQuestion } = useContext(QuestionContext);
  const [selectedQ, setSelectedQ] = useState('');
  const [files, setFiles] = useState([]); // {name, dataUrl}
  const [currentPreview, setCurrentPreview] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (questions.length > 0 && !selectedQ) setSelectedQ(questions[0].questionNumber);
  }, [questions]);

  // load per-question ocrText when selected changes
  useEffect(() => {
    if (!selectedQ) return;
    const q = getQuestion(selectedQ);
    if (q && q.ocrText) {
      onSetExtractedText(q.ocrText);
    }
  }, [selectedQ]);

  const handleFiles = (e) => {
    const list = Array.from(e.target.files);
    list.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setFiles((cur) => [...cur, { name: f.name, dataUrl: reader.result }]);
      reader.readAsDataURL(f);
    });
  };

  const handleCropResult = (blob, croppedUrl) => {
    // upload cropped blob via existing backend /ocr and Puter pipeline
    (async () => {
      setMessage('Processing cropped image...');
      try {
        const formData = new FormData();
        formData.append('file', blob, 'crop.png');
        const uploadResponse = await fetch('http://localhost:8000/ocr', { method: 'POST', body: formData });
        const uploadData = await uploadResponse.json();
        const dataUrl = uploadData.data_url;
        if (!window.puter) throw new Error('Puter not loaded');
        const extracted = await window.puter.ai.chat('Extract all the text from this image and return it as a paragraph. Only return the text, nothing else.', dataUrl, { model: 'gpt-5-nano' });

        // append to per-question storage
        const q = getQuestion(selectedQ) || { questionNumber: selectedQ, questionType: 'subjective', questionText: '', ocrText: '', uploads: [] };
        const newOcrText = (q.ocrText ? q.ocrText + '\n' : '') + extracted;
        q.ocrText = newOcrText;
        q.uploads = q.uploads || [];
        q.uploads.push({ id: Date.now(), name: 'crop.png', dataUrl: croppedUrl });
        addOrUpdateQuestion(q);

        // update UI
        onSetExtractedText(newOcrText);
        setMessage('Cropped image processed and appended to question.');
      } catch (e) {
        console.error(e);
        setMessage('Error processing image: ' + e.message);
      }
    })();
  };

  const handleSelectFileForCrop = (item) => {
    setCurrentPreview(item);
  };

  return (
    <div style={{ padding: 12 }}>
      <h3>Question Uploader</h3>
      <div style={{ marginBottom: 8 }}>
        <label>Select Question</label>
        <select value={selectedQ} onChange={(e) => setSelectedQ(e.target.value)}>
          <option value="">-- select --</option>
          {questions.map((q) => (
            <option key={q.questionNumber} value={q.questionNumber}>{q.questionNumber} - {q.questionText.slice(0,40)}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label>Upload images for selected question (multiple)</label>
        <input type="file" accept="image/*" multiple onChange={handleFiles} />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h4>Uploaded images</h4>
          {files.map((f, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <img src={f.dataUrl} alt={f.name} style={{ maxWidth: 150 }} />
              <div>
                <button onClick={() => handleSelectFileForCrop(f)}>Crop</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 2 }}>
          <h4>Crop / Preview</h4>
          {currentPreview ? (
            <ImageCropper dataUrl={currentPreview.dataUrl} onCrop={handleCropResult} />
          ) : (
            <div>Select an image to crop</div>
          )}
          {message && <div style={{ marginTop: 8 }}>{message}</div>}
        </div>
      </div>
    </div>
  );
}
