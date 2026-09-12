import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QuestionPalette } from './components/QuestionPalette';
import {
  getAttempts,
  getUser,
  loginUser,
  getModelConfig,
  getExamQuestions,
  getExams,
  getModules,
  getModelOptions,
  getPracticeQuestions,
  getWrongQuestions,
  gradeCaseAnswer,
  saveModelConfig,
  submitAttempt,
  testModelConfig,
} from './services/api';
import type {
  AttemptResult,
  AttemptSummary,
  CaseGradingResult,
  Exam,
  ExamMode,
  FullMockCaseResult,
  ModelConfig,
  ModelOption,
  OptionKey,
  Question,
  WrongQuestion,
  User,
} from './types/exam';

type Screen = 'home' | 'exam' | 'result' | 'wrong' | 'settings';
type QuestionSource = 'module' | 'exam' | 'random';

interface SavedSession {
  userId: string;
  examId: string;
  mode: ExamMode;
  questionIndex: number;
  answers: Record<string, OptionKey>;
  marked: string[];
  startedAt: number;
  remainingSeconds: number;
}

const SESSION_KEY = 'soft-exam-practice-session';
const USER_KEY = 'soft-exam-practice-user-id';
const MOCK_RANDOM_COUNT = 69;
const MOCK_CASE_COUNT = 4;
const docsUrl = import.meta.env.VITE_DOCS_URL || 'http://localhost:4321/soft-exam/';
const modeOptions: { value: ExamMode; label: string; description: string }[] = [
  { value: 'practice', label: '刷题模式', description: '直接看答案和解析，快速过题' },
  { value: 'exercise', label: '做题模式', description: '每题作答后立即查看答案' },
  { value: 'mock', label: '模拟模式', description: '基础知识 + 应用技术，连续作答' },
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

function getCasePoints(question: Question) {
  if (question.points && question.points > 0) return question.points;
  const inferredPoints = [...question.stem.matchAll(/[（(]\s*(\d+)\s*分[）)]/g)].reduce((total, match) => total + Number(match[1]), 0);
  return inferredPoints || 20;
}

const inlinePageReferencePattern = /(?:参见\s*)?(?:中级教材(?:第二版)?|教材)?\s*P\s*\d{2,3}(?:\s*[-－—–]\s*P?\s*\d{2,3})?\s*页?\s*(?=[，,：:；;。！？《●•▪◦\u4E00-\u9FFF]|$)[，,：:；;。！？]?/gi;
const pageReferencePattern = /(^|\n)[ \t]*(?:参见\s*)?(?:中级教材(?:第二版)?|教材)?\s*P\s*\d{1,3}(?:\s*[-－—–]\s*P?\s*\d{1,3})?\s*页?\s*(?=[，,：:；;。！？《●•▪◦\u4E00-\u9FFF]|$)[，,：:；;。！？]?/gim;
const mergedAnswerPattern = /\n(?:第\s*[2-9]\s*批|20\d{2}\s*年\s*(?:上|下)半年\s*案例分析试题)/;

function cleanDisplayedText(content: string) {
  const cleaned = content
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(inlinePageReferencePattern, '')
    .replace(pageReferencePattern, '$1')
    .replace(/(\d)\.\s+(\d)/g, '$1.$2')
    .replace(/[ \t]+[●•▪◦]\s*/g, '\n• ')
    .replace(/([：:；;。])\s*[●•▪◦]\s*/g, '$1\n• ')
    .replace(/([。；：:！？])\s*[-—~·]?\s*(?=[（(]?\d{1,2}[)）.、])/g, '$1\n')
    .replace(/([。；：:！？])\s*(?=选项\s*[A-D][：:])/g, '$1\n')
    .replace(/\s+(?=选项\s*[A-D][：:])/g, '\n')
    .replace(/(^|\n)[ \t]*[•●▪◦][ \t]*(?=\n|$)/gm, '$1')
    .replace(/(^|[ \t。；：.!?])\s*\.(\d{1,2})[.、](?=[\u4E00-\u9FFF])/gm, '$1\n$2. ')
    .replace(/(^|[ \t。；：])[-—]?\s*[（(](\d{1,2})[)）](?=[\u4E00-\u9FFF])/gm, '$1\n$2. ')
    .replace(/[ \t]+(?=[（(]?\d{1,2}[)）.、])/g, '\n')
    .replace(/\bAl\b/g, 'AI')
    .replace(/IS0/g, 'ISO')
    .replace(/防真软件/g, '仿真软件')
    .replace(/项目实胜/g, '项目实践')
    .replace(/项目十系人/g, '项目干系人')
    .replace(/4）[:：]\s*信息技术与产业(?=信息产业)/g, '4）信息技术与产业：')
    .replace(/(【问题 2】（10 分）结合案例：\n1\. 请写出常用的两种 WBS 的表示形式。（2 分）\n\n2\. 请指出以下 WBS 存在的问题。（8 分）)\n\1/g, '$1')
    .replace(/请将下面（1）一（3）的答案/g, '请将下面（1）—（4）的答案')
    .replace(/③的编码设计与①存在对应关系/g, '③的编码设计与④存在对应关系')
    .replace(/\bFID\b/g, 'RFID')
    .replace(/关链路径/g, '关键路径')
    .replace(/直接反应了效率/g, '直接反映了效率')
    .replace(/报建系统/g, '拟建系统')
    .replace(/所需请帮助资源/g, '所需资源')
    .replace(/情況/g, '情况')
    .replace(/经行/g, '进行')
    .replace(/捷达/g, '解答')
    .replace(/回各问题/g, '回答各问题')
    .replace(/各题纸/g, '答题纸')
    .replace(/己经/g, '已经')
    .replace(/该标准等\s*标准/g, '该标准等同采用')
    .replace(/ISO\/IEC\s*20000-1:\s*2005/g, 'ISO/IEC 20000-1:2005')
    .replace(/ISO20000\.1-2005/g, 'ISO/IEC 20000-1:2005')
    .replace(/GB\/T24405\.\s*l-2009idtISO20000-1：2005/g, 'GB/T24405.1-2009 idt ISO/IEC 20000-1:2005')
    .replace(/([\u4E00-\u9FFF])\s+(?=[\u4E00-\u9FFF])/g, '$1')
    .replace(/该标准等标准/g, '该标准等同采用')
    .replace(/2011-04-15/g, '2011-04-12')
    .replace(/([^\n])\s+(?=(?:PV|AC|EV|CV|SV|CPI|SPI|ETC|EAC|EMV)(?:\s*[\u4E00-\u9FFF]*)?\s*=)/g, '$1\n')
    .replace(/\s+(?=(?:自主研发方案|外包方案|建议[:：]|当前项目状态[:：]|采取措施[:：]|具体措施[:：]))/g, '\n')
    .replace(/^(?:[，,：:]\s*)+/, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
  const markerIndex = cleaned.search(mergedAnswerPattern);
  return markerIndex > 0 ? cleaned.slice(0, markerIndex).trimEnd() : cleaned;
}

function cleanInlineText(content: string) {
  return cleanDisplayedText(content)
    .replace(/\s+/g, ' ')
    .replace(/([\u4E00-\u9FFF])\s+([\u4E00-\u9FFF])/g, '$1$2')
    .replace(/\s+([，。；：、！？）】])/g, '$1')
    .replace(/([（【])\s+/g, '$1')
    .trim();
}

function splitTableLine(line: string) {
  return line.trim().split(/\s{2,}/).map((cell) => cleanInlineText(cell)).filter(Boolean);
}

function getTableRows(lines: string[], startIndex: number) {
  const firstRow = splitTableLine(lines[startIndex] || '');
  if (firstRow.length < 3 || !/\s{2,}/.test(lines[startIndex] || '')) return null;
  const rows = [firstRow];
  let index = startIndex + 1;
  while (index < lines.length) {
    const row = splitTableLine(lines[index]);
    if (row.length !== firstRow.length) break;
    rows.push(row);
    index += 1;
  }
  return rows.length >= 3 ? { rows, endIndex: index } : null;
}

function isContentHeading(line: string) {
  return /^(?:【(?:说明|问题|答案|参考答案)[^】]*】|试题[一二三四五六七八九十]|第\s*[一二三四五六七八九十]+\s*题)/.test(line.trim());
}

function isListLine(line: string) {
  return /^(?:[•●▪◦]|[（(]?\d{1,2}[)）.、]|[一二三四五六七八九十]+[、.])\s*/.test(line.trim());
}

function isOrderedListLine(line: string) {
  return /^(?:[（(]?\d{1,2}[)）.、]|[一二三四五六七八九十]+[、.])\s*/.test(line.trim());
}

function isOptionExplanationLine(line: string) {
  return /^选项\s*[A-D][：:]/.test(line.trim());
}

function isStandaloneListMarker(line: string) {
  return /^(?:[（(]\d{1,2}[)）]|\d{1,2}[.、])$/.test(line.trim());
}

function cleanListPrefix(line: string) {
  return line.trim().replace(/^(?:[•●▪◦]|[（(]?\d{1,2}[)）.、]|[一二三四五六七八九十]+[、.])\s*/, '').replace(/^[:：]\s*/, '');
}

function joinStructuredLines(lines: string[]) {
  return cleanInlineText(lines.join(' '));
}

function renderStructuredText(content: string): ReactNode[] {
  const lines = cleanDisplayedText(content).split('\n');
  const blocks: ReactNode[] = [];
  let textLines: string[] = [];
  let index = 0;

  const flushText = () => {
    if (textLines.length === 0) return;
    blocks.push(<p className="case-text-block" key={`text-${blocks.length}`}>{joinStructuredLines(textLines)}</p>);
    textLines = [];
  };

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      flushText();
      index += 1;
      continue;
    }

    const table = getTableRows(lines, index);
    if (table) {
      flushText();
      blocks.push(<div className="case-table-wrap" key={`table-${index}`}><table className="case-table"><thead><tr>{table.rows[0].map((cell, cellIndex) => <th key={`head-${cellIndex}`}>{cell}</th>)}</tr></thead><tbody>{table.rows.slice(1).map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>);
      index = table.endIndex;
      continue;
    }

    if (isStandaloneListMarker(line)) {
      if (/^[•●▪◦]$/.test(line)) {
        index += 1;
        continue;
      }
      const marker = line.match(/[（(](\d{1,2})[)）]/)?.[1] || line.match(/^(\d{1,2})[.、]$/)?.[1];
      blocks.push(<h3 className="case-content-heading case-subquestion-heading" key={`subquestion-${index}`}>{marker ? `第 ${marker} 小题` : line}</h3>);
      index += 1;
      continue;
    }

    if (isContentHeading(line)) {
      flushText();
      blocks.push(<h3 className="case-content-heading" key={`heading-${index}`}>{line}</h3>);
      index += 1;
      continue;
    }

    if (isOptionExplanationLine(line)) {
      flushText();
      const optionItems: { key: string; text: string }[] = [];
      while (index < lines.length && isOptionExplanationLine(lines[index])) {
        const match = lines[index].trim().match(/^选项\s*([A-D])[：:]\s*(.*)$/);
        if (match) optionItems.push({ key: match[1], text: match[2] });
        index += 1;
      }
      blocks.push(<ul className="option-explanation-list" key={`option-explanation-${index}`}>{optionItems.map((item) => <li key={item.key}><strong>选项 {item.key}</strong><span>{item.text}</span></li>)}</ul>);
      continue;
    }

    if (isListLine(line)) {
      flushText();
      const listItems: string[] = [];
      const ordered = isOrderedListLine(line);
      while (index < lines.length && isListLine(lines[index])) {
        listItems.push(cleanInlineText(cleanListPrefix(lines[index])));
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List className="rich-list" key={`list-${index}`}>{listItems.map((item, itemIndex) => {
        const heading = item.match(/^(.{2,18}(?:原则|：|:))(?=[\u4E00-\u9FFF])/);
        return <li key={`item-${itemIndex}`}>{heading ? <><strong className="rich-list-heading">{heading[1]}</strong>{item.slice(heading[1].length)}</> : item}</li>;
      })}</List>);
      continue;
    }

    textLines.push(line);
    index += 1;
  }
  flushText();
  return blocks;
}

function renderCaseContent(content: string): ReactNode[] {
  return renderStructuredText(content);
}

function renderAnswerContent(content: string): ReactNode[] {
  return renderStructuredText(content);
}

interface PickerOption {
  value: string;
  label: string;
  meta?: string;
}

function ChoicePicker({
  label,
  value,
  options,
  onChange,
  placeholder = '请选择',
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const searchable = options.length > 8;
  const filteredOptions = searchable && query.trim()
    ? options.filter((option) => `${option.label} ${option.meta || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function selectOption(optionValue: string) {
    onChange(optionValue);
    setQuery('');
    setOpen(false);
  }

  function toggleOpen() {
    if (!open && pickerRef.current) {
      const bounds = pickerRef.current.getBoundingClientRect();
      setOpenUp(window.innerHeight - bounds.bottom < (searchable ? 330 : options.length * 48 + 24));
    }
    setOpen((current) => !current);
  }

  return (
    <div className={`choice-picker ${open ? 'is-open' : ''} ${openUp ? 'opens-up' : ''}`} ref={pickerRef}>
      <button className="picker-trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={toggleOpen}>
        <span className="picker-trigger-copy"><strong>{selected?.label || placeholder}</strong>{selected?.meta && <small>{selected.meta}</small>}</span>
        <span className="picker-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && <div className="picker-menu" role="listbox" aria-label={label}>
        {searchable && <div className="picker-search-wrap"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} /></div>}
        <div className="picker-options">
          {filteredOptions.length > 0 ? filteredOptions.map((option) => <button className={`picker-option ${option.value === value ? 'is-selected' : ''}`} type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => selectOption(option.value)}><span><strong>{option.label}</strong>{option.meta && <small>{option.meta}</small>}</span>{option.value === value && <span className="picker-check" aria-hidden="true">✓</span>}</button>) : <p className="picker-empty">没有匹配的选项</p>}
        </div>
      </div>}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [exams, setExams] = useState<Exam[]>([]);
  const [modules, setModules] = useState<{ name: string; questionCount: number }[]>([]);
  const [caseModules, setCaseModules] = useState<{ name: string; questionCount: number }[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [userSwitching, setUserSwitching] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<WrongQuestion[]>([]);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [mockApplicationQuestions, setMockApplicationQuestions] = useState<Question[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [examMode, setExamMode] = useState<ExamMode>('practice');
  const [caseMode, setCaseMode] = useState<'practice' | 'exercise'>('practice');
  const [questionSource, setQuestionSource] = useState<QuestionSource>('exam');
  const [caseQuestionSource, setCaseQuestionSource] = useState<QuestionSource>('exam');
  const [mockQuestionSource, setMockQuestionSource] = useState<'exam' | 'random'>('exam');
  const [selectedModule, setSelectedModule] = useState('all');
  const [selectedCaseModule, setSelectedCaseModule] = useState('all');
  const [selectedExamId, setSelectedExamId] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [randomCount, setRandomCount] = useState(20);
  const [caseRandomCount, setCaseRandomCount] = useState(4);
  const [practiceFeedback, setPracticeFeedback] = useState<{ correct: boolean; answer: OptionKey | null; explanation: string } | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [fullMockCaseResults, setFullMockCaseResults] = useState<FullMockCaseResult[]>([]);
  const [caseNotes, setCaseNotes] = useState<Record<string, string>>({});
  const [showReference, setShowReference] = useState(false);
  const [caseGrading, setCaseGrading] = useState<CaseGradingResult | null>(null);
  const [configApiKey, setConfigApiKey] = useState('');
  const [configBaseUrl, setConfigBaseUrl] = useState('https://api.deepseek.com');
  const [configModel, setConfigModel] = useState('deepseek-v4-flash');
  const [configMessage, setConfigMessage] = useState('');
  const [modelListMessage, setModelListMessage] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [grading, setGrading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function loadWorkspace(loadedUser: User) {
    const [loadedExams, loadedAttempts, loadedModules, loadedModelConfig, loadedCaseModules] = await Promise.all([getExams(), getAttempts(loadedUser.id), getModules(), getModelConfig(), getModules('case')]);
    setExams(loadedExams);
    setAttempts(loadedAttempts);
    setModules(loadedModules);
    setCaseModules(loadedCaseModules);
    setModelConfig(loadedModelConfig);
    setConfigBaseUrl(loadedModelConfig.baseUrl);
    setConfigModel(loadedModelConfig.model);
    setSelectedExamId(loadedExams.find((exam) => exam.type === 'choice')?.id || '');
    setSelectedCaseId(loadedExams.find((exam) => exam.type === 'case')?.id || '');
    const rawSession = localStorage.getItem(SESSION_KEY);
    if (!rawSession) return;
    try {
      const saved = JSON.parse(rawSession) as SavedSession;
      const savedExam = loadedExams.find((exam) => exam.id === saved.examId && exam.type === 'choice');
      const savedMode = saved.mode || 'practice';
      const restoredRemainingSeconds = savedMode === 'mock'
        ? Math.max(0, savedExam ? savedExam.durationMinutes * 60 - Math.floor((Date.now() - saved.startedAt) / 1000) : 0)
        : 0;
      if (saved.userId === loadedUser.id && savedExam && (savedMode !== 'mock' || restoredRemainingSeconds > 0)) {
        const savedQuestions = await getExamQuestions(saved.examId, savedMode !== 'mock');
        setSelectedExam(savedExam);
        setQuestions(savedQuestions);
        setQuestionIndex(Math.min(saved.questionIndex, savedQuestions.length - 1));
        setAnswers(saved.answers || {});
        setMarked(new Set(saved.marked || []));
        setStartedAt(saved.startedAt);
        setExamMode(savedMode);
        setRemainingSeconds(restoredRemainingSeconds);
        setScreen('exam');
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  useEffect(() => {
    if (screen !== 'exam') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [screen]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const savedUserId = localStorage.getItem(USER_KEY);
        if (!savedUserId) {
          setUserReady(true);
          setLoading(false);
          return;
        }
        const loadedUser = await getUser(savedUserId).catch(() => null);
        if (!active) return;
        if (!loadedUser) {
          localStorage.removeItem(USER_KEY);
          setUserReady(true);
          setLoading(false);
          return;
        }
        setUser(loadedUser);
        setUserReady(true);
        await loadWorkspace(loadedUser);
        if (active) setLoading(false);
      } catch (requestError) {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : '系统加载失败');
        setUserReady(true);
        setLoading(false);
      }
    }
    void bootstrap();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (screen !== 'exam' || !selectedExam || !startedAt || selectedExam.type !== 'choice' || selectedExam.origin === 'generated' || mockApplicationQuestions.length > 0) return;
    const saved: SavedSession = {
      userId: user?.id || '',
      examId: selectedExam.id,
      mode: examMode,
      questionIndex,
      answers,
      marked: [...marked],
      startedAt,
      remainingSeconds,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  }, [answers, examMode, marked, mockApplicationQuestions.length, questionIndex, remainingSeconds, screen, selectedExam, startedAt, user]);

  useEffect(() => {
    if (screen !== 'exam' || selectedExam?.type !== 'choice' || examMode !== 'mock' || !startedAt) return;
    const updateRemainingSeconds = () => {
      const durationSeconds = selectedExam.durationMinutes * 60;
      setRemainingSeconds(Math.max(0, durationSeconds - Math.floor((Date.now() - startedAt) / 1000)));
    };
    updateRemainingSeconds();
    const timer = window.setInterval(updateRemainingSeconds, 1000);
    return () => window.clearInterval(timer);
  }, [examMode, screen, selectedExam, startedAt]);

  useEffect(() => {
    if (screen === 'exam' && selectedExam?.type === 'choice' && examMode === 'mock' && remainingSeconds === 0 && startedAt && !submitting) {
      void handleSubmit(true);
    }
  }, [examMode, remainingSeconds, screen, selectedExam, startedAt, submitting]);

  useEffect(() => {
    setPracticeFeedback(null);
    setCaseGrading(null);
  }, [questionIndex]);

  useEffect(() => {
    if (caseModules.length <= 1 && caseQuestionSource === 'module') setCaseQuestionSource('exam');
  }, [caseModules.length, caseQuestionSource]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = usernameInput.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{2,23}$/.test(username)) {
      setError('用户名需为 3-24 位英文开头，可包含英文、数字、下划线或短横线');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const loggedInUser = await loginUser(username);
      localStorage.setItem(USER_KEY, loggedInUser.id);
      setUser(loggedInUser);
      setUserReady(true);
      setUserSwitching(false);
      setUsernameInput('');
      setWrongQuestions([]);
      setScreen('home');
      await loadWorkspace(loggedInUser);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  const choiceExams = useMemo(() => exams.filter((exam) => exam.type === 'choice'), [exams]);
  const caseExams = useMemo(() => exams.filter((exam) => exam.type === 'case'), [exams]);
  const currentQuestion = questions[questionIndex];

  function changeMode(mode: ExamMode) {
    setExamMode(mode);
    if (mode === 'mock' && questionSource === 'module') setQuestionSource('exam');
  }

  function changeQuestionSource(source: QuestionSource) {
    setQuestionSource(source);
    if (source === 'random') setSelectedModule('all');
  }

  function changeCaseQuestionSource(source: QuestionSource) {
    setCaseQuestionSource(source);
    if (source === 'random') setSelectedCaseModule('all');
  }

  function findPairedApplicationExam(choiceExam: Exam) {
    const season = choiceExam.session.includes('上') ? 'h1' : 'h2';
    const batchNumber = choiceExam.batch ? ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'].findIndex((number) => choiceExam.batch?.includes(`第${number}批`)) : -1;
    const batchMatch = batchNumber >= 0
      ? caseExams.find((exam) => exam.year === choiceExam.year && exam.id.includes(`-${season}`) && exam.batch?.includes(`第${batchNumber + 1}批`))
      : undefined;
    return batchMatch
      || caseExams.find((exam) => exam.year === choiceExam.year && exam.id.includes(`-${season}`))
      || caseExams.find((exam) => exam.year === choiceExam.year)
      || caseExams[0];
  }

  async function startFullMock() {
    setError('');
    setLoading(true);
    try {
      let objectiveQuestions: Question[];
      let applicationQuestions: Question[];
      let exam: Exam;
      if (mockQuestionSource === 'exam') {
        const selected = choiceExams.find((item) => item.id === selectedExamId) || choiceExams[0];
        const pairedExam = selected && findPairedApplicationExam(selected);
        if (!selected || !pairedExam) throw new Error('暂无可组成完整考试的历年真题');
        [objectiveQuestions, applicationQuestions] = await Promise.all([getExamQuestions(selected.id), getExamQuestions(pairedExam.id)]);
        if (objectiveQuestions.length === 0 || applicationQuestions.length === 0) throw new Error('这套历年真题缺少完整的应用技术题');
        exam = { ...selected, title: `${selected.title} · 完整模拟`, durationMinutes: 240, questionCount: objectiveQuestions.length + applicationQuestions.length, source: `${selected.source} + ${pairedExam.source}` };
      } else {
        [objectiveQuestions, applicationQuestions] = await Promise.all([
          getPracticeQuestions({ source: 'random', count: MOCK_RANDOM_COUNT, revealAnswers: false }),
          getPracticeQuestions({ source: 'random', count: MOCK_CASE_COUNT, revealAnswers: false, type: 'case' }),
        ]);
        if (objectiveQuestions.length === 0 || applicationQuestions.length === 0) throw new Error('当前题库不足以组成完整模拟考试');
        exam = { id: `generated-${Date.now()}`, title: '随机完整模拟', type: 'choice', origin: 'generated', year: 'generated', session: '', durationMinutes: 240, questionCount: objectiveQuestions.length + applicationQuestions.length, source: 'generated' };
      }
      const combinedQuestions = [...objectiveQuestions, ...applicationQuestions].map((question, index) => ({ ...question, number: index + 1 }));
      setExamMode('mock');
      setSelectedExam(exam);
      setMockApplicationQuestions(combinedQuestions.slice(objectiveQuestions.length));
      setQuestions(combinedQuestions);
      setQuestionIndex(0);
      setAnswers({});
      setMarked(new Set());
      setCaseNotes({});
      setFullMockCaseResults([]);
      setShowReference(false);
      setCaseGrading(null);
      setResult(null);
      setStartedAt(Date.now());
      setRemainingSeconds(exam.durationMinutes * 60);
      setPracticeFeedback(null);
      setScreen('exam');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '完整试卷加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function startSelectedChoice() {
    if (examMode === 'mock') {
      await startFullMock();
      return;
    }
    setError('');
    setLoading(true);
    try {
      let loadedQuestions: Question[];
      let exam: Exam;
      if (questionSource === 'exam') {
        if (selectedExamId === 'all-exams') {
          loadedQuestions = await getPracticeQuestions({ source: 'module', module: 'all', revealAnswers: examMode !== 'mock', type: 'single-choice' });
          if (loadedQuestions.length === 0) throw new Error('暂无可用的历年选择题');
          loadedQuestions = loadedQuestions.map((question, index) => ({ ...question, number: index + 1 }));
          exam = { id: `generated-${Date.now()}`, title: `全部历年选择题 · ${modeOptions.find((mode) => mode.value === examMode)?.label}`, type: 'choice', origin: 'generated', year: 'generated', session: '', durationMinutes: examMode === 'mock' ? 90 : 0, questionCount: loadedQuestions.length, source: 'generated' };
        } else {
          const selected = choiceExams.find((item) => item.id === selectedExamId) || choiceExams[0];
          if (!selected) throw new Error('暂无可用的历年选择题');
          loadedQuestions = await getExamQuestions(selected.id, examMode !== 'mock');
          exam = selected;
        }
      } else {
        const source = questionSource === 'module' ? 'module' : 'random';
        loadedQuestions = await getPracticeQuestions({ source, module: selectedModule, count: examMode === 'mock' ? MOCK_RANDOM_COUNT : randomCount, revealAnswers: examMode !== 'mock' });
        if (loadedQuestions.length === 0) throw new Error('当前范围没有可用题目');
        loadedQuestions = loadedQuestions.map((question, index) => ({ ...question, number: index + 1 }));
        const sourceName = questionSource === 'module' ? (selectedModule === 'all' ? '全部模块' : selectedModule) : `随机 ${loadedQuestions.length} 题`;
        exam = { id: `generated-${Date.now()}`, title: `${sourceName} · ${modeOptions.find((mode) => mode.value === examMode)?.label}`, type: 'choice', origin: 'generated', year: 'generated', session: '', durationMinutes: examMode === 'mock' ? 90 : 0, questionCount: loadedQuestions.length, source: 'generated' };
      }
      setSelectedExam(exam);
      setMockApplicationQuestions([]);
      setQuestions(loadedQuestions);
      setQuestionIndex(0);
      setAnswers({});
      setMarked(new Set());
      setCaseNotes({});
      setShowReference(false);
      setCaseGrading(null);
      setFullMockCaseResults([]);
      setResult(null);
      setStartedAt(Date.now());
      setRemainingSeconds(examMode === 'mock' ? exam.durationMinutes * 60 : 0);
      setPracticeFeedback(null);
      setScreen('exam');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '题目加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function startExam(exam: Exam, mode = examMode, preparedQuestions?: Question[]) {
    setError('');
    setLoading(true);
    try {
      const loadedQuestions = preparedQuestions || await getExamQuestions(exam.id, mode !== 'mock');
      setSelectedExam(exam);
      setMockApplicationQuestions([]);
      setQuestions(loadedQuestions);
      setQuestionIndex(0);
      setAnswers({});
      setMarked(new Set());
      setCaseNotes({});
      setShowReference(false);
      setCaseGrading(null);
      setFullMockCaseResults([]);
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

  async function startSelectedCase() {
    const selectedCaseMode = modeOptions.find((mode) => mode.value === caseMode) || modeOptions[0];
    if (caseQuestionSource === 'exam') {
      if (selectedCaseId === 'all-exams') {
        setError('');
        setLoading(true);
        try {
          const loadedQuestions = await getPracticeQuestions({ source: 'module', module: 'all', revealAnswers: caseMode === 'practice', type: 'case' });
          if (loadedQuestions.length === 0) throw new Error('暂无可用的历年应用技术题');
          const numberedQuestions = loadedQuestions.map((question, index) => ({ ...question, number: index + 1 }));
          const exam: Exam = { id: `generated-${Date.now()}`, title: `全部历年应用技术题 · ${selectedCaseMode.label}`, type: 'case', origin: 'generated', year: 'generated', session: '', durationMinutes: 0, questionCount: numberedQuestions.length, source: 'generated' };
          await startExam(exam, caseMode, numberedQuestions);
        } catch (requestError) {
          setError(requestError instanceof Error ? requestError.message : '应用技术题加载失败');
        } finally {
          setLoading(false);
        }
        return;
      }
      const selected = caseExams.find((item) => item.id === selectedCaseId) || caseExams[0];
      if (!selected) {
        setError('暂无可用的历年应用技术题');
        return;
      }
      await startExam(selected, caseMode);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const loadedQuestions = await getPracticeQuestions({ source: caseQuestionSource, module: selectedCaseModule, count: caseQuestionSource === 'random' ? caseRandomCount : undefined, revealAnswers: caseMode === 'practice', type: 'case' });
      if (loadedQuestions.length === 0) throw new Error('当前范围没有可用的应用技术题');
      const numberedQuestions = loadedQuestions.map((question, index) => ({ ...question, number: index + 1 }));
      const sourceName = caseQuestionSource === 'module' ? (selectedCaseModule === 'all' ? '全部模块' : selectedCaseModule) : `随机 ${numberedQuestions.length} 题`;
      const exam: Exam = { id: `generated-${Date.now()}`, title: `${sourceName} · ${selectedCaseMode.label}`, type: 'case', origin: 'generated', year: 'generated', session: '', durationMinutes: 0, questionCount: numberedQuestions.length, source: 'generated' };
      await startExam(exam, caseMode, numberedQuestions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '应用技术题加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function openWrongBook() {
    if (!user) return;
    setError('');
    setLoading(true);
    try {
      setWrongQuestions(await getWrongQuestions(user.id));
      setScreen('wrong');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '错题加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function refreshModelOptions(force = false) {
    if (!modelConfig?.configured && !force) {
      setModelListMessage('先保存 DeepSeek API Key，再获取可用模型。');
      return;
    }
    setModelsLoading(true);
    setModelListMessage('正在读取 DeepSeek 模型列表…');
    try {
      const models = await getModelOptions();
      setAvailableModels(models);
      setModelListMessage(models.length > 0 ? `已读取 ${models.length} 个可用模型。` : '当前账号没有返回可用模型。');
    } catch (requestError) {
      setModelListMessage('模型列表读取失败');
      setError(requestError instanceof Error ? requestError.message : '获取模型列表失败');
    } finally {
      setModelsLoading(false);
    }
  }

  function openSettings() {
    setError('');
    setConfigMessage('');
    setModelListMessage('');
    setScreen('settings');
    if (modelConfig?.configured && availableModels.length === 0) void refreshModelOptions();
  }

  async function handleSaveModelConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfigSaving(true);
    setError('');
    setConfigMessage('');
    try {
      const saved = await saveModelConfig({ apiKey: configApiKey || undefined, baseUrl: configBaseUrl, model: configModel });
      setModelConfig(saved);
      setConfigApiKey('');
      setConfigBaseUrl(saved.baseUrl);
      setConfigModel(saved.model);
      setConfigMessage(`配置已保存，当前 Key：${saved.apiKeyMasked}`);
      void refreshModelOptions(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '模型配置保存失败');
    } finally {
      setConfigSaving(false);
    }
  }

  async function handleTestModelConfig() {
    setConfigSaving(true);
    setError('');
    setConfigMessage('正在测试 DeepSeek 连接…');
    try {
      const result = await testModelConfig();
      setConfigMessage(result.message);
    } catch (requestError) {
      setConfigMessage('连接失败');
      setError(requestError instanceof Error ? requestError.message : 'DeepSeek 连接失败');
    } finally {
      setConfigSaving(false);
    }
  }

  async function handleCaseGrading() {
    if (!currentQuestion || !caseNotes[currentQuestion.id]?.trim()) {
      setError('请先填写你的答案，再进行 AI 评分');
      return;
    }
    setGrading(true);
    setError('');
    setCaseGrading(null);
    try {
      setCaseGrading(await gradeCaseAnswer({ stem: currentQuestion.stem, referenceAnswer: currentQuestion.referenceAnswer, answer: caseNotes[currentQuestion.id], points: getCasePoints(currentQuestion) }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI 评分失败，请稍后重试');
    } finally {
      setGrading(false);
    }
  }

  function chooseAnswer(answer: OptionKey) {
    if (!currentQuestion) return;
    setAnswers((current) => ({ ...current, [currentQuestion.id]: answer }));
    if (examMode !== 'mock') {
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
    if (!selectedExam || selectedExam.type !== 'choice' || !user || submitting) return;
    const isFullMock = examMode === 'mock' && mockApplicationQuestions.length > 0;
    const unansweredCount = questions.filter((question) => question.type === 'case' ? !caseNotes[question.id]?.trim() : !answers[question.id]).length;
    if (!autoSubmitted && unansweredCount > 0) {
      const shouldSubmit = window.confirm(`还有 ${unansweredCount} 道题未作答，确定交卷吗？`);
      if (!shouldSubmit) return;
    }
    setSubmitting(true);
    try {
      const submittedResult = await submitAttempt({
        userId: user.id,
        examId: selectedExam.origin === 'generated' ? undefined : selectedExam.id,
        questionIds: selectedExam.origin === 'generated' ? questions.filter((question) => question.type === 'single-choice').map((question) => question.id) : undefined,
        title: selectedExam.title,
        answers,
        marked: [...marked],
        startedAt: startedAt || Date.now(),
        mode: examMode,
      });
      if (isFullMock) {
        const gradedCases: FullMockCaseResult[] = [];
        for (const question of mockApplicationQuestions) {
          const answer = caseNotes[question.id]?.trim() || '';
          if (!answer) {
            gradedCases.push({ question, answer, grading: null, error: '未作答' });
            continue;
          }
          try {
            gradedCases.push({ question, answer, grading: await gradeCaseAnswer({ stem: question.stem, referenceAnswer: question.referenceAnswer, answer, points: getCasePoints(question) }) });
          } catch (gradingError) {
            gradedCases.push({ question, answer, grading: null, error: gradingError instanceof Error ? gradingError.message : 'AI 评分失败' });
          }
        }
        setFullMockCaseResults(gradedCases);
      }
      setResult(submittedResult);
      setScreen('result');
      if (user) setAttempts(await getAttempts(user.id));
      localStorage.removeItem(SESSION_KEY);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '交卷失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  function returnHome() {
    localStorage.removeItem(SESSION_KEY);
    setScreen('home');
    setExamMode('practice');
    setCaseMode('practice');
    setSelectedExam(null);
    setMockApplicationQuestions([]);
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setMarked(new Set());
    setStartedAt(null);
    setRemainingSeconds(0);
    setPracticeFeedback(null);
    setCaseNotes({});
    setCaseGrading(null);
    setFullMockCaseResults([]);
    setResult(null);
    setError('');
  }

  function renderUserDialog() {
    if (!userReady || (user && !userSwitching)) return null;
    return (
      <div className="user-gate">
        <section className="user-card" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title">
          <span className="kicker">USER PROFILE</span>
          <h1 id="user-dialog-title">{user ? '切换登录用户' : '登录练习系统'}</h1>
          <p>输入英文用户名即可登录。首次使用会自动创建，练习记录和错题本会跟随用户名保存，换设备也能继续。</p>
          <form className="user-form" onSubmit={(event) => void handleLogin(event)}>
            <label><span>英文用户名</span><input value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} placeholder="例如：zhangsan" maxLength={24} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
            <button className="primary-control" type="submit">登录并进入</button>
          </form>
          {user && <p className="user-current-id">当前登录：{user.displayName}</p>}
          {user && <button className="user-cancel" type="button" onClick={() => { setUserSwitching(false); setUsernameInput(''); setError(''); }}>取消切换</button>}
        </section>
      </div>
    );
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
          <button className={screen === 'settings' ? 'nav-active' : ''} type="button" onClick={openSettings}>模型配置</button>
          <a href={docsUrl}>学习资料</a>
          {user && <button className="user-chip" type="button" onClick={() => { setUserSwitching(true); setError(''); }} title={`用户 ID：${user.id}`}>用户 · {user.displayName}</button>}
          <button className="theme-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="切换主题">
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </nav>
      </header>
    );
  }

  function renderHome() {
    const selectedChoiceExam = choiceExams.find((exam) => exam.id === selectedExamId) || choiceExams[0];
    const selectedCaseExam = caseExams.find((exam) => exam.id === selectedCaseId) || caseExams[0];
    const selectedChoiceMode = modeOptions.find((mode) => mode.value === examMode && mode.value !== 'mock') || modeOptions[0];
    const selectedCaseMode = modeOptions.find((mode) => mode.value === caseMode) || modeOptions[0];
    const sourceOptions: PickerOption[] = [{ value: 'exam', label: '历年真题', meta: `${choiceExams.length} 套试卷可选` }, { value: 'module', label: '按模块练习', meta: `${modules.length} 个知识模块` }, { value: 'random', label: '随机抽题', meta: '从题库中随机组合' }];
    const caseSourceOptions: PickerOption[] = [{ value: 'exam', label: '历年真题', meta: `${caseExams.length} 套试卷可选` }, ...(caseModules.length > 1 ? [{ value: 'module', label: '按模块练习', meta: `${caseModules.length} 个应用模块` }] : []), { value: 'random', label: '随机抽题', meta: '从应用题库中随机组合' }];
    const examOptions: PickerOption[] = [{ value: 'all-exams', label: '全部历年真题', meta: `${choiceExams.reduce((count, exam) => count + exam.questionCount, 0)} 道选择题` }, ...choiceExams.map((exam) => ({ value: exam.id, label: exam.title, meta: `${exam.questionCount} 题 · ${exam.durationMinutes} 分钟` }))];
    const caseExamOptions: PickerOption[] = [{ value: 'all-exams', label: '全部历年真题', meta: `${caseExams.reduce((count, exam) => count + exam.questionCount, 0)} 道应用题` }, ...caseExams.map((exam) => ({ value: exam.id, label: exam.title, meta: `${exam.questionCount} 道应用题` }))];
    const mockSourceOptions: PickerOption[] = [{ value: 'exam', label: '历年真题', meta: `${choiceExams.length} 套配套试卷` }, { value: 'random', label: '随机模拟', meta: `基础知识 ${MOCK_RANDOM_COUNT} 题 + 应用技术 ${MOCK_CASE_COUNT} 题` }];
    const mockExamOptions: PickerOption[] = choiceExams.map((exam) => ({ value: exam.id, label: exam.title, meta: `${exam.questionCount} 道基础知识 · 配套应用技术` }));
    const moduleOptions: PickerOption[] = [{ value: 'all', label: '全部模块', meta: `${modules.reduce((count, module) => count + module.questionCount, 0)} 题` }, ...modules.map((module) => ({ value: module.name, label: module.name, meta: `${module.questionCount} 题` }))];
    const caseModuleOptions: PickerOption[] = [{ value: 'all', label: '全部模块', meta: `${caseModules.reduce((count, module) => count + module.questionCount, 0)} 道应用题` }, ...caseModules.map((module) => ({ value: module.name, label: module.name, meta: `${module.questionCount} 道应用题` }))];
    const randomCountOptions: PickerOption[] = [20, 40, 60, 69].map((count) => ({ value: String(count), label: `${count} 题`, meta: '随机抽取' }));
    const caseRandomCountOptions: PickerOption[] = [1, 2, 4, 6, 10].map((count) => ({ value: String(count), label: `${count} 道`, meta: '随机抽取' }));
    return (
      <>
        <section className="page-intro compact-intro">
          <p>选择题、应用题和模拟考试，选好范围后即可开始。</p>
        </section>

        <section className="practice-console" aria-label="选择题练习">
          <div className="practice-console-head"><div><span className="kicker">CHOICE QUESTIONS</span><h2>选择题练习</h2><p>{selectedChoiceMode.description}</p></div><div className="mode-options mode-tabs choice-mode-tabs">{modeOptions.filter((mode) => mode.value !== 'mock').map((mode) => <button className={examMode === mode.value ? 'mode-option is-selected' : 'mode-option'} type="button" key={mode.value} onClick={() => changeMode(mode.value)}><strong>{mode.label}</strong><small>{mode.description}</small></button>)}</div></div>
          <div className="selection-flow">
            <div className="selection-step"><span>01</span><div><strong>选择题范围</strong><small>按试卷、模块或随机抽题开始</small></div></div>
            <div className={`selection-fields ${questionSource === 'random' ? 'is-random' : ''}`}>
              <div className="selection-field"><span>题目范围</span><ChoicePicker label="题目范围" value={questionSource} options={sourceOptions} onChange={(value) => changeQuestionSource(value as QuestionSource)} /></div>
              {questionSource === 'exam' && <div className="selection-field"><span>选择试卷</span><ChoicePicker label="选择试卷" value={selectedExamId} options={examOptions} onChange={setSelectedExamId} /></div>}
              {questionSource === 'module' && <div className="selection-field"><span>选择模块</span><ChoicePicker label="选择模块" value={selectedModule} options={moduleOptions} onChange={setSelectedModule} /></div>}
              {questionSource === 'random' && <><div className="selection-field"><span>抽题范围</span><ChoicePicker label="抽题范围" value={selectedModule} options={moduleOptions} onChange={setSelectedModule} /></div><div className="selection-field selection-count"><span>题目数量</span><ChoicePicker label="题目数量" value={String(randomCount)} options={randomCountOptions} onChange={(value) => setRandomCount(Number(value))} /></div></>}
              <button className="primary-control selection-submit" type="button" onClick={() => void startSelectedChoice()} disabled={loading || (questionSource === 'exam' && !selectedChoiceExam)}>{selectedChoiceMode.label} <span>→</span></button>
            </div>
          </div>
          <p className="selection-hint">{questionSource === 'module' ? '模块练习会检索该模块下的全部选择题。' : questionSource === 'random' ? `从${selectedModule === 'all' ? '全部题库' : selectedModule}中随机抽取 ${randomCount} 题。` : selectedExamId === 'all-exams' ? '已选择全部历年选择题，按年份和试卷顺序开始练习。' : '选择一套历年试卷，按题目顺序开始练习。'}</p>
        </section>

        <section className="practice-console case-console" aria-label="应用技术专项练习">
          <div className="practice-console-head"><div><span className="kicker">APPLICATION PRACTICE</span><h2>应用技术专项练习</h2><p>{selectedCaseMode.value === 'practice' ? '直接查看案例答案与解析，快速过题' : '输入答案后提交，由 AI 按评分点评分'}</p></div><div className="mode-options mode-tabs case-mode-tabs">{modeOptions.filter((mode) => mode.value !== 'mock').map((mode) => <button className={caseMode === mode.value ? 'mode-option is-selected' : 'mode-option'} type="button" key={mode.value} onClick={() => setCaseMode(mode.value as 'practice' | 'exercise')}><strong>{mode.label}</strong><small>{mode.value === 'practice' ? '直接查看答案和解析' : '作答后提交 AI 评分'}</small></button>)}</div></div>
          <div className="selection-flow">
            <div className="selection-step"><span>02</span><div><strong>选择应用题范围</strong><small>按试卷、模块或随机抽题开始</small></div></div>
            <div className={`selection-fields ${caseQuestionSource === 'random' ? 'is-random' : ''}`}>
              <div className="selection-field"><span>题目范围</span><ChoicePicker label="题目范围" value={caseQuestionSource} options={caseSourceOptions} onChange={(value) => changeCaseQuestionSource(value as QuestionSource)} /></div>
              {caseQuestionSource === 'exam' && <div className="selection-field"><span>选择试卷</span><ChoicePicker label="选择试卷" value={selectedCaseId} options={caseExamOptions} onChange={setSelectedCaseId} placeholder="暂无应用题" /></div>}
              {caseQuestionSource === 'module' && <div className="selection-field"><span>选择模块</span><ChoicePicker label="选择模块" value={selectedCaseModule} options={caseModuleOptions} onChange={setSelectedCaseModule} placeholder="暂无应用模块" /></div>}
              {caseQuestionSource === 'random' && <><div className="selection-field"><span>抽题范围</span><ChoicePicker label="抽题范围" value={selectedCaseModule} options={caseModuleOptions} onChange={setSelectedCaseModule} placeholder="全部模块" /></div><div className="selection-field selection-count"><span>题目数量</span><ChoicePicker label="题目数量" value={String(caseRandomCount)} options={caseRandomCountOptions} onChange={(value) => setCaseRandomCount(Number(value))} /></div></>}
              <button className="primary-control selection-submit" type="button" onClick={() => void startSelectedCase()} disabled={loading || (caseQuestionSource === 'exam' && !selectedCaseExam)}>{selectedCaseMode.label} <span>→</span></button>
            </div>
          </div>
          <p className="selection-hint">{caseQuestionSource === 'module' ? `模块练习会检索${selectedCaseModule === 'all' ? '全部模块' : selectedCaseModule}下的应用题。` : caseQuestionSource === 'random' ? `从${selectedCaseModule === 'all' ? '全部应用题库' : selectedCaseModule}中随机抽取 ${caseRandomCount} 道。` : selectedCaseId === 'all-exams' ? '已选择全部历年应用题，按年份和试卷顺序开始练习。' : '选择一套历年应用技术试卷，按题目顺序开始练习。'}</p>
        </section>

        <section className="practice-console mock-console" aria-label="模拟考试">
          <div className="practice-console-head"><div><span className="kicker">FULL MOCK EXAM</span><h2>模拟考试</h2><p>基础知识与应用技术连续作答，共用 240 分钟，最后统一交卷。</p></div><span className="mock-badge">整套考试</span></div>
          <div className="selection-flow">
            <div className="selection-step"><span>03</span><div><strong>设置考试范围</strong><small>选择历年配套试卷或随机组成完整试卷</small></div></div>
            <div className="mock-picker"><div className="selection-field"><span>模拟范围</span><ChoicePicker label="模拟范围" value={mockQuestionSource} options={mockSourceOptions} onChange={(value) => setMockQuestionSource(value as 'exam' | 'random')} /></div><div className="selection-field"><span>{mockQuestionSource === 'exam' ? '选择试卷' : '考试构成'}</span>{mockQuestionSource === 'exam' ? <ChoicePicker label="选择模拟试卷" value={selectedChoiceExam?.id || ''} options={mockExamOptions} onChange={setSelectedExamId} /> : <div className="selection-fixed"><strong>{MOCK_RANDOM_COUNT} 道选择题 + {MOCK_CASE_COUNT} 道应用题</strong><span>固定题量 · 共 240 分钟</span></div>}</div><button className="primary-control" type="button" onClick={() => void startFullMock()} disabled={loading || (mockQuestionSource === 'exam' && !selectedChoiceExam)}>开始模拟考试 <span>→</span></button></div>
          </div>
          <p className="selection-hint">{mockQuestionSource === 'exam' ? '选择一套历年选择题，系统会自动匹配同年度应用技术题。' : '从题库中随机抽取固定数量的选择题和应用题，组成一套完整模拟考试。'}</p>
        </section>

        <section className="quick-actions" aria-label="快捷练习">
          <div><span className="action-icon">⌁</span><div><strong>先复习再做题</strong><small>回到资料站查看知识点和答题方法</small></div><a href={docsUrl}>打开资料</a></div>
          <div><span className="action-icon">↗</span><div><strong>最近一次练习</strong><small>{attempts[0] ? `${attempts[0].examTitle} · ${attempts[0].score}/${attempts[0].total}` : '完成一套题后，这里会显示记录'}</small></div></div>
        </section>
      </>
    );
  }

  function renderExam() {
    if (!selectedExam || !currentQuestion) return null;
    if (selectedExam.type === 'case') return renderCaseExam();
    if (examMode === 'mock' && mockApplicationQuestions.length > 0 && currentQuestion.type === 'case') return renderMockCaseQuestion();
    const selectedAnswer = answers[currentQuestion.id];
    const isReviewMode = examMode === 'practice';
    const immediateFeedback = currentQuestion.answer && isReviewMode
      ? { correct: true, answer: currentQuestion.answer, explanation: currentQuestion.explanation || '暂无解析' }
      : currentQuestion.answer && examMode === 'exercise' && selectedAnswer
        ? { correct: selectedAnswer === currentQuestion.answer, answer: currentQuestion.answer, explanation: currentQuestion.explanation || '暂无解析' }
        : practiceFeedback;
    return (
      <div className="exam-shell">
        <div className="exam-topbar">
          <div><button className="back-button" type="button" onClick={returnHome}>← 退出</button><span className="exam-title">{selectedExam.title}{mockApplicationQuestions.length > 0 ? ' · 基础知识' : ''}</span></div>
          {examMode === 'mock' ? <div className={`timer ${remainingSeconds < 300 ? 'timer-warning' : ''}`}><span>剩余时间</span><strong>{formatTime(remainingSeconds)}</strong></div> : examMode === 'practice' || examMode === 'exercise' ? <span className="exam-progress">第 {questionIndex + 1} / {questions.length} 题</span> : <span className="mode-label">{modeOptions.find((mode) => mode.value === examMode)?.label}</span>}
          <button className="submit-button" type="button" onClick={isReviewMode ? returnHome : () => void handleSubmit()} disabled={submitting}>{submitting ? '提交中…' : isReviewMode ? '结束浏览' : examMode === 'mock' ? '交卷' : '提交练习'}</button>
        </div>
        <div className={`exam-layout ${isReviewMode ? 'review-layout' : ''} ${examMode === 'exercise' ? 'exercise-layout' : ''}`}>
          <main className="question-main">
            <div className="question-meta"><span>{mockApplicationQuestions.length > 0 ? `基础知识 · 第 ${currentQuestion.number} 题` : `第 ${currentQuestion.number} 题`}</span><span>单选题</span></div>
            <h1 className="question-stem">{cleanInlineText(currentQuestion.stem)}</h1>
            <div className="options-list">
              {currentQuestion.options.map((option) => (
                <button className={`option-button ${selectedAnswer === option.key ? 'is-selected' : ''} ${isReviewMode && currentQuestion.answer === option.key ? 'is-correct' : ''}`} type="button" key={option.key} onClick={isReviewMode ? undefined : () => chooseAnswer(option.key)}>
                  <span className="option-key">{option.key}</span><span>{cleanInlineText(option.label)}</span>
                </button>
              ))}
            </div>
            {!isReviewMode && examMode !== 'mock' && immediateFeedback && <div className={immediateFeedback.correct ? 'practice-feedback feedback-correct' : 'practice-feedback feedback-wrong'}><strong>{immediateFeedback.correct ? '正确答案' : `回答错误，正确答案是 ${immediateFeedback.answer || '暂无'}`}</strong><div className="rich-answer-text">{renderAnswerContent(immediateFeedback.explanation)}</div></div>}
            <div className="question-actions">
              {isReviewMode ? <span className="review-tip">答案与解析已展示</span> : <button className={marked.has(currentQuestion.id) ? 'mark-button is-marked' : 'mark-button'} type="button" onClick={toggleMarked}>⚑ {marked.has(currentQuestion.id) ? '已标记' : '标记待检查'}</button>}
              <div><button className="secondary-control" type="button" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>上一题</button><button className="primary-control" type="button" onClick={() => questionIndex === questions.length - 1 ? (isReviewMode ? returnHome() : void handleSubmit()) : setQuestionIndex(questionIndex + 1)}>{questionIndex === questions.length - 1 ? (isReviewMode ? '结束浏览' : mockApplicationQuestions.length > 0 ? '提交整套考试' : '完成练习') : mockApplicationQuestions.length > 0 && questionIndex === questions.length - mockApplicationQuestions.length - 1 ? '进入应用技术' : '下一题'}</button></div>
            </div>
          </main>
          {isReviewMode ? <aside className="question-panel answer-panel"><div className="panel-heading"><div><span className="panel-kicker">ANSWER REVIEW</span><h2>答案与解析</h2></div><span className="panel-count">第 {currentQuestion.number} 题</span></div><div className="answer-panel-key"><span>正确答案</span><strong>{currentQuestion.answer || '暂无'}</strong></div><div className="answer-panel-explanation"><span className="panel-kicker">EXPLANATION</span><div className="rich-answer-text">{renderAnswerContent(currentQuestion.explanation || '暂无解析')}</div></div></aside> : <QuestionPalette questions={questions} currentIndex={questionIndex} answers={answers} caseAnswers={caseNotes} marked={marked} onSelect={setQuestionIndex} />}
        </div>
      </div>
    );
  }

  function renderMockCaseQuestion() {
    if (!selectedExam || !currentQuestion) return null;
    const applicationIndex = mockApplicationQuestions.findIndex((question) => question.id === currentQuestion.id);
    const isLastQuestion = questionIndex === questions.length - 1;
    return (
      <div className="exam-shell">
        <div className="exam-topbar"><div><button className="back-button" type="button" onClick={returnHome}>← 退出</button><span className="exam-title">{selectedExam.title} · 应用技术</span></div><div className={`timer ${remainingSeconds < 300 ? 'timer-warning' : ''}`}><span>剩余时间</span><strong>{formatTime(remainingSeconds)}</strong></div><button className="submit-button" type="button" onClick={() => void handleSubmit()} disabled={submitting}>{submitting ? '评分中…' : '提交整套考试'}</button></div>
        <div className="exam-layout">
          <main className="question-main mock-case-main"><div className="question-meta"><span>应用技术 · 第 {applicationIndex + 1} 题</span><span>{getCasePoints(currentQuestion)} 分</span></div><h1 className="case-heading">案例题 {applicationIndex + 1}</h1><div className="case-text case-content">{renderCaseContent(currentQuestion.stem)}</div><label className="answer-label" htmlFor="mock-case-answer">我的作答</label><textarea id="mock-case-answer" className="case-answer" value={caseNotes[currentQuestion.id] || ''} onChange={(event) => setCaseNotes((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} placeholder="按评分点写出你的答案，模拟考试结束后统一评分……" /><div className="question-actions"><button className={marked.has(currentQuestion.id) ? 'mark-button is-marked' : 'mark-button'} type="button" onClick={toggleMarked}>⚑ {marked.has(currentQuestion.id) ? '已标记' : '标记待检查'}</button><div><button className="secondary-control" type="button" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>上一题</button><button className="primary-control" type="button" onClick={() => isLastQuestion ? void handleSubmit() : setQuestionIndex(questionIndex + 1)}>{isLastQuestion ? '提交整套考试' : '下一题'}</button></div></div></main>
          <QuestionPalette questions={questions} currentIndex={questionIndex} answers={answers} caseAnswers={caseNotes} marked={marked} onSelect={setQuestionIndex} />
        </div>
      </div>
    );
  }

  function renderCaseExam() {
    if (!selectedExam || !currentQuestion) return null;
    const isReviewMode = examMode === 'practice';
    const isLastQuestion = questionIndex === questions.length - 1;
    return (
      <div className="case-shell">
        <div className="exam-topbar"><div><button className="back-button" type="button" onClick={returnHome}>← 返回</button><span className="exam-title">{selectedExam.title}</span></div><span className="case-progress">案例 {questionIndex + 1} / {questions.length}</span><div className="case-top-actions">{isReviewMode ? <button className="submit-button" type="button" onClick={returnHome}>结束浏览</button> : <><button className="secondary-control" type="button" onClick={() => setShowReference(!showReference)}>{showReference ? '收起参考答案' : '查看参考答案'}</button><button className="submit-button" type="button" onClick={() => void handleCaseGrading()} disabled={grading}>{grading ? '评分中…' : '提交并 AI 评分'}</button></>}</div></div>
        <div className={`case-layout ${isReviewMode ? 'case-review-layout' : ''}`}>
          <main className="case-main">
            <div className="question-meta"><span>{currentQuestion.title || `试题 ${currentQuestion.number}`}</span><span>{getCasePoints(currentQuestion)} 分</span></div>
            <h1 className="case-heading">案例题 {currentQuestion.number}</h1>
            <div className="case-text case-content">{renderCaseContent(currentQuestion.stem)}</div>
            {!isReviewMode && <><label className="answer-label" htmlFor="case-answer">我的作答</label><textarea id="case-answer" className="case-answer" value={caseNotes[currentQuestion.id] || ''} onChange={(event) => setCaseNotes((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} placeholder="在这里输入你的答题要点……" />{caseGrading && <section className="grading-result"><div className="grading-heading"><div><span className="panel-kicker">AI GRADING</span><h2>本题得分</h2></div><strong>{caseGrading.score}<small> / {caseGrading.maxScore} 分</small></strong></div><p>{caseGrading.summary}</p><div className="grading-items">{caseGrading.items.map((item, index) => <div key={`${item.criterion}-${index}`}><span>{item.criterion}</span><strong>{item.score}/{item.maxScore}</strong><small>{item.reason}</small></div>)}</div><em>AI 评分仅供参考 · 置信度：{caseGrading.confidence === 'high' ? '高' : caseGrading.confidence === 'low' ? '低' : '中'}</em></section>}{showReference && <section className="reference-answer"><h2>参考答案</h2><div className="case-text case-content">{renderCaseContent(currentQuestion.referenceAnswer || '暂无参考答案')}</div></section>}</>}
            <div className="question-actions">{isReviewMode ? <span className="review-tip">答案与解析已展示</span> : <div />}<div><button className="secondary-control" type="button" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}>上一题</button><button className="primary-control" type="button" onClick={() => isReviewMode && isLastQuestion ? returnHome() : setQuestionIndex(Math.min(questions.length - 1, questionIndex + 1))} disabled={!isReviewMode && isLastQuestion}>{isLastQuestion && isReviewMode ? '结束浏览' : '下一题'}</button></div></div>
          </main>
          {isReviewMode ? <aside className="case-sidebar answer-panel"><div className="panel-heading"><div><span className="panel-kicker">ANSWER REVIEW</span><h2>答案与解析</h2></div><span className="panel-count">第 {currentQuestion.number} 题</span></div><div className="answer-panel-explanation"><span className="panel-kicker">REFERENCE ANSWER</span><div className="case-text case-content answer-panel-case-text">{renderCaseContent(currentQuestion.referenceAnswer || '暂无参考答案')}</div></div></aside> : <aside className="case-sidebar"><span className="panel-kicker">CASE LIST</span><h2>案例题目</h2>{questions.map((question, index) => <button className={index === questionIndex ? 'case-nav is-current' : 'case-nav'} type="button" key={question.id} onClick={() => setQuestionIndex(index)}><span>{question.number}</span><small>{question.title || '案例题'}</small></button>)}</aside>}
        </div>
      </div>
    );
  }

  function renderSettings() {
    const modelPickerOptions: PickerOption[] = availableModels.length > 0
      ? availableModels.map((model) => ({ value: model.id, label: model.label, meta: model.recommended ? '推荐用于评分' : model.id }))
      : configModel ? [{ value: configModel, label: configModel, meta: '当前配置 · 刷新获取完整列表' }] : [];
    const selectedModel = availableModels.find((model) => model.id === configModel);
    return <div className="settings-page"><div className="result-heading"><span className="kicker">MODEL SETTINGS</span><h1>模型配置</h1><p>选择一个 DeepSeek 模型，用于案例题、计算题和文字题的 AI 评分。选择题仍按题库标准答案自动判分。</p></div><form className="settings-form" onSubmit={(event) => void handleSaveModelConfig(event)}><label className="settings-field"><span>DeepSeek API Key</span><input type="password" value={configApiKey} onChange={(event) => setConfigApiKey(event.target.value)} placeholder={modelConfig?.configured ? `已配置 ${modelConfig.apiKeyMasked}，留空保持不变` : '请输入 API Key'} autoComplete="off" /></label><div className="settings-model-field"><div className="settings-field-head"><span>评分模型</span><button className="model-refresh" type="button" onClick={() => void refreshModelOptions()} disabled={modelsLoading || configSaving || !modelConfig?.configured}>{modelsLoading ? '读取中…' : '刷新模型列表'}</button></div><ChoicePicker label="评分模型" value={configModel} options={modelPickerOptions} onChange={setConfigModel} placeholder="先刷新模型列表" />{selectedModel ? <p className="model-description"><strong>{selectedModel.recommended ? '推荐用于评分' : '模型用途'}</strong>{selectedModel.description}</p> : <p className="model-description">{availableModels.length > 0 ? '当前配置的模型未出现在列表中，可直接选择其他模型。' : '保存 API Key 后刷新列表，选择用于 AI 评分的模型。'}</p>}</div><label className="settings-field"><span>接口地址</span><input value={configBaseUrl} onChange={(event) => setConfigBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" /></label><div className="settings-actions"><button className="primary-control" type="submit" disabled={configSaving}>{configSaving ? '保存中…' : '保存配置'}</button><button className="secondary-control" type="button" onClick={() => void handleTestModelConfig()} disabled={configSaving || !modelConfig?.configured}>测试连接</button></div>{configMessage && <p className="settings-message">{configMessage}</p>}{modelListMessage && <p className="settings-message settings-list-message">{modelListMessage}</p>}<p className="settings-note">模型列表从 DeepSeek 服务端实时读取；Key 仅保存在服务端 data 目录，前端不会接触原始 Key。AI 评分结果仅供参考。</p></form></div>;
  }

  function renderResult() {
    if (!result) return null;
    const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
    const caseMaxScore = fullMockCaseResults.reduce((total, item) => total + getCasePoints(item.question), 0);
    const caseScore = fullMockCaseResults.reduce((total, item) => total + (item.grading?.score || 0), 0);
    return <div className="result-page"><div className="result-heading"><span className="kicker">SUBMISSION COMPLETE</span><h1>{result.examTitle}</h1><p>{fullMockCaseResults.length > 0 ? '整套考试已交卷：基础知识按标准答案判分，应用技术按评分点进行 AI 评分。' : '这次完成得怎么样，回看错题比只看分数更重要。'}</p></div><section className="score-grid"><div className="score-main"><span>{fullMockCaseResults.length > 0 ? '基础知识得分' : '得分'}</span><strong>{result.score}</strong><small>/ {result.total}</small></div><div><span>正确率</span><strong>{accuracy}%</strong></div><div><span>答对</span><strong>{result.correct}</strong></div><div><span>答错</span><strong>{result.wrong}</strong></div><div><span>未答</span><strong>{result.unanswered}</strong></div></section>{fullMockCaseResults.length > 0 && <section className="full-mock-result"><div className="section-title"><div><span className="kicker">APPLICATION TECHNOLOGY</span><h2>应用技术评分</h2></div><strong>{caseScore} / {caseMaxScore} 分</strong></div><p>案例题和计算题按评分点给出部分得分，AI 评分仅供参考。</p><div className="full-mock-case-list">{fullMockCaseResults.map((item, index) => <div key={item.question.id}><span>第 {index + 1} 题</span><strong>{item.grading ? `${item.grading.score} / ${item.grading.maxScore} 分` : item.error || '未评分'}</strong><small>{item.grading?.summary || (item.error === '未作答' ? '本题未填写答案。' : '请配置模型后重新进行专项评分。')}</small></div>)}</div></section>}<section className="review-section"><div className="section-title"><div><span className="kicker">ANSWER REVIEW</span><h2>基础知识逐题解析</h2></div><span>{result.durationSeconds ? `用时 ${formatTime(result.durationSeconds)}` : ''}</span></div><div className="review-list">{result.answers.map((answer) => <article className={`review-card ${answer.isCorrect ? 'review-correct' : 'review-wrong'}`} key={answer.questionId}><div className="review-card-head"><span>第 {answer.number} 题</span><strong>{answer.isCorrect ? '回答正确' : answer.selectedAnswer ? `你的答案：${answer.selectedAnswer}` : '未作答'}</strong><span>正确答案：{answer.correctAnswer}</span></div><h3>{cleanInlineText(answer.stem)}</h3><div className="review-options">{answer.options.map((option) => <span className={option.key === answer.correctAnswer ? 'correct-option' : option.key === answer.selectedAnswer ? 'wrong-option' : ''} key={option.key}><b>{option.key}</b>{cleanInlineText(option.label)}</span>)}</div><div className="explanation"><b>解析</b><div className="rich-answer-text">{renderAnswerContent(answer.explanation || '暂无解析')}</div></div></article>)}</div></section><div className="bottom-actions"><button className="secondary-control" type="button" onClick={returnHome}>返回练习大厅</button><button className="primary-control" type="button" onClick={openWrongBook}>查看错题本</button></div></div>;
  }

  function renderWrongBook() {
    return <div className="wrong-page"><div className="page-intro"><div><span className="kicker">MISTAKE NOTEBOOK</span><h1>错题本</h1><p>每次交卷后的错题都会留在这里，重新理解解析，再回到对应知识点。</p></div><strong className="wrong-count">{wrongQuestions.length}<small>道错题</small></strong></div>{wrongQuestions.length === 0 ? <div className="empty-state"><strong>还没有错题</strong><p>完成一套选择题后，答错的题目会自动出现在这里。</p><button className="primary-control" type="button" onClick={returnHome}>去做一套题</button></div> : <div className="wrong-list">{wrongQuestions.map((question) => <article className="wrong-card" key={question.questionId}><div className="review-card-head"><span>{question.examTitle} · 第 {question.number} 题</span><span>上次练习：{new Date(question.lastAttemptAt).toLocaleDateString('zh-CN')}</span></div><h2>{cleanInlineText(question.stem)}</h2><div className="review-options">{question.options.map((option) => <span className={option.key === question.correctAnswer ? 'correct-option' : ''} key={option.key}><b>{option.key}</b>{cleanInlineText(option.label)}</span>)}</div><div className="explanation"><b>正确答案：{question.correctAnswer}</b><div className="rich-answer-text">{renderAnswerContent(question.explanation || '暂无解析')}</div></div></article>)}</div>}</div>;
  }

  if (!userReady || (loading && user && exams.length === 0)) return <div className="loading-screen"><span className="brand-mark">SE</span><p>正在加载题库…</p></div>;
  if (!user) return <div className="app"><div className="page-wrap">{error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div>}{renderUserDialog()}</div></div>;
  return <div className="app"><div className="page-wrap">{screen !== 'exam' && renderHeader()}{error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError('')}>×</button></div>}{screen === 'home' && renderHome()}{screen === 'exam' && renderExam()}{screen === 'result' && renderResult()}{screen === 'wrong' && renderWrongBook()}{screen === 'settings' && renderSettings()}{renderUserDialog()}</div></div>;
}

export default App;
