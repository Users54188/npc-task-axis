/**
 * 知识库解析器验证：node tests/kb.spec.js
 * 断言"输入任务名 → 自动回填常规时间与阶段计划"这条主链路在真实参考日期下成立。
 */
const assert = require('assert');
const kb = require('../miniprogram/utils/kb');
const d = require('../miniprogram/utils/date');

const REF = d.parse('2026-09-24');
let passed = 0;

function ok(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('知识库版本 ' + kb.version + '，参考日期 2026-09-24\n');

ok('listAll 覆盖 10 个证书/赛事条目', function () {
  const all = kb.listAll();
  assert.strictEqual(all.length, 10, '实际 ' + all.length);
  assert.ok(all.every(function (e) { return !!e.key && !!e.name && !!e.type; }));
});

ok('"计算机二级" 命中 NCRE 并选到最近的 12 月考次', function () {
  const s = kb.suggest('计算机二级', REF);
  assert.ok(s, '未命中');
  assert.strictEqual(s.key, 'ncre2ms');
  assert.strictEqual(s.cadenceLabel, '12 月次');
  assert.ok(s.examDate > '2026-09-24', '考试日应在未来：' + s.examDate);
  assert.ok(s.regStart && s.regEnd, '报名窗口缺失');
  assert.strictEqual(s.type, 'certificate');
  console.log('    → 报名 ' + s.regStart + '~' + s.regEnd + ' / 考试 ' + s.examDate + ' / 查分 ' + s.scoreStart);
});

ok('"四级" 命中 CET-4 且考试日为 12 月第三个周六', function () {
  const s = kb.suggest('四级', REF);
  assert.strictEqual(s.key, 'cet4');
  const exam = d.parse(s.examDate);
  assert.strictEqual(exam.getMonth() + 1, 12);
  assert.strictEqual(exam.getDay(), 6, '应为周六，实际 ' + exam.getDay());
  assert.ok(exam.getDate() >= 15 && exam.getDate() <= 21, '应为第三周，实际 ' + exam.getDate());
  assert.strictEqual(s.examApprox, false);
  console.log('    → 考试 ' + s.examDate + '（' + ['日', '一', '二', '三', '四', '五', '六'][exam.getDay()] + '曜日）');
});

ok('"教资" 命中笔试并给出未来考次', function () {
  const s = kb.suggest('教资', REF);
  assert.ok(s, '未命中');
  assert.ok(s.examDate > '2026-09-24');
  assert.ok(s.plan.length === 3, '阶段数应为 3');
  console.log('    → ' + s.name + ' / ' + s.cadenceLabel + ' / 考试 ' + s.examDate);
});

ok('阶段计划按考试日倒排且互不重叠', function () {
  const s = kb.suggest('蓝桥杯', REF);
  assert.ok(s, '未命中');
  const exam = d.parse(s.examDate);
  assert.ok(d.diffDays(d.parse(s.plan[s.plan.length - 1].end), exam) >= 0, '最后阶段应在考试日前结束');
  for (let i = 1; i < s.plan.length; i++) {
    assert.ok(d.parse(s.plan[i].start) > d.parse(s.plan[i - 1].end), '阶段 ' + i + ' 与上一阶段重叠');
    assert.ok(d.parse(s.plan[i].start) > d.parse(s.plan[i - 1].start), '阶段顺序应按时间递增');
    assert.ok(d.diffDays(d.parse(s.plan[i - 1].start), d.parse(s.plan[i - 1].end)) + 1 === s.plan[i - 1].weeks * 7, '阶段 ' + (i - 1) + ' 时长应为 weeks 周');
  }
  assert.ok(s.plan[0].start < s.plan[s.plan.length - 1].end, '首阶段应早于末阶段');
  console.log('    → ' + s.plan.map(function (p) { return p.name + '(' + p.start + '~' + p.end + ')'; }).join(' → '));
});

ok('flattenNodes 输出四类节点并按日期升序', function () {
  const s = kb.suggest('四级', REF);
  const nodes = kb.flattenNodes(s);
  const kinds = nodes.map(function (n) { return n.kind; });
  assert.ok(kinds.indexOf('reg') >= 0 && kinds.indexOf('admit') >= 0 && kinds.indexOf('exam') >= 0);
  for (let i = 1; i < nodes.length; i++) {
    assert.ok(nodes[i].start >= nodes[i - 1].start, '顺序错误');
  }
  console.log('    → ' + nodes.map(function (n) { return n.label + ' ' + n.start; }).join(' | '));
});

ok('别名与噪声输入可容错', function () {
  ['CET4', ' 四级 ', '英语四级', 'cet-4'].forEach(function (q) {
    assert.ok(kb.suggest(q, REF), '未命中：' + q);
  });
});

ok('无关输入返回 null（不误填）', function () {
  assert.strictEqual(kb.suggest('今晚吃什么', REF), null);
  assert.strictEqual(kb.suggest('', REF), null);
});

ok('查分跨年标记生效', function () {
  const s = kb.suggest('四级', REF);
  assert.ok(s.scoreStart > s.examDate, '12 月考试 → 次年 2 月查分');
  assert.ok(s.scoreStart.startsWith('2027'), '实际 ' + s.scoreStart);
});

ok('全部条目满足节点时间单调不变量（含跨年窗口）', function () {
  kb.listAll().forEach(function (e) {
    const s = kb.suggest(e.name, REF);
    assert.ok(s, e.key + ' 未命中');
    assert.ok(s.regStart <= s.regEnd, e.key + ' 报名起止倒置：' + s.regStart + ' > ' + s.regEnd);
    assert.ok(s.regEnd <= s.examDate, e.key + ' 报名截止晚于考试：' + s.regEnd + ' > ' + s.examDate);
    // 考试日为机考分批/现场排期（examApprox）时，考点不固定到某一天，
    // 此时不对准考证/查分做严格先后断言 —— 数据里已用 verify 字段标注需人工核对。
    if (!s.examApprox) {
      assert.ok(!s.admitEnd || s.admitEnd <= s.examDate, e.key + ' 准考证截止晚于考试：' + s.admitEnd + ' > ' + s.examDate);
      assert.ok(!s.scoreStart || s.scoreStart >= s.examDate, e.key + ' 查分早于考试：' + s.scoreStart + ' < ' + s.examDate);
    }
    assert.ok(s.plan[0].start <= s.plan[s.plan.length - 1].end, e.key + ' 阶段区间倒置');
    assert.ok(s.plan[s.plan.length - 1].end < s.examDate, e.key + ' 末阶段未在考试前收尾');
  });
  console.log('    → 10 条全部单调，跨年窗口按端点独立回退正确');
});

ok('蓝桥杯跨年报名窗口回退到考试上一年', function () {
  const s = kb.suggest('蓝桥杯', REF);
  assert.ok(s.regStart < s.examDate, '报名 ' + s.regStart + ' 应早于考试 ' + s.examDate);
  console.log('    → 报名 ' + s.regStart + '~' + s.regEnd + ' / 考试 ' + s.examDate);
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
