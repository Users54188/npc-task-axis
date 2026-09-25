/**
 * 页面处理函数冒烟：把每个页面 WXML 里绑定的处理函数真的调用一遍。
 *
 * 为什么需要它：处理函数「定义了」不等于「点得动」。structure.spec 只查方法存在，
 * 而 43 个绑定里有 25 个此前从没被任何用例调用过 —— 长图的死按钮就是这么活下来的。
 * 这里不求业务结果正确，只求在页面真实可达的状态下不抛异常。
 *
 * task-detail 有两个互斥状态：查看态（task 有值、draft 为 null）与编辑态
 * （draft 有值、task 为 null）。编辑类按钮在查看态下不渲染，所以两种状态各跑一遍，
 * 处理函数只要在任一状态下能跑通就算过。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPageLoader } = require('./helpers/page-harness');

const ROOT = path.resolve(__dirname, '..', 'miniprogram', 'pages');

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// 需要真云调用或异步链的，冒烟事件喂不出来；理由写在这，用例别假装覆盖。
const EXEMPT = {
  onRecRun: '需识别草稿且云端可用，异步链路由 pages.spec 专门覆盖',
  onSyncNow: '触发 flush() 真云调用，离线桩下无意义',
  onExport: '导出走 setClipboardData，与点击行为无关'
};

function handlersOf(pageName) {
  const wxml = fs.readFileSync(path.join(ROOT, pageName, pageName + '.wxml'), 'utf8');
  const set = new Set();
  const re = /\b(?:bind|catch)[:a-zA-Z]*\s*=\s*"([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(wxml))) set.add(m[1]);
  return Array.from(set).sort();
}

function fakeEvent(id) {
  return {
    type: 'tap',
    currentTarget: { id: id || '', dataset: { field: 'name', id: 'tn_1', index: 0, key: 'name', value: '1' } },
    target: { id: id || '', dataset: { field: 'name', id: 'tn_1', index: 0 } },
    detail: { value: '1', index: 0 },
    mark: {},
    timeStamp: Date.now()
  };
}

const pages = fs.readdirSync(ROOT).filter(function (n) {
  return fs.statSync(path.join(ROOT, n)).isDirectory();
}).sort();

let passed = 0;
let failedPages = 0;
let chain = Promise.resolve();
const notes = [];

function runPage(pageName) {
  const L = createPageLoader({ offline: true });
  const tl = L.load(path.join(ROOT, 'timeline', 'timeline.js'));
  tl.onSeed();
  return delay(60).then(function () {
    // store.js 在模块加载时就读 wx.onNetworkStatusChange，必须等桩装好再 require。
    const store = require(path.join(ROOT, '..', 'utils', 'store.js'));
    const first = store.rawTasks()[0];
    assert.ok(first, '示例任务应已写入，否则详情页没有可进入的对象');
    const page = L.load(path.join(ROOT, pageName, pageName + '.js'));

    const states = pageName === 'task-detail'
      ? [
        { label: '编辑态', enter: function () { page.onLoad({ mode: 'new' }); } },
        { label: '查看态', enter: function () { page.onLoad({ id: first._id }); } }
      ]
      : [{ label: '默认', enter: function () { if (typeof page.onLoad === 'function') page.onLoad({}); } }];

    states.forEach(function (s) { s.enter(); });
    return delay(30).then(function () {
      const list = handlersOf(pageName);
      const okSet = {};

      list.forEach(function (h) {
        if (EXEMPT[h]) return;
        if (typeof page[h] !== 'function') { notes.push(pageName + ' · ' + h + ' 在 WXML 绑定但页面没有此方法'); return; }
        states.forEach(function (s) {
          if (okSet[h]) return;
          try {
            s.enter();
            page[h](fakeEvent(h));
            okSet[h] = s.label;
          } catch (e) {
            notes.push(pageName + ' [' + s.label + '] ' + h + ' → ' + ((e && e.message) || e));
          }
        });
        if (!okSet[h]) {
          // 上面已记录逐态失败原因，这里只标总体不通过
          okSet[h] = null;
        }
      });

      const unpassed = list.filter(function (h) { return !EXEMPT[h] && typeof page[h] === 'function' && !okSet[h]; });
      try { if (typeof page.onUnload === 'function') page.onUnload(); } catch (e) { void e; }
      assert.deepStrictEqual(unpassed, [], pageName + ' 有处理函数在所有可达状态下都抛：' + unpassed.join('、'));
      passed++;
      const ex = list.filter(function (h) { return EXEMPT[h]; });
      if (ex.length) notes.push(pageName + ' 豁免 ' + ex.length + ' 项：' + ex.join('、'));
      void L;
    });
  });
}

console.log('页面处理函数冒烟\n');
pages.forEach(function (p) {
  chain = chain.then(function () {
    return runPage(p).catch(function () { failedPages++; });
  });
});

chain.then(function () {
  console.log('\n' + passed + ' / ' + pages.length + ' 通过');
  const exempt = notes.filter(function (n) { return n.indexOf('豁免') > 0; });
  const problems = notes.filter(function (n) { return n.indexOf('豁免') < 0; });
  if (exempt.length) console.log(exempt.join('\n'));
  if (problems.length) {
    console.log('\n问题（' + problems.length + ' 条）：\n  ' + problems.join('\n  '));
  }
  process.exit(problems.length || failedPages ? 1 : 0);
});
