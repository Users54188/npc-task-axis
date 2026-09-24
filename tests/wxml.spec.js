/**
 * WXML 模板验证：node tests/wxml.spec.js
 * 用真实页面数据渲染真实模板，抓编译期与首屏渲染期才会暴露的问题。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const wx = require('./helpers/wxml');
const { createPageLoader } = require('./helpers/page-harness');

const PAGES = ['timeline', 'task-detail', 'checkin', 'focus', 'mine'];
const ROOT = path.resolve(__dirname, '..', 'miniprogram');

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
function readWxml(page) { return fs.readFileSync(path.join(ROOT, 'pages', page, page + '.wxml'), 'utf8'); }

/** 把每个页面驱动到「有真实数据」的状态，返回 page.data 作为渲染作用域 */
function populated(page) {
  const L = createPageLoader({ offline: true });
  const store = require('../miniprogram/utils/store');
  const kb = require('../miniprogram/utils/kb');
  const p = L.load(path.join(ROOT, 'pages', page, page + '.js'));

  const task = function () {
    const hit = kb.suggest('四级', new Date('2026-09-24T00:00:00'));
    return store.saveTask(hit);
  };

  const boot = function (p) {
    if (typeof p.onLoad === 'function') p.onLoad();
    if (typeof p.onShow === 'function') p.onShow();
  };

  if (page === 'timeline') {
    boot(p);
    return task().then(function () { return delay(10); }).then(function () { return p.refresh(); }).then(function () { return p.data; });
  }
  if (page === 'task-detail') {
    return task().then(function (row) {
      p.onLoad({ id: row._id });
      return p.load(row._id, kb.todayStr());
    }).then(function () { return p.data; });
  }
  if (page === 'checkin') {
    boot(p);
    return task().then(function (row) {
      return store.addCheckIn({ nodeId: row._id, date: kb.todayStr(), subject: '听力', focusMinutes: 25 });
    }).then(function () { return p.refresh(); }).then(function () { return p.data; });
  }
  if (page === 'focus') {
    boot(p);
    return task().then(function () { return p.refresh(); }).then(function () { return p.data; });
  }
  boot(p);
  return task().then(function (row) {
    return store.addCheckIn({ nodeId: row._id, date: kb.todayStr(), subject: '听力', focusMinutes: 25 });
  }).then(function () { return p.refresh(); }).then(function () { return p.data; });
}

console.log('WXML 模板\n');

PAGES.forEach(function (page) {
  ok(page + '.wxml 结构可解析且标签闭合', function () {
    const ast = wx.parse(readWxml(page));
    assert.deepStrictEqual(ast.errors, [], '解析错误：' + ast.errors.join(' | '));
    assert.ok(ast.root.children.length > 0, '模板不能为空');
  });

  ok(page + '.wxml 无 mustache / 标签 / 表达式 / 条件链问题', function () {
    const ast = wx.parse(readWxml(page));
    const all = wx.mustacheErrors(ast).concat(wx.tagErrors(ast))
      .concat(wx.exprErrors(ast)).concat(wx.chainErrors(ast));
    assert.deepStrictEqual(all, [], '模板问题：\n      ' + all.join('\n      '));
  });

  ok(page + '.wxml 在真实页面数据上渲染无异常', function () {
    return populated(page).then(function (data) {
      const ast = wx.parse(readWxml(page));
      const out = wx.render(ast, data);
      assert.deepStrictEqual(out.report, [], '渲染问题：\n      ' + out.report.join('\n      '));
      assert.ok(out.html.length > 80, '渲染结果过短，可能条件全部落空');
      assert.ok(!/undefined/.test(out.html), '输出含 undefined：\n      ' +
        out.html.split('\n').filter(function (l) { return /undefined/.test(l); }).slice(0, 3).join('\n      '));
      assert.ok(!/ERR/.test(out.html), '输出含求值错误标记');
    });
  });
});

ok('模板未使用的变量不会漏出页面 data（timeline 抽查）', function () {
  return populated('timeline').then(function (data) {
    const ast = wx.parse(readWxml('timeline'));
    const used = wx.usedVars(ast);
    const missing = used.names.filter(function (n) {
      if (used.local.indexOf(n) >= 0) return false;
      if (['true', 'false', 'null', 'undefined'].indexOf(n) >= 0) return false;
      return !(n in data);
    });
    assert.deepStrictEqual(missing, [], '模板引用了页面 data 里不存在的变量：' + missing.join(', '));
  });
});

ok('条件链与循环的语义正确（构造用例验证渲染器本身）', function () {
  const ast = wx.parse('<view><text wx:if="{{a}}">A</text><text wx:elif="{{b}}">B</text>' +
    '<text wx:else>C</text></view>');
  assert.ok(wx.render(ast, { a: true, b: true }).html.includes('>A<'));
  assert.ok(wx.render(ast, { a: false, b: true }).html.includes('>B<'));
  assert.ok(wx.render(ast, { a: false, b: false }).html.includes('>C<'));
  assert.strictEqual((wx.render(ast, { a: true, b: true }).html.match(/<span/g) || []).length, 1, '命中后不应再渲染其他分支');

  const loop = wx.parse('<view><text wx:for="{{list}}" wx:key="k">{{item.k}}-{{index}}</text></view>');
  const r = wx.render(loop, { list: [{ k: 'x' }, { k: 'y' }] });
  assert.ok(r.html.includes('x-0') && r.html.includes('y-1'), r.html);
  assert.deepStrictEqual(r.report, []);
});

ok('渲染器能抓出模板真实缺陷（自检）', function () {
  const bad = wx.parse('<view><text>{{stats.missing}}</text><text wx:else="1">x</text></view>');
  assert.ok(wx.chainErrors(bad).length > 0, '孤立 wx:else 应被检出');
  assert.ok(wx.tagErrors(wx.parse('<view><foo/></view>')).some(function (e) { return /未知标签/.test(e); }));
  assert.ok(wx.exprErrors(wx.parse('<view>{{a.filter(function(x){return x})}}</view>')).length > 0);
  assert.ok(wx.parse('<view><text></view>').errors.length > 0, '标签不匹配应被检出');
  const rendered = wx.render(wx.parse('<view><text>{{a.b.c}}</text></view>'), { a: null });
  assert.ok(rendered.report.length > 0, '求值失败必须进 report 而不是静默');
});

module.exports = finish().then(function () { return { passed: passed, failed: failed }; });
