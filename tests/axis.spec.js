/**
 * 时间轴与游戏化规则验证：node tests/axis.spec.js
 */
const assert = require('assert');
const axis = require('../miniprogram/utils/axis');
const game = require('../miniprogram/utils/game');
const d = require('../miniprogram/utils/date');

const TODAY = '2026-09-24';
let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

const task = {
  _id: 't1', name: '计算机二级（Office）', shortName: 'NCRE', type: 'certificate',
  regStart: '2026-08-20', regEnd: '2026-09-15',
  admitStart: '2026-12-07', admitEnd: '2026-12-13',
  examDate: '2026-12-14', scoreStart: '2027-02-01', scoreEnd: '2027-02-20',
  registered: false
};

console.log('时间轴与养成规则，参考日期 ' + TODAY + '\n');

ok('四类节点全部展平且按日期升序', function () {
  const a = axis.buildAxis([task], TODAY);
  assert.strictEqual(a.length, 4);
  assert.deepStrictEqual(a.map(function (n) { return n.kind; }), ['reg', 'admit', 'exam', 'score']);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].dateText >= a[i - 1].dateText || a[i].sortKey >= a[i - 1].sortKey);
});

ok('已过去的报名窗口标为 past 且不告警', function () {
  const reg = axis.buildAxis([task], TODAY).filter(function (n) { return n.kind === 'reg'; })[0];
  assert.strictEqual(reg.state, 'past');
  assert.strictEqual(reg.hot, false);
  assert.ok(/已过 \d+ 天/.test(reg.subText), reg.subText);
});

ok('7 天内开始的节点标为 hot 并给出剩余天数', function () {
  const soon = Object.assign({}, task, { regStart: '2026-09-28', regEnd: '2026-10-10' });
  const n = axis.buildAxis([soon], TODAY).filter(function (x) { return x.kind === 'reg'; })[0];
  assert.strictEqual(n.state, 'future');
  assert.strictEqual(n.hot, true);
  assert.strictEqual(n.days, 4);
});

ok('进行中的窗口（今天落在起止之间）标为 active', function () {
  const act = Object.assign({}, task, { admitStart: '2026-09-20', admitEnd: '2026-09-30' });
  const n = axis.buildAxis([act], TODAY).filter(function (x) { return x.kind === 'admit'; })[0];
  assert.strictEqual(n.state, 'active');
  assert.strictEqual(n.hot, true);
  assert.ok(/进行中/.test(n.subText), n.subText);
});

ok('未报名不生成倒计时，报名后生成且为正数', function () {
  assert.strictEqual(axis.countdownOf(task, TODAY), null);
  const c = axis.countdownOf(Object.assign({}, task, { registered: true }), TODAY);
  assert.strictEqual(c.days, d.diffDays(d.parse(TODAY), d.parse('2026-12-14')));
  assert.strictEqual(c.overdue, false);
  assert.ok(parseInt(c.text, 10) > 0);
});

ok('考试已过后倒计时标记 overdue', function () {
  const past = Object.assign({}, task, { registered: true, examDate: '2026-09-01' });
  const c = axis.countdownOf(past, TODAY);
  assert.strictEqual(c.overdue, true);
  assert.strictEqual(c.text, '已结束');
});

ok('alertsOf 只统计未过期的临期节点', function () {
  assert.strictEqual(axis.alertsOf(axis.buildAxis([task], TODAY)), 0);
  const hot = Object.assign({}, task, { admitStart: '2026-09-25', admitEnd: '2026-09-28' });
  assert.strictEqual(axis.alertsOf(axis.buildAxis([hot], TODAY)), 1);
});

ok('缺失日期的节点被跳过而不是崩溃', function () {
  const bare = { _id: 't2', name: '裸任务', type: 'certificate', examDate: '2026-12-01' };
  const a = axis.buildAxis([bare], TODAY);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].kind, 'exam');
  assert.strictEqual(axis.buildAxis([], TODAY).length, 0);
});

