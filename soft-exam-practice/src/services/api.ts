import type {
  AttemptResult,
  AttemptSummary,
  Exam,
  Question,
  WrongQuestion,
  OptionKey,
  CaseGradingResult,
  ModelConfig,
  ModelOption,
  User,
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

export function getUser(userId: string) {
  return request<User>(`/users/${encodeURIComponent(userId)}`);
}

export function loginUser(username: string) {
  return request<User>('/login', { method: 'POST', body: JSON.stringify({ username }) });
}

export function getModules(type: 'single-choice' | 'case' = 'single-choice') {
  return request<{ name: string; questionCount: number }[]>(`/modules?type=${type}`);
}

export function getModelConfig() {
  return request<ModelConfig>('/model-config');
}

export function getModelOptions() {
  return request<ModelOption[]>('/model-options');
}

export function saveModelConfig(payload: { apiKey?: string; baseUrl: string; model: string }) {
  return request<ModelConfig>('/model-config', { method: 'PUT', body: JSON.stringify(payload) });
}

export function testModelConfig() {
  return request<{ ok: boolean; message: string }>('/model-config/test', { method: 'POST' });
}

export function gradeCaseAnswer(payload: { stem: string; referenceAnswer?: string; answer: string; points?: number }) {
  return request<CaseGradingResult>('/case-grading', { method: 'POST', body: JSON.stringify(payload) });
}

export function getExamQuestions(examId: string, revealAnswers = false) {
  const suffix = revealAnswers ? '?mode=practice' : '?mode=mock';
  return request<Question[]>(`/exams/${encodeURIComponent(examId)}/questions${suffix}`);
}

export function getPracticeQuestions(params: { source: 'module' | 'random'; module?: string; count?: number; revealAnswers?: boolean; type?: 'single-choice' | 'case' }) {
  const search = new URLSearchParams({ source: params.source, mode: params.revealAnswers ? 'practice' : 'mock' });
  if (params.module && params.module !== 'all') search.set('module', params.module);
  if (params.count) search.set('count', String(params.count));
  if (params.type) search.set('type', params.type);
  return request<Question[]>(`/practice-questions?${search.toString()}`);
}

export function getAttempts(userId: string) {
  return request<AttemptSummary[]>(`/attempts?userId=${encodeURIComponent(userId)}`);
}

export function getWrongQuestions(userId: string) {
  return request<WrongQuestion[]>(`/wrong-questions?userId=${encodeURIComponent(userId)}`);
}

export function submitAttempt(payload: {
  userId: string;
  examId?: string;
  questionIds?: string[];
  title?: string;
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
