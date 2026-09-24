/**
 * 云函数服务端校验验证：node tests/cloud.spec.js
 * 重点是「客户端能生成的数据，服务端必须接受」这条跨边界一致性。
 */
const assert = require('assert');
const check = require('../cloudfunctions/taskNode/check');
const ck = require('../cloudfunctions/checkIn/check');
const kb = require('../miniprogram/utils/kb');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

const T = new Date('2026-09-24T12:00:00Z').getTime();
function node(over) {
  return Object.assign({
    name: '大学英语四级', shortName: 'CET-4', type: 'certificate',
    regStart: '2026-09-01', regEnd: '2026-09-20',
    admitStart: '2026-12-09', admitEnd: '2026-12-13',
    examDate: '2026-12-19', scoreStart: '2027-02-16', scoreEnd: '2027-02-26',
    registered: false, plan: [{ name: '阶段一', weeks: 6, focus: '词汇' }]
  }, over || {});
}

console.log('服务端校验\n');

ok('合法节点通过校验', function () {
  assert.strictEqual(check.validate(node()), null);
  assert.strictEqual(check.validate(node({ type: 'contest' })), null);
  assert.strictEqual(check.validate(node({ plan: [] })), null);
});

ok('跨边界一致性：知识库生成的 10 个条目服务端全部接受', function () {
  const ref = new Date('2026-09-24T00:00:00');
  kb.listAll().forEach(function (e) {
    const s = kb.suggest(e.name, ref);
    assert.ok(s, e.key + ' 未命中');
    const err = check.validate(s);
    assert.strictEqual(err, null, e.key + ' 被服务端拒收：' + err);
  });
});

ok('必填与枚举缺失被拒', function () {
  assert.match(check.validate(node({ name: '' })), /名称/);
  assert.match(check.validate(node({ name: '   ' })), /名称/);
  assert.match(check.validate(node({ examDate: '' })), /考试日期必填/);
  assert.match(check.validate(node({ type: '其他' })), /类型/);
  assert.strictEqual(check.validate(node()), null, '对照：完整节点应通过');
});

ok('日期格式与真实日历都被检查', function () {
  assert.match(check.validate(node({ examDate: '2026-12-19 ' })), /合法/, '尾随空格应被拒');
  assert.match(check.validate(node({ scoreStart: '2026-02-30' })), /合法/, '不存在的日子应被拒');
  assert.match(check.validate(node({ admitEnd: '2026-13-01' })), /合法/, '13 月应被拒');
  assert.strictEqual(check.validate(node({ examDate: '2028-02-29', admitEnd: '2028-02-20', scoreStart: '2028-04-01', scoreEnd: '2028-04-20' })), null, '闰日应被接受');
});

ok('examApprox：机考分批的估算考试日不做严格先后断言', function () {
  const approx = node({ examDate: '2027-04-05', admitEnd: '2027-04-10', scoreStart: '2027-05-10', scoreEnd: '2027-05-31', examApprox: true });
  assert.strictEqual(check.validate(approx), null, '准考证窗口跨过估算考试日必须能存进去');
  assert.match(check.validate(node({ examApprox: true, regEnd: '2027-05-01' })), /报名截止晚于考试/);
  assert.match(check.validate(node({ examApprox: false, admitEnd: '2026-12-31' })), /准考证截止晚于考试/);
});

ok('窗口单调性全部覆盖', function () {
  assert.match(check.validate(node({ regStart: '2026-09-25', regEnd: '2026-09-20' })), /报名起始晚于截止/);
  assert.match(check.validate(node({ regEnd: '2027-01-01' })), /报名截止晚于考试/);
  assert.match(check.validate(node({ admitStart: '2026-12-20', admitEnd: '2026-12-13' })), /准考证起始晚于截止/);
  assert.match(check.validate(node({ admitEnd: '2026-12-31' })), /准考证截止晚于考试/);
  assert.match(check.validate(node({ scoreStart: '2026-12-01' })), /查分开始早于考试/);
  assert.match(check.validate(node({ scoreEnd: '2027-01-01' })), /查分起始晚于截止/);
});

ok('备考计划的条数、名称、周数与区间都被约束', function () {
  assert.match(check.validate(node({ plan: 'x' })), /数组/);
  assert.match(check.validate(node({ plan: new Array(13).fill({ name: 'p' }) })), /最多 12/);
  assert.match(check.validate(node({ plan: [{ weeks: 2 }] })), /缺少名称/);
  assert.match(check.validate(node({ plan: [{ name: 'a', weeks: 0 }] })), /周数/);
  assert.match(check.validate(node({ plan: [{ name: 'a', weeks: 27 }] })), /周数/);
  assert.match(check.validate(node({ plan: [{ name: 'a', start: '2026-12-01', end: '2026-11-01' }] })), /倒置/);
});

