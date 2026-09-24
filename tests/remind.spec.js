/**
 * 提醒计划与消息体组装验证：node tests/remind.spec.js
 */
const assert = require('assert');
const plan = require('../cloudfunctions/remind/plan');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

const TODAY = '2026-09-24';
function t(over) {
  return Object.assign({
    _id: 'n1', _openid: 'oX', name: '大学英语四级',
    regStart: '2026-09-01', regEnd: '2026-09-27',
    admitStart: '2026-12-09', admitEnd: '2026-12-13',
    examDate: '2026-12-19', scoreStart: '2027-02-16',
    registered: false
  }, over || {});
}
function kinds(jobs) { return jobs.map(function (j) { return j.kind; }).sort(); }

console.log('提醒计划\n');

ok('报名截止：提前 3 / 1 / 0 天各触发一次，其余日子静默', function () {
  assert.deepStrictEqual(kinds(plan.dueJobs([t({ regEnd: '2026-09-27' })], TODAY)), ['reg']);
  assert.deepStrictEqual(kinds(plan.dueJobs([t({ regEnd: '2026-09-25' })], TODAY)), ['reg']);
  assert.deepStrictEqual(kinds(plan.dueJobs([t({ regEnd: '2026-09-24' })], TODAY)), ['reg']);
  assert.deepStrictEqual(kinds(plan.dueJobs([t({ regEnd: '2026-09-26' })], TODAY)), []);
  assert.deepStrictEqual(kinds(plan.dueJobs([t({ regEnd: '2026-10-20' })], TODAY)), []);
});

ok('已报名的任务不再提醒报名截止（没意义）', function () {
  assert.deepStrictEqual(kinds(plan.dueJobs([t({ regEnd: '2026-09-25', registered: true })], TODAY)), []);
});

ok('准考证 / 考试 / 查分：未报名一律不打扰', function () {
  const notReg = t({ registered: false, regEnd: '2026-12-01', admitStart: '2026-09-25', examDate: '2026-09-25', scoreStart: '2026-09-24' });
  assert.deepStrictEqual(kinds(plan.dueJobs([notReg], TODAY)), [], '未报名不应产生任何提醒');

  const reg = Object.assign({}, notReg, { registered: true });
  assert.deepStrictEqual(kinds(plan.dueJobs([reg], TODAY)), ['admit', 'exam', 'score']);
});

ok('考试提醒只在提前 7 / 3 / 1 天，查分只当天', function () {
  const far = { registered: true, regEnd: '2026-12-01', admitStart: '2027-01-01', scoreStart: '2027-02-01' };
  // TODAY = 2026-09-24 → 提前 7/3/1 天分别是 10-01 / 09-27 / 09-25
  ['2026-10-01', '2026-09-27', '2026-09-25'].forEach(function (d) {
    assert.deepStrictEqual(kinds(plan.dueJobs([t(Object.assign({ examDate: d }, far))], TODAY)), ['exam'], d + ' 应触发');
  });
  // 14 / 4 / 2 天都不在档位上
  ['2026-10-08', '2026-09-28', '2026-09-26'].forEach(function (d) {
    assert.deepStrictEqual(kinds(plan.dueJobs([t(Object.assign({ examDate: d }, far))], TODAY)), [], d + ' 不该触发');
  });
});

ok('已过期的节点绝不补发', function () {
  const past = t({ registered: true, regEnd: '2026-01-01', admitStart: '2026-01-02', examDate: '2026-01-03', scoreStart: '2026-01-04' });
  assert.deepStrictEqual(plan.dueJobs([past], TODAY), []);
});

ok('缺 openid / 缺日期 / 非法日期的任务被跳过', function () {
  assert.deepStrictEqual(plan.dueJobs([t({ _openid: '', regEnd: '2026-09-25' })], TODAY), []);
  assert.deepStrictEqual(plan.dueJobs([t({ regEnd: '', examDate: '' })], TODAY), []);
  assert.deepStrictEqual(plan.dueJobs([t({ regEnd: '下周三' })], TODAY), []);
  assert.deepStrictEqual(plan.dueJobs([t({ regEnd: '2026-9-25' })], TODAY), [], '月日必须补零');
  assert.deepStrictEqual(plan.dueJobs(null, TODAY), []);
  assert.deepStrictEqual(plan.dueJobs([t()], 'bad-input'), []);
});

