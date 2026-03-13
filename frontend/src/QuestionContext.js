import React, { createContext, useEffect, useState } from 'react';
import { buildApiUrl } from './config';

export const QuestionContext = createContext(null);

export function QuestionProvider({ children }) {
  const [questions, setQuestions] = useState([]);

  // Load from backend (MongoDB) on mount
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(buildApiUrl('/questions'));
        const data = await response.json();
        if (response.ok && data.status === 'ok' && Array.isArray(data.questions)) {
          setQuestions(data.questions);
        }
      } catch (e) {
        console.error('Failed to load questions from backend', e);
      }
    })();
  }, []);

  const addOrUpdateQuestion = async (q) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((p) => p.questionNumber === q.questionNumber);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...q };
        return copy;
      }
      return [...prev, q];
    });

    try {
      await fetch(buildApiUrl('/questions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q),
      });
    } catch (e) {
      console.error('Failed to save question to backend', e);
    }
  };

  const deleteQuestion = async (questionNumber) => {
    setQuestions((prev) => prev.filter((q) => q.questionNumber !== questionNumber));

    try {
      await fetch(buildApiUrl(`/questions/${encodeURIComponent(questionNumber)}`), {
        method: 'DELETE',
      });
    } catch (e) {
      console.error('Failed to delete question from backend', e);
    }
  };

  const getQuestion = (questionNumber) => {
    return questions.find((q) => q.questionNumber === questionNumber) || null;
  };

  return (
    <QuestionContext.Provider value={{ questions, addOrUpdateQuestion, deleteQuestion, getQuestion, setQuestions }}>
      {children}
    </QuestionContext.Provider>
  );
}

export default QuestionProvider;
