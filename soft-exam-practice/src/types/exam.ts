export type ExamType = 'choice' | 'case';
export type QuestionType = 'single-choice' | 'case';
export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type ExamMode = 'practice' | 'exercise' | 'mock';

export interface Exam {
  id: string;
  title: string;
  type: ExamType;
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
