/**
 * 双向同步合并层验证：node tests/sync.spec.js
 * 核心命题：远端数据永远不能抹掉「本地还没推上去的改动」。
 */
const assert = require('assert');
const s = require('../miniprogram/utils/sync');

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

const T = 1000;
function row(id, updatedAt, extra) {
  return Object.assign({ _id: id, _cloudId: id, name: 'n' + id, updatedAt: updatedAt }, extra || {});
}
function ids(rows) { return rows.map(function (r) { return r._id; }).sort(); }

console.log('同步合并规则\n');

ok('远端新增行并入本地', function () {
  const out = s.merge([row('a', T)], [row('a', T), row('b', T + 5)], []);
  assert.deepStrictEqual(ids(out.rows), ['a', 'b']);
  assert.strictEqual(out.changed, true);
});

ok('updatedAt 后者胜：远端更新则覆盖', function () {
  const out = s.merge([row('a', T, { name: 'local' })], [row('a', T + 100, { name: 'remote' })], []);
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rows[0].name, 'remote');
});

ok('updatedAt 后者胜：本地更新则不被远端回退', function () {
  const out = s.merge([row('a', T + 100, { name: 'local' })], [row('a', T, { name: 'remote' })], []);
  assert.strictEqual(out.rows[0].name, 'local');
});

ok('合并保留本地独有字段，不被远端整行替换抹掉', function () {
  const out = s.merge(
    [row('a', T, { name: 'local', plan: [{ name: 'p1' }] })],
    [row('a', T + 1, { name: 'remote' })],
    []
  );
  assert.strictEqual(out.rows[0].name, 'remote');
  assert.deepStrictEqual(out.rows[0].plan, [{ name: 'p1' }]);
});

ok('dirty 行即使远端时间戳更新也不被覆盖（离线编辑保护）', function () {
  const local = [row('a', T, { name: 'mine' })];
  const remote = [row('a', T + 9999, { name: 'theirs' })];
  const out = s.merge(local, remote, new Set(['a']));
  assert.strictEqual(out.rows[0].name, 'mine', '未 flush 的本地编辑必须存活');
  const clean = s.merge(local, remote, new Set());
  assert.strictEqual(clean.rows[0].name, 'theirs', '不在脏集合里才允许被覆盖');
});

ok('dirty 可用本地 _id 或云端 _cloudId 命中', function () {
  const local = [{ _id: 'L1', _cloudId: 'C9', name: 'mine', updatedAt: T }];
  const remote = [{ _id: 'C9', name: 'theirs', updatedAt: T + 5 }];
  assert.strictEqual(s.merge(local, remote, new Set(['L1'])).rows[0].name, 'mine');
  assert.strictEqual(s.merge(local, remote, new Set(['C9'])).rows[0].name, 'mine');
});

ok('远端删除：已同步的本地行丢弃并记入 dropped', function () {
  const out = s.merge([row('a', T), row('b', T)], [row('b', T)], []);
  assert.deepStrictEqual(ids(out.rows), ['b']);
  assert.deepStrictEqual(out.dropped, ['a']);
});

ok('远端删除：从未同步成功的本地新增行必须保留', function () {
  const fresh = { _id: 'new1', name: '未上传', updatedAt: T };
  const out = s.merge([fresh, row('a', T)], [row('a', T)], []);
  assert.deepStrictEqual(ids(out.rows), ['a', 'new1']);
  assert.deepStrictEqual(out.dropped, [], '未同步行不应被当作对端删除');
});

ok('待删除但删除尚未推送的行不得被远端复活', function () {
  const local = [row('a', T)];
  const out = s.merge(local, [row('a', T + 1)], new Set(['a']));
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rows[0].updatedAt, T, '脏行保持本地版本');
});

ok('结果按 updatedAt 降序，且两次合并幂等', function () {
  const local = [row('a', T), row('b', T + 50)];
  const remote = [row('a', T), row('b', T + 50), row('c', T + 99)];
  const once = s.merge(local, remote, []);
  assert.deepStrictEqual(once.rows.map(function (r) { return r._id; }), ['c', 'b', 'a']);
  const twice = s.merge(once.rows, remote, []);
  assert.deepStrictEqual(twice.rows.map(function (r) { return r._id; }), ['c', 'b', 'a']);
  assert.strictEqual(twice.changed, false, '第二次合并不应再产生变化');
});

ok('merge 不修改入参数组', function () {
  const local = [row('a', T)];
  const remote = [row('b', T)];
  s.merge(local, remote, []);
  assert.strictEqual(local.length, 1);
  assert.strictEqual(remote.length, 1);
  assert.strictEqual(local[0].updatedAt, T);
});

ok('空远端快照不清空本地（防止 get 失败当删除）', function () {
  const out = s.merge([row('a', T)], [], new Set());
  assert.strictEqual(out.rows.length, 0, '显式空数组代表远端确实没有数据');
  const missing = s.merge([row('a', T)], null, new Set());
  assert.strictEqual(missing.rows.length, 1, '远端为 null（请求失败）时不得清空本地');
});

