/**
 * 页面逻辑验证：node tests/pages.spec.js
 * 直接驱动真实 Page 对象的生命周期与事件处理，不依赖微信开发者工具。
 */
const assert = require('assert');
const path = require('path');
const { createPageLoader, withNow } = require('./helpers/page-harness');

const P = function (rel) { return path.resolve(__dirname, '..', 'miniprogram', 'pages', rel); };
const d = require('../miniprogram/utils/date');

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
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

console.log('页面逻辑\n');

/* ---------------- timeline ---------------- */

ok('时间轴：首次进入是空态，载入示例后生成任务与节点', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('timeline/timeline.js'));
  return page.refresh().then(function () {
    assert.strictEqual(page.data.empty, true);
    assert.strictEqual(page.data.loading, false);
    assert.strictEqual(page.data.axis.length, 0);

    page.onSeed();
    return delay(30);
  }).then(function () {
    assert.ok(page.data.stats.tasks >= 4, '示例任务应至少 4 个');
    assert.ok(page.data.axis.length >= page.data.stats.tasks, '每个任务至少产出一个节点');
    assert.ok(page.data.level.lv >= 1);
    assert.strictEqual(page.data.offline, true);
  });
});

ok('时间轴：分段切换后 shown 只含该类型，且告警计数与节点一致', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('timeline/timeline.js'));
  page.onSeed();
  return delay(40).then(function () {
    return page.refresh();
  }).then(function () {
    const cert = page.data.axis.filter(function (n) { return n.type === 'certificate'; });
    page.onSeg({ currentTarget: { dataset: { seg: 'certificate' } } });
    assert.strictEqual(page.data.shown.length, cert.length);
    assert.ok(page.data.shown.every(function (n) { return n.type === 'certificate'; }));

    const hot = page.data.axis.filter(function (n) { return n.hot && n.state !== 'past'; });
    assert.strictEqual(page.data.alerts, hot.length);
  });
});

/* ---------------- checkin ---------------- */

ok('打卡页：月历 42 格，今天与漏打卡日状态正确', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('checkin/checkin.js'));
  const now = new Date();
  page.onLoad();
  assert.strictEqual(page.data.year, now.getFullYear());
  assert.strictEqual(page.data.month, now.getMonth() + 1);

  return page.refresh().then(function () {
    assert.strictEqual(page.data.cells.length, 42);
    const today = d.fmt(now);
    const cell = page.data.cells.filter(function (c) { return c.key === today; })[0];
    assert.ok(cell, '今天必须在网格里');
    assert.ok(['today', 'ok'].indexOf(cell.state) >= 0, '今天应是 today 或 ok，实际 ' + cell.state);
    const outside = page.data.cells.filter(function (c) { return !c.inMonth; });
    assert.ok(outside.every(function (c) { return c.state === 'blank'; }));
  });
});

ok('打卡页：阶段完成率 = 区间内打卡数 / 区间天数', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('checkin/checkin.js'));
  const store = require('../miniprogram/utils/store');
  const kb = require('../miniprogram/utils/kb');
  const hit = kb.suggest('四级', new Date('2026-09-24T00:00:00'));

  return store.saveTask(hit).then(function (row) {
    const plan = hit.plan[0];
    const start = d.parse(plan.start);
    const total = d.diffDays(start, d.parse(plan.end)) + 1;
    const writes = [];
    for (let i = 0; i < 2 && i < total; i++) {
      writes.push(store.addCheckIn({
        nodeId: row._id, date: d.fmt(d.addDays(start, i)), subject: '高频词', stage: plan.name
      }));
    }
    return Promise.all(writes).then(function () { return page.refresh(); });
  }).then(function () {
    const st = page.data.stages[0];
    assert.ok(st, '应渲染出阶段');
    assert.strictEqual(st.done, 2);
    assert.strictEqual(st.percent, Math.min(100, Math.round(2 / st.total * 100)));
    assert.ok(st.total > 0);
  });
});

ok('打卡页：未选任务不写入；未来日期被拒绝', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('checkin/checkin.js'));
  page.onLoad();
  return page.refresh().then(function () {
    page.data.taskId = '';
    page.onSubmit();
    assert.strictEqual(L.h.toasts.filter(function (t) { return /请先选择任务/.test(t.title); }).length, 1);
    assert.strictEqual(page.data.checkIns.length, 0);

    page.onCell({ currentTarget: { dataset: { i: page.data.cells.findIndex(function (c) { return c.state === 'idle'; }) } } });
    assert.ok(L.h.toasts.some(function (t) { return /未来/.test(t.title); }), '未来日期应被拒绝');
    assert.strictEqual(page.data.form.date, '', '未来日期不应被填进表单');
  });
});

