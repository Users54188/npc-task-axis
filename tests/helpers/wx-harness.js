/**
 * 最小微信运行时桩：Storage + cloud.database + watch + getApp。
 * 只实现 utils/store.js 用到的那部分，够验证「本地优先 / 队列重放 / 合并 / 回推」即可。
 */

function createHarness(opts) {
  const options = opts || {};
  const storage = {};
  // 传入 collections 可让多个 harness 共享同一份「云端」，用于模拟多设备同步
  const collections = options.collections || {};
  const watches = [];
  let idSeq = 0;

  function nextId(prefix) {
    idSeq += 1;
    return (prefix || 'doc') + '-' + idSeq;
  }

  function rowsOf(name) {
    if (!collections[name]) collections[name] = [];
    return collections[name];
  }

  function matches(row, q) {
    if (!q) return true;
    return Object.keys(q).every(function (k) { return row[k] === q[k]; });
  }

  function emit(name, evt) {
    watches.forEach(function (w) {
      if (w.collection === name) w.onChange({ docChanges: [evt] });
    });
  }

  const database = {
    command: { eq: function (v) { return v; } },
    collection: function (name) {
      const api = {
        _q: null,
        where: function (q) { api._q = q; return api; },
        orderBy: function () { return api; },
        limit: function () { return api; },
        get: function () {
          if (options.failGet) return Promise.reject(new Error('network'));
          return Promise.resolve({
            // 浅拷贝：Date 等类型必须原样保留，云端返回的就是 Date 对象
            data: rowsOf(name).filter(function (r) { return matches(r, api._q); })
              .map(function (r) { return Object.assign({}, r); })
          });
        },
        add: function (param) {
          if (options.failWrite) return Promise.reject(new Error('write failed'));
          const doc = Object.assign({}, param.data, { _id: nextId('c'), _openid: 'openid-x' });
          rowsOf(name).unshift(doc);
          emit(name, { queueType: 'enqueue', docId: doc._id, doc: doc });
          return Promise.resolve({ _id: doc._id });
        },
        remove: function () {
          if (options.failWrite) return Promise.reject(new Error('write failed'));
          const rows = rowsOf(name);
          const keep = [];
          let removed = 0;
          rows.forEach(function (r) {
            if (matches(r, api._q)) {
              removed++;
              emit(name, { queueType: 'remove', docId: r._id });
            } else keep.push(r);
          });
          collections[name] = keep;
          return Promise.resolve({ stats: { removed: removed } });
        },
        doc: function (id) {
          return {
            update: function (param) {
              if (options.failWrite) return Promise.reject(new Error('write failed'));
              const rows = rowsOf(name);
              const i = rows.findIndex(function (r) { return r._id === id; });
              if (i < 0) return Promise.resolve({ stats: { updated: 0 } });
              rows[i] = Object.assign({}, rows[i], param.data);
              emit(name, { queueType: 'update', docId: id, doc: rows[i] });
              return Promise.resolve({ stats: { updated: 1 } });
            },
            remove: function () {
              if (options.failWrite) return Promise.reject(new Error('write failed'));
              const rows = rowsOf(name);
              const i = rows.findIndex(function (r) { return r._id === id; });
              if (i < 0) return Promise.resolve({ stats: { deleted: 0 } });
              rows.splice(i, 1);
              emit(name, { queueType: 'remove', docId: id });
              return Promise.resolve({ stats: { deleted: 1 } });
            }
          };
        },
        watch: function (param) {
          const entry = {
            collection: name,
            onChange: param.onChange,
            onError: param.onError,
            closed: false,
            onChangeSnapshot: function (snap) { param.onChange(snap); },
            onErrorEvent: function (e) { param.onError(e); },
            close: function () { entry.closed = true; }
          };
          watches.push(entry);
          return entry;
        }
      };
      return api;
    }
  };

  const wx = {
    getStorageSync: function (k) { return storage[k] === undefined ? '' : storage[k]; },
    setStorageSync: function (k, v) { storage[k] = v; },
    removeStorageSync: function (k) { delete storage[k]; },
    onNetworkStatusChange: function (fn) { wx._net = fn; },
    cloud: { init: function () {}, database: function () { return database; } },
    showToast: function () {}, showModal: function () {}, navigateTo: function () {},
    navigateBack: function () {}, switchTab: function () {}, setClipboardData: function () {},
    stopPullDownRefresh: function () {}, requestSubscribeMessage: function () {},
    // 默认不提供 showShareImageMenu：真实基础库可能没有，代码必须能降级。
    showActionSheet: function (o) { wx._sheet = o; },
    saveImageToPhotosAlbum: function (o) { wx._album = o; },
    showLoading: function (o) { wx._loading = true; void o; },
    hideLoading: function () { wx._loading = false; },
    openSetting: function (o) { wx._setting = o || true; },
    vibrateLong: function (o) { wx._vibrated = (wx._vibrated || 0) + 1; void o; },
    getWindowInfo: function () { return { pixelRatio: 2, windowWidth: 375, screenWidth: 375 }; },
    getSystemInfoSync: function () { return { pixelRatio: 2, windowWidth: 375, screenWidth: 375 }; },
    // 够跑通 canvas 2d 的长图导出链路即可，绘制内容由 share.spec 单独断言。
    createSelectorQuery: function () {
      const node = {
        width: 0, height: 0,
        getContext: function () {
          // 只列 canvas 2d 真实会被调到的成员；渐变必须返回带 addColorStop 的对象，
          // 用 Proxy 兜底会在 createLinearGradient(...).addColorStop(...) 上炸。
          return {
            setTransform: function () {}, save: function () {}, restore: function () {},
            translate: function () {}, scale: function () {}, rotate: function () {},
            beginPath: function () {}, closePath: function () {}, moveTo: function () {},
            lineTo: function () {}, arc: function () {}, rect: function () {},
            roundRect: function () {}, fill: function () {}, stroke: function () {},
            clip: function () {}, fillRect: function () {}, strokeRect: function () {},
            clearRect: function () {}, fillText: function () {}, strokeText: function () {},
            drawImage: function () {},
            measureText: function () { return { width: 40 }; },
            createLinearGradient: function () { return { addColorStop: function () {} }; },
            createRadialGradient: function () { return { addColorStop: function () {} }; },
            fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
            lineWidth: 1, lineCap: '', lineJoin: '', globalAlpha: 1,
            shadowColor: '', shadowBlur: 0, shadowOffsetY: 0
          };
        }
      };
      const q = {
        in() { return q; },
        select() { return q; },
        fields() { return q; },
        exec(cb) { cb([{ node: node, width: 300, height: 400 }]); }
      };
      wx._canvasNode = node;
      return q;
    },
    canvasToTempFilePath: function (o) {
      wx._export = { width: o.width, height: o.height, destWidth: o.destWidth };
      if (o.success) o.success({ tempFilePath: 'wxfile://axis.png' });
    },
    setNavigationBarTitle: function () {}, setKeepScreenOn: function () {}
  };

  global.wx = wx;
  global.getApp = function () {
    return { globalData: { offline: !!options.offline, cloudEnv: '', today: '2026-09-24' } };
  };

  return {
    wx: wx,
    storage: storage,
    collections: collections,
    database: database,
    watches: watches,
    rowsOf: rowsOf,
    setOffline: function (v) { options.offline = v; },
    setFailure: function (kind) { options.failWrite = kind === 'write'; options.failGet = kind === 'get'; }
  };
}

module.exports = { createHarness };
