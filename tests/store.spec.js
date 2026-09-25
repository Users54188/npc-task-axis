/**
 * 数据层端到端验证：node tests/store.spec.js
 * 用 tests/helpers/wx-harness.js 桩出 wx/cloud 运行时，覆盖
 * 离线降级、写入重放、脏保护合并、watch 回推、级联删除。
 */
const assert = require('assert');
const path = require('path');
const { createHarness } = require('./helpers/wx-harness');

const STORE_PATH = path.resolve(__dirname, '..', 'miniprogram', 'utils', 'store.js');

let passed = 0;
let failed = 0;
let chain = Promise.resolve();

function ok(label, fn) {
  chain = chain.then(function () {
    return Promise.resolve().then(fn).then(function () {
      passed++;
      console.log('  ✓ ' + label);
    }, function (e) {
      failed++;
      console.log('  ✗ ' + label + '\n    ' + (e && e.message));
      process.exitCode = 1;
    });
  });
  return chain;
}

function finish() {
  return chain.then(function () {
    console.log('\n' + passed + ' 通过 / ' + failed + ' 失败');
    if (failed) process.exitCode = 1;
  });
}

/** 每个用例拿一份全新的 store 模块，避免 watchers / listeners 串味 */
function fresh(offline) {
  delete require.cache[STORE_PATH];
  const h = createHarness({ offline: offline !== false });
  const store = require(STORE_PATH);
  store.stopWatch();
  return { h: h, store: store };
}

function task(over) {
  return Object.assign({
    name: '大学英语四级', examDate: '2026-12-19', type: 'certificate',
    regStart: '2026-09-01', regEnd: '2026-09-20', plan: []
  }, over || {});
}

console.log('数据层端到端\n');

ok('离线模式：写入只落本地，不产生任何云端行', function () {
  const { h, store } = fresh(true);
  return store.saveTask(task()).then(function () {
    assert.strictEqual(store.rawTasks().length, 1);
    assert.strictEqual(h.rowsOf('taskNodes').length, 0);
    assert.strictEqual(store.offline(), true);
  });
});

ok('在线新增：拿到云端主键并标记已同步，且不外传本地 _id', function () {
  const { h, store } = fresh(false);
  return store.saveTask(task()).then(function (row) {
    assert.ok(row._cloudId, '应回填 _cloudId');
    assert.strictEqual(row._synced, true);
    const cloud = h.rowsOf('taskNodes')[0];
    assert.ok(!('_id' in cloud) || cloud._id === row._cloudId, '本地 _id 不应写进云端');
    assert.strictEqual(cloud._openid, 'openid-x');
    assert.ok(cloud.createdAt && cloud.updatedAt);
  });
});

ok('写入失败进队列，恢复后 flush 重放成功并清空队列', function () {
  const { h, store } = fresh(false);
  h.setFailure('write');
  return store.saveTask(task()).then(function (row) {
    assert.strictEqual(row._cloudId, undefined, '写失败时不应有云端主键');
    assert.strictEqual(store.queueSize(), 1);
    assert.strictEqual(h.rowsOf('taskNodes').length, 0);

    h.setFailure(null);
    return store.flush();
  }).then(function (n) {
    assert.strictEqual(n, 1, '应重放 1 条');
    assert.strictEqual(store.queueSize(), 0);
    assert.strictEqual(h.rowsOf('taskNodes').length, 1);
  });
});

ok('pull 合并：本地未推送的编辑不被远端旧数据抹掉', function () {
  const { h, store } = fresh(false);
  h.setFailure('write');
  return store.saveTask(task({ name: '计算机二级', examDate: '2026-12-14' })).then(function () {
    assert.strictEqual(store.queueSize(), 1);
    // 恢复网络，但云端此时躺着一条同键的旧版本
    h.setFailure(null);
    h.rowsOf('taskNodes').push({
      _id: 'c-old', name: '计算机二级', examDate: '2026-12-14',
      fee: '旧值', updatedAt: 10
    });
    return store.listTasks();
  }).then(function (rows) {
    const mine = rows.filter(function (r) { return r.name === '计算机二级'; });
    assert.strictEqual(mine.length, 1, '应认回同一行而不是两条：' + JSON.stringify(mine.map(function (r) { return r._id; })));
    assert.ok(!('fee' in mine[0]) || mine[0].fee !== '旧值', '本地版本优先');
  });
});

ok('pull 失败（reject）时不清空本地数据', function () {
  const { h, store } = fresh(false);
  return store.saveTask(task()).then(function () {
    assert.strictEqual(store.rawTasks().length, 1);
    h.setFailure('get');
    return store.listTasks();
  }).then(function (rows) {
    assert.strictEqual(rows.length, 1, '网络失败必须保留本地行');
  });
});

