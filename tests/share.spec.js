/**
 * 长图生成验证：node tests/share.spec.js
 * 绘制内容（模型 + 几何）与绘制执行（对 ctx 的调用）都在 Node 侧断言，
 * 只有真正拿 canvas node 那一段留在页面里。
 */
const assert = require('assert');
const share = require('../miniprogram/utils/share');
const kb = require('../miniprogram/utils/kb');
const game = require('../miniprogram/utils/game');

const TODAY = '2026-09-24';
const REF = new Date(TODAY + 'T00:00:00');

function tasks(n) {
  return kb.listAll().slice(0, n).map(function (e) {
    return kb.suggest(e.name, REF);
  }).filter(Boolean);
}

let passed = 0;
function ok(label, fn) { fn(); passed++; console.log('  ✓ ' + label); }

console.log('任务轴长图\n');

ok('模型只保留未过期节点，且高度与行数自洽', function () {
  const list = tasks(4);
  const m = share.buildModel(list, [], game.summarize(list, [], TODAY), TODAY);
  assert.ok(m.rows.length > 0);
  assert.ok(m.rows.every(function (r) { return r.state !== 'past'; }), '不应把已过去的节点画进图里');
  assert.strictEqual(m.height, share.HEAD_H + Math.max(1, m.rows.length) * share.ROW_H + share.FOOT_H);
  assert.ok(m.subtitle.indexOf(TODAY) >= 0, m.subtitle);
  assert.ok(/4 个任务/.test(m.subtitle), m.subtitle);
});

ok('行数封顶，长名单不会把图无限拉长', function () {
  const list = tasks(10);
  const m = share.buildModel(list, [], game.summarize(list, [], TODAY), TODAY);
  assert.ok(m.rows.length <= share.MAX_ROWS, '实际 ' + m.rows.length);
  assert.ok(m.height <= share.HEAD_H + share.MAX_ROWS * share.ROW_H + share.FOOT_H + 1);
});

ok('任务名超长被截断，日期与状态文案齐备', function () {
  const m = share.buildModel([{
    _id: 'x', name: '全国大学生广告艺术大赛暨学院奖联合命题赛', type: 'contest',
    examDate: '2026-10-08', regEnd: '2026-10-01', registered: true
  }], [], null, TODAY);
  const row = m.rows[0];
  assert.ok(row.name.length <= 14, 'name=' + row.name);
  assert.ok(row.name.endsWith('…'), row.name);
  assert.ok(/剩 \d+ 天/.test(row.note), row.note);
});

ok('空任务出占位图而不是空白图', function () {
  const m = share.emptyModel(TODAY);
  assert.strictEqual(m.rows.length, 1);
  assert.ok(m.rows[0].name.length > 0);
  assert.ok(/还没有任务/.test(m.subtitle));
  assert.strictEqual(m.height, share.HEAD_H + share.ROW_H + share.FOOT_H);
});

ok('绘制指令覆盖全画布且不越界', function () {
  const list = tasks(5);
  const m = share.buildModel(list, [], game.summarize(list, [], TODAY), TODAY);
  const ops = share.layout(m);
  assert.strictEqual(ops[0].op, 'rect');
  assert.strictEqual(ops[0].w, m.width);
  assert.strictEqual(ops[0].h, m.height);

  ops.forEach(function (o) {
    if (o.op === 'text' || o.op === 'tag') {
      assert.ok(o.x >= 0 && o.x <= m.width, '文字横向越界：' + o.text);
      assert.ok(o.y > 0 && o.y <= m.height, '文字纵向越界：' + o.text);
      assert.ok(typeof o.text === 'string' && o.text.length > 0, '空文字指令');
    }
    if (o.op === 'rrect') {
      assert.ok(o.x >= 0 && o.x + o.w <= m.width, '卡片横向越界');
      assert.ok(o.y >= 0 && o.y + o.h <= m.height, '卡片纵向越界');
    }
    if (o.op === 'line') assert.ok(o.y1 <= m.height && o.y2 <= m.height);
  });
});

