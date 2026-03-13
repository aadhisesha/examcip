import React, { useContext, useEffect, useState } from 'react';
import { QuestionContext } from './QuestionContext';
import { buildApiUrl } from './config';

export default function QuestionUploader({ onSetExtractedText }) {
  const { questions, addOrUpdateQuestion, getQuestion } = useContext(QuestionContext);
  const [selectedQ, setSelectedQ] = useState('');
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState('');

  const formatScore = (value) => `${Math.round((Number(value) || 0) * 100)}%`;

  const getQuestionMaxMarks = (question) => {
    if (question.questionType === 'subjective') {
      return Number(question.maxMarks) || 10;
    }

    if (Array.isArray(question.rubrics) && question.rubrics.length > 0) {
      const rubricTotal = question.rubrics.reduce((sum, item) => sum + (Number(item.marks) || 0), 0);
      return rubricTotal > 0 ? rubricTotal : 10;
    }

    return Number(question.maxMarks) || 10;
  };

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

  const preprocessForMl = (text) =>
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const tokenize = (text) => preprocessForMl(text).split(' ').filter(Boolean);

  const composeQuestionOcrText = (question, questionFiles) => {
    const fileTextMap = question.fileExtractedTextMap || {};

    const fileTexts = (questionFiles || [])
      .map((file) => fileTextMap[file.id])
      .filter((text) => text && String(text).trim());

    return fileTexts.join('\n');
  };

  const cosineFromTokens = (tokensA, tokensB) => {
    if (!tokensA.length || !tokensB.length) return 0;

    const countsA = new Map();
    const countsB = new Map();
    tokensA.forEach((token) => countsA.set(token, (countsA.get(token) || 0) + 1));
    tokensB.forEach((token) => countsB.set(token, (countsB.get(token) || 0) + 1));

    const allTokens = new Set([...countsA.keys(), ...countsB.keys()]);
    let dot = 0;
    let magA = 0;
    let magB = 0;

    allTokens.forEach((token) => {
      const a = countsA.get(token) || 0;
      const b = countsB.get(token) || 0;
      dot += a * b;
      magA += a * a;
      magB += b * b;
    });

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  };

  const evaluateSubjectiveLocally = (question, studentAnswer) => {
    const maxMarks = getQuestionMaxMarks(question);
    const answerKey = question.answerKey || '';

    const keyTokens = tokenize(answerKey);
    const studentTokens = tokenize(studentAnswer);
    if (!studentTokens.length) {
      return {
        evaluationType: 'subjective_ml_local',
        marks: 0,
        maxMarks,
        justification: 'The submitted answer is empty or too short to evaluate.',
        confidenceScore: 0,
        method: 'Local ML fallback (token cosine + overlap similarity)',
        similarityBreakdown: {
          cosineSimilarity: 0,
          characterSimilarity: 0,
          jaccardSimilarity: 0,
          keywordCoverage: 0,
          sentenceCoverage: 0,
          lengthAdequacy: 0,
          feedbackSimilarity: 0,
        },
        matchedKeywords: [],
        missingKeywords: [],
        calibrationApplied: false,
        feedbackSamplesUsed: 0,
      };
    }

    const cosineSimilarity = cosineFromTokens(keyTokens, studentTokens);

    const keySet = new Set(keyTokens);
    const studentSet = new Set(studentTokens);
    const intersection = [...keySet].filter((token) => studentSet.has(token));
    const unionCount = new Set([...keySet, ...studentSet]).size || 1;
    const jaccardSimilarity = intersection.length / unionCount;

    const uniqueKeywords = [...keySet].slice(0, 12);
    const matchedKeywords = uniqueKeywords.filter((token) => studentSet.has(token));
    const missingKeywords = uniqueKeywords.filter((token) => !studentSet.has(token));
    const keywordCoverage = uniqueKeywords.length ? matchedKeywords.length / uniqueKeywords.length : 0;

    const keyLen = Math.max(keyTokens.length, 1);
    const studentLen = studentTokens.length;
    const lengthAdequacy = clamp(studentLen / (keyLen * 0.85));

    const finalPercent = clamp(
      (0.42 * cosineSimilarity) +
      (0.2 * jaccardSimilarity) +
      (0.28 * keywordCoverage) +
      (0.1 * lengthAdequacy)
    );

    return {
      evaluationType: 'subjective_ml_local',
      marks: Number((finalPercent * maxMarks).toFixed(2)),
      maxMarks,
      justification: `The answer shows ${Math.round(finalPercent * 100)}% overall similarity to the key answer using local ML fallback scoring.`,
      confidenceScore: Number(clamp((cosineSimilarity + keywordCoverage + jaccardSimilarity) / 3).toFixed(4)),
      method: 'Local ML fallback (token cosine + overlap similarity)',
      similarityBreakdown: {
        cosineSimilarity: Number(cosineSimilarity.toFixed(4)),
        characterSimilarity: Number(cosineSimilarity.toFixed(4)),
        jaccardSimilarity: Number(jaccardSimilarity.toFixed(4)),
        keywordCoverage: Number(keywordCoverage.toFixed(4)),
        sentenceCoverage: Number(cosineSimilarity.toFixed(4)),
        lengthAdequacy: Number(lengthAdequacy.toFixed(4)),
        feedbackSimilarity: 0,
      },
      matchedKeywords,
      missingKeywords,
      calibrationApplied: false,
      feedbackSamplesUsed: 0,
    };
  };

  useEffect(() => {
    if (questions.length > 0 && !selectedQ) setSelectedQ(questions[0].questionNumber);
  }, [questions, selectedQ]);

  useEffect(() => {
    if (!selectedQ) return;
    const question = getQuestion(selectedQ);
    if (question && question.ocrText) {
      onSetExtractedText(question.ocrText);
    }
  }, [selectedQ, getQuestion, onSetExtractedText]);

  const handleFiles = (e) => {
    const list = Array.from(e.target.files || []);
    list.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setFiles((current) => [...current, { id: `${Date.now()}-${Math.random()}`, name: file.name, dataUrl: reader.result }]);
      reader.readAsDataURL(file);
    });
  };

  const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
  };

  const extractTextFromDataUrl = async (dataUrl, fileName = 'upload.png') => {
    const blob = await dataUrlToBlob(dataUrl);
    const formData = new FormData();
    formData.append('file', blob, fileName);

    const uploadResponse = await fetch(buildApiUrl('/ocr'), { method: 'POST', body: formData });
    const uploadData = await uploadResponse.json();
    const ocrDataUrl = uploadData.data_url;

    if (!window.puter) {
      throw new Error('Puter not loaded');
    }

    return window.puter.ai.chat(
      'Extract all the text from this image and return it as a paragraph. Only return the text, nothing else.',
      ocrDataUrl,
      { model: 'gpt-5-nano' }
    );
  };

  const evaluateSubjectiveAnswer = async (question, studentAnswer) => {
    try {
      const response = await fetch(buildApiUrl('/evaluate-subjective'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber: question.questionNumber,
          questionType: question.questionType,
          questionText: question.questionText || '',
          answerKey: question.answerKey || '',
          studentAnswer,
          maxMarks: getQuestionMaxMarks(question),
        }),
      });

      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error || `Evaluation failed with status ${response.status}`);
      }

      return result;
    } catch (error) {
      console.warn('Backend subjective evaluator unavailable, using local ML fallback.', error);
      return evaluateSubjectiveLocally(question, studentAnswer);
    }
  };

  const getFeedbackCalibratedPercentage = async (question, studentAnswer, basePercentage) => {
    try {
      const response = await fetch(buildApiUrl('/feedback-calibration'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber: question.questionNumber,
          questionType: question.questionType,
          studentAnswer,
          basePercentage,
        }),
      });

      const result = await response.json();
      if (!response.ok || result.status === 'error') {
        return {
          adjustedPercentage: basePercentage,
          applied: false,
          feedbackSimilarity: 0,
          samplesUsed: 0,
        };
      }

      return {
        adjustedPercentage: Number(result.adjustedPercentage ?? basePercentage),
        applied: Boolean(result.applied),
        feedbackSimilarity: Number(result.feedbackSimilarity || 0),
        samplesUsed: Number(result.samplesUsed || 0),
      };
    } catch {
      return {
        adjustedPercentage: basePercentage,
        applied: false,
        feedbackSimilarity: 0,
        samplesUsed: 0,
      };
    }
  };

  const parseJsonFromText = (rawText) => {
    try {
      return JSON.parse(rawText);
    } catch {
      const match = String(rawText || '').match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error('AI response was not valid JSON.');
      }
      return JSON.parse(match[0]);
    }
  };

  const evaluateCreativeAnswer = async (question, studentAnswer) => {
    if (!window.puter) {
      throw new Error('Puter not loaded');
    }

    const maxMarks = getQuestionMaxMarks(question);
    const rubricText = Array.isArray(question.rubrics) && question.rubrics.length
      ? question.rubrics
          .map((rubric, index) => `${index + 1}. ${rubric.name || 'Criterion'}: ${rubric.description || ''} (Marks: ${rubric.marks || 0})`)
          .join('\n')
      : 'No rubric provided. Evaluate for quality, relevance, creativity, and coherence.';

    const prompt = `You are a strict exam evaluator for creative answers.\nQuestion: ${question.questionText || ''}\n\nRubrics:\n${rubricText}\n\nStudent answer:\n${studentAnswer}\n\nAssign marks out of ${maxMarks}. Return ONLY JSON in this exact schema:\n{"marks": <number>, "maxMarks": <number>, "justification": "...", "strengths": ["..."], "improvements": ["..."]}`;

    const raw = await window.puter.ai.chat(prompt, { model: 'gpt-5-nano' });
    const parsed = parseJsonFromText(raw);
    const rawMarks = typeof parsed.marks === 'number' ? parsed.marks : Number(parsed.marks || 0);
    const basePercentage = clamp(rawMarks / maxMarks);
    const calibration = await getFeedbackCalibratedPercentage(question, studentAnswer, basePercentage);
    const calibratedMarks = Number((calibration.adjustedPercentage * maxMarks).toFixed(2));

    return {
      evaluationType: 'creative_ai',
      marks: calibratedMarks,
      maxMarks: typeof parsed.maxMarks === 'number' ? parsed.maxMarks : maxMarks,
      justification: parsed.justification || 'Creative answer evaluated using AI.',
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      confidenceScore: 0.8,
      method: 'AI creative evaluation with rubric-aware prompt and feedback calibration',
      calibrationApplied: calibration.applied,
      feedbackSamplesUsed: calibration.samplesUsed,
      similarityBreakdown: {
        cosineSimilarity: 0,
        characterSimilarity: 0,
        jaccardSimilarity: 0,
        keywordCoverage: 0,
        sentenceCoverage: 0,
        lengthAdequacy: 0,
        feedbackSimilarity: calibration.feedbackSimilarity,
      },
    };
  };

  const evaluateByQuestionType = async (question, answerText) => {
    if (question.questionType === 'subjective') {
      return evaluateSubjectiveAnswer(question, answerText);
    }

    if (question.questionType === 'creative') {
      return evaluateCreativeAnswer(question, answerText);
    }

    throw new Error(`Unsupported question type: ${question.questionType}`);
  };

  const saveEvaluationResult = async (questionNumber, evaluationPayload) => {
    try {
      const response = await fetch(buildApiUrl('/evaluations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber,
          ...evaluationPayload,
        }),
      });

      const result = await response.json();
      if (!response.ok || result.status !== 'ok') {
        throw new Error(result.error || `Failed to save evaluation (${response.status})`);
      }

      return result.evaluation || null;
    } catch (error) {
      console.warn('Failed to persist evaluation in backend.', error);
      return null;
    }
  };

  const handleDeleteFile = (indexToDelete) => {
    setFiles((current) => {
      const next = current.filter((_, index) => index !== indexToDelete);
      const removed = current[indexToDelete];

      const question = getQuestion(selectedQ);
      if (question && removed) {
        const fileTextMap = { ...(question.fileExtractedTextMap || {}) };
        if (fileTextMap[removed.id]) {
          delete fileTextMap[removed.id];
          question.fileExtractedTextMap = fileTextMap;
          question.ocrText = composeQuestionOcrText(question, next);

          if (question.lastEvaluation && question.lastEvaluation.extractedText) {
            question.lastEvaluation = null;
          }

          addOrUpdateQuestion(question);
          onSetExtractedText(question.ocrText || '');
          setMessage('Image deleted and its extracted text removed.');
        }
      }

      return next;
    });
  };

  const handleEvaluateQuestion = async () => {
    if (!selectedQ) {
      setMessage('Select a question first');
      return;
    }

    const question = getQuestion(selectedQ);
    if (!question) {
      setMessage('Question not found');
      return;
    }

    setMessage('Evaluating answer...');
    try {
      if (!files.length && (!question.ocrText || !question.ocrText.trim())) {
        setMessage('No extracted text found. Upload images or crop first.');
        return;
      }

      question.fileExtractedTextMap = question.fileExtractedTextMap || {};
      if (files.length) {
        if (!window.puter) {
          throw new Error('Puter not loaded');
        }

        for (const file of files) {
          if (!question.fileExtractedTextMap[file.id]) {
            const extracted = await extractTextFromDataUrl(file.dataUrl, file.name || 'upload.png');
            question.fileExtractedTextMap[file.id] = extracted;
          }
        }

        question.ocrText = composeQuestionOcrText(question, files);
        addOrUpdateQuestion(question);
        onSetExtractedText(question.ocrText || '');
      }

      const evaluation = await evaluateByQuestionType(question, question.ocrText);
      question.lastEvaluation = {
        uploadId: question.uploads && question.uploads.length ? question.uploads[question.uploads.length - 1].id : Date.now(),
        ...evaluation,
        extractedText: question.ocrText,
      };

      const savedEvaluation = await saveEvaluationResult(question.questionNumber, question.lastEvaluation);
      if (savedEvaluation && savedEvaluation.id) {
        question.lastEvaluation.id = savedEvaluation.id;
      }

      addOrUpdateQuestion(question);
      setMessage(`${question.questionType === 'subjective' ? 'Subjective ML' : 'Creative AI'} evaluation complete.`);
    } catch (e) {
      console.error(e);
      setMessage('Evaluation failed: ' + (e.message || e));
    }
  };

  return (
    <div className="panel-card">
      <h3 className="panel-title">Question Uploader</h3>
      <div className="field-row">
        <label>Select Question</label>
        <select value={selectedQ} onChange={(e) => setSelectedQ(e.target.value)}>
          <option value="">-- select --</option>
          {questions.map((question) => (
            <option key={question.questionNumber} value={question.questionNumber}>
              {question.questionNumber} - {question.questionText.slice(0, 40)}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label>Upload images for selected question (multiple)</label>
        <input type="file" accept="image/*" multiple onChange={handleFiles} />
        <div className="action-row">
          <button type="button" onClick={handleEvaluateQuestion} disabled={!selectedQ}>
            Evaluate Answer
          </button>
        </div>
      </div>

      <div className="symmetric-columns">
        <div className="column-card">
          <h4 className="section-title">Uploaded images</h4>
          {files.length === 0 && <div className="empty-state">No images uploaded yet.</div>}
          {files.map((file, index) => (
            <div key={file.id || index} className="upload-thumb-card">
              <button
                type="button"
                onClick={() => handleDeleteFile(index)}
                className="icon-delete-btn"
                aria-label={`Delete ${file.name}`}
                title="Delete image"
              >
                ×
              </button>
              <img src={file.dataUrl} alt={file.name} className="upload-thumb-image" />
            </div>
          ))}
        </div>

        <div className="column-card">
          <h4 className="section-title">Latest Evaluation</h4>
          {selectedQ && (() => {
            const question = getQuestion(selectedQ);
            if (!question || !question.lastEvaluation) return null;
            const evaluation = question.lastEvaluation;

            return (
              <div className="evaluation-card edit-card">
                <div>
                  <strong>Marks:</strong>{' '}
                  <input type="number" defaultValue={evaluation.marks ?? ''} id={`marks-${evaluation.uploadId}`} className="inline-marks-input" />
                </div>
                <div className="field-row">
                  <strong>Justification:</strong>
                  <div>
                    <textarea id={`just-${evaluation.uploadId}`} defaultValue={evaluation.justification} className="compact-textarea" />
                  </div>
                </div>
                <div className="action-row">
                  <button onClick={async () => {
                    const input = document.getElementById(`marks-${evaluation.uploadId}`);
                    const corrected = parseFloat(input.value);
                    if (isNaN(corrected)) {
                      setMessage('Please enter a numeric mark');
                      return;
                    }

                    try {
                      const questionToUpdate = getQuestion(selectedQ);
                      const previousMarks = questionToUpdate.lastEvaluation.marks;
                      questionToUpdate.lastEvaluation.marks = corrected;
                      addOrUpdateQuestion(questionToUpdate);

                      await fetch(buildApiUrl('/feedback'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          questionNumber: selectedQ,
                          questionType: questionToUpdate.questionType,
                          uploadId: evaluation.uploadId,
                          previousMarks,
                          correctedMarks: corrected,
                          maxMarks: evaluation.maxMarks || questionToUpdate.maxMarks || 10,
                          justification: document.getElementById(`just-${evaluation.uploadId}`)?.value || evaluation.justification || '',
                          extractedText: evaluation.extractedText || ''
                        })
                      });

                      await saveEvaluationResult(selectedQ, {
                        ...questionToUpdate.lastEvaluation,
                        correctedMarks: corrected,
                        previousMarks,
                        justification: document.getElementById(`just-${evaluation.uploadId}`)?.value || evaluation.justification || '',
                      });

                      setMessage(`${questionToUpdate.questionType === 'subjective' ? 'Subjective ML' : 'Creative AI'} mark updated and feedback saved for learning.`);
                    } catch (e) {
                      console.error(e);
                      setMessage('Failed to send feedback: ' + e.message);
                    }
                  }}>
                    Save corrected mark
                  </button>
                </div>
              </div>
            );
          })()}

          {selectedQ && (() => {
            const question = getQuestion(selectedQ);
            if (!question || question.lastEvaluation) return null;
            return <div className="empty-state">No evaluation yet. Click Evaluate Answer.</div>;
          })()}

          {selectedQ && (() => {
            const question = getQuestion(selectedQ);
            if (!question || !question.lastEvaluation) return null;
            const evaluation = question.lastEvaluation;

            return (
              <div className="evaluation-card">
                <h4>Latest Evaluation</h4>
                <div><strong>Marks:</strong> {evaluation.marks ?? '—'} / {evaluation.maxMarks}</div>
                {evaluation.method && <div className="info-line"><strong>Method:</strong> {evaluation.method}</div>}
                {typeof evaluation.confidenceScore === 'number' && (
                  <div className="info-line"><strong>Confidence:</strong> {formatScore(evaluation.confidenceScore)}</div>
                )}
                <div className="info-line">
                  <strong>Justification:</strong>
                  <div className="detail-box">{evaluation.justification || '—'}</div>
                </div>
                {evaluation.similarityBreakdown && (
                  <div className="info-line">
                    <strong>Similarity Breakdown:</strong>
                    <ul className="metric-list">
                      <li>TF-IDF cosine similarity: {formatScore(evaluation.similarityBreakdown.cosineSimilarity)}</li>
                      <li>Character similarity: {formatScore(evaluation.similarityBreakdown.characterSimilarity)}</li>
                      <li>Jaccard similarity: {formatScore(evaluation.similarityBreakdown.jaccardSimilarity)}</li>
                      <li>Keyword coverage: {formatScore(evaluation.similarityBreakdown.keywordCoverage)}</li>
                      <li>Sentence coverage: {formatScore(evaluation.similarityBreakdown.sentenceCoverage)}</li>
                      <li>Length adequacy: {formatScore(evaluation.similarityBreakdown.lengthAdequacy)}</li>
                      <li>Feedback similarity: {formatScore(evaluation.similarityBreakdown.feedbackSimilarity)}</li>
                    </ul>
                  </div>
                )}
                {Array.isArray(evaluation.strengths) && evaluation.strengths.length > 0 && (
                  <div className="info-line"><strong>Strengths:</strong> {evaluation.strengths.join(', ')}</div>
                )}
                {Array.isArray(evaluation.improvements) && evaluation.improvements.length > 0 && (
                  <div className="info-line"><strong>Improvements:</strong> {evaluation.improvements.join(', ')}</div>
                )}
                {Array.isArray(evaluation.matchedKeywords) && evaluation.matchedKeywords.length > 0 && (
                  <div className="info-line"><strong>Matched keywords:</strong> {evaluation.matchedKeywords.join(', ')}</div>
                )}
                {Array.isArray(evaluation.missingKeywords) && evaluation.missingKeywords.length > 0 && (
                  <div className="info-line"><strong>Missing keywords:</strong> {evaluation.missingKeywords.join(', ')}</div>
                )}
                {evaluation.calibrationApplied && (
                  <div className="info-line">
                    <strong>Feedback calibration:</strong> Applied using {evaluation.feedbackSamplesUsed} similar checked answers.
                  </div>
                )}
                <div className="action-row">
                  <button onClick={handleEvaluateQuestion}>Re-evaluate</button>
                </div>
              </div>
            );
          })()}

          {message && <div className="info-chip">{message}</div>}
        </div>
      </div>
    </div>
  );
}