ok('打卡页：提交后写入记录并刷新统计', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('checkin/checkin.js'));
  const kb = require('../miniprogram/utils/kb');
  const store = require('../miniprogram/utils/store');
  return store.saveTask(kb.suggest('四级', new Date('2026-09-24T00:00:00')))
    .then(function () { return page.refresh(); })
    .then(function () {
      assert.ok(page.data.taskId, '应自动选中第一个任务');
      page.onForm({ currentTarget: { dataset: { field: 'subject' } }, detail: { value: '听力' } });
      const before = page.data.stats.checkIns;
      page.onSubmit();
      return delay(30).then(function () { return page.refresh(); });
    }).then(function () {
      assert.strictEqual(page.data.stats.checkIns, 1);
      assert.ok(page.data.stats.streak >= 1);
      assert.ok(L.h.toasts.some(function (t) { return /打卡成功/.test(t.title); }));
    });
});

/* ---------------- focus ---------------- */

ok('番茄钟：时间戳基准，切后台挂起后回前台一次校正', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('focus/focus.js'));
  const base = new Date('2026-09-24T09:00:00').getTime();

  return page.refresh().then(function () {
    withNow(base, function (clock) {
      page.onLoad();
      page.start();
      // 模拟切后台 10 分钟：期间没有任何 tick 回调
      clock.t = base + 10 * 60 * 1000;
      page.tick();
      assert.strictEqual(page.data.remainText, '15:00', '挂起 10 分钟后应剩 15 分钟');
      assert.strictEqual(page.data.percent, 40);
      page.stopTimer();
    });
  });
});

ok('番茄钟：跑满 25 分钟自动写入专注段并切到短休', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('focus/focus.js'));
  const kb = require('../miniprogram/utils/kb');
  const store = require('../miniprogram/utils/store');
  const base = new Date('2026-09-24T09:00:00').getTime();

  return store.saveTask(kb.suggest('四级', new Date('2026-09-24T00:00:00')))
    .then(function () { return page.refresh(); })
    .then(function () {
      withNow(base, function (clock) {
        page.onLoad();
        page.start();
        clock.t = base + 25 * 60 * 1000 + 1000;
        page.tick();
      });
      return delay(40);
    }).then(function () {
      assert.strictEqual(page.data.mode, 'short', '一段专注后应进入短休');
      assert.strictEqual(page.data.finished, 1);
      const checks = store.rawCheckIns();
      assert.strictEqual(checks.length, 1);
      assert.strictEqual(checks[0].focusMinutes, 25);
      assert.strictEqual(checks[0].stage, '番茄钟');
      assert.ok(L.h.vibrated, '结束应有震动反馈');
    });
});

ok('番茄钟：每完成 4 段专注进入一次长休', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('focus/focus.js'));
  const kb = require('../miniprogram/utils/kb');
  const store = require('../miniprogram/utils/store');
  const base = new Date('2026-09-24T09:00:00').getTime();

  return store.saveTask(kb.suggest('四级', new Date('2026-09-24T00:00:00')))
    .then(function () { return page.refresh(); })
    .then(function () {
      page.onLoad();
      page.setData({ finished: 3 });
      withNow(base, function (clock) {
        page.setData({ mode: 'focus', remain: 1500 });
        page.start();
        clock.t = base + 25 * 60 * 1000 + 1000;
        page.tick();
      });
      return delay(30);
    }).then(function () {
      assert.strictEqual(page.data.mode, 'long', '第 4 段后应给长休');
      assert.strictEqual(page.data.remain, 15 * 60);
    });
});

ok('番茄钟：提前结束不足 1 分钟不记账', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('focus/focus.js'));
  const kb = require('../miniprogram/utils/kb');
  const store = require('../miniprogram/utils/store');
  const base = new Date('2026-09-24T09:00:00').getTime();

  return store.saveTask(kb.suggest('四级', new Date('2026-09-24T00:00:00')))
    .then(function () { return page.refresh(); })
    .then(function () {
      withNow(base, function (clock) {
        page.onLoad();
        page.start();
        clock.t = base + 30 * 1000;
        page.onFinishNow();
        assert.strictEqual(store.rawCheckIns().length, 0);
        assert.ok(L.h.toasts.some(function (t) { return /不足 1 分钟/.test(t.title); }));
      });
    });
});

/* ---------------- task-detail ---------------- */

