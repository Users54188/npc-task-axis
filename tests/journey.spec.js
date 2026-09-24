/**
 * 端到端旅程验证：node tests/journey.spec.js
 * 单模块测试全绿不代表这些件拼起来能用。这里按真实用户动线串一遍，
 * 并覆盖同步设计真正的验收条件：两台设备共享同一云端。
 */
const assert = require('assert');
const path = require('path');
const { createHarness } = require('./helpers/wx-harness');
const cloudCheck = require('../cloudfunctions/taskNode/check');
const remindPlan = require('../cloudfunctions/remind/plan');
const d = require('../miniprogram/utils/date');

const STORE_PATH = path.resolve(__dirname, '..', 'miniprogram', 'utils', 'store.js');
const REMIND_FIELDS = { thing1: 'thing5', date2: 'date9', thing3: 'thing7', thing4: 'thing8' };

let passed = 0, failed = 0, chain = Promise.resolve();
function ok(label, fn) {
  chain = chain.then(function () {
    return Promise.resolve().then(fn).then(function () {
      passed++; console.log('  ✓ ' + label);
    }, function (e) {
      failed++; console.log('  ✗ ' + label + '\n    ' + (e && e.message)); process.exitCode = 1;
    });
  });
}
function finish() {
  return chain.then(function () {
    console.log('\n' + passed + ' 通过 / ' + failed + ' 失败');
    if (failed) process.exitCode = 1;
  });
}

/** 换一台设备：新的本地存储 + 新的 store 实例，但可共享同一份「云端」 */
function device(opts) {
  delete require.cache[STORE_PATH];
  const h = createHarness(opts);
  const store = require(STORE_PATH);
  store.stopWatch();
  return { h: h, store: store };
}

const shared = { collections: {} };
let devA, taskId, taskSnapshot;

console.log('端到端旅程\n');

ok('① 冷启动是干净的空态，而不是报错', function () {
  devA = device({ offline: false, collections: shared.collections });
  assert.strictEqual(devA.store.offline(), false);
  return devA.store.listTasks().then(function (rows) {
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(devA.store.rawCheckIns().length, 0);
    assert.strictEqual(devA.store.queueSize(), 0);
  });
});

ok('② 接任务：知识库生成的节点能被服务端校验接受并入库', function () {
  const kb = require('../miniprogram/utils/kb');
  const hit = kb.suggest('计算机二级', new Date('2026-09-24T00:00:00'));
  assert.ok(hit, '知识库未命中');
  assert.strictEqual(cloudCheck.validate(hit), null, '服务端拒收了客户端生成的数据');

  return devA.store.saveTask(hit).then(function (row) {
    taskId = row._id;
    taskSnapshot = row;
    assert.ok(row._cloudId, '应拿到云端主键');
    assert.strictEqual(shared.collections.taskNodes.length, 1);
    assert.strictEqual(shared.collections.taskNodes[0].name, hit.name);
  });
});

ok('③ 时间轴：四个节点齐备且按日期升序', function () {
  const axis = require('../miniprogram/utils/axis');
  return devA.store.listTasks().then(function (rows) {
    const nodes = axis.buildAxis(rows, '2026-09-24');
    assert.deepStrictEqual(nodes.map(function (n) { return n.kind; }), ['reg', 'admit', 'exam', 'score']);
    for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i].sortKey >= nodes[i - 1].sortKey);
    assert.ok(nodes[0].state === 'past' || nodes[0].state === 'active');
  });
});

ok('④ 标记已报名 → 倒计时出现，且提醒语义随之翻转', function () {
  const axis = require('../miniprogram/utils/axis');
  const stored = devA.store.getTask(taskId);
  // remind 直接读云端，_openid 由云开发自动写入；本地行没有这个字段
  const asCloudRow = function (r) { return Object.assign({ _openid: 'oX' }, r); };

  assert.strictEqual(axis.countdownOf(stored, '2026-09-24'), null, '未报名不该有倒计时');
  assert.ok(remindPlan.dueJobs([asCloudRow(stored)], '2026-09-12').some(function (j) { return j.kind === 'reg'; }),
    '未报名时应提醒报名截止');

  const registered = Object.assign({}, stored, { registered: true });
  return devA.store.saveTask(registered).then(function (row) {
    taskSnapshot = row;
    const cd = axis.countdownOf(row, '2026-09-24');
    assert.ok(cd && cd.days > 0, '报名后应生成正数倒计时');
    assert.strictEqual(remindPlan.dueJobs([asCloudRow(row)], '2026-09-12').filter(function (j) { return j.kind === 'reg'; }).length, 0,
      '已报名后不该再提醒报名截止');
  });
});

ok('⑤ 到点真的会生成提醒作业并可组装成消息体', function () {
  const exam = d.parse(taskSnapshot.examDate);
  const weekBefore = d.fmt(d.addDays(exam, -7));
  const jobs = remindPlan.dueJobs([Object.assign({}, taskSnapshot, { _openid: 'oX' })], weekBefore);
  assert.ok(jobs.length >= 1, '考前 7 天应至少产生一条提醒，实际 0 条 @' + weekBefore);

  const built = jobs.map(function (j) { return remindPlan.buildData(j, REMIND_FIELDS); });
  built.forEach(function (b) {
    assert.ok(b, '消息体组装失败');
    assert.ok(b.thing5.value.length <= 20);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(b.date9.value));
  });
});

