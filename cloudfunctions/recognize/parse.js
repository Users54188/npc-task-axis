/**
 * 把模型/OCR 返回的原始文本规整成 taskNodes 记录，并做服务端级校验。
 * 纯函数，不依赖 wx-server-sdk，因此可在 Node 侧直接跑单测。
 */

const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const DATE_FIELDS = ['regStart', 'regEnd', 'admitStart', 'admitEnd', 'examDate', 'scoreStart', 'scoreEnd'];
const TEXT_FIELDS = ['name', 'shortName', 'type', 'domain', 'site', 'place', 'fee', 'verify'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/** 接受 2026-12-14 / 2026/12/14 / 2026.12.14，统一成 ISO；无法识别则返回 null */
function normDate(v) {
  if (!v) return null;
  const m = DATE_RE.exec(String(v).trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return m[1] + '-' + pad(mo) + '-' + pad(da);
}

/** 剥掉 ```json 代码围栏与前后说明文字，只留第一个 JSON 对象 */
function extractJson(text) {
  const s = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function coerce(raw) {
  const node = {};
  TEXT_FIELDS.forEach(function (f) {
    if (raw[f] !== undefined && raw[f] !== null) node[f] = String(raw[f]).slice(0, 200);
  });
  // type 是 taskNodes 的必填枚举，缺失或非法都归到 certificate
  node.type = raw.type === 'contest' ? 'contest' : 'certificate';
  DATE_FIELDS.forEach(function (f) {
    const v = normDate(raw[f]);
    if (v) node[f] = v;
  });
  node.registered = !!raw.registered;
  node.plan = Array.isArray(raw.plan) ? raw.plan.slice(0, 12).map(function (p, i) {
    return {
      idx: i + 1,
      name: String(p.name || ('阶段' + (i + 1))).slice(0, 40),
      focus: String(p.focus || '').slice(0, 120),
      weeks: Math.max(1, Math.min(26, Number(p.weeks) || 2)),
      subjects: Array.isArray(p.subjects) ? p.subjects.slice(0, 6).map(String) : [],
      start: normDate(p.start) || '',
      end: normDate(p.end) || ''
    };
  }) : [];
  return node;
}

/** 与 cloudfunctions/taskNode、小程序侧 tests 保持同一套单调不变量。纯检查，不改入参。 */
function validate(node) {
  if (!node.name || !node.name.trim()) return '缺少任务名称';
  if (!node.examDate) return '缺少考试日期';
  if (node.type !== 'certificate' && node.type !== 'contest') return '类型只能是证书或赛事';
  if (node.regEnd && node.regEnd > node.examDate) return '报名截止晚于考试日期';
  if (node.admitEnd && node.admitEnd > node.examDate) return '准考证截止晚于考试日期';
  if (node.scoreStart && node.scoreStart < node.examDate) return '查分开始早于考试日期';
  return null;
}

/** 入口：原始文本 → { ok, node, error } */
function parse(text) {
  const raw = extractJson(text);
  if (!raw) return { ok: false, error: '返回内容里没有找到合法 JSON' };
  const node = coerce(raw);
  const err = validate(node);
  if (err) return { ok: false, error: err, node: node };
  return { ok: true, node: node };
}

module.exports = { parse, coerce, validate, normDate, extractJson, DATE_FIELDS };
