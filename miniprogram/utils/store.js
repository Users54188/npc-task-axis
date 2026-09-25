/**
 * 数据层：本地优先写入 + 云开发落库 + watch 实时回推 + 冲突合并。
 * 未配置云环境（touristappid 或备案未通过）时自动降级为纯本地存储，
 * 保证全流程可演示、可自测。
 *
 * 关键约束：任何一次远端拉取都不得丢弃「尚未成功推上去的本地行」，
 * 因此 pull / watch 一律走 utils/sync.js 合并，而不是整体覆盖。
 */
const d = require('./date');
const sync = require('./sync');

const TASKS = 'taskNodes';
const CHECKINS = 'checkIns';
const QUEUE = 'syncQueue';
const COLLECTION_TASK = 'taskNodes';
const COLLECTION_CHECK = 'checkIns';

const DATE_FIELDS = ['regStart', 'regEnd', 'admitStart', 'admitEnd', 'examDate', 'scoreStart', 'scoreEnd'];

/** 业务唯一键：把云端回包认回尚未取得云端主键的本地行 */
function matchTask(r) { return r && r.name ? r.name + '|' + (r.examDate || '') : ''; }
function matchCheck(r) { return r && r.date ? r.nodeId + '|' + r.date + '|' + (r.subject || '') : ''; }

function offline() {
  try {
    const app = getApp();
    return !app || !app.globalData || app.globalData.offline !== false;
  } catch (e) {
    return true;
  }
}

function db() {
  if (offline() || !wx.cloud) return null;
  try {
    return wx.cloud.database();
  } catch (e) {
    return null;
  }
}

function uid() {
  let v = wx.getStorageSync('uid');
  if (!v) {
    v = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    wx.setStorageSync('uid', v);
  }
  return v;
}

function local(key) {
  const v = wx.getStorageSync(key);
  return Array.isArray(v) ? v : [];
}

function writeLocal(key, rows) {
  wx.setStorageSync(key, rows);
}

function genId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** 只有任务表需要把云端 Date/String 统一成 YYYY-MM-DD */
function normalizeTask(r) {
  const out = Object.assign({}, r);
  DATE_FIELDS.forEach(function (f) {
    if (out[f] !== undefined) out[f] = d.fmt(out[f]);
  });
  return out;
}

/* ---------- 待同步队列 ---------- */

function enqueue(op) {
  const q = local(QUEUE);
  q.push(op);
  writeLocal(QUEUE, q);
  notify({ type: 'queue', collection: op.collection });
}

function dequeueAll() {
  const q = local(QUEUE);
  writeLocal(QUEUE, []);
  return q;
}

/** 队列涉及的所有主键：合并时这些行不允许被远端覆盖 */
function dirtyIds() {
  const set = new Set();
  local(QUEUE).forEach(function (op) {
    if (op.id) set.add(op.id);
    if (op.localId) set.add(op.localId);
    if (op.data) {
      if (op.data._id) set.add(op.data._id);
      if (op.data._cloudId) set.add(op.data._cloudId);
    }
  });
  return set;
}

/** 重放成功后把云端主键回填到对应本地行，否则下次 pull 会插成重复行 */
function backfill(collection, localId, cloudId) {
  const localKey = collection === COLLECTION_TASK ? TASKS : CHECKINS;
  const rows = local(localKey);
  let hit = false;
  const next = rows.map(function (r) {
    if (r._id !== localId) return r;
    hit = true;
    return Object.assign({}, r, { _cloudId: cloudId, _synced: true });
  });
  if (hit) writeLocal(localKey, next);
}

function flush() {
  const database = db();
  const q = dequeueAll();
  if (!database || !q.length) return Promise.resolve(0);

  return q.reduce(function (chain, op) {
    return chain.then(function (done) {
      const col = database.collection(op.collection);
      let p;
      if (op.type === 'add') p = col.add({ data: op.data });
      else if (op.type === 'update') p = col.doc(op.id).update({ data: op.data });
      else if (op.type === 'remove') p = col.doc(op.id).remove();
      else return Promise.resolve(done);

      return p.then(function (res) {
        if (op.type === 'add' && op.localId && res && res._id) {
          backfill(op.collection, op.localId, res._id);
        }
        return done + 1;
      }, function () {
        enqueue(op);
        return done;
      });
    });
  }, Promise.resolve(0)).then(function (done) {
    notify({ type: 'flushed', size: done });
    return done;
  });
}

/* ---------- 拉取与合并 ---------- */