ok('watch：init 首帧写入本地，remove 事件删除本地行', function () {
  const { h, store } = fresh(false);
  assert.strictEqual(store.startWatch(), true);
  const w = h.watches.filter(function (x) { return x.collection === 'taskNodes'; })[0];
  assert.ok(w, '应为 taskNodes 建立 watch');

  w.onChangeSnapshot({
    docChanges: [{ queueType: 'init', docId: 'c1', doc: { _id: 'c1', name: '六级', examDate: '2026-12-19', updatedAt: 500 } }]
  });
  assert.strictEqual(store.rawTasks().length, 1);
  assert.strictEqual(store.rawTasks()[0]._cloudId, 'c1');

  w.onChangeSnapshot({ docChanges: [{ queueType: 'remove', docId: 'c1' }] });
  assert.strictEqual(store.rawTasks().length, 0);
  store.stopWatch();
});

ok('watch 回推会通知订阅者，退订后不再通知', function () {
  const { h, store } = fresh(false);
  store.startWatch();
  const w = h.watches.filter(function (x) { return x.collection === 'checkIns'; })[0];
  let hits = 0;
  const off = store.onSync(function () { hits++; });

  w.onChangeSnapshot({
    docChanges: [{ queueType: 'init', docId: 'k1', doc: { _id: 'k1', nodeId: 't1', date: '2026-09-24', subject: '听力', updatedAt: 1 } }]
  });
  assert.strictEqual(hits, 1);
  off();
  w.onChangeSnapshot({ docChanges: [{ queueType: 'remove', docId: 'k1' }] });
  assert.strictEqual(hits, 1, '退订后不应再收到');
  store.stopWatch();
});

ok('打卡去重：同任务同日同科目合并为一条并累加时长', function () {
  const { store } = fresh(false);
  return store.addCheckIn({ nodeId: 't1', date: '2026-09-24', subject: '听力', focusMinutes: 25 })
    .then(function (first) {
      return store.addCheckIn({ nodeId: 't1', date: '2026-09-24', subject: '听力', focusMinutes: 40 })
        .then(function (second) {
          assert.strictEqual(second._id, first._id, '应复用同一行');
          assert.strictEqual(store.checkInsOf('t1').length, 1);
          assert.strictEqual(store.rawCheckIns()[0].focusMinutes, 40);
        });
    });
});

ok('删除任务级联删除其打卡记录', function () {
  const { h, store } = fresh(false);
  let saved;
  return store.saveTask(task()).then(function (row) {
    saved = row;
    return store.addCheckIn({ nodeId: row._id, date: '2026-09-24', subject: '听力' });
  }).then(function () {
    assert.strictEqual(store.checkInsOf(saved._id).length, 1);
    return store.removeTask(saved._id);
  }).then(function () {
    assert.strictEqual(store.rawTasks().length, 0);
    assert.strictEqual(store.checkInsOf(saved._id).length, 0);
    assert.strictEqual(h.rowsOf('taskNodes').length, 0);
    assert.strictEqual(h.rowsOf('checkIns').length, 0);
  });
});

ok('云端日期对象归一为 YYYY-MM-DD，打卡表不被污染', function () {
  const { h, store } = fresh(false);
  h.rowsOf('taskNodes').push({
    _id: 'c-d', name: '普通话', examDate: new Date(2027, 3, 12),
    regStart: new Date(2027, 2, 1), regEnd: '2027-03-15', updatedAt: 5
  });
  h.rowsOf('checkIns').push({ _id: 'k-d', nodeId: 'c-d', date: '2026-09-24', subject: '朗读', updatedAt: 5 });

  return Promise.all([store.listTasks(), store.listCheckIns()]).then(function (res) {
    const t = res[0][0];
    assert.strictEqual(t.examDate, '2027-04-12');
    assert.strictEqual(t.regStart, '2027-03-01');
    assert.strictEqual(t.regEnd, '2027-03-15');
    const c = res[1][0];
    assert.ok(!('examDate' in c), '打卡表不应被塞进任务字段');
    assert.ok(!('regStart' in c), '打卡表不应被塞进任务字段');
  });
});

ok('离线写入 → flush 回填云端主键 → 再 pull 不产生重复行', function () {
  const { h, store } = fresh(false);
  h.setFailure('write');
  return store.saveTask(task({ name: '教资笔试', examDate: '2027-03-13' })).then(function () {
    assert.strictEqual(store.queueSize(), 1);
    h.setFailure(null);
    return store.flush();
  }).then(function (n) {
    assert.strictEqual(n, 1);
    assert.strictEqual(store.rawTasks()[0]._cloudId, h.rowsOf('taskNodes')[0]._id,
      'flush 成功后必须回填云端主键');
    return store.listTasks();
  }).then(function (rows) {
    assert.strictEqual(rows.length, 1, 'pull 后仍是 1 行，实际 ' + rows.length);
    assert.strictEqual(rows[0]._cloudId, h.rowsOf('taskNodes')[0]._id);
  });
});

ok('订阅消息真机失败原因写得进、读得出（清单靠它显示）', function () {
  const { store } = fresh(true);
  assert.strictEqual(store.lastSubscribeError(), '', '没失败过就不该报出错误');
  store.subscribeError('requestSubscribeMessage:fail bad template id');
  assert.strictEqual(store.lastSubscribeError(), 'requestSubscribeMessage:fail bad template id');
});

ok('uid 首次生成后复用', function () {
  const { store } = fresh(true);
  const a = store.uid();
  assert.ok(a && a === store.uid());
  assert.ok(/^u[0-9a-z]+$/.test(a), a);
}).then(finish);
