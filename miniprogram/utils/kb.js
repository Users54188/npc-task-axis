const d = require('./date');
const KB = require('../data/knowledge-base.json');

/** 把 {m,wom,wd} 或 {m,d} 解析为具体年份的日期；wd=-1 表示考期不固定到星期 */
function resolveExam(spec, year) {
  if (!spec) return { date: null, approx: true };
  if (spec.d) return { date: d.toDate(year, spec.m, spec.d), approx: false };
  if (spec.wd === -1 || spec.wd === undefined || spec.wd === null) {
    return { date: d.nthWeekday(year, spec.m, 1, spec.wom || 1), approx: true };
  }
  return { date: d.nthWeekday(year, spec.m, spec.wd, spec.wom || 1), approx: false };
}

/**
 * 端点年份独立推断（窗口自身可以跨年，如报名 12 月起 → 次年 3 月止）：
 *  before（报名/准考证，先于考试）：端点月份 > 考试月 ⇒ 上一年
 *  after （查分，后于考试）        ：端点月份 < 考试月 ⇒ 下一年
 * 显式 prevYear / nextYear 标记作为人工覆盖优先于自动判定。
 */
function endpointYear(month, examYear, examMonth, dir, forced) {
  if (forced === 'prevYear') return examYear - 1;
  if (forced === 'nextYear') return examYear + 1;
  if (!examMonth) return examYear;
  if (dir === 'before') return month > examMonth ? examYear - 1 : examYear;
  return month < examMonth ? examYear + 1 : examYear;
}

function resolveWindow(win, examYear, examMonth, dir, forced) {
  if (!win || win.length < 2) return { start: null, end: null };
  const y1 = endpointYear(win[0][0], examYear, examMonth, dir, hasFlag(win, 'prevYear') ? 'prevYear' : forced);
  const y2 = endpointYear(win[1][0], examYear, examMonth, dir, hasFlag(win, 'prevYear') ? 'prevYear' : forced);
  return {
    start: d.toDate(y1, win[0][0], win[0][1]),
    end: d.toDate(y2, win[1][0], win[1][1])
  };
}

function hasFlag(win, flag) {
  return Array.isArray(win) && win.indexOf(flag) >= 0;
}

/** 把一条 cadence 解析成具体日期的四节点 */
function resolveCadence(cadence, examYear) {
  const exam = resolveExam(cadence.exam, examYear);
  const m = cadence.exam && cadence.exam.m;
  const reg = resolveWindow(cadence.reg, examYear, m, 'before', null);
  const admit = resolveWindow(cadence.admit, examYear, m, 'before', null);
  const scoreWin = cadence.score && cadence.score.window;
  const forced = cadence.score && cadence.score.nextYear ? 'nextYear' : null;
  const score = scoreWin ? resolveWindow(scoreWin, examYear, m, 'after', forced) : { start: null, end: null };
  return { examYear, examDate: exam.date, examApprox: exam.approx, regStart: reg.start, regEnd: reg.end, admitStart: admit.start, admitEnd: admit.end, scoreStart: score.start, scoreEnd: score.end };
}

/** 选出不早于 refDate 的最近一个考次（允许回看 14 天，便于刚考完还能看到查分节点） */
function pickCadence(entry, refDate) {
  const ref = d.startOfDay(refDate);
  let best = null;
  (entry.cadence || []).forEach(function (cad) {
    for (let off = 0; off <= 1; off++) {
      const year = ref.getFullYear() + off;
      const r = resolveCadence(cad, year);
      if (!r.examDate) return;
      const probe = cad.exam && cad.exam.d ? r.examDate : new Date(r.examDate.getTime() - 31 * 86400000);
      if (d.diffDays(ref, probe) >= -14) {
        const cand = { cadence: cad, resolved: r, sortKey: r.examDate.getTime() };
        if (!best || cand.sortKey < best.sortKey) best = cand;
        return;
      }
    }
  });
  return best;
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[\s（）()、,，。.\-_·]/g, '');
}

