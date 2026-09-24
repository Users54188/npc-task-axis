/**
 * 任务节点的服务端校验（纯函数，可在 Node 侧单测）。
 * 与小程序侧 utils/kb.js、cloudfunctions/recognize/parse.js 共用同一套单调不变量，
 * 三处必须一致，否则客户端能存进去、服务端却拒收（或反过来）。
 */

const FIELDS = ['name', 'shortName', 'type', 'domain', 'site', 'place', 'fee',
  'regStart', 'regEnd', 'admitStart', 'admitEnd', 'examDate', 'scoreStart', 'scoreEnd',
  'registered', 'plan', 'verify', 'examApprox'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = ['regStart', 'regEnd', 'admitStart', 'admitEnd', 'examDate', 'scoreStart', 'scoreEnd'];

/** 只保留白名单字段，避免客户端塞入 _openid / _id 之类的保留字段 */
function pick(body) {
  const src = body || {};
  return FIELDS.reduce(function (o, k) {
    if (src[k] !== undefined) o[k] = src[k];
    return o;
  }, {});
}

function isDate(v) {
  if (!v) return true;
  if (!DATE_RE.test(String(v))) return false;
  const p = String(v).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function validate(node) {
  const n = node || {};
  if (!n.name || !String(n.name).trim()) return '任务名称不能为空';
  if (String(n.name).length > 60) return '任务名称过长（上限 60 字）';
  if (!n.examDate) return '考试日期必填';
  if (n.type !== 'certificate' && n.type !== 'contest') return '类型只能是证书或赛事';

  for (let i = 0; i < DATE_FIELDS.length; i++) {
    const f = DATE_FIELDS[i];
    if (!isDate(n[f])) return f + ' 不是合法的 YYYY-MM-DD 日期';
  }

  if (n.regStart && n.regEnd && n.regStart > n.regEnd) return '报名起始晚于截止';
  if (n.admitStart && n.admitEnd && n.admitStart > n.admitEnd) return '准考证起始晚于截止';
  if (n.regEnd && n.regEnd > n.examDate) return '报名截止晚于考试日期';

  // examApprox：机考分批 / 现场排期不固定到某一天，考试日只是估算值。
  // 此时「准考证截止」或「查分日」晚于估算考试日属于正常数据，不做严格先后断言；
  // 但「报名截止不得晚于考试」这一条仍然成立（不可能考完再报名）。
  if (!n.examApprox) {
    if (n.admitEnd && n.admitEnd > n.examDate) return '准考证截止晚于考试日期';
    if (n.scoreStart && n.scoreStart < n.examDate) return '查分开始早于考试日期';
  }
  if (n.scoreStart && n.scoreEnd && n.scoreStart > n.scoreEnd) return '查分起始晚于截止';

  if (n.plan !== undefined) {
    if (!Array.isArray(n.plan)) return '备考计划必须是数组';
    if (n.plan.length > 12) return '备考计划最多 12 个阶段';
    for (let i = 0; i < n.plan.length; i++) {
      const s = n.plan[i] || {};
      if (!s.name || !String(s.name).trim()) return '第 ' + (i + 1) + ' 阶段缺少名称';
      if (s.weeks !== undefined && (Number(s.weeks) < 1 || Number(s.weeks) > 26)) {
        return '第 ' + (i + 1) + ' 阶段周数应在 1~26 之间';
      }
      if (s.start && s.end && s.start > s.end) return '第 ' + (i + 1) + ' 阶段起止倒置';
    }
  }
  return null;
}

module.exports = { validate, pick, isDate, FIELDS, DATE_FIELDS };
