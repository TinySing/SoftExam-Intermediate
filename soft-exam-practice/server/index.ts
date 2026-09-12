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
const modelConfigPath = path.join(dataDirectory, 'model-config.json');

interface ModelConfig {
  provider: 'deepseek';
  baseUrl: string;
  model: string;
  apiKey: string;
}

const defaultModelConfig: ModelConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: '',
};

fs.mkdirSync(dataDirectory, { recursive: true });
if (!fs.existsSync(databasePath)) fs.copyFileSync(questionBankPath, databasePath);
const SqlJs: SqlJsStatic = await initSqlJs({ locateFile: (file) => path.join(projectDirectory, 'node_modules/sql.js/dist', file) });
const database: SqlDatabase = new SqlJs.Database(fs.readFileSync(databasePath));

database.run(`
  CREATE TABLE IF NOT EXISTS question_sets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'past',
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
    origin TEXT NOT NULL DEFAULT 'past',
    module TEXT NOT NULL DEFAULT '综合题库',
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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES question_sets(id),
    user_id TEXT NOT NULL DEFAULT 'legacy',
    source_title TEXT NOT NULL DEFAULT '',
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

const inlinePageReferencePattern = /(?:参见\s*)?(?:中级教材(?:第二版)?|教材)?\s*P\s*\d{2,3}(?:\s*[-－—–]\s*P?\s*\d{2,3})?\s*页?\s*(?=[，,：:；;。！？《●•▪◦\u4E00-\u9FFF]|$)[，,：:；;。！？]?/gi;
const pageReferencePattern = /(^|\n)[ \t]*(?:参见\s*)?(?:中级教材(?:第二版)?|教材)?\s*P\s*\d{1,3}(?:\s*[-－—–]\s*P?\s*\d{1,3})?\s*页?\s*(?=[，,：:；;。！？《●•▪◦\u4E00-\u9FFF]|$)[，,：:；;。！？]?/gim;
const mergedAnswerPattern = /\n(?:第\s*[2-9]\s*批|20\d{2}\s*年\s*(?:上|下)半年\s*案例分析试题)/;
const explanationOverrides: Record<string, string> = {
  'choice-2026-h1-第一批-q2': '本题两个空要分别看它们所属的服务质量特性。\n第 1 空：灵活性。友好性包括主动性、灵活性和礼貌性，灵活性指服务方应对需求变化的能力。\n第 2 空：合规性。有形性包括可视性、专业性和合规性，合规性指 IT 服务遵循标准、约定或法规的程度。\n因此答案是 C：灵活性、合规性。',
  'choice-2024-h2-第一批-q6': '质量测量指标是“规划质量管理”的输出，不属于该过程的输入。干系人参与计划、需求文件和范围基准都可以作为规划质量管理的输入，因此选 C。',
  'choice-2024-h2-第三批-q23': '响应性是指 IT 服务供方按照服务协议的要求，及时受理和处理需方服务请求的程度。可靠性强调在约定条件和时间内稳定履约；有形性和友好性也不符合题干定义，因此选 A。',
  'choice-2025-h2-第二批-q36': '完备性是指服务是否具备服务协议中承诺的全部功能，题干描述与此完全对应，因此选 B。可用性强调需要时能否正常使用，有效性强调是否达到预期效果。',
};

function cleanExamText(value: unknown) {
  return String(value || '')
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
    .replace(/GB\/T24405\.\s*l-2009idtISO\/IEC 20000-1：2005/g, 'GB/T24405.1-2009 idt ISO/IEC 20000-1:2005')
    .replace(/([\u4E00-\u9FFF])\s+(?=[\u4E00-\u9FFF])/g, '$1')
    .replace(/该标准等标准/g, '该标准等同采用')
    .replace(/2011-04-15/g, '2011-04-12')
    .replace(/([^\n])\s+(?=(?:PV|AC|EV|CV|SV|CPI|SPI|ETC|EAC|EMV)(?:\s*[\u4E00-\u9FFF]*)?\s*=)/g, '$1\n')
    .replace(/\s+(?=(?:自主研发方案|外包方案|建议[:：]|当前项目状态[:：]|采取措施[:：]|具体措施[:：]))/g, '\n')
    .replace(/^(?:[，,：:]\s*)+/, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function cleanReferenceAnswer(value: unknown) {
  const cleaned = cleanExamText(value).replace(
    /1\.\s*招标文件、（2）采购工作说明书、（3）独立成本估算和、（4）供方选择标准（5）合同条款、（6）合同中规定的程序、（7）谈判/g,
    '1. 招标文件\n2. 采购工作说明书\n3. 独立成本估算\n4. 供方选择标准\n5. 合同条款\n6. 合同中规定的程序\n7. 谈判'
  );
  const markerIndex = cleaned.search(mergedAnswerPattern);
  return markerIndex > 0 ? cleaned.slice(0, markerIndex).trimEnd() : cleaned;
}

function cleanQuestionExplanation(id: unknown, value: unknown) {
  return explanationOverrides[String(id)] || cleanExamText(value);
}

function readModelConfig(): ModelConfig {
  if (!fs.existsSync(modelConfigPath)) return defaultModelConfig;
  try {
    const saved = JSON.parse(fs.readFileSync(modelConfigPath, 'utf8')) as Partial<ModelConfig>;
    return { ...defaultModelConfig, ...saved, provider: 'deepseek' };
  } catch {
    return defaultModelConfig;
  }
}

function writeModelConfig(config: ModelConfig) {
  fs.writeFileSync(modelConfigPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(modelConfigPath, 0o600);
}

function maskApiKey(apiKey: string) {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••••••';
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

async function callDeepSeek(messages: { role: 'system' | 'user'; content: string }[]) {
  const config = readModelConfig();
  if (!config.apiKey) throw new Error('请先在模型配置中填写 DeepSeek API Key');
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek 请求失败（${response.status}）`);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 没有返回有效内容');
  return content;
}