ok('pick 只放行白名单字段，挡掉保留字段', function () {
  const out = check.pick({
    name: 'x', examDate: '2026-12-19', type: 'certificate',
    _openid: 'evil', _id: 'evil', createdAt: 1, updatedAt: 1, admin: true
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ['examDate', 'name', 'type']);
  assert.strictEqual('_openid' in out, false);
  assert.strictEqual('updatedAt' in out, false);
  assert.deepStrictEqual(check.pick(null), {});
});

ok('isDate 精确：不存在的日子一律 false', function () {
  ['', null, undefined].forEach(function (v) { assert.strictEqual(check.isDate(v), true, '空值由必填项负责'); });
  assert.strictEqual(check.isDate('2026-12-19'), true);
  assert.strictEqual(check.isDate('2026-02-30'), false);
  assert.strictEqual(check.isDate('2026-02-29'), false, '2026 非闰年');
  assert.strictEqual(check.isDate('2028-02-29'), true, '2028 闰年');
  assert.strictEqual(check.isDate('2026-13-01'), false);
  assert.strictEqual(check.isDate('2026-1-5'), false, '必须补零');
});

/* ---------- 打卡 ---------- */

ok('打卡日期：格式、未来、不存在、过远都被拦', function () {
  assert.strictEqual(ck.checkDate('2026-09-24', T), null);
  assert.match(ck.checkDate('2026-9-24', T), /格式/);
  assert.match(ck.checkDate('2026-02-30', T), /不存在/);
  assert.match(ck.checkDate('2026-09-26', T), /未来/);
  assert.strictEqual(ck.checkDate('2026-09-25', T), null, '跨时区容错一天');
  assert.match(ck.checkDate('2020-01-01', T), /过早/);
});

ok('sanitize 收口所有长度与数值边界', function () {
  const row = ck.sanitize({
    nodeId: 'n1', date: '2026-09-24', subject: 's'.repeat(90), stage: 'g'.repeat(90),
    note: 'x'.repeat(900), focusMinutes: 9999, tags: new Array(20).fill('t'), makeup: 1
  }, { now: T });
  assert.strictEqual(row.subject.length, 40);
  assert.strictEqual(row.stage.length, 40);
  assert.strictEqual(row.note.length, 200);
  assert.strictEqual(row.focusMinutes, 600);
  assert.strictEqual(row.tags.length, 6);
  assert.strictEqual(row.makeup, true);
  assert.strictEqual(row.updatedAt, T);
});

ok('sanitize：内容安全 review 时丢弃备注原文', function () {
  assert.strictEqual(ck.sanitize({ nodeId: 'n', date: '2026-09-24', note: '可疑内容' }, { suggest: 'review' }).note, '');
  assert.strictEqual(ck.sanitize({ nodeId: 'n', date: '2026-09-24', note: '正常内容' }, { suggest: 'pass' }).note, '正常内容');
  assert.strictEqual(ck.sanitize({ nodeId: 'n', date: '2026-09-24', focusMinutes: -5 }).focusMinutes, 0);
  assert.strictEqual(ck.sanitize({ nodeId: 'n', date: '2026-09-24', focusMinutes: 'abc' }).focusMinutes, 0);
});

ok('dedupeKey 稳定且能区分三种差异', function () {
  const base = { nodeId: 'n1', date: '2026-09-24', subject: '听力' };
  assert.strictEqual(ck.dedupeKey(base), ck.dedupeKey(Object.assign({}, base)));
  assert.notStrictEqual(ck.dedupeKey(base), ck.dedupeKey(Object.assign({}, base, { date: '2026-09-23' })));
  assert.notStrictEqual(ck.dedupeKey(base), ck.dedupeKey(Object.assign({}, base, { subject: '阅读' })));
  assert.notStrictEqual(ck.dedupeKey(base), ck.dedupeKey(Object.assign({}, base, { nodeId: 'n2' })));
});

ok('worthLogging 只放过至少 1 分钟的专注段', function () {
  assert.strictEqual(ck.worthLogging({ focusMinutes: 25 }), true);
  assert.strictEqual(ck.worthLogging({ focusMinutes: 1 }), true);
  assert.strictEqual(ck.worthLogging({ focusMinutes: 0 }), false);
  assert.strictEqual(ck.worthLogging({}), false);
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
