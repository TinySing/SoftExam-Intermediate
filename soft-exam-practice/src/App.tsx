import { useEffect, useMemo, useState } from 'react';
import { QuestionPalette } from './components/QuestionPalette';
import {
  getAttempts,
  getExamQuestions,
  getExams,
  getWrongQuestions,
  submitAttempt,
} from './services/api';
import type {
  AttemptResult,
  AttemptSummary,
  Exam,
  ExamMode,
  OptionKey,
  Question,
  WrongQuestion,
} from './types/exam';

type Screen = 'home' | 'exam' | 'result' | 'wrong';

interface SavedSession {
  examId: string;
  mode: ExamMode;
  questionIndex: number;
  answers: Record<string, OptionKey>;
  marked: string[];
  startedAt: number;
  remainingSeconds: number;
}

const SESSION_KEY = 'soft-exam-practice-session';
const docsUrl = import.meta.env.VITE_DOCS_URL || 'http://localhost:4321/soft-exam/';
const modeOptions: { value: ExamMode; label: string; description: string }[] = [
  { value: 'practice', label: '刷题模式', description: '选完立即看对错和解析' },
  { value: 'exercise', label: '做题模式', description: '整套完成后再统一查看结果' },
  { value: 'mock', label: '模拟模式', description: '按考试时长完成并交卷' },
];

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(totalSeconds, 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [wrongQuestions, setWrongQuestions] = useState<WrongQuestion[]>([]);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [examMode, setExamMode] = useState<ExamMode>('mock');
  const [practiceFeedback, setPracticeFeedback] = useState<{ correct: boolean; answer: OptionKey | null; explanation: string } | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [caseNotes, setCaseNotes] = useState<Record<string, string>>({});
  const [showReference, setShowReference] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    Promise.all([getExams(), getAttempts()])
      .then(async ([loadedExams, loadedAttempts]) => {
        if (!active) return;
        setExams(loadedExams);
        setAttempts(loadedAttempts);
        const rawSession = localStorage.getItem(SESSION_KEY);
        if (rawSession) {
          try {
            const saved = JSON.parse(rawSession) as SavedSession;
            const savedExam = loadedExams.find((exam) => exam.id === saved.examId && exam.type === 'choice');
            const savedMode = saved.mode || 'mock';
            if (savedExam && (savedMode !== 'mock' || saved.remainingSeconds > 0)) {
              const savedQuestions = await getExamQuestions(saved.examId, savedMode === 'practice');
              if (!active) return;
              setSelectedExam(savedExam);
              setQuestions(savedQuestions);
              setQuestionIndex(Math.min(saved.questionIndex, savedQuestions.length - 1));
              setAnswers(saved.answers || {});
              setMarked(new Set(saved.marked || []));
              setStartedAt(saved.startedAt);
              setExamMode(savedMode);
              setRemainingSeconds(saved.remainingSeconds);
              setScreen('exam');
            } else {
              localStorage.removeItem(SESSION_KEY);
            }
          } catch {
            localStorage.removeItem(SESSION_KEY);
          }
        }
        setLoading(false);
      })
      .catch((requestError: Error) => {
        if (!active) return;
        setError(requestError.message);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (screen !== 'exam' || !selectedExam || !startedAt || selectedExam.type !== 'choice') return;
    const saved: SavedSession = {
      examId: selectedExam.id,
      mode: examMode,
      questionIndex,
      answers,
      marked: [...marked],
      startedAt,
      remainingSeconds,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  }, [answers, examMode, marked, questionIndex, remainingSeconds, screen, selectedExam, startedAt]);

  useEffect(() => {
    if (screen !== 'exam' || selectedExam?.type !== 'choice' || examMode !== 'mock' || remainingSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [examMode, screen, selectedExam?.type, remainingSeconds]);

  useEffect(() => {
    if (screen === 'exam' && selectedExam?.type === 'choice' && examMode === 'mock' && remainingSeconds === 0 && startedAt && !submitting) {
      void handleSubmit(true);
    }
  }, [examMode, remainingSeconds, screen, selectedExam, startedAt, submitting]);

  useEffect(() => {
    setPracticeFeedback(null);
  }, [questionIndex]);

  const choiceExams = useMemo(() => exams.filter((exam) => exam.type === 'choice'), [exams]);
  const caseExams = useMemo(() => exams.filter((exam) => exam.type === 'case'), [exams]);
  const currentQuestion = questions[questionIndex];

  async function startExam(exam: Exam, mode = examMode) {
    setError('');
    setLoading(true);
    try {
      const loadedQuestions = await getExamQuestions(exam.id, mode === 'practice');
      setSelectedExam(exam);
      setQuestions(loadedQuestions);
      setQuestionIndex(0);
      setAnswers({});
      setMarked(new Set());
      setCaseNotes({});
      setShowReference(false);
      setResult(null);
      setExamMode(mode);
      setPracticeFeedback(null);
      setStartedAt(Date.now());
      setRemainingSeconds(mode === 'mock' ? exam.durationMinutes * 60 : 0);
      setScreen('exam');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '题目加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function openWrongBook() {
    setError('');
    setLoading(true);
    try {
      setWrongQuestions(await getWrongQuestions());
      setScreen('wrong');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '错题加载失败');
    } finally {
      setLoading(false);
    }
  }

  function chooseAnswer(answer: OptionKey) {
    if (!currentQuestion) return;
    setAnswers((current) => ({ ...current, [currentQuestion.id]: answer }));
    if (examMode === 'practice') {
      setPracticeFeedback({
        correct: currentQuestion.answer === answer,
        answer: currentQuestion.answer || null,
        explanation: currentQuestion.explanation || '暂无解析',
      });
    }
  }

  function toggleMarked() {
    if (!currentQuestion) return;
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
      else next.add(currentQuestion.id);
      return next;
    });
  }

  async function handleSubmit(autoSubmitted = false) {
    if (!selectedExam || selectedExam.type !== 'choice' || submitting) return;
    if (!autoSubmitted && Object.keys(answers).length < questions.length) {
      const shouldSubmit = window.confirm(`还有 ${questions.length - Object.keys(answers).length} 道题未作答，确定交卷吗？`);
      if (!shouldSubmit) return;
    }
    setSubmitting(true);
    try {
      const submittedResult = await submitAttempt({
        examId: selectedExam.id,
        answers,
        marked: [...marked],
        startedAt: startedAt || Date.now(),
        mode: examMode,
      });
      setResult(submittedResult);
      setScreen('result');
      setAttempts(await getAttempts());
      localStorage.removeItem(SESSION_KEY);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '交卷失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  function returnHome() {
    setScreen('home');
    setSelectedExam(null);
    setQuestions([]);
    setResult(null);
    setError('');
  }

  function renderHeader() {
    return (
      <header className="app-header">
        <button className="brand" type="button" onClick={returnHome}>
          <span className="brand-mark">SE</span>
          <span><strong>SoftExam</strong><small>模拟做题系统</small></span>
        </button>
        <nav className="top-nav" aria-label="主导航">
          <button className={screen === 'home' ? 'nav-active' : ''} type="button" onClick={returnHome}>练习大厅</button>
          <button className={screen === 'wrong' ? 'nav-active' : ''} type="button" onClick={openWrongBook}>错题本</button>
          <a href={docsUrl}>学习资料</a>
          <button className="theme-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="切换主题">
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </nav>
      </header>
    );
  }

  function renderHome() {
    return (
      <>
        <section className="page-intro">
          <div>
            <span className="kicker">PRACTICE CENTER</span>
            <h1>选择一套题，开始练习。</h1>
            <p>按真实考试方式完成历年真题，提交后查看成绩、答案和解析。</p>
          </div>
          <div className="intro-meta">
            <strong>{choiceExams.length}</strong><span>套选择题试卷</span>
            <strong>{caseExams.length}</strong><span>套案例试卷</span>
          </div>
        </section>

        <section className="mode-selector" aria-label="做题模式">
          <div><span className="kicker">CHOOSE A MODE</span><h2>选择做题方式</h2></div>
          <div className="mode-options">
            {modeOptions.map((mode) => <button className={examMode === mode.value ? 'mode-option is-selected' : 'mode-option'} type="button" key={mode.value} onClick={() => setExamMode(mode.value)}><strong>{mode.label}</strong><small>{mode.description}</small></button>)}
          </div>
        </section>

        <section className="quick-actions" aria-label="快捷练习">
          <div><span className="action-icon">↗</span><div><strong>最近一次练习</strong><small>{attempts[0] ? `${attempts[0].examTitle} · ${attempts[0].score}/${attempts[0].total}` : '完成一套题后，这里会显示记录'}</small></div></div>
          <div><span className="action-icon">⌁</span><div><strong>先复习再做题</strong><small>回到资料站查看知识点和答题方法</small></div><a href={docsUrl}>打开资料</a></div>
        </section>

        <section className="exam-section">
          <div className="section-title"><div><span className="kicker">OBJECTIVE QUESTIONS</span><h2>历年选择题</h2></div><span>共 {choiceExams.reduce((count, exam) => count + exam.questionCount, 0)} 题</span></div>
          <div className="exam-list">
            {choiceExams.map((exam) => <ExamCard key={exam.id} exam={exam} onStart={startExam} />)}
          </div>
        </section>

        <section className="exam-section">
          <div className="section-title"><div><span className="kicker">CASE STUDIES</span><h2>历年案例题</h2></div><span>输入答案后对照参考答案</span></div>
          <div className="exam-list case-list">
            {caseExams.map((exam) => <ExamCard key={exam.id} exam={exam} onStart={startExam} />)}
          </div>
        </section>
      </>
    );
  }

  function renderExam() {
    if (!selectedExam || !currentQuestion) return null;
    if (selectedExam.type === 'case') return renderCaseExam();
    const selectedAnswer = answers[currentQuestion.id];
    return (
      <div className="exam-shell">
        <div className="exam-topbar">
          <div><button className="back-button" type="button" onClick={returnHome}>← 退出</button><span className="exam-title">{selectedExam.title}</span></div>
          {examMode === 'mock' ? <div className={`timer ${remainingSeconds < 300 ? 'timer-warning' : ''}`}><span>剩余时间</span><strong>{formatTime(remainingSeconds)}</strong></div> : <span className="mode-label">{modeOptions.find((mode) => mode.value === examMode)?.label}</span>}
          <button className="submit-button" type="button" onClick={() => void handleSubmit()} disabled={submitting}>{submitting ? '提交中…' : examMode === 'mock' ? '交卷' : '提交答案'}</button>
        </div>
        <div className="exam-layout">
          <main className="question-main">
            <div className="question-meta"><span>第 {currentQuestion.number} 题</span><span>单选题</span></div>
            <h1 className="question-stem">{currentQuestion.stem}</h1>
            <div className="options-list">
              {currentQuestion.options.map((option) => (
                <button className={`option-button ${selectedAnswer === option.key ? 'is-selected' : ''}`} type="button" key={option.key} onClick={() => chooseAnswer(option.key)}>
                  <span className="option-key">{option.key}</span><span>{option.label}</span>
                </button>
              ))}
            </div>
            {examMode === 'practice' && practiceFeedback && <div className={practiceFeedback.correct ? 'practice-feedback feedback-correct' : 'practice-feedback feedback-wrong'}><strong>{practiceFeedback.correct ? '回答正确' : `回答错误，正确答案是 ${practiceFeedback.answer || '暂无'}`}</strong><p>{practiceFeedback.explanation}</p></div>}
            <div className="question-actions">
              <button className={marked.has(currentQuestion.id) ? 'mark-button is-marked' : 'mark-button'} type="button" onClick={toggleMarked}>⚑ {marked.has(currentQuestion.id) ? '已标记' : '标记待检查'}</button>
              <div><button className="secondary-control" type="button" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>上一题</button><button className="primary-control" type="button" onClick={() => questionIndex === questions.length - 1 ? void handleSubmit() : setQuestionIndex(questionIndex + 1)}>{questionIndex === questions.length - 1 ? '完成练习' : '下一题'}</button></div>
            </div>
          </main>
          <QuestionPalette questions={questions} currentIndex={questionIndex} answers={answers} marked={marked} onSelect={setQuestionIndex} />
        </div>
      </div>
    );
  }

  function renderCaseExam() {
    if (!selectedExam || !currentQuestion) return null;
    return (
      <div className="case-shell">
        <div className="exam-topbar"><div><button className="back-button" type="button" onClick={returnHome}>← 返回</button><span className="exam-title">{selectedExam.title}</span></div><span className="case-progress">案例 {questionIndex + 1} / {questions.length}</span><button className="submit-button" type="button" onClick={() => setShowReference(!showReference)}>{showReference ? '收起参考答案' : '查看参考答案'}</button></div>
        <div className="case-layout">
          <main className="case-main"><div className="question-meta"><span>{currentQuestion.title || `试题 ${currentQuestion.number}`}</span><span>{currentQuestion.points || 0} 分</span></div><h1 className="case-heading">案例题 {currentQuestion.number}</h1><pre className="case-text">{currentQuestion.stem}</pre><label className="answer-label" htmlFor="case-answer">我的作答</label><textarea id="case-answer" className="case-answer" value={caseNotes[currentQuestion.id] || ''} onChange={(event) => setCaseNotes((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} placeholder="在这里输入你的答题要点……" />{showReference && <section className="reference-answer"><h2>参考答案</h2><pre>{currentQuestion.referenceAnswer || '暂无参考答案'}</pre></section>}<div className="question-actions"><div /><div><button className="secondary-control" type="button" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>上一题</button><button className="primary-control" type="button" onClick={() => setQuestionIndex(Math.min(questions.length - 1, questionIndex + 1))} disabled={questionIndex === questions.length - 1}>下一题</button></div></div></main><aside className="case-sidebar"><span className="panel-kicker">CASE LIST</span><h2>案例题目</h2>{questions.map((question, index) => <button className={index === questionIndex ? 'case-nav is-current' : 'case-nav'} type="button" key={question.id} onClick={() => setQuestionIndex(index)}><span>{question.number}</span><small>{question.title || '案例题'}</small></button>)}</aside></div>
      </div>
    );
  }

  function renderResult() {
    if (!result) return null;
    const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
    return <div className="result-page"><div className="result-heading"><span className="kicker">SUBMISSION COMPLETE</span><h1>{result.examTitle}</h1><p>这次完成得怎么样，回看错题比只看分数更重要。</p></div><section className="score-grid"><div className="score-main"><span>得分</span><strong>{result.score}</strong><small>/ {result.total}</small></div><div><span>正确率</span><strong>{accuracy}%</strong></div><div><span>答对</span><strong>{result.correct}</strong></div><div><span>答错</span><strong>{result.wrong}</strong></div><div><span>未答</span><strong>{result.unanswered}</strong></div></section><section className="review-section"><div className="section-title"><div><span className="kicker">ANSWER REVIEW</span><h2>逐题解析</h2></div><span>{result.durationSeconds ? `用时 ${formatTime(result.durationSeconds)}` : ''}</span></div><div className="review-list">{result.answers.map((answer) => <article className={`review-card ${answer.isCorrect ? 'review-correct' : 'review-wrong'}`} key={answer.questionId}><div className="review-card-head"><span>第 {answer.number} 题</span><strong>{answer.isCorrect ? '回答正确' : answer.selectedAnswer ? `你的答案：${answer.selectedAnswer}` : '未作答'}</strong><span>正确答案：{answer.correctAnswer}</span></div><h3>{answer.stem}</h3><div className="review-options">{answer.options.map((option) => <span className={option.key === answer.correctAnswer ? 'correct-option' : option.key === answer.selectedAnswer ? 'wrong-option' : ''} key={option.key}><b>{option.key}</b>{option.label}</span>)}</div><p className="explanation"><b>解析</b>{answer.explanation || '暂无解析'}</p></article>)}</div></section><div className="bottom-actions"><button className="secondary-control" type="button" onClick={returnHome}>返回练习大厅</button><button className="primary-control" type="button" onClick={openWrongBook}>查看错题本</button></div></div>;
  }

  function renderWrongBook() {
    return <div className="wrong-page"><div className="page-intro"><div><span className="kicker">MISTAKE NOTEBOOK</span><h1>错题本</h1><p>每次交卷后的错题都会留在这里，重新理解解析，再回到对应知识点。</p></div><strong className="wrong-count">{wrongQuestions.length}<small>道错题</small></strong></div>{wrongQuestions.length === 0 ? <div className="empty-state"><strong>还没有错题</strong><p>完成一套选择题后，答错的题目会自动出现在这里。</p><button className="primary-control" type="button" onClick={returnHome}>去做一套题</button></div> : <div className="wrong-list">{wrongQuestions.map((question) => <article className="wrong-card" key={question.questionId}><div className="review-card-head"><span>{question.examTitle} · 第 {question.number} 题</span><span>上次练习：{new Date(question.lastAttemptAt).toLocaleDateString('zh-CN')}</span></div><h2>{question.stem}</h2><div className="review-options">{question.options.map((option) => <span className={option.key === question.correctAnswer ? 'correct-option' : ''} key={option.key}><b>{option.key}</b>{option.label}</span>)}</div><p className="explanation"><b>正确答案：{question.correctAnswer}</b>{question.explanation || '暂无解析'}</p></article>)}</div>}</div>;
  }

  if (loading && exams.length === 0) return <div className="loading-screen"><span className="brand-mark">SE</span><p>正在加载题库…</p></div>;
  return <div className="app"><div className="page-wrap">{screen !== 'exam' && renderHeader()}{error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div>}{screen === 'home' && renderHome()}{screen === 'exam' && renderExam()}{screen === 'result' && renderResult()}{screen === 'wrong' && renderWrongBook()}</div></div>;
}

function ExamCard({ exam, onStart }: { exam: Exam; onStart: (exam: Exam) => void }) {
  return <article className="exam-card"><div className="exam-card-main"><span className="exam-type">{exam.type === 'choice' ? '选择题' : '案例题'}</span><h3>{exam.title}</h3><p>{exam.type === 'choice' ? `${exam.questionCount} 道题 · 90 分钟 · 自动评分` : `${exam.questionCount} 道案例 · 输入答案后查看参考答案`}</p><small>{exam.source.split('/').at(-1)}</small></div><button className="card-button" type="button" onClick={() => onStart(exam)}>{exam.type === 'choice' ? '开始答题' : '开始阅读'} <span>→</span></button></article>;
}

export default App;