function pull(collection, localKey, isTask) {
  const database = db();
  if (!database) return Promise.resolve(local(localKey));

  return database.collection(collection).orderBy('updatedAt', 'desc').limit(100).get()
    .then(function (res) {
      const remote = (res.data || []).map(function (r) {
        const row = isTask ? normalizeTask(r) : Object.assign({}, r);
        if (!row._cloudId) row._cloudId = r._id;
        row._synced = true;
        return row;
      });
      const merged = sync.merge(local(localKey), remote, dirtyIds(), isTask ? matchTask : matchCheck);
      writeLocal(localKey, merged.rows);
      if (merged.changed) notify({ type: 'pull', collection: collection });
      return merged.rows;
    }, function () { return local(localKey); });
}

function put(collection, localKey, row, isTask) {
  const now = Date.now();
  row.updatedAt = now;
  if (!row.createdAt) row.createdAt = now;

  const next = local(localKey).filter(function (r) { return r._id !== row._id; });
  next.unshift(row);
  writeLocal(localKey, next);

  const database = db();
  if (!database) return Promise.resolve(row);

  // 本地主键与 _synced 不外传；云端自己生成 _id
  const payload = Object.assign({}, row);
  delete payload._id;
  delete payload._synced;
  if (isTask) DATE_FIELDS.forEach(function (f) { if (payload[f] === '') delete payload[f]; });

  if (row._cloudId) {
    return database.collection(collection).doc(row._cloudId).update({ data: payload })
      .then(function () { return row; }, function () {
        enqueue({ type: 'update', collection: collection, id: row._cloudId, localId: row._id, data: payload });
        return row;
      });
  }

  return database.collection(collection).add({ data: payload })
    .then(function (res) {
      row._cloudId = res._id;
      row._synced = true;
      const fixed = local(localKey).map(function (r) { return r._id === row._id ? row : r; });
      writeLocal(localKey, fixed);
      return row;
    }, function () {
      enqueue({ type: 'add', collection: collection, localId: row._id, data: payload });
      return row;
    });
}

function drop(collection, localKey, id) {
  const row = local(localKey).filter(function (r) { return r._id === id; })[0];
  writeLocal(localKey, local(localKey).filter(function (r) { return r._id !== id; }));
  const database = db();
  if (!database || !row || !row._cloudId) return Promise.resolve(true);
  return database.collection(collection).doc(row._cloudId).remove()
    .then(function () { return true; }, function () {
      enqueue({ type: 'remove', collection: collection, id: row._cloudId });
      return true;
    });
}

/* ---------- 实时回推 ---------- */

const watchers = {};
let listeners = [];

function notify(evt) {
  listeners.forEach(function (fn) {
    try { fn(evt); } catch (e) { /* 单个订阅者抛错不影响其他订阅者 */ }
  });
}

/** 返回退订函数，页面 onHide 必须调用，否则监听器会累积 */
function onSync(fn) {
  listeners.push(fn);
  return function () { offSync(fn); };
}

function offSync(fn) {
  listeners = listeners.filter(function (f) { return f !== fn; });
}

/**
 * watch 快照的 queueType：init / update / replace / remove / enqueue / dequeue。
 * init、dequeue 是握手噪声，enqueue 是本地写回显 —— 都交给 sync.applySnapshot 判定。
 */
function watchCollection(collection, localKey, isTask) {
  const database = db();
  if (!database || watchers[collection]) return;
  const matchKey = isTask ? matchTask : matchCheck;
  try {
    watchers[collection] = database.collection(collection).watch({
      onChange: function (snapshot) {
        let rows = local(localKey);
        const changes = (snapshot && snapshot.docChanges) || [];
        const dirty = dirtyIds();
        changes.forEach(function (ch) {
          let doc = ch.doc;
          if (doc && isTask) doc = normalizeTask(doc);
          rows = sync.applySnapshot(rows, {
            queueType: ch.queueType,
            docId: ch.docId || (doc && doc._id),
            doc: doc
          }, dirty, matchKey);
        });
        writeLocal(localKey, rows);
        if (changes.length) notify({ type: 'watch', collection: collection, size: changes.length });
      },
      onError: function () {
        // 断线后退化为「页面 onShow 时 pull」，不做重试轰炸
        close_();
        notify({ type: 'watch-error', collection: collection });
      }
    });
  } catch (e) {
    watchers[collection] = null;
  }

  function close_() {
    if (!watchers[collection]) return;
    try { watchers[collection].close(); } catch (e) { /* 已关闭 */ }
    watchers[collection] = null;
  }
}

function startWatch() {
  if (!db()) return false;
  watchCollection(COLLECTION_TASK, TASKS, true);
  watchCollection(COLLECTION_CHECK, CHECKINS, false);
  return true;
}

function stopWatch() {
  Object.keys(watchers).forEach(function (k) {
    if (!watchers[k]) return;
    try { watchers[k].close(); } catch (e) { /* 已关闭 */ }
    watchers[k] = null;
  });
}