const modelGuidance: Record<string, { label: string; description: string; recommended: boolean }> = {
  'deepseek-v4-flash': { label: 'DeepSeek V4 Flash', description: '速度快、成本更低，适合日常案例题和计算题评分。', recommended: true },
  'deepseek-v4-pro': { label: 'DeepSeek V4 Pro', description: '复杂推理能力更强，适合答案较长或评分点较多的案例题。', recommended: false },
  'deepseek-v4-flash-vision-exp': { label: 'DeepSeek V4 Flash Vision Exp', description: '支持图片输入；当前评分流程是文字答案，暂不推荐。', recommended: false },
  'deepseek-chat': { label: 'DeepSeek Chat（兼容）', description: '兼容旧模型名称，适合普通文字评分；建议逐步迁移到 V4 Flash。', recommended: false },
  'deepseek-reasoner': { label: 'DeepSeek Reasoner（兼容）', description: '兼容旧模型名称，适合复杂推理评分；响应速度通常较慢。', recommended: false },
};

async function listDeepSeekModels() {
  const config = readModelConfig();
  if (!config.apiKey) throw new Error('请先保存 DeepSeek API Key，再获取模型列表');
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  const payload = await response.json().catch(() => null) as { error?: { message?: string }; data?: { id?: unknown }[] } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `获取模型列表失败（${response.status}）`);
  return (payload?.data || []).filter((model) => typeof model.id === 'string').map((model) => {
    const id = String(model.id);
    const guidance = modelGuidance[id];
    return { id, label: guidance?.label || id, description: guidance?.description || 'DeepSeek 可用文本模型，可用于案例题和计算题评分。', recommended: guidance?.recommended || false };
  }).sort((left, right) => Number(right.recommended) - Number(left.recommended) || left.label.localeCompare(right.label));
}

function clampScore(value: unknown, maxScore: number) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.min(Math.max(score, 0), maxScore) : 0;
}

