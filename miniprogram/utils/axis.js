const d = require('./date');

const KINDS = [
  { key: 'reg', label: '报名', tag: 'bm', s: 'regStart', e: 'regEnd' },
  { key: 'admit', label: '准考证', tag: 'zk', s: 'admitStart', e: 'admitEnd' },
  { key: 'exam', label: '考试', tag: 'ks', s: 'examDate', e: 'examDate' },
  { key: 'score', label: '查分', tag: 'cf', s: 'scoreStart', e: 'scoreEnd' }
];

function stateOf(start, end, ref) {
  const s = d.parse(start);
  const e = d.parse(end) || s;
  if (!s) return null;
  if (e < ref) return { state: 'past', hot: false, days: d.diffDays(ref, e) };
  if (s <= ref) return { state: 'active', hot: true, days: d.diffDays(ref, e) };
  return { state: 'future', hot: d.diffDays(ref, s) <= 7, days: d.diffDays(ref, s) };
}

function dateText(start, end) {
  const s = d.parse(start);
  const e = d.parse(end);
  if (!s) return '';
  if (!e || +e === +s) return d.fmtCN(s);
  return d.fmtCN(s) + ' ~ ' + d.fmtCN(e);
}

/** 把所有任务的四类节点展平成一条按日期升序的时间轴 */
function buildAxis(tasks, today) {
  const ref = d.parse(today) || new Date();
  const items = [];
  (tasks || []).forEach(function (t) {
    KINDS.forEach(function (k) {
      const start = t[k.s];
      const end = t[k.e];
      if (!start) return;
      const st = stateOf(start, end, ref);
      if (!st) return;
      items.push({
        id: t._id + '-' + k.key,
        taskId: t._id,
        kind: k.key,
        tagClass: 'tag-' + k.tag,
        label: k.label,
        taskName: t.name,
        shortName: t.shortName,
        type: t.type,
        registered: !!t.registered,
        approx: !!t.examApprox && k.key === 'exam',
        dateText: dateText(start, end),
        state: st.state,
        hot: st.hot,
        days: st.days,
        subText: st.state === 'active' ? '进行中 · 剩 ' + st.days + ' 天'
          : st.state === 'past' ? '已过 ' + Math.abs(st.days) + ' 天'
          : '剩 ' + st.days + ' 天',
        sortKey: d.parse(start).getTime()
      });
    });
  });
  return items.sort(function (a, b) { return a.sortKey - b.sortKey; });
}

/** 已报名任务的考试倒计时 */
function countdownOf(task, today) {
  if (!task || !task.registered || !task.examDate) return null;
  const days = d.diffDays(d.parse(today) || new Date(), d.parse(task.examDate));
  if (days < 0) return { text: '已结束', days: days, overdue: true };
  return { text: String(days), days: days, overdue: false };
}

function alertsOf(axis) {
  return axis.filter(function (n) { return n.hot && n.state !== 'past'; }).length;
}

module.exports = { KINDS, buildAxis, countdownOf, alertsOf };
