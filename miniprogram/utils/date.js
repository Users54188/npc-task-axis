function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function toDate(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0); }

function fmt(date) {
  if (!date) return '';
  if (typeof date === 'string') {
    // 纯日期串原样返回，避免时区位移；带时间的 ISO 串才需要解析
    if (date.indexOf('T') < 0) return date;
    date = new Date(date);
  }
  if (typeof date === 'number') date = new Date(date);
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function fmtCN(date) {
  if (!date) return '';
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function parse(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  const p = String(str).split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return null;
  return toDate(p[0], p[1], p[2]);
}

function startOfDay(date) { return toDate(date.getFullYear(), date.getMonth() + 1, date.getDate()); }

function diffDays(a, b) {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86400000);
}

function addDays(date, n) { return new Date(date.getTime() + n * 86400000); }

/** 该年 month 月第 nth 个 weekday（0=周日…6=周六） */
function nthWeekday(year, month, weekday, nth) {
  const first = toDate(year, month, 1);
  let delta = (weekday - first.getDay() + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  return toDate(year, month, Math.min(day, 28));
}

/** 生成某年某月的日历矩阵（6 行 7 列，含前后月补位） */
function monthMatrix(year, month) {
  const first = toDate(year, month, 1);
  const lead = first.getDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    cells.push(addDays(first, i - lead));
  }
  return cells;
}

function monthLabel(year, month) { return year + ' 年 ' + month + ' 月'; }

module.exports = {
  pad2, toDate, fmt, fmtCN, parse, startOfDay, diffDays, addDays,
  nthWeekday, monthMatrix, monthLabel
};
