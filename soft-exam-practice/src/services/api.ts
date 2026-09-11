import type {
  AttemptResult,
  AttemptSummary,
  Exam,
  Question,
  WrongQuestion,
  OptionKey,
} from '../types/exam';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || `请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export function getExams() {
  return request<Exam[]>('/exams');
}

export function getExamQuestions(examId: string, revealAnswers = false) {
  const suffix = revealAnswers ? '?mode=practice' : '';
  return request<Question[]>(`/exams/${encodeURIComponent(examId)}/questions${suffix}`);
}

export function getAttempts() {
  return request<AttemptSummary[]>('/attempts');
}

export function getWrongQuestions() {
  return request<WrongQuestion[]>('/wrong-questions');
}

export function submitAttempt(payload: {
  examId: string;
  answers: Record<string, OptionKey>;
  marked: string[];
  startedAt: number;
  mode: 'practice' | 'exercise' | 'mock';
}) {
  return request<AttemptResult>('/attempts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
