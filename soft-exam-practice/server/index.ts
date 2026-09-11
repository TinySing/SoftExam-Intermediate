import cors from 'cors';
import express from 'express';
import initSqlJs, { type Database as SqlDatabase, type SqlJsStatic } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');
const dataDirectory = path.join(projectDirectory, 'data');
const databasePath = path.join(dataDirectory, 'soft-exam-practice.sqlite');
const questionBankPath = path.join(projectDirectory, 'question-bank/soft-exam-practice.sqlite');

fs.mkdirSync(dataDirectory, { recursive: true });
if (!fs.existsSync(databasePath)) fs.copyFileSync(questionBankPath, databasePath);
const SqlJs: SqlJsStatic = await initSqlJs({ locateFile: (file) => path.join(projectDirectory, 'node_modules/sql.js/dist', file) });
const database: SqlDatabase = new SqlJs.Database(fs.readFileSync(databasePath));

database.run(`
  CREATE TABLE IF NOT EXISTS question_sets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    year TEXT NOT NULL,
    session TEXT NOT NULL,
    batch TEXT,
    location TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    question_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES question_sets(id),
    number INTEGER NOT NULL,
    type TEXT NOT NULL,
    stem TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_answer TEXT,
    explanation TEXT NOT NULL DEFAULT '',
    reference_answer TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    year TEXT NOT NULL,
    session TEXT NOT NULL,
    points INTEGER,
    title TEXT
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES question_sets(id),
    mode TEXT NOT NULL,
    started_at TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    wrong INTEGER NOT NULL DEFAULT 0,
    unanswered INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS attempt_answers (
    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id),
    selected_answer TEXT,
    is_correct INTEGER NOT NULL DEFAULT 0,
    marked_for_review INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (attempt_id, question_id)
  );
`);

function queryAll(sql: string, params: unknown[] = []) {
  const statement = database.prepare(sql);
  statement.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}
function queryOne(sql: string, params: unknown[] = []) { return queryAll(sql, params)[0] || null; }
function run(sql: string, params: unknown[] = []) { database.run(sql, params); }
function persistDatabase() { fs.writeFileSync(databasePath, Buffer.from(database.export())); }

const app = express();
const port = Number(process.env.PORT || 4000);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function mapExam(row: Record<string, unknown>) {
  return { id: row.id, title: row.title, type: row.type, year: row.year, session: row.session, batch: row.batch || undefined, location: row.location || undefined, durationMinutes: row.duration_minutes, questionCount: row.question_count, source: row.source };
}
function mapQuestion(row: Record<string, unknown>, includeAnswers = false) {
  return { id: row.id, examId: row.exam_id, number: row.number, type: row.type, stem: row.stem, options: JSON.parse(String(row.options_json)), ...(includeAnswers ? { answer: row.correct_answer, explanation: row.explanation, referenceAnswer: row.reference_answer } : row.type === 'case' ? { referenceAnswer: row.reference_answer } : {}), year: row.year, session: row.session, title: row.title || undefined, points: row.points || undefined };
}
function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.get('/api/exams', (_request, response) => response.json(queryAll(`SELECT * FROM question_sets ORDER BY CASE type WHEN 'choice' THEN 0 ELSE 1 END, year DESC, session DESC, batch ASC, location ASC`).map(mapExam)));
app.get('/api/exams/:examId/questions', (request, response) => response.json(queryAll(`SELECT * FROM questions WHERE exam_id = ? ORDER BY number ASC`, [request.params.examId]).map((row) => mapQuestion(row, request.query.mode === 'practice'))));
app.get('/api/attempts', (_request, response) => response.json(queryAll(`SELECT attempts.*, question_sets.title AS exam_title FROM attempts JOIN question_sets ON question_sets.id = attempts.exam_id ORDER BY submitted_at DESC LIMIT 30`).map((row) => ({ id: row.id, examId: row.exam_id, examTitle: row.exam_title, submittedAt: row.submitted_at, score: row.score, total: row.total, correct: row.correct, wrong: row.wrong, unanswered: row.unanswered }))));
app.get('/api/wrong-questions', (_request, response) => response.json(queryAll(`SELECT questions.*, question_sets.title AS exam_title, MAX(attempts.submitted_at) AS last_attempt_at FROM attempt_answers JOIN questions ON questions.id = attempt_answers.question_id JOIN attempts ON attempts.id = attempt_answers.attempt_id JOIN question_sets ON question_sets.id = questions.exam_id WHERE attempt_answers.is_correct = 0 AND attempt_answers.selected_answer IS NOT NULL AND questions.type = 'single-choice' GROUP BY questions.id ORDER BY last_attempt_at DESC`).map((row) => ({ questionId: row.id, examTitle: row.exam_title, number: row.number, stem: row.stem, options: JSON.parse(String(row.options_json)), correctAnswer: row.correct_answer, explanation: row.explanation, lastAttemptAt: row.last_attempt_at }))));
app.post('/api/attempts', (request, response) => {
  const { examId, answers = {}, marked = [], startedAt, mode = 'mock' } = request.body as { examId?: string; answers?: Record<string, string>; marked?: string[]; startedAt?: number; mode?: string };
  if (!examId || !startedAt) return response.status(400).json({ message: '缺少试卷或开始时间' });
  const exam = queryOne(`SELECT * FROM question_sets WHERE id = ? AND type = 'choice'`, [examId]);
  if (!exam) return response.status(404).json({ message: '试卷不存在或暂不支持自动评分' });
  const questions = queryAll(`SELECT * FROM questions WHERE exam_id = ? ORDER BY number ASC`, [examId]);
  const correct = questions.filter((question) => answers[String(question.id)] && answers[String(question.id)] === question.correct_answer).length;
  const answered = questions.filter((question) => Boolean(answers[String(question.id)])).length;
  const wrong = answered - correct;
  const submittedAt = new Date();
  const durationSeconds = Math.max(0, Math.round((submittedAt.getTime() - Number(startedAt)) / 1000));
  const attemptId = createId();
  run('BEGIN');
  run(`INSERT INTO attempts (id, exam_id, mode, started_at, submitted_at, duration_seconds, score, total, correct, wrong, unanswered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [attemptId, examId, mode, new Date(Number(startedAt)).toISOString(), submittedAt.toISOString(), durationSeconds, correct, questions.length, correct, wrong, questions.length - answered]);
  for (const question of questions) run(`INSERT INTO attempt_answers (attempt_id, question_id, selected_answer, is_correct, marked_for_review) VALUES (?, ?, ?, ?, ?)`, [attemptId, question.id, answers[String(question.id)] || null, answers[String(question.id)] === question.correct_answer ? 1 : 0, marked.includes(question.id) ? 1 : 0]);
  run('COMMIT');
  persistDatabase();
  response.json({ id: attemptId, examTitle: exam.title, score: correct, total: questions.length, correct, wrong, unanswered: questions.length - answered, durationSeconds, answers: questions.map((question) => ({ questionId: question.id, number: question.number, stem: question.stem, options: JSON.parse(String(question.options_json)), selectedAnswer: answers[String(question.id)] || null, correctAnswer: question.correct_answer, explanation: question.explanation, isCorrect: answers[String(question.id)] === question.correct_answer })) });
});

app.listen(port, () => console.log(`SoftExam Practice API listening on http://localhost:${port}`));