ok('临期行用警示底色，普通行用白底', function () {
  const hot = share.buildModel([{
    _id: 'h', name: '计算机二级', type: 'certificate', examDate: '2026-12-14',
    regStart: '2026-09-20', regEnd: '2026-09-25', registered: false
  }], [], null, TODAY);
  const hotOps = share.layout(hot);
  assert.ok(hotOps.some(function (o) { return o.op === 'rrect' && o.fill === '#FFECEE'; }), '临期行应有警示底色');

  const calm = share.buildModel([{
    _id: 'c', name: '普通话测试', type: 'certificate', examDate: '2027-04-12',
    regEnd: '2027-03-15', registered: false
  }], [], null, TODAY);
  const calmOps = share.layout(calm);
  assert.ok(calmOps.some(function (o) { return o.op === 'rrect' && o.fill === '#FFFFFF'; }));
  assert.ok(!calmOps.some(function (o) { return o.op === 'rrect' && o.fill === '#FFECEE'; }));
});

/** 记录所有调用的假 2D 上下文 */
function fakeCtx(opts) {
  const o = opts || {};
  const calls = [];
  const fonts = [];
  const ctx = {
    calls: calls, fonts: fonts,
    fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', lineWidth: 1,
    fillRect: function () { calls.push('fillRect'); },
    beginPath: function () { calls.push('beginPath'); },
    fill: function () { calls.push('fill'); },
    stroke: function () { calls.push('stroke'); },
    moveTo: function () { calls.push('moveTo'); },
    lineTo: function () { calls.push('lineTo'); },
    arc: function () { calls.push('arc'); },
    rect: function () { calls.push('rect'); },
    fillText: function (t) { calls.push('fillText:' + t); fonts.push(ctx.font); },
    createLinearGradient: function () {
      calls.push('gradient');
      return { addColorStop: function () {} };
    }
  };
  if (!o.noRoundRect) {
    ctx.roundRect = function () { calls.push('roundRect'); };
  }
  return ctx;
}

ok('draw 使用标准 2D API，不碰已废弃的 setFillStyle 系列', function () {
  const m = share.buildModel(tasks(3), [], null, TODAY);
  const ctx = fakeCtx();
  share.draw(ctx, m);
  ['setFillStyle', 'setFontSize', 'setTextAlign', 'setStrokeStyle'].forEach(function (fn) {
    assert.strictEqual(ctx[fn], undefined, fn + ' 属于旧 canvas-id 接口，type="2d" 上不存在');
  });
  assert.ok(ctx.calls.indexOf('gradient') >= 0, '页头应走线性渐变');
  assert.ok(ctx.calls.indexOf('roundRect') >= 0, '卡片应走圆角矩形');
  assert.ok(ctx.calls.some(function (c) { return c.indexOf('fillText:') === 0; }));
  assert.ok(ctx.fonts.some(function (f) { return /^bold /.test(f); }), '标题应以粗体绘制：' + ctx.fonts.join(' | '));
  assert.ok(ctx.fonts.some(function (f) { return /^\d+px/.test(f); }), '正文字号应为 px：' + ctx.fonts.join(' | '));
});

ok('ctx 不支持 roundRect 时降级为直角矩形而不抛错', function () {
  const m = share.buildModel(tasks(2), [], null, TODAY);
  const ctx = fakeCtx({ noRoundRect: true });
  share.draw(ctx, m);
  assert.ok(ctx.calls.indexOf('rect') >= 0, '应回退到 rect');
  assert.strictEqual(ctx.calls.indexOf('roundRect'), -1);
});

ok('clamp 边界：空值、恰好、超长', function () {
  assert.strictEqual(share.clamp('', 10), '');
  assert.strictEqual(share.clamp(null, 10), '');
  assert.strictEqual(share.clamp(undefined, 10), '');
  assert.strictEqual(share.clamp('1234567890', 10), '1234567890');
  assert.strictEqual(share.clamp('12345678901', 10).length, 10);
  assert.ok(share.clamp('12345678901', 10).endsWith('…'));
});

console.log('\n' + passed + ' / ' + passed + ' 通过');
