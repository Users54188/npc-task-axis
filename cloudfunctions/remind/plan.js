/**
 * 提醒计划计算：纯函数，可在 Node 侧单测。
 * 输入任务表 + 今天，输出今天应该发出的提醒作业。
 *
 * 规则要点：
 *  - 报名截止提醒：已报名的任务不再提醒（没意义了）
 *  - 准考证 / 考试 / 查分提醒：只有已报名的任务才提醒
 *  - 每种提醒只在固定的提前量档位触发，避免每天重复轰炸
 */
const KINDS = [
  { kind: 'reg', label: '报名截止', field: 'regEnd', needRegistered: false, offsets: [3, 1, 0] },
  { kind: 'admit', label: '准考证打印', field: 'admitStart', needRegistered: true, offsets: [1, 0] },
  { kind: 'exam', label: '考试', field: 'examDate', needRegistered: true, offsets: [7, 3, 1] },
  { kind: 'score', label: '成绩公布', field: 'scoreStart', needRegistered: true, offsets: [0] }
];

function parse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const utc = Date.UTC(y, mo - 1, da);
  // Date.UTC 会把 2 月 30 日滚进 3 月，必须回读校验真实日历
  const back = new Date(utc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) return null;
  return utc;
}

function daysBetween(fromUTC, toUTC) {
  return Math.round((toUTC - fromUTC) / 86400000);
}

/**
 * @param {Array} tasks  云端 taskNodes 全量（含 _openid）
 * @param {string} today YYYY-MM-DD
 * @returns {Array} 作业：{ openid, nodeId, kind, label, date, daysLeft, urgent }
 */
function dueJobs(tasks, today) {
  const base = parse(today);
  if (base === null) return [];
  const jobs = [];

  (tasks || []).forEach(function (t) {
    if (!t || !t._openid) return;
    KINDS.forEach(function (k) {
      const target = parse(t[k.field]);
      if (target === null) return;
      const daysLeft = daysBetween(base, target);
      if (k.needRegistered !== !!t.registered) return;
      if (k.offsets.indexOf(daysLeft) < 0) return;

      jobs.push({
        openid: t._openid,
        nodeId: t._id,
        taskName: t.name || t.shortName || '任务',
        kind: k.kind,
        label: k.label,
        date: t[k.field],
        daysLeft: daysLeft,
        urgent: daysLeft <= 1
      });
    });
  });

  return jobs.sort(function (a, b) {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return String(a.taskName) < String(b.taskName) ? -1 : 1;
  });
}

/** 订阅消息 data 字段值：thing/character_string 类限 20 字 */
function clamp(v, n) {
  const s = String(v === undefined || v === null ? '' : v);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * 组装 subscribeMessage.send 的 data。
 * fields 是「本函数入参语义 → 该模板实际字段名」的映射，
 * 例如 { thing1: 'thing5', date2: 'date9', thing3: 'thing7', thing4: 'thing8' }。
 * 缺映射时返回 null，由调用方跳过发送而不是发一条注定失败的请求。
 */
function buildData(job, fields) {
  const f = fields;
  if (!f || !f.thing1 || !f.date2 || !f.thing3) return null;
  const when = job.daysLeft === 0 ? '就是今天' : '还有 ' + job.daysLeft + ' 天';
  const data = {};
  data[f.thing1] = { value: clamp(job.taskName, 20) };
  data[f.date2] = { value: job.date };
  data[f.thing3] = { value: clamp(job.label + ' · ' + when, 20) };
  if (f.thing4) data[f.thing4] = { value: clamp(job.urgent ? '请尽快处理' : '别忘了', 20) };
  return data;
}

module.exports = { KINDS, dueJobs, buildData, clamp, parse, daysBetween };