function resolveCasePoints(points: unknown, stem: string) {
  const storedPoints = Number(points);
  if (Number.isFinite(storedPoints) && storedPoints > 0) return storedPoints;
  const inferredPoints = [...stem.matchAll(/[（(]\s*(\d+)\s*分[）)]/g)].reduce((total, match) => total + Number(match[1]), 0);
  return inferredPoints || 20;
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = queryAll(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('question_sets', 'origin', "TEXT NOT NULL DEFAULT 'past'");
ensureColumn('questions', 'origin', "TEXT NOT NULL DEFAULT 'past'");
ensureColumn('questions', 'module', "TEXT NOT NULL DEFAULT '综合题库'");
ensureColumn('attempts', 'source_title', "TEXT NOT NULL DEFAULT ''");
ensureColumn('attempts', 'user_id', "TEXT NOT NULL DEFAULT 'legacy'");

const legacyUserId = 'legacy';
if (!queryOne('SELECT id FROM users WHERE id = ?', [legacyUserId])) {
  const now = new Date().toISOString();
  run('INSERT INTO users (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)', [legacyUserId, '旧数据', now, now]);
  persistDatabase();
}

const moduleRules: [string, string[]][] = [
  ['信息系统架构', ['架构', 'SOA', '微服务', '中间件', '分布式', '系统集成']],
  ['数据工程', ['数据库', '数据仓库', '数据湖', 'ETL', '数据挖掘', '数据治理', '主数据', '大数据']],
  ['信息安全工程', ['信息安全', '网络安全', '加密', '密码', '防火墙', '漏洞', '攻击', '身份认证', '访问控制']],
  ['软件工程', ['软件工程', '软件开发', '软件生命周期', '面向对象', '设计模式', '软件测试', 'CMMI', '需求分析', 'UML']],
  ['信息化与信息技术', ['云计算', '物联网', '人工智能', '区块链', '数字化', '信息化', '电子政务', '互联网']],
  ['信息技术服务', ['IT服务', '信息技术服务', '服务管理', 'SLA', '运维']],
  ['法律法规与标准', ['法律', '法规', '知识产权', '著作权', '专利', '标准']],
  ['项目管理', ['项目', '风险', '进度', '成本', '质量', '采购', '干系人', '沟通', '变更', '绩效', '计划']],
];

function inferModule(stem: string) {
  return moduleRules.find(([, keywords]) => keywords.some((keyword) => stem.includes(keyword)))?.[0] || '综合题库';
}

for (const question of queryAll(`SELECT id, stem FROM questions WHERE type = 'single-choice' AND (module IS NULL OR module = '' OR module = '综合题库')`)) {
  run(`UPDATE questions SET module = ? WHERE id = ?`, [inferModule(String(question.stem)), question.id]);
}

function trimReferenceAnswer(questionId: string, marker: string) {
  const question = queryOne(`SELECT reference_answer FROM questions WHERE id = ?`, [questionId]);
  const referenceAnswer = String(question?.reference_answer || '');
  const markerIndex = referenceAnswer.indexOf(marker);
  if (markerIndex > 0) run(`UPDATE questions SET reference_answer = ? WHERE id = ?`, [referenceAnswer.slice(0, markerIndex).trimEnd(), questionId]);
}

trimReferenceAnswer('case-2025-h2-q4', '\n第2批');
trimReferenceAnswer('case-2026-h1-q4', '\n第2批');
for (const question of queryAll(`SELECT id, stem, explanation, reference_answer FROM questions`)) {
  const stem = cleanExamText(question.stem);
  const explanation = cleanQuestionExplanation(question.id, question.explanation);
  const referenceAnswer = cleanReferenceAnswer(question.reference_answer);
  if (stem !== question.stem || explanation !== question.explanation || referenceAnswer !== question.reference_answer) {
    run(`UPDATE questions SET stem = ?, explanation = ?, reference_answer = ? WHERE id = ?`, [stem, explanation, referenceAnswer, question.id]);
  }
}
run(`UPDATE question_sets SET question_count = (SELECT COUNT(*) FROM questions WHERE questions.exam_id = question_sets.id) WHERE question_count <> (SELECT COUNT(*) FROM questions WHERE questions.exam_id = question_sets.id)`);
persistDatabase();

const app = express();
const port = Number(process.env.PORT || 4000);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function mapExam(row: Record<string, unknown>) {
  return { id: row.id, title: row.title, type: row.type, origin: row.origin || 'past', year: row.year, session: row.session, batch: row.batch || undefined, location: row.location || undefined, durationMinutes: row.duration_minutes, questionCount: row.actual_question_count || row.question_count, source: row.source };
}
function mapQuestion(row: Record<string, unknown>, includeAnswers = false) {
  return { id: row.id, examId: row.exam_id, number: row.number, type: row.type, origin: row.origin || 'past', module: row.module || '综合题库', stem: cleanExamText(row.stem), options: JSON.parse(String(row.options_json)), ...(includeAnswers ? { answer: row.correct_answer, explanation: cleanQuestionExplanation(row.id, row.explanation), referenceAnswer: cleanReferenceAnswer(row.reference_answer) } : row.type === 'case' ? { referenceAnswer: cleanReferenceAnswer(row.reference_answer) } : {}), year: row.year, session: row.session, title: row.title || undefined, points: row.points || undefined };
}
function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

function getQueryUserId(request: express.Request) {
  const userId = request.query.userId;
  return typeof userId === 'string' ? userId.trim() : '';
}

function hasUser(userId: string) {
  return Boolean(userId && queryOne('SELECT id FROM users WHERE id = ?', [userId]));
}

const usernamePattern = /^[a-z][a-z0-9_-]{2,23}$/i;

function normalizeUsername(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isValidUsername(username: string) {
  return usernamePattern.test(username);
}

function loginOrCreateUser(username: string) {
  const now = new Date().toISOString();
  const existingUser = queryOne('SELECT id, display_name, created_at FROM users WHERE id = ?', [username])
    || queryOne('SELECT id, display_name, created_at FROM users WHERE lower(display_name) = ?', [username]);
  if (existingUser) {
    const currentId = String(existingUser.id);
    if (currentId !== username && !queryOne('SELECT id FROM users WHERE id = ?', [username])) {
      run('UPDATE users SET id = ?, display_name = ?, last_seen_at = ? WHERE id = ?', [username, username, now, currentId]);
      run('UPDATE attempts SET user_id = ? WHERE user_id = ?', [username, currentId]);
      persistDatabase();
      return { id: username, displayName: username, createdAt: existingUser.created_at };
    }
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', [now, currentId]);
    persistDatabase();
    return { id: currentId, displayName: existingUser.display_name, createdAt: existingUser.created_at };
  }

  run('INSERT INTO users (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)', [username, username, now, now]);
  const nonLegacyUsers = queryOne("SELECT COUNT(*) AS count FROM users WHERE id <> 'legacy'");
  if (Number(nonLegacyUsers?.count || 0) === 1) run("UPDATE attempts SET user_id = ? WHERE user_id = 'legacy'", [username]);
  persistDatabase();
  return { id: username, displayName: username, createdAt: now };
}

app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.post('/api/login', (request, response) => {
  const username = normalizeUsername(request.body?.username);
  if (!isValidUsername(username)) return response.status(400).json({ message: '用户名需为 3-24 位英文开头，可包含英文、数字、下划线或短横线' });
  response.json(loginOrCreateUser(username));
});
app.post('/api/users', (request, response) => {
  const username = normalizeUsername(request.body?.displayName);
  if (!isValidUsername(username)) return response.status(400).json({ message: '用户名需为 3-24 位英文开头，可包含英文、数字、下划线或短横线' });
  response.json(loginOrCreateUser(username));
});
app.get('/api/users/:userId', (request, response) => {
  const user = queryOne('SELECT id, display_name, created_at FROM users WHERE id = ?', [request.params.userId]);
  if (!user) return response.status(404).json({ message: '用户不存在，请检查用户名' });
  run('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), request.params.userId]);
  persistDatabase();
  response.json({ id: user.id, displayName: user.display_name, createdAt: user.created_at });
});
app.get('/api/model-config', (_request, response) => {
  const config = readModelConfig();
  response.json({ provider: config.provider, baseUrl: config.baseUrl, model: config.model, configured: Boolean(config.apiKey), apiKeyMasked: maskApiKey(config.apiKey) });
});
app.get('/api/model-options', async (_request, response) => {
  try {
    response.json(await listDeepSeekModels());
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : '获取模型列表失败' });
  }
});
app.put('/api/model-config', (request, response) => {
  const current = readModelConfig();
  const { apiKey, baseUrl = current.baseUrl, model = current.model } = request.body as { apiKey?: string; baseUrl?: string; model?: string };
  const nextApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : current.apiKey;
  if (!nextApiKey) return response.status(400).json({ message: '请填写 DeepSeek API Key' });
  writeModelConfig({ provider: 'deepseek', apiKey: nextApiKey, baseUrl: String(baseUrl).trim() || defaultModelConfig.baseUrl, model: String(model).trim() || defaultModelConfig.model });
  response.json({ provider: 'deepseek', baseUrl: String(baseUrl).trim() || defaultModelConfig.baseUrl, model: String(model).trim() || defaultModelConfig.model, configured: true, apiKeyMasked: maskApiKey(nextApiKey) });
});
app.post('/api/model-config/test', async (_request, response) => {
  try {
    await callDeepSeek([{ role: 'system', content: '只返回 JSON：{"ok":true}' }, { role: 'user', content: '连接测试。' }]);
    response.json({ ok: true, message: 'DeepSeek 连接成功' });
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : 'DeepSeek 连接失败' });
  }
});
app.post('/api/case-grading', async (request, response) => {
  const { stem, referenceAnswer, answer, points = 0 } = request.body as { stem?: string; referenceAnswer?: string; answer?: string; points?: number };
  if (!stem || !answer?.trim()) return response.status(400).json({ message: '请先填写你的答案' });
  const maxScore = resolveCasePoints(points, stem);
  try {
    const content = await callDeepSeek([
      { role: 'system', content: '你是软件项目管理考试阅卷老师。请严格依据题目分值、参考答案和评分点评分，允许同义表达和合理的不同计算路径，不能因为措辞不同扣分。必须只返回 JSON，不要 Markdown。格式：{"score":数字,"summary":"总体评价","confidence":"high|medium|low","items":[{"criterion":"评分点","score":数字,"maxScore":数字,"reason":"判断理由"}]}' },
      { role: 'user', content: `题目：\n${stem}\n\n总分：${maxScore}\n\n参考答案：\n${referenceAnswer || '暂无参考答案'}\n\n考生答案：\n${answer}\n\n请按评分点给出部分得分。` },
    ]);
    const parsed = JSON.parse(content) as { score?: unknown; summary?: unknown; confidence?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items.map((item) => {
      const gradingItem = item as { criterion?: unknown; score?: unknown; maxScore?: unknown; reason?: unknown };
      const itemMaxScore = Math.max(Number(gradingItem.maxScore) || 0, 0);
      return { criterion: String(gradingItem.criterion || '评分点'), score: clampScore(gradingItem.score, itemMaxScore), maxScore: itemMaxScore, reason: String(gradingItem.reason || '') };
    }) : [];
    response.json({ score: clampScore(parsed.score, maxScore), maxScore, summary: String(parsed.summary || ''), confidence: ['high', 'medium', 'low'].includes(String(parsed.confidence)) ? parsed.confidence : 'medium', items });
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : 'AI 评分失败，请稍后重试' });
  }
});
app.get('/api/exams', (_request, response) => response.json(queryAll(`SELECT question_sets.*, COUNT(questions.id) AS actual_question_count FROM question_sets LEFT JOIN questions ON questions.exam_id = question_sets.id WHERE COALESCE(question_sets.origin, 'past') != 'generated' GROUP BY question_sets.id ORDER BY CASE question_sets.type WHEN 'choice' THEN 0 ELSE 1 END, question_sets.year DESC, question_sets.session DESC, question_sets.batch ASC, question_sets.location ASC`).map(mapExam)));
app.get('/api/modules', (request, response) => {
  const questionType = request.query.type === 'case' ? 'case' : 'single-choice';
  response.json(queryAll(`SELECT module AS name, COUNT(*) AS question_count FROM questions WHERE type = ? AND COALESCE(origin, 'past') != 'generated' GROUP BY module ORDER BY CASE module WHEN '综合题库' THEN 1 ELSE 0 END, module ASC`, [questionType]).map((row) => ({ name: row.name, questionCount: row.question_count })));
});
app.get('/api/exams/:examId/questions', (request, response) => response.json(queryAll(`SELECT * FROM questions WHERE exam_id = ? ORDER BY number ASC`, [request.params.examId]).map((row) => mapQuestion(row, request.query.mode !== 'mock'))));
app.get('/api/practice-questions', (request, response) => {
  const module = typeof request.query.module === 'string' ? request.query.module : '';
  const questionType = request.query.type === 'case' ? 'case' : 'single-choice';
  const count = Math.min(Math.max(Number(request.query.count) || 20, 1), 100);
  const conditions = [`questions.type = ?`, `COALESCE(questions.origin, 'past') != 'generated'`];
  const params: unknown[] = [questionType];
  if (module && module !== 'all') {
    conditions.push('questions.module = ?');
    params.push(module);
  }
  const limit = request.query.source === 'random' ? ` LIMIT ${count}` : '';
  const rows = queryAll(`SELECT questions.* FROM questions WHERE ${conditions.join(' AND ')} ORDER BY ${request.query.source === 'random' ? 'RANDOM()' : 'module ASC, year DESC, exam_id ASC, number ASC'}${limit}`, params);
  response.json(rows.map((row) => mapQuestion(row, request.query.mode !== 'mock')));
});
app.get('/api/attempts', (request, response) => {
  const userId = getQueryUserId(request);
  if (!userId) return response.status(400).json({ message: '缺少用户 ID' });
  if (!hasUser(userId)) return response.status(404).json({ message: '用户不存在，请重新登录' });
  response.json(queryAll(`SELECT attempts.*, question_sets.title AS exam_title FROM attempts JOIN question_sets ON question_sets.id = attempts.exam_id WHERE attempts.user_id = ? ORDER BY submitted_at DESC LIMIT 30`, [userId]).map((row) => ({ id: row.id, userId: row.user_id, examId: row.exam_id, examTitle: row.source_title || row.exam_title, submittedAt: row.submitted_at, score: row.score, total: row.total, correct: row.correct, wrong: row.wrong, unanswered: row.unanswered })));
});
app.get('/api/wrong-questions', (request, response) => {
  const userId = getQueryUserId(request);
  if (!userId) return response.status(400).json({ message: '缺少用户 ID' });
  if (!hasUser(userId)) return response.status(404).json({ message: '用户不存在，请重新登录' });
  response.json(queryAll(`SELECT questions.*, question_sets.title AS exam_title, MAX(attempts.submitted_at) AS last_attempt_at FROM attempt_answers JOIN questions ON questions.id = attempt_answers.question_id JOIN attempts ON attempts.id = attempt_answers.attempt_id JOIN question_sets ON question_sets.id = questions.exam_id WHERE attempts.user_id = ? AND attempt_answers.is_correct = 0 AND attempt_answers.selected_answer IS NOT NULL AND questions.type = 'single-choice' GROUP BY questions.id ORDER BY last_attempt_at DESC`, [userId]).map((row) => ({ questionId: row.id, examTitle: row.exam_title, number: row.number, stem: cleanExamText(row.stem), options: JSON.parse(String(row.options_json)), correctAnswer: row.correct_answer, explanation: cleanQuestionExplanation(row.id, row.explanation), lastAttemptAt: row.last_attempt_at })));
});
app.post('/api/attempts', (request, response) => {
  const { userId = '', examId, questionIds = [], title = '', answers = {}, marked = [], startedAt, mode = 'mock' } = request.body as { userId?: string; examId?: string; questionIds?: string[]; title?: string; answers?: Record<string, string>; marked?: string[]; startedAt?: number; mode?: string };
  if (!userId || !hasUser(userId)) return response.status(400).json({ message: '缺少有效的用户 ID' });
  if ((!examId && questionIds.length === 0) || !startedAt) return response.status(400).json({ message: '缺少题目或开始时间' });
  const exam = examId ? queryOne(`SELECT * FROM question_sets WHERE id = ? AND type = 'choice' AND COALESCE(origin, 'past') != 'generated'`, [examId]) : null;
  if (examId && !exam) return response.status(404).json({ message: '试卷不存在或暂不支持自动评分' });
  let questions = exam
    ? queryAll(`SELECT * FROM questions WHERE exam_id = ? ORDER BY number ASC`, [examId])
    : queryAll(`SELECT * FROM questions WHERE id IN (${questionIds.map(() => '?').join(',')})`, questionIds);
  if (!exam && questionIds.length > 0) {
    const order = new Map(questionIds.map((id, index) => [id, index]));
    questions = questions.sort((left, right) => Number(order.get(String(left.id))) - Number(order.get(String(right.id))));
  }
  if (questions.length === 0) return response.status(400).json({ message: '没有找到可评分的题目' });
  const correct = questions.filter((question) => answers[String(question.id)] && answers[String(question.id)] === question.correct_answer).length;
  const answered = questions.filter((question) => Boolean(answers[String(question.id)])).length;
  const wrong = answered - correct;
  const submittedAt = new Date();
  const durationSeconds = Math.max(0, Math.round((submittedAt.getTime() - Number(startedAt)) / 1000));
  const attemptId = createId();
  const attemptExamId = exam ? String(exam.id) : `generated-${attemptId}`;
  const attemptTitle = exam ? String(exam.title) : title || '随机题练习';
  run('BEGIN');
  if (!exam) run(`INSERT INTO question_sets (id, title, type, origin, year, session, duration_minutes, question_count, source) VALUES (?, ?, 'choice', 'generated', 'generated', '', 0, ?, 'generated')`, [attemptExamId, attemptTitle, questions.length]);
  run(`INSERT INTO attempts (id, exam_id, user_id, source_title, mode, started_at, submitted_at, duration_seconds, score, total, correct, wrong, unanswered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [attemptId, attemptExamId, userId, attemptTitle, mode, new Date(Number(startedAt)).toISOString(), submittedAt.toISOString(), durationSeconds, correct, questions.length, correct, wrong, questions.length - answered]);
  for (const question of questions) run(`INSERT INTO attempt_answers (attempt_id, question_id, selected_answer, is_correct, marked_for_review) VALUES (?, ?, ?, ?, ?)`, [attemptId, question.id, answers[String(question.id)] || null, answers[String(question.id)] === question.correct_answer ? 1 : 0, marked.includes(question.id) ? 1 : 0]);
  run('COMMIT');
  persistDatabase();
  response.json({ id: attemptId, examTitle: attemptTitle, score: correct, total: questions.length, correct, wrong, unanswered: questions.length - answered, durationSeconds, answers: questions.map((question, index) => ({ questionId: question.id, number: exam ? question.number : index + 1, stem: cleanExamText(question.stem), options: JSON.parse(String(question.options_json)), selectedAnswer: answers[String(question.id)] || null, correctAnswer: question.correct_answer, explanation: cleanQuestionExplanation(question.id, question.explanation), isCorrect: answers[String(question.id)] === question.correct_answer })) });
});

app.listen(port, () => console.log(`SoftExam Practice API listening on http://localhost:${port}`));
