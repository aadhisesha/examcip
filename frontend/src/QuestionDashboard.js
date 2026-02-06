import React, { useContext, useState } from 'react';
import { QuestionContext } from './QuestionContext';

// Question management UI: add / edit questions and rubrics
export default function QuestionDashboard() {
  const { questions, addOrUpdateQuestion, deleteQuestion } = useContext(QuestionContext);
  const [qn, setQn] = useState('');
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState('subjective');
  const [answerKey, setAnswerKey] = useState('');
  const [rubrics, setRubrics] = useState([]);

  const resetForm = () => {
    setQn('');
    setQText('');
    setQType('subjective');
    setAnswerKey('');
    setRubrics([]);
  };

  const handleAddRubric = () => {
    setRubrics((r) => [...r, { name: '', description: '', marks: '' }]);
  };

  const updateRubric = (idx, field, value) => {
    setRubrics((r) => r.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const removeRubric = (idx) => setRubrics((r) => r.filter((_, i) => i !== idx));

  const handleSave = (e) => {
    e.preventDefault();
    if (!qn || !qText) return;

    const questionObj = {
      questionNumber: qn,
      questionType: qType,
      questionText: qText,
      answerKey: qType === 'subjective' ? answerKey : '',
      rubrics: qType === 'creative' ? rubrics : [],
      // per-question storage for OCR and uploads (backend-ready)
      ocrText: '',
      uploads: []
    };

    addOrUpdateQuestion(questionObj);
    resetForm();
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Question Management Dashboard</h2>
      <form onSubmit={handleSave} style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <label>Question Number (e.g. Q1)</label>
          <input value={qn} onChange={(e) => setQn(e.target.value)} required />
        </div>

        <div style={{ marginBottom: 8 }}>
          <label>Question Text</label>
          <textarea value={qText} onChange={(e) => setQText(e.target.value)} required />
        </div>

        <div style={{ marginBottom: 8 }}>
          <label>Question Type</label>
          <select value={qType} onChange={(e) => setQType(e.target.value)}>
            <option value="subjective">Subjective</option>
            <option value="creative">Creative</option>
          </select>
        </div>

        {qType === 'subjective' ? (
          <div style={{ marginBottom: 8 }}>
            <label>Answer Key (paragraph)</label>
            <textarea value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} />
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <label>Rubrics</label>
            {rubrics.map((r, i) => (
              <div key={i} style={{ border: '1px solid #ddd', padding: 8, marginBottom: 8 }}>
                <input placeholder="Criterion name" value={r.name} onChange={(e) => updateRubric(i, 'name', e.target.value)} />
                <textarea placeholder="Description" value={r.description} onChange={(e) => updateRubric(i, 'description', e.target.value)} />
                <input placeholder="Marks" value={r.marks} onChange={(e) => updateRubric(i, 'marks', e.target.value)} />
                <button type="button" onClick={() => removeRubric(i)}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={handleAddRubric}>Add Rubric</button>
          </div>
        )}

        <div>
          <button type="submit">Save Question</button>
        </div>
      </form>

      <h3>Existing Questions</h3>
      <div>
        {questions.length === 0 && <div>No questions defined yet.</div>}
        {questions.map((q) => (
          <div key={q.questionNumber} style={{ border: '1px solid #eee', padding: 8, marginBottom: 8 }}>
            <strong>{q.questionNumber}</strong> — {q.questionType}
            <div>{q.questionText}</div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => deleteQuestion(q.questionNumber)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
