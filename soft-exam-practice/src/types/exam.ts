export type ExamType = 'choice' | 'case';
export type QuestionType = 'single-choice' | 'case';
export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type ExamMode = 'practice' | 'exercise' | 'mock';

export interface User {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface ModelConfig {
  provider: 'deepseek';
  baseUrl: string;
  model: string;
  configured: boolean;
  apiKeyMasked: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
}

export interface CaseGradingResult {
  score: number;
  maxScore: number;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  items: { criterion: string; score: number; maxScore: number; reason: string }[];
}

export interface FullMockCaseResult {
  question: Question;
  answer: string;
  grading: CaseGradingResult | null;
  error?: string;
}

export interface Exam {
  id: string;
  title: string;
  type: ExamType;
  origin?: 'past' | 'custom' | 'generated';
  year: string;
  session: string;
  batch?: string;
  location?: string;
  durationMinutes: number;
  questionCount: number;
  source: string;
}

export interface QuestionOption {
  key: OptionKey;
  label: string;
}

export interface Question {
  id: string;
  examId: string;
  number: number;
  type: QuestionType;
  origin?: 'past' | 'custom' | 'generated';
  module?: string;
  stem: string;
  options: QuestionOption[];
  answer?: OptionKey | null;
  explanation?: string;
  referenceAnswer?: string;
  title?: string;
  points?: number;
  year: string;
  session: string;
}

export interface AttemptSummary {
  id: string;
  userId: string;
  examId: string;
  examTitle: string;
  submittedAt: string;
  score: number;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
}

export interface ReviewAnswer {
  questionId: string;
  number: number;
  stem: string;
  options: QuestionOption[];
  selectedAnswer: OptionKey | null;
  correctAnswer: OptionKey;
  explanation: string;
  isCorrect: boolean;
}

export interface AttemptResult {
  id: string;
  examTitle: string;
  score: number;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  durationSeconds: number;
  answers: ReviewAnswer[];
}

export interface WrongQuestion {
  questionId: string;
  examTitle: string;
  number: number;
  stem: string;
  options: QuestionOption[];
  correctAnswer: OptionKey;
  explanation: string;
  lastAttemptAt: string;
}
