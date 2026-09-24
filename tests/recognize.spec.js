/**
 * 报名表文字抽取结果的规整与校验：node tests/recognize.spec.js
 * 只测纯函数 parse.js，不需要 wx-server-sdk。
 */
const assert = require('assert');
const p = require('../cloudfunctions/recognize/parse');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

console.log('抽取结果校验\n');

ok('日期格式统一：斜杠、点号、单位数月日都归一到 ISO', function () {
  assert.strictEqual(p.normDate('2026-12-14'), '2026-12-14');
  assert.strictEqual(p.normDate('2026/12/4'), '2026-12-04');
  assert.strictEqual(p.normDate('2026.1.9'), '2026-01-09');
  assert.strictEqual(p.normDate(' 2026-09-24 '), '2026-09-24');
});

ok('非法与缺失日期一律返回 null，不做猜测', function () {
  ['', null, undefined, '12-14', '2026-13-01', '2026-02-30x', '下周三', '2026-00-05']
    .forEach(function (v) { assert.strictEqual(p.normDate(v), null, '应拒绝：' + v); });
});

ok('剥掉 ```json 围栏与前后说明文字', function () {
  const wrapped = '好的，这是结果：\n```json\n{"name":"四级","examDate":"2026-12-19"}\n```\n希望有帮助';
  assert.deepStrictEqual(p.extractJson(wrapped), { name: '四级', examDate: '2026-12-19' });
});

ok('模型返回非 JSON 时给出明确错误而不是崩溃', function () {
  assert.strictEqual(p.extractJson('我不知道'), null);
  assert.strictEqual(p.extractJson(''), null);
  assert.strictEqual(p.extractJson('{不是合法 json}'), null);
  const out = p.parse('抱歉，无法处理');
  assert.strictEqual(out.ok, false);
  assert.ok(/JSON/.test(out.error), out.error);
});

ok('完整输入 → 合法节点', function () {
  const out = p.parse(JSON.stringify({
    name: '全国计算机等级考试二级 MS Office',
    shortName: 'NCRE-2', type: 'certificate', domain: '计算机',
    site: 'https://ncre-bm.neea.cn', place: '本校考点', fee: '90 元',
    regStart: '2026/8/20', regEnd: '2026-09-15',
    admitStart: '2026-12-07', admitEnd: '2026-12-13',
    examDate: '2026-12-14', scoreStart: '2027-02-01',
    plan: [{ name: '公共基础', weeks: 3, subjects: ['选择题'], focus: '数据结构' }]
  }));
  assert.strictEqual(out.ok, true, out.error);
  assert.strictEqual(out.node.regStart, '2026-08-20');
  assert.strictEqual(out.node.plan[0].idx, 1);
  assert.strictEqual(out.node.registered, false);
});

ok('缺考试日期直接拒绝（不得编造节点）', function () {
  const out = p.parse('{"name":"某考试","regEnd":"2026-09-15"}');
  assert.strictEqual(out.ok, false);
  assert.ok(/考试日期/.test(out.error), out.error);
});

ok('日期单调违规被拦下', function () {
  const bad1 = p.parse('{"name":"A","examDate":"2026-09-01","regEnd":"2026-10-01"}');
  assert.strictEqual(bad1.ok, false);
  assert.ok(/报名截止晚于考试/.test(bad1.error), bad1.error);

  const bad2 = p.parse('{"name":"A","examDate":"2026-12-01","admitEnd":"2026-12-20"}');
  assert.strictEqual(bad2.ok, false);
  assert.ok(/准考证截止晚于考试/.test(bad2.error), bad2.error);

  const bad3 = p.parse('{"name":"A","examDate":"2026-12-01","scoreStart":"2026-11-01"}');
  assert.strictEqual(bad3.ok, false);
  assert.ok(/查分开始早于考试/.test(bad3.error), bad3.error);
});

ok('未知 type 归一到 certificate，长文本与超量阶段被截断', function () {
  const node = p.coerce({
    name: 'x'.repeat(400), type: '其他',
    plan: new Array(30).fill(0).map(function (_, i) { return { name: 'p' + i, weeks: 99 }; })
  });
  assert.strictEqual(node.name.length, 200);
  assert.strictEqual(node.type, 'certificate');
  assert.strictEqual(node.plan.length, 12);
  assert.strictEqual(node.plan[0].weeks, 26);
  assert.strictEqual(node.plan[11].idx, 12);
});

ok('validate 拒绝非法 type 且不修改入参（纯检查）', function () {
  const node = { name: 'A', examDate: '2026-12-01', type: '乱填' };
  assert.strictEqual(p.validate(node), '类型只能是证书或赛事');
  assert.strictEqual(node.type, '乱填', 'validate 不得就地改写数据');
  assert.strictEqual(p.validate({ name: 'A', examDate: '2026-12-01', type: 'certificate' }), null);
});

ok('缺失的可选字段不写入，避免用空串覆盖已有值', function () {
  const node = p.coerce({ name: 'A', examDate: '2026-12-01', regStart: '', fee: null });
  assert.ok(!('regStart' in node), 'regStart 不应出现');
  assert.ok(!('fee' in node), 'fee 不应出现');
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