function score(entry, q) {
  const n = normalize(q);
  if (!n) return 0;
  let s = 0;
  if (normalize(entry.name) === n) s = 100;
  else if (normalize(entry.shortName) === n) s = 95;
  else if (normalize(entry.key) === n) s = 95;
  (entry.aliases || []).forEach(function (a) {
    const na = normalize(a);
    if (!na) return;
    if (na === n) s = Math.max(s, 90);
    else if (na.indexOf(n) >= 0 || n.indexOf(na) >= 0) s = Math.max(s, 60 + Math.min(20, na.length));
  });
  if (normalize(entry.name).indexOf(n) >= 0) s = Math.max(s, 50);
  if (normalize(entry.shortName).indexOf(n) >= 0) s = Math.max(s, 55);
  return s;
}

/** 输入任务名 → 命中知识库 + 解析出真实日期 + 生成阶段计划 */
function suggest(input, refDate) {
  const ref = refDate || new Date();
  let best = null;
  KB.entries.forEach(function (e) {
    const s = score(e, input);
    if (s >= 50 && (!best || s > best.matchScore)) best = { entry: e, matchScore: s };
  });
  if (!best) return null;
  const pick = pickCadence(best.entry, ref);
  if (!pick) return null;

  const plan = (best.entry.stages || []).map(function (st, i) {
    // 从考试日往前倒排：最后一个阶段紧贴考试日，各阶段首尾相接不重叠
    const tail = tailWeeks(best.entry.stages, i);
    const end = d.addDays(pick.resolved.examDate, -(tail * 7 + 1));
    const begin = d.addDays(end, -(st.weeks * 7 - 1));
    return {
      idx: i + 1,
      name: st.name,
      weeks: st.weeks,
      subjects: st.subjects || [],
      focus: st.focus || '',
      start: d.fmt(begin),
      end: d.fmt(end)
    };
  });

  return {
    key: best.entry.key,
    name: best.entry.name,
    shortName: best.entry.shortName,
    type: best.entry.type,
    domain: best.entry.domain,
    site: best.entry.site,
    place: best.entry.place,
    fee: best.entry.fee,
    prereq: best.entry.prereq || '',
    verify: best.entry.verify || '',
    cadenceLabel: pick.cadence.label,
    examApprox: pick.resolved.examApprox,
    regStart: d.fmt(pick.resolved.regStart),
    regEnd: d.fmt(pick.resolved.regEnd),
    admitStart: d.fmt(pick.resolved.admitStart),
    admitEnd: d.fmt(pick.resolved.admitEnd),
    examDate: d.fmt(pick.resolved.examDate),
    scoreStart: d.fmt(pick.resolved.scoreStart),
    scoreEnd: d.fmt(pick.resolved.scoreEnd),
    registered: false,
    plan: plan,
    matchScore: best.matchScore
  };
}

function tailWeeks(stages, idx) {
  let t = 0;
  for (let i = idx + 1; i < stages.length; i++) t += (stages[i] && stages[i].weeks) || 0;
  return t;
}

/** 时间轴四类节点展平，按日期排序并标注临期 */
function flattenNodes(task) {
  const out = [];
  const push = function (kind, label, start, end) {
    if (!start) return;
    out.push({ kind: kind, label: label, start: start, end: end || start });
  };
  push('reg', '报名', task.regStart, task.regEnd);
  push('admit', '准考证', task.admitStart, task.admitEnd);
  push('exam', '考试', task.examDate, null);
  push('score', '查分', task.scoreStart, task.scoreEnd);
  return out.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
}

function todayStr() { return d.fmt(new Date()); }

function listAll() {
  return KB.entries.map(function (e) {
    return { key: e.key, name: e.name, shortName: e.shortName, type: e.type, domain: e.domain };
  });
}

module.exports = { suggest, listAll, flattenNodes, todayStr, resolveCadence, pickCadence, normalize, version: KB.version };