ok('applySnapshot：init 首帧真实数据必须应用', function () {
  const out = s.applySnapshot([], { queueType: 'init', docId: 'z', doc: { _id: 'z', name: 'first', updatedAt: T } });
  assert.deepStrictEqual(ids(out), ['z']);
});

ok('applySnapshot：update / replace / enqueue 都按写入处理', function () {
  ['update', 'replace', 'enqueue'].forEach(function (t) {
    const out = s.applySnapshot([row('a', T, { name: 'old' })],
      { queueType: t, docId: 'a', doc: { _id: 'a', name: 'via-' + t, updatedAt: T + 5 } });
    assert.strictEqual(out[0].name, 'via-' + t, t + ' 应写入');
  });
});

ok('applySnapshot：remove 与 dequeue 都按删除处理', function () {
  assert.deepStrictEqual(s.applySnapshot([row('a', T)], { queueType: 'remove', docId: 'a' }), []);
  assert.deepStrictEqual(s.applySnapshot([row('a', T)], { queueType: 'dequeue', docId: 'a' }), []);
});

ok('applySnapshot：本地有未推送操作时，删除事件不抹掉它', function () {
  const rows = [row('a', T, { name: 'mine' })];
  const out = s.applySnapshot(rows, { queueType: 'remove', docId: 'a' }, new Set(['a']));
  assert.strictEqual(out.length, 1, '待推送的行不能被远端删除事件抹掉');
  assert.strictEqual(s.applySnapshot(rows, { queueType: 'dequeue', docId: 'a' }, new Set()).length, 0);
});

ok('applySnapshot：脏行缺云端主键时用业务键认回，不产生重复行', function () {
  const local = [{ _id: 'L1', name: 'mine', examDate: '2026-12-01', updatedAt: T }];
  const key = function (r) { return r.name + '|' + r.examDate; };
  const evt = { queueType: 'init', docId: 'C9', doc: { _id: 'C9', name: 'mine', examDate: '2026-12-01', updatedAt: T + 9 } };

  const out = s.applySnapshot(local, evt, new Set(['L1']), key);
  assert.strictEqual(out.length, 1, '不应插成两行');
  assert.strictEqual(out[0].name, 'mine', '内容仍以本地未推送的编辑为准');
  assert.strictEqual(out[0]._cloudId, 'C9', '云端主键应补上');

  const noKey = s.applySnapshot(local, evt, new Set(), key);
  assert.strictEqual(noKey.length, 2, '非脏行不做业务键猜测，避免误合并两条真实记录');
});

ok('applySnapshot：matchKey 抛错时降级为按主键处理，不影响写入', function () {
  const out = s.applySnapshot([],
    { queueType: 'init', docId: 'C1', doc: { _id: 'C1', name: 'x', updatedAt: T } },
    new Set(), function () { throw new Error('bad row'); });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0]._cloudId, 'C1');
});

ok('applySnapshot：未知 queueType 与缺主键的事件被忽略', function () {
  const rows = [row('a', T)];
  assert.deepStrictEqual(ids(s.applySnapshot(rows, { queueType: '??', docId: 'z', doc: { _id: 'z' } })), ['a']);
  assert.deepStrictEqual(ids(s.applySnapshot(rows, { queueType: 'update', doc: {} })), ['a']);
  assert.deepStrictEqual(ids(rows), ['a'], '不得改入参');
});

ok('applySnapshot：旧时间戳的迟到回包不覆盖新值', function () {
  const rows = [row('a', T + 100, { name: 'fresh' })];
  const out = s.applySnapshot(rows, { queueType: 'update', docId: 'a', doc: { _id: 'a', name: 'stale', updatedAt: T } });
  assert.strictEqual(out[0].name, 'fresh');
});

ok('applySnapshot：watch 回包补齐 _cloudId 供后续合并对齐', function () {
  const out = s.applySnapshot([], { queueType: 'init', docId: 'C1', doc: { _id: 'C1', name: 'x', updatedAt: T } });
  assert.strictEqual(out[0]._cloudId, 'C1');
});

ok('keyOf / stamp 对缺字段数据稳健', function () {
  assert.strictEqual(s.keyOf({ _cloudId: 'C', _id: 'L' }), 'C');
  assert.strictEqual(s.keyOf({ _id: 'L' }), 'L');
  assert.strictEqual(s.stamp({ updatedAt: 'abc' }), 0);
  assert.strictEqual(s.stamp(undefined), 0);
});

ok('merge：脏行的云端孪生行按业务键认回，不产生重复', function () {
  const local = [{ _id: 'L1', name: '四级', examDate: '2026-12-19', updatedAt: T }];
  const remote = [{ _id: 'C1', name: '四级', examDate: '2026-12-19', updatedAt: T + 5 }];
  const key = function (r) { return r.name + '|' + r.examDate; };

  const out = s.merge(local, remote, new Set(['L1']), key);
  assert.strictEqual(out.rows.length, 1, '应认回同一行而不是两条');
  assert.strictEqual(out.rows[0]._cloudId, 'C1');
  assert.strictEqual(out.rows[0].name, '四级');

  const clean = s.merge(local, remote, new Set(), key);
  assert.strictEqual(clean.rows.length, 2, '非脏行不猜业务键，保留两条');
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