ok('连续打卡：今天已打卡则从今天起算', function () {
  const cs = [
    { date: '2026-09-24', nodeId: 't1' }, { date: '2026-09-23', nodeId: 't1' },
    { date: '2026-09-22', nodeId: 't1' }, { date: '2026-09-20', nodeId: 't1' }
  ];
  assert.strictEqual(game.streakOf(cs, TODAY), 3);
  assert.strictEqual(game.longestStreakOf(cs), 3);
});

ok('连续打卡：今天未打卡则从昨天起算', function () {
  const cs = [{ date: '2026-09-23', nodeId: 't1' }, { date: '2026-09-22', nodeId: 't1' }];
  assert.strictEqual(game.streakOf(cs, TODAY), 2);
  assert.strictEqual(game.streakOf([], TODAY), 0);
});

ok('最长连击能跨过今天的断档', function () {
  const cs = [];
  for (let i = 1; i <= 10; i++) cs.push({ date: '2026-08-' + (i + 10), nodeId: 't1' });
  assert.strictEqual(game.longestStreakOf(cs), 10);
  assert.strictEqual(game.streakOf(cs, TODAY), 0);
});

ok('summarize 的经验、等级、徽章可复算', function () {
  const cs = [
    { date: '2026-09-24', nodeId: 't1', focusMinutes: 25 },
    { date: '2026-09-23', nodeId: 't1', focusMinutes: 25 }
  ];
  const s = game.summarize([Object.assign({}, task, { registered: true })], cs, TODAY);
  assert.strictEqual(s.checkIns, 2);
  assert.strictEqual(s.focusCount, 2);
  assert.strictEqual(s.focusMinutes, 50);
  assert.strictEqual(s.streak, 2);
  assert.strictEqual(s.exp, 2 * game.EXP.checkIn + 2 * game.EXP.focus + 1 * game.EXP.registered);
  assert.ok(s.level.lv >= 1);
  assert.ok(s.level.percent >= 2 && s.level.percent <= 100);
  // 2 次打卡 / 连击 2 天 / 专注 2 段 / 已报名 1 个 → 只有「开箱人」达标
  assert.deepStrictEqual(s.badges.filter(function (b) { return b.earned; }).map(function (b) { return b.key; }), ['first']);
});

ok('查分日已过的任务计入 tasksWithScore（回归：日期比较不得受 today 优先级影响）', function () {
  const done = Object.assign({}, task, { scoreStart: '2026-09-01', scoreEnd: '2026-09-10' });
  const future = Object.assign({}, task, { _id: 't9', scoreStart: '2027-02-01' });
  const none = { _id: 't8', name: '无查分日', type: 'certificate' };
  const s = game.summarize([done, future, none], [], TODAY);
  assert.strictEqual(s.tasksWithScore, 1, '实际 ' + s.tasksWithScore);
  assert.strictEqual(s.exp, game.EXP.taskDone);
});

ok('等级曲线单调递增且章节与等级对齐', function () {
  let prev = -1;
  game.LEVELS.forEach(function (l) {
    assert.ok(l.need > prev, 'need 必须递增：' + l.lv);
    prev = l.need;
  });
  assert.strictEqual(game.levelOf(0).lv, 1);
  assert.strictEqual(game.levelOf(64).lv, 1);
  assert.strictEqual(game.levelOf(65).lv, 2);
  assert.strictEqual(game.levelOf(99999).lv, game.LEVELS[game.LEVELS.length - 1].lv);
  assert.strictEqual(game.levelOf(65).chapter, game.CHAPTERS[1]);
});

ok('空数据不崩（首启状态）', function () {
  const s = game.summarize([], [], TODAY);
  assert.strictEqual(s.exp, 0);
  assert.strictEqual(s.streak, 0);
  assert.strictEqual(s.level.lv, 1);
  assert.strictEqual(axis.buildAxis([], TODAY).length, 0);
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
