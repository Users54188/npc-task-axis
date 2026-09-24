/**
 * 双向同步的合并层。纯函数，可在 Node 侧单测。
 *
 * 规则（本地优先 + 后写胜）：
 *  1. 有未 flush 的本地改动（dirty）的行，远端不得覆盖，等 flush 后再对齐；
 *  2. 其余按 updatedAt 后者胜；
 *  3. 远端已删除的行：本地若从未同步成功过（无 _cloudId）则保留待上传，
 *     否则视为对端删除，丢弃；
 *  4. 本地新增且尚未同步的行一律保留。
 */

function keyOf(row) {
  return row._cloudId || row._id;
}

function stamp(row) {
  return Number(row && row.updatedAt) || 0;
}

/**
 * @param {Array} local   本地行
 * @param {Array} remote  远端行（pull 或 watch 快照）
 * @param {Set|Array} dirtyIds 有 pending 操作的 _id / _cloudId
 * @returns {{rows: Array, changed: boolean, dropped: Array}}
 */
function merge(local, remote, dirtyIds, matchKey) {
  // 远端为 null/undefined 代表「这次没拿到」（请求失败），不能当成远端已清空
  if (remote === null || remote === undefined) {
    return { rows: (local || []).slice(), changed: false, dropped: [] };
  }
  const dirty = dirtyIds instanceof Set ? dirtyIds : new Set(dirtyIds || []);
  const out = new Map();
  const dropped = [];

  (local || []).forEach(function (r) { out.set(keyOf(r), r); });

  const remoteKeys = new Set();
  (remote || []).forEach(function (r) {
    const k = keyOf(r);
    remoteKeys.add(k);
    const cur = out.get(k);
    const isDirty = cur && (dirty.has(cur._id) || dirty.has(k));

    if (!cur) {
      // 远端新行可能在本地有一条尚未拿到云端主键的孪生行，按业务键认回
      const twin = typeof matchKey === 'function' ? findDirtyTwin(local, r, dirty, matchKey) : null;
      if (twin) {
        out.delete(keyOf(twin));
        out.set(k, Object.assign({}, twin, { _cloudId: k, _synced: true }));
        return;
      }
      out.set(k, Object.assign({}, r, { _synced: true }));
      return;
    }
    if (isDirty) return;                       // 本地有未推送的改动，不让远端覆盖
    if (stamp(r) > stamp(cur)) {
      out.set(k, Object.assign({}, cur, r, { _synced: true }));
    }
  });

  // 远端消失的行
  Array.from(out.keys()).forEach(function (k) {
    if (remoteKeys.has(k)) return;
    const cur = out.get(k);
    if (dirty.has(cur._id) || dirty.has(k)) return;   // 待推送，保留
    if (!cur._cloudId && !cur._synced) return;        // 纯本地新增，保留
    if (!cur._cloudId) return;                        // 无云端主键，视为本地行
    out.delete(k);
    dropped.push(k);
  });

  const rows = Array.from(out.values()).sort(function (a, b) {
    return stamp(b) - stamp(a);
  });

  return { rows: rows, changed: rows.length !== (local || []).length || dropped.length > 0, dropped: dropped };
}

/** watch 回调里的 queueType → 是否应接受这次变更 */
function acceptChange(existing, incoming) {
  if (!existing) return true;
  return stamp(incoming) >= stamp(existing);
}

/**
 * 应用一次 watch 增量。云开发 queueType 语义：
 *   init     首帧真实数据，必须应用
 *   update / replace / enqueue   写入或修改，应用 doc
 *   remove / dequeue             删除或不再匹配查询，按删除处理
 * 删除受脏保护：本地有未推送操作时不删，等 flush 后由 pull 对齐。
 *
 * matchKey(row)：业务唯一键。未同步成功的本地行没有 _cloudId，
 * 云端回包按主键找不到它，会插成重复行 —— 用业务键把这行认回来。
 */
function applySnapshot(rows, event, dirtyIds, matchKey) {
  const list = (rows || []).slice();
  const dirty = dirtyIds instanceof Set ? dirtyIds : new Set(dirtyIds || []);
  const doc = event && event.doc;
  const id = event && (event.docId || (doc && (doc._id || doc._cloudId)));
  if (!id) return list;

  const type = event && event.queueType;

  if (type === 'remove' || type === 'dequeue') {
    const idx = list.findIndex(function (r) { return keyOf(r) === id; });
    if (idx < 0) return list;
    const cur = list[idx];
    if (dirty.has(cur._id) || dirty.has(keyOf(cur))) return list;
    list.splice(idx, 1);
    return list;
  }

  if (type !== 'init' && type !== 'update' && type !== 'replace' && type !== 'enqueue') return list;
  if (!doc) return list;

  // watch 回包只有云端 _id，回填成 _cloudId 才能与本地行的主键体系对齐
  const incoming = doc._cloudId ? doc : Object.assign({}, doc, { _cloudId: id });
  let cur = list.find(function (r) { return keyOf(r) === id; });

  if (!cur && typeof matchKey === 'function') {
    const want = safeKey(matchKey, incoming);
    if (want) {
      cur = list.find(function (r) {
        if (!dirty.has(r._id) && !dirty.has(keyOf(r))) return false;
        return safeKey(matchKey, r) === want;
      });
      if (cur) {
        // 认回同一条：补云端主键，内容仍以本地未推送的编辑为准
        list[list.indexOf(cur)] = Object.assign({}, cur, { _cloudId: id });
        return list;
      }
    }
  }

  if (cur) {
    if (!acceptChange(cur, incoming)) return list;
    if (dirty.has(cur._id) || dirty.has(keyOf(cur))) {
      list[list.indexOf(cur)] = Object.assign({}, cur, { _cloudId: id });
      return list;
    }
    list[list.indexOf(cur)] = Object.assign({}, cur, incoming);
  } else {
    list.unshift(incoming);
  }
  return list;
}

function safeKey(fn, row) {
  try {
    const v = fn(row);
    return v ? String(v) : '';
  } catch (e) {
    return '';
  }
}

/** 在脏行里找与远端行同业务键的孪生行；只认脏行，避免把两条真实记录误合并 */
function findDirtyTwin(local, remoteRow, dirty, matchKey) {
  const want = safeKey(matchKey, remoteRow);
  if (!want) return null;
  return (local || []).find(function (r) {
    if (!dirty.has(r._id) && !dirty.has(keyOf(r))) return false;
    return safeKey(matchKey, r) === want;
  }) || null;
}

module.exports = { merge, applySnapshot, acceptChange, findDirtyTwin, keyOf, stamp };
