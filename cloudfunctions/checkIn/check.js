/**
 * 打卡记录的服务端校验与规整（纯函数，可在 Node 侧单测）。
 */

const DAY = 86400000;

function isSameDay(a, b) { return a === b; }

/** 只接受 YYYY-MM-DD 且不是未来（允许 +1 天容错时区） */
function checkDate(dateStr, nowMs) {
  const now = nowMs || Date.now();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return '打卡日期格式应为 YYYY-MM-DD';
  const p = String(dateStr).split('-').map(Number);
  const t = Date.UTC(p[0], p[1] - 1, p[2]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) {
    return '打卡日期不存在';
  }
  if (t > now + DAY) return '不能给未来打卡';
  if (t < now - 730 * DAY) return '打卡日期过早，请核对';
  return null;
}

function clampText(v, n) {
  const s = String(v === undefined || v === null ? '' : v);
  return s.length > n ? s.slice(0, n) : s;
}

/** 去重键：同任务 + 同日 + 同科目 视为同一条 */
function dedupeKey(rec) {
  return [rec.nodeId, rec.date, clampText(rec.subject, 40)].join('|');
}

/** 规整成可入库的行；顺带做边界收口，避免脏数据进表 */
function sanitize(rec, opts) {
  const o = opts || {};
  const minutes = Number(rec.focusMinutes) || 0;
  return {
    nodeId: clampText(rec.nodeId, 64),
    date: String(rec.date),
    subject: clampText(rec.subject, 40),
    stage: clampText(rec.stage, 40),
    // review 时不保留原文，risky 由调用方直接拒写
    note: o.suggest === 'review' ? '' : clampText(rec.note, 200),
    focusMinutes: Math.max(0, Math.min(600, Math.round(minutes))),
    tags: Array.isArray(rec.tags) ? rec.tags.slice(0, 6).map(function (x) { return clampText(x, 20); }) : [],
    makeup: !!rec.makeup,
    updatedAt: o.now || Date.now()
  };
}

/** 专注段是否值得入账：必须是专注且至少 1 分钟 */
function worthLogging(rec) {
  return Number(rec.focusMinutes) >= 1;
}

module.exports = { checkDate, sanitize, dedupeKey, clampText, worthLogging, isSameDay, DAY };