ok('任务详情：输入名称防抖后命中知识库并可回填', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('task-detail/task-detail.js'));
  page.onLoad({ mode: 'new' });
  assert.strictEqual(page.data.mode, 'edit');
  assert.strictEqual(page.data.matched, null);

  page.onNameInput({ detail: { value: '计算机二级' } });
  assert.strictEqual(page.data.matched, null, '防抖窗口内不应立刻命中');

  return delay(320).then(function () {
    assert.ok(page.data.matched, '260ms 后应命中');
    assert.strictEqual(page.data.matched.key, 'ncre2ms');
    assert.ok(page.data.matched.examDate);

    page.onApplyMatch();
    assert.strictEqual(page.data.draft.key, 'ncre2ms');
    assert.strictEqual(page.data.draft.examDate, page.data.matched.examDate);
    assert.ok(page.data.draft.plan.length >= 3);
    assert.ok(page.data.draft.regStart && page.data.draft.regEnd);
  });
});

ok('任务详情：报名截止晚于考试日时拒绝保存', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('task-detail/task-detail.js'));
  page.onLoad({ mode: 'new' });
  page.setData({ draft: {
    name: '乱填的考试', type: 'certificate', examDate: '2026-09-01',
    regStart: '2026-08-01', regEnd: '2026-10-01', plan: []
  } });
  page.onSave();
  assert.ok(L.h.toasts.some(function (t) { return /报名截止晚于考试/.test(t.title); }), '应拒绝保存');
  assert.strictEqual(L.h.modals.length, 0);
});

ok('任务详情：缺名称或缺考试日都不能保存', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('task-detail/task-detail.js'));
  page.onLoad({ mode: 'new' });
  page.onSave();
  assert.ok(L.h.toasts.some(function (t) { return /任务名称/.test(t.title); }));

  page.setData({ 'draft.name': '普通话测试' });
  page.onSave();
  assert.ok(L.h.toasts.some(function (t) { return /考试日期/.test(t.title); }));
});

ok('任务详情：切换已报名后生成倒计时并持久化', function () {
  const L = createPageLoader({ offline: true });
  const kb = require('../miniprogram/utils/kb');
  const store = require('../miniprogram/utils/store');
  const page = L.load(P('task-detail/task-detail.js'));

  let savedId;
  return store.saveTask(kb.suggest('四级', new Date('2026-09-24T00:00:00'))).then(function (row) {
    savedId = row._id;
    return page.load(row._id, kb.todayStr());
  }).then(function () {
    assert.strictEqual(page.data.countdown, null, '未报名不应有倒计时');
    assert.strictEqual(page.data.nodes.length, 4);
    page.onToggleRegistered();
    return delay(40);
  }).then(function () {
    const t = store.getTask(savedId);
    assert.strictEqual(t.registered, true);
    assert.ok(page.data.countdown, '报名后应生成倒计时');
    assert.ok(parseInt(page.data.countdown.text, 10) > 0);
    assert.ok(page.data.nodes.length >= 4);
  });
});

ok('任务详情：报名网站只复制不内嵌（个人主体无 web-view）', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('task-detail/task-detail.js'));
  let copied = '';
  L.h.wx.setClipboardData = function (o) { copied = o.data; o.success && o.success(); };
  page.setData({ mode: 'view', task: { name: 'x', site: 'https://ncre-bm.neea.cn' } });
  page.onCopySite();
  assert.strictEqual(copied, 'https://ncre-bm.neea.cn');
  assert.ok(L.h.toasts.some(function (t) { return /浏览器/.test(t.title); }), '应提示去浏览器打开');
});

/* ---------------- mine ---------------- */

ok('我的页：统计、徽章、云状态与知识库版本全部可读', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('mine/mine.js'));
  const kb = require('../miniprogram/utils/kb');
  const store = require('../miniprogram/utils/store');
  return store.saveTask({ name: '四级', examDate: '2026-12-19', type: 'certificate', registered: true, plan: [] })
    .then(function (row) {
      return store.addCheckIn({ nodeId: row._id, date: kb.todayStr(), subject: '听力', focusMinutes: 25 });
    })
    .then(function () { return page.refresh(); })
    .then(function () {
      assert.ok(page.data.stats);
      assert.strictEqual(page.data.taskCount, 1);
      assert.strictEqual(page.data.checkCount, 1);
      assert.strictEqual(page.data.earnedCount, page.data.badges.filter(function (b) { return b.earned; }).length);
      assert.ok(page.data.earnedCount >= 1, '至少点亮开箱人');
      assert.strictEqual(page.data.offline, true);
      assert.strictEqual(page.data.cloudEnv, '未配置');
      assert.strictEqual(page.data.hasTemplate, false);
      assert.strictEqual(page.data.kbVersion, kb.version);
    });
});