ok('多任务按剩余天数升序、同日按名称稳定排序', function () {
  const jobs = plan.dueJobs([
    t({ _id: 'a', name: '计算机二级', regEnd: '2026-09-27' }),
    t({ _id: 'b', name: '普通话测试', regEnd: '2026-09-25' }),
    t({ _id: 'c', name: '大广赛', regEnd: '2026-09-25' })
  ], TODAY);
  assert.deepStrictEqual(jobs.map(function (j) { return j.daysLeft; }), [1, 1, 3]);
  assert.deepStrictEqual(jobs.slice(0, 2).map(function (j) { return j.name || j.taskName; }), ['大广赛', '普通话测试']);
});

ok('daysLeft 与 urgent 标注正确', function () {
  const jobs = plan.dueJobs([t({ regEnd: '2026-09-27' })], TODAY);
  assert.strictEqual(jobs[0].daysLeft, 3);
  assert.strictEqual(jobs[0].urgent, false);
  assert.strictEqual(jobs[0].label, '报名截止');
  assert.strictEqual(plan.dueJobs([t({ regEnd: '2026-09-24' })], TODAY)[0].urgent, true);
});

ok('buildData：模板字段未配置时返回 null 而不是发废请求', function () {
  const job = plan.dueJobs([t({ regEnd: '2026-09-25' })], TODAY)[0];
  assert.strictEqual(plan.buildData(job, null), null);
  assert.strictEqual(plan.buildData(job, { thing1: 'thing1' }), null, '缺 date2 也不能发');
});

ok('buildData：字段名按模板映射，文案区分当天与倒计时', function () {
  const fields = { thing1: 'thing5', date2: 'date9', thing3: 'thing7', thing4: 'thing8' };
  const j3 = plan.dueJobs([t({ regEnd: '2026-09-27' })], TODAY)[0];
  const data = plan.buildData(j3, fields);
  assert.deepStrictEqual(Object.keys(data).sort(), ['date9', 'thing5', 'thing7', 'thing8']);
  assert.strictEqual(data.thing5.value, '大学英语四级');
  assert.strictEqual(data.date9.value, '2026-09-27');
  assert.strictEqual(data.thing7.value, '报名截止 · 还有 3 天');
  assert.strictEqual(data.thing8.value, '别忘了');

  const j0 = plan.dueJobs([t({ regEnd: '2026-09-24' })], TODAY)[0];
  assert.strictEqual(plan.buildData(j0, fields).thing7.value, '报名截止 · 就是今天');
  assert.strictEqual(plan.buildData(j0, fields).thing8.value, '请尽快处理');
});

ok('clamp：thing 类字段严格不超过 20 字并带省略号', function () {
  assert.strictEqual(plan.clamp('短', 20), '短');
  assert.strictEqual(plan.clamp('x'.repeat(20), 20).length, 20);
  const long = plan.clamp('y'.repeat(40), 20);
  assert.strictEqual(long.length, 20);
  assert.ok(long.endsWith('…'), long);
  assert.strictEqual(plan.clamp(undefined, 20), '');
  assert.strictEqual(plan.clamp(12345, 20), '12345');
});

ok('跨月与闰日边界不产生偏移', function () {
  assert.strictEqual(plan.daysBetween(plan.parse('2026-02-28'), plan.parse('2026-03-01')), 1);
  assert.strictEqual(plan.daysBetween(plan.parse('2028-02-28'), plan.parse('2028-03-01')), 2, '2028 是闰年');
  assert.strictEqual(plan.daysBetween(plan.parse('2026-12-31'), plan.parse('2027-01-01')), 1);
  assert.strictEqual(plan.parse('2026-02-30'), null, '非法日期不接受');
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
