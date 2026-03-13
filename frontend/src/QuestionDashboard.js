import React, { useContext, useState } from 'react';
import { QuestionContext } from './QuestionContext';

// Question management UI: add / edit questions and rubrics
export default function QuestionDashboard() {
  const { questions, addOrUpdateQuestion, deleteQuestion } = useContext(QuestionContext);
  const [qn, setQn] = useState('');
  const [qText, setQText] = useState('');
  const [qType, setQType] = useState('subjective');
  const [maxMarks, setMaxMarks] = useState('');
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
      maxMarks: qType === 'subjective' ? (parseFloat(maxMarks) || 10) : undefined,
      rubrics: qType === 'creative' ? rubrics : [],
      // per-question storage for OCR and uploads (backend-ready)
      ocrText: '',
      uploads: []
    };

    addOrUpdateQuestion(questionObj);
    resetForm();
  };

  return (
    <div className="panel-card">
      <h2 className="panel-title">Question Management Dashboard</h2>
      <form onSubmit={handleSave} className="dashboard-form">
        <div className="field-row">
          <label>Question Number (e.g. Q1)</label>
          <input value={qn} onChange={(e) => setQn(e.target.value)} required />
        </div>

        <div className="field-row">
          <label>Question Text</label>
          <textarea value={qText} onChange={(e) => setQText(e.target.value)} required />
        </div>

        <div className="field-row">
          <label>Question Type</label>
          <select value={qType} onChange={(e) => setQType(e.target.value)}>
            <option value="subjective">Subjective</option>
            <option value="creative">Creative</option>
          </select>
        </div>

        {qType === 'subjective' && (
          <div className="field-row">
            <label>Max Marks</label>
            <input value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} placeholder="e.g. 10" />
          </div>
        )}

        {qType === 'subjective' ? (
          <div className="field-row">
            <label>Answer Key (paragraph)</label>
            <textarea value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} />
          </div>
        ) : (
          <div className="field-row">
            <label>Rubrics</label>
            {rubrics.map((r, i) => (
              <div key={i} className="rubric-card">
                <input placeholder="Criterion name" value={r.name} onChange={(e) => updateRubric(i, 'name', e.target.value)} />
                <textarea placeholder="Description" value={r.description} onChange={(e) => updateRubric(i, 'description', e.target.value)} />
                <input placeholder="Marks" value={r.marks} onChange={(e) => updateRubric(i, 'marks', e.target.value)} />
                <button className="danger-btn" type="button" onClick={() => removeRubric(i)}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={handleAddRubric}>Add Rubric</button>
          </div>
        )}

        <div className="field-row">
          <button type="submit">Save Question</button>
        </div>
      </form>

      <h3 className="section-title">Existing Questions</h3>
      <div className="question-list">
        {questions.length === 0 && <div className="empty-state">No questions defined yet.</div>}
        {questions.map((q) => (
          <div key={q.questionNumber} className="question-item">
            <strong>{q.questionNumber}</strong> — {q.questionType}
            <div className="question-text">{q.questionText}</div>
            <div className="question-actions">
              <button className="danger-btn" onClick={() => deleteQuestion(q.questionNumber)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