ok('我的页：桌宠台词轮换且不重复触发 AI', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('mine/mine.js'));
  const seen = {};
  const first = page.data.petLine;
  for (let i = 0; i < 8; i++) {
    page.onPet();
    seen[page.data.petLine] = true;
    assert.ok(page.data.petLine.length > 4);
  }
  assert.ok(Object.keys(seen).length >= 6, '应轮换出多条预设台词，实际 ' + Object.keys(seen).length);
  assert.notStrictEqual(page.data.petLine, first, '8 次点击后不应停在原句');
});

ok('我的页：导出 JSON 含两张表，清空只动本地', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('mine/mine.js'));
  const store = require('../miniprogram/utils/store');
  let copied = '';
  L.h.wx.setClipboardData = function (o) { copied = o.data; o.success && o.success(); };

  return store.saveTask({ name: '六级', examDate: '2026-12-19', type: 'certificate', plan: [] })
    .then(function (row) { return store.addCheckIn({ nodeId: row._id, date: '2026-09-24', subject: '阅读' }); })
    .then(function () { return page.refresh(); })
    .then(function () {
      page.onExport();
      const parsed = JSON.parse(copied);
      assert.ok(parsed.exportedAt);
      assert.strictEqual(parsed.taskNodes.length, 1);
      assert.strictEqual(parsed.checkIns.length, 1);

      page.onClear();
      assert.strictEqual(store.rawTasks().length, 0, '清空后本地应无任务');
      assert.ok(L.h.modals.some(function (m) { return /不可恢复|本机缓存/.test(m.content || '') }), '清空前必须二次确认');
    });
});

ok('我的页：离线时点同步给出配置指引而不是静默失败', function () {
  const L = createPageLoader({ offline: true });
  const page = L.load(P('mine/mine.js'));
  page.onSyncNow();
  const m = L.h.modals[L.h.modals.length - 1];
  assert.ok(m, '应弹出提示');
  assert.ok(/config\.js/.test(m.content), '提示要指出去哪填：' + m.content);
});

/* ---------------- recognize 客户端 ---------------- */

ok('识别：离线或未开启时明确不可用，并给替代路径', function () {
  const L = createPageLoader({ offline: true });
  const rec = require('../miniprogram/utils/recognize');
  assert.strictEqual(rec.available(), false);
  assert.ok(/云开发环境/.test(rec.unavailableReason()));

  return rec.recognizeText('全国计算机等级考试，2026年12月14日开考').then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);
  });
});

ok('识别：过短输入直接拒绝，不打云端', function () {
  const L = createPageLoader({ offline: true });
  const rec = require('../miniprogram/utils/recognize');
  return rec.recognizeText('四级').then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.ok(/至少/.test(r.error), r.error);
  });
});

ok('识别：云端 501 映射成可读提示，成功后只补空字段', function () {
  const L = createPageLoader({ offline: false });
  const config = require('../miniprogram/utils/config');
  const rec = require('../miniprogram/utils/recognize');
  config.RECOGNIZE_ENABLED = true;
  L.h.wx.cloud.callFunction = function () {
    return Promise.resolve({ result: { code: 501, msg: 'AI 抽取未启用' } });
  };
  return rec.recognizeText('全国计算机等级考试二级 MS Office，2026 年 12 月 14 日开考').then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.unavailable, true);

    L.h.wx.cloud.callFunction = function () {
      return Promise.resolve({ result: { code: 0, data: { name: 'NCRE', examDate: '2026-12-14', fee: '90 元', plan: [{ name: '阶段一' }] } } });
    };
    return rec.recognizeText('全国计算机等级考试二级 MS Office，2026 年 12 月 14 日开考');
  }).then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.node.examDate, '2026-12-14');

    const page = L.load(P('task-detail/task-detail.js'));
    page.onLoad({ mode: 'new' });
    page.setData({ draft: { name: '我自己起的名字', examDate: '', plan: [], type: 'certificate' }, rec: { open: true, text: '全国计算机等级考试二级 MS Office，2026 年 12 月 14 日开考', busy: false, msg: '' } });
    return page.onRecRun().then(function () {
      assert.strictEqual(page.data.draft.name, '我自己起的名字', '已填内容不得被覆盖');
      assert.strictEqual(page.data.draft.examDate, '2026-12-14', '空字段应被补齐');
      assert.strictEqual(page.data.draft.fee, '90 元');
      assert.strictEqual(page.data.rec.busy, false);
    });
  });
});

module.exports = finish().then(function () { return { passed: passed, failed: failed }; });