ok('⑥ 打卡与专注累积经验、连击与徽章', function () {
  const game = require('../miniprogram/utils/game');
  const kb = require('../miniprogram/utils/kb');
  const today = kb.todayStr();
  const days = [0, 1, 2].map(function (i) { return d.fmt(d.addDays(d.parse(today), -i)); });

  return days.reduce(function (c, day, i) {
    return c.then(function () {
      return devA.store.addCheckIn({
        nodeId: taskId, date: day, subject: 'Excel 函数', stage: '阶段二',
        focusMinutes: i === 0 ? 25 : 0
      });
    });
  }, Promise.resolve()).then(function () {
    return devA.store.listCheckIns();
  }).then(function (checks) {
    assert.strictEqual(checks.length, 3);
    const sum = game.summarize([taskSnapshot], checks, today);
    assert.strictEqual(sum.streak, 3, '连击应为 3 天');
    assert.strictEqual(sum.focusMinutes, 25);
    assert.ok(sum.exp > 0);
    assert.ok(sum.badges.filter(function (b) { return b.earned; }).some(function (b) { return b.key === 'three'; }),
      '三日之约徽章应点亮');
  });
});

ok('⑦ 长图内容与当前时间轴一致且不画过期节点', function () {
  const share = require('../miniprogram/utils/share');
  const axis = require('../miniprogram/utils/axis');
  const kb = require('../miniprogram/utils/kb');
  return Promise.all([devA.store.listTasks(), devA.store.listCheckIns()]).then(function (res) {
    const sum = kb && require('../miniprogram/utils/game').summarize(res[0], res[1], kb.todayStr());
    const model = share.buildModel(res[0], res[1], sum, kb.todayStr());
    const live = axis.buildAxis(res[0], kb.todayStr()).filter(function (n) { return n.state !== 'past'; });
    assert.strictEqual(model.rows.length, Math.min(live.length, share.MAX_ROWS));
    assert.ok(model.rows.every(function (r) { return r.state !== 'past'; }));

    const calls = [];
    const ctx = {
      fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', lineWidth: 1,
      fillRect: function () { calls.push('r'); }, beginPath: function () {}, fill: function () { calls.push('f'); },
      stroke: function () {}, moveTo: function () {}, lineTo: function () {}, arc: function () { calls.push('a'); },
      roundRect: function () { calls.push('rr'); }, rect: function () {},
      fillText: function (t) { calls.push('t:' + t); },
      createLinearGradient: function () { return { addColorStop: function () {} }; }
    };
    share.draw(ctx, model);
    assert.ok(calls.filter(function (c) { return c.indexOf('t:') === 0; }).length >= model.rows.length * 3,
      '每行至少应有日期、任务名、状态三段文字');
  });
});

ok('⑧ 第二台设备登录能看到同一份数据', function () {
  const devB = device({ offline: false, collections: shared.collections });
  assert.strictEqual(devB.store.rawTasks().length, 0, '新设备本地应为空');
  return devB.store.listTasks().then(function (rows) {
    assert.strictEqual(rows.length, 1, '拉取后应看到 A 建的任务');
    assert.strictEqual(rows[0].name, taskSnapshot.name);
    assert.strictEqual(rows[0].registered, true, '报名状态应同步过来');
    return devB.store.listCheckIns();
  }).then(function (checks) {
    assert.strictEqual(checks.length, 3, '三条打卡应同步过来');
  });
});

ok('⑨ 离线改动不会被云端旧数据覆盖，恢复后正确合并', function () {
  const devC = device({ offline: false, collections: shared.collections });
  return devC.store.listTasks().then(function (rows) {
    // 断网：本地改名，写入失败进队列
    devC.h.setFailure('write');
    return devC.store.saveTask(Object.assign({}, rows[0], { name: '改了名字但没网' }));
  }).then(function () {
    assert.strictEqual(devC.store.queueSize(), 1);
    // 云端同时被别人改了一次（时间戳更早），拉取不得覆盖本地未推送的编辑
    shared.collections.taskNodes[0].updatedAt = 10;
    devC.h.setFailure(null);
    return devC.store.listTasks();
  }).then(function (rows) {
    const mine = rows.filter(function (r) { return r.name === '改了名字但没网'; });
    assert.strictEqual(mine.length, 1, '本地未推送的编辑必须存活');
    return devC.store.flush();
  }).then(function (n) {
    assert.ok(n >= 1, 'flush 应重放队列');
    assert.strictEqual(devC.store.queueSize(), 0);
    return devC.store.listTasks();
  }).then(function (rows) {
    const dup = rows.filter(function (r) { return r.name === '改了名字但没网'; });
    assert.strictEqual(dup.length, 1, '重放后不应出现重复任务');
  });
});

ok('⑩ 删除任务级联清掉打卡，两台设备同时收敛', function () {
  const devD = device({ offline: false, collections: shared.collections });
  return devD.store.listTasks().then(function (rows) {
    // 同一任务在创建设备上是本地 id、在别的设备拉成云端 id：
    // 页面一律用当次 listTasks 返回的 _id，绝不跨设备复用 id。
    assert.ok(rows[0]._id, '拉取行必须有可用主键');
    assert.notStrictEqual(rows[0]._id, taskId, '跨设备主键不同，属设计如此');
    return devD.store.removeTask(rows[0]._id);
  }).then(function () {
    assert.strictEqual(shared.collections.taskNodes.length, 0, '云端任务应被删除');
    assert.strictEqual(shared.collections.checkIns.length, 0, '云端打卡应被级联删除');
    const devE = device({ offline: false, collections: shared.collections });
    return devE.store.listTasks().then(function (rows) {
      assert.strictEqual(rows.length, 0);
      return devE.store.listCheckIns();
    }).then(function (checks) {
      assert.strictEqual(checks.length, 0);
    });
  });
});

module.exports = finish().then(function () { return { passed: passed, failed: failed }; });
