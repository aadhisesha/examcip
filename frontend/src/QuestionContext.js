import React, { createContext, useEffect, useState } from 'react';

// LocalStorage key
const STORAGE_KEY = 'exam_questions_v1';

export const QuestionContext = createContext(null);

export function QuestionProvider({ children }) {
  const [questions, setQuestions] = useState([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setQuestions(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to load questions from storage', e);
    }
  }, []);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
    } catch (e) {
      console.error('Failed to save questions to storage', e);
    }
  }, [questions]);

  const addOrUpdateQuestion = (q) => {
    setQuestions((prev) => {
      const idx = prev.findIndex((p) => p.questionNumber === q.questionNumber);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...q };
        return copy;
      }
      return [...prev, q];
    });
  };

  const deleteQuestion = (questionNumber) => {
    setQuestions((prev) => prev.filter((q) => q.questionNumber !== questionNumber));
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