/* ---------- 任务节点 ---------- */

function listTasks() { return pull(COLLECTION_TASK, TASKS, true); }

function getTask(id) {
  return local(TASKS).filter(function (r) { return r._id === id || r._cloudId === id; })[0] || null;
}

/**
 * nodeId 必须落在「跨设备稳定」的标识上。
 * 同一任务在创建端是本地 id、在别的设备拉成云端 id，若打卡记录跟着存本地 id，
 * 换设备删除任务时就匹配不到打卡，留下永久孤儿行。
 */
function canonicalNodeId(id) {
  const t = getTask(id);
  if (!t) return id;
  return t._cloudId || t._id;
}

function relatedCheckIns(taskId) {
  const a = canonicalNodeId(taskId);
  const b = taskId;
  return local(CHECKINS).filter(function (c) { return c.nodeId === a || c.nodeId === b; });
}

function saveTask(task) {
  const row = Object.assign({}, task);
  if (!row._id) row._id = genId('task');
  if (!row.owner) row.owner = uid();
  return put(COLLECTION_TASK, TASKS, row, true);
}

function removeTask(id) {
  const canonical = canonicalNodeId(id);
  const checks = relatedCheckIns(id);
  writeLocal(CHECKINS, local(CHECKINS).filter(function (c) {
    return !(c.nodeId === canonical || c.nodeId === id);
  }));

  const database = db();
  if (!database) return drop(COLLECTION_TASK, TASKS, id);

  // 必须按 nodeId 条件批量删：本机可能根本没拉过这些打卡行，
  // 只遍历本地缓存会漏删，云端留下永久孤儿记录。
  const cascade = database.collection(COLLECTION_CHECK)
    .where({ nodeId: canonical }).remove()
    .catch(function () { return null; });

  return cascade.then(function () {
    // 兜底：本地已知但 nodeId 存的是旧本地 id 的行，逐条按云端主键删
    return Promise.all(checks.filter(function (c) { return c._cloudId; }).map(function (c) {
      return database.collection(COLLECTION_CHECK).doc(c._cloudId).remove().catch(function () { return null; });
    }));
  }).then(function () {
    return drop(COLLECTION_TASK, TASKS, id);
  });
}

/* ---------- 打卡记录 ---------- */

function listCheckIns() { return pull(COLLECTION_CHECK, CHECKINS, false); }

function addCheckIn(rec) {
  const all = local(CHECKINS);
  const nodeId = canonicalNodeId(rec.nodeId);
  const dup = all.filter(function (r) {
    return r.nodeId === nodeId && r.date === rec.date && r.subject === rec.subject;
  })[0];
  const row = Object.assign({ owner: uid(), makeup: !!rec.makeup }, dup || {}, rec, { nodeId: nodeId });
  if (!row._id) row._id = genId('ck');
  return put(COLLECTION_CHECK, CHECKINS, row, false);
}

function dropCheckIn(id) { return drop(COLLECTION_CHECK, CHECKINS, id); }

function checkInsOf(id) { return relatedCheckIns(id); }

/* ---------- 订阅消息额度记账 ---------- */

function subscribeLog(templateId, ok) {
  const key = 'subLog';
  const v = wx.getStorageSync(key) || {};
  v[templateId] = (v[templateId] || 0) + (ok ? 1 : -1);
  wx.setStorageSync(key, v);
}

/**
 * requestSubscribeMessage 失败时小程序只回调 fail，不弹任何提示；模板 ID 填错、
 * 类目不支持、单次传太多模板都会走这条路，静默吞掉就等于核心提醒功能悄悄失效。
 * 这里把最后一次失败原因留下，交给「我的」页配置清单显示。
 */
function subscribeError(msg) {
  wx.setStorageSync('subErr', { msg: String(msg || 'unknown'), at: Date.now() });
}

function lastSubscribeError() {
  const v = wx.getStorageSync('subErr');
  return v && v.msg ? v.msg : '';
}

if (wx.onNetworkStatusChange) {
  wx.onNetworkStatusChange(function (res) {
    if (!res.isConnected) return;
    flush().then(function () { startWatch(); });
  });
}

module.exports = {
  offline, uid, flush,
  startWatch, stopWatch, onSync, offSync,
  listTasks, getTask, saveTask, removeTask,
  listCheckIns, addCheckIn, dropCheckIn, checkInsOf,
  subscribeLog,
  subscribeError,
  lastSubscribeError,
  queueSize: function () { return local(QUEUE).length; },
  rawTasks: function () { return local(TASKS); },
  rawCheckIns: function () { return local(CHECKINS); }
};
