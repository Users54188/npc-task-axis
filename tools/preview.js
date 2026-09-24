/**
 * 用真实 WXML + 真实页面数据 + 真实 WXSS 生成 HTML 预览，
 * 让模板渲染结果可以在浏览器里被看到（配合 Chrome 无头截图）。
 *
 *   node tools/preview.js  →  output/preview/pages-preview.html
 */
const fs = require('fs');
const path = require('path');
const wx = require('../tests/helpers/wxml');
const { createPageLoader } = require('../tests/helpers/page-harness');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const OUT = path.resolve(__dirname, '..', 'output', 'preview');
const PAGES = ['timeline', 'task-detail', 'checkin', 'focus', 'mine'];

function populate(page) {
  const L = createPageLoader({ offline: true });
  const store = require('../miniprogram/utils/store');
  const kb = require('../miniprogram/utils/kb');
  const p = L.load(path.join(ROOT, 'pages', page, page + '.js'));
  const hit = kb.suggest('四级', new Date('2026-09-24T00:00:00'));

  const boot = function () {
    if (typeof p.onLoad === 'function') p.onLoad();
    if (typeof p.onShow === 'function') p.onShow();
  };

  if (page === 'task-detail') {
    return store.saveTask(hit).then(function (row) {
      p.onLoad({ id: row._id });
      return p.load(row._id, kb.todayStr());
    }).then(function () { return p.data; });
  }

  boot();
  return store.saveTask(hit)
    .then(function (row) {
      if (page === 'checkin' || page === 'mine') {
        return store.addCheckIn({ nodeId: row._id, date: kb.todayStr(), subject: '听力', focusMinutes: 25 });
      }
      return null;
    })
    .then(function () { return p.refresh ? p.refresh() : null; })
    .then(function () { return p.data; });
}

/** rpx → px（375 设计宽 / 750rpx），并把所有选择器限定在该页容器内 */
function scopeCss(css, selectorPrefix) {
  return css
    .replace(/(\d+(?:\.\d+)?)rpx/g, function (_, n) { return (Number(n) / 2) + 'px'; })
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map(function (chunk) {
      const i = chunk.indexOf('{');
      if (i < 0) return '';
      const sel = chunk.slice(0, i).trim();
      const body = chunk.slice(i + 1).trim();
      if (!sel || !body) return '';
      const prefixed = sel.split(',').map(function (s) {
        const one = s.trim();
        if (!one) return '';
        if (one === 'page') return selectorPrefix;
        return selectorPrefix + ' ' + one;
      }).join(', ');
      return prefixed ? prefixed + '{' + body + '}' : '';
    })
    .join('\n');
}

function readCss(page) {
  const app = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
  let pageCss = '';
  const f = path.join(ROOT, 'pages', page, page + '.wxss');
  if (fs.existsSync(f)) pageCss = fs.readFileSync(f, 'utf8');
  return { app: app, page: pageCss };
}

/** 串行执行：page-harness 会覆盖全局 wx，并发跑会互相踩存储 */
function populateAll(pages) {
  const out = [];
  return pages.reduce(function (chain, p) {
    return chain.then(function () {
      return populate(p).then(function (d) { out.push(d); });
    });
  }, Promise.resolve()).then(function () { return out; });
}

populateAll(PAGES).then(function (datas) {
  fs.mkdirSync(OUT, { recursive: true });

  let css = '';
  let body = '';

  PAGES.forEach(function (page, idx) {
    const src = fs.readFileSync(path.join(ROOT, 'pages', page, page + '.wxml'), 'utf8');
    const ast = wx.parse(src);
    const rendered = wx.render(ast, datas[idx] || {});
    const id = 'page-' + page;
    const c = readCss(page);

    css += scopeCss(c.app, '#' + id + ' .screen') + '\n';
    css += scopeCss(c.page, '#' + id + ' .screen') + '\n';

    body += '<section class="cell" id="' + id + '">' +
      '<h2>' + (idx + 1) + '. pages/' + page + '　<span>' +
      (rendered.report.length ? '渲染告警 ' + rendered.report.length + ' 条' : '渲染无告警') + '</span></h2>' +
      '<div class="phone"><div class="screen">' + rendered.html + '</div></div>' +
      (rendered.report.length
        ? '<pre class="rep">' + rendered.report.map(function (r) { return r.replace(/</g, '&lt;'); }).join('\n') + '</pre>'
        : '') +
      '</section>\n';
  });

  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>大学 NPC 任务轴 · 真实模板渲染预览</title><style>' +
    'body{margin:0;padding:28px;background:#E7E8EE;font:14px/1.6 -apple-system,"Microsoft YaHei",sans-serif}' +
    'h1{font-size:20px;margin:0 0 6px}' +
    '.sub{color:#6B6A75;font-size:13px;margin-bottom:22px}' +
    '.grid{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start}' +
    '.cell{width:375px}' +
    '.cell h2{font-size:12px;color:#6B6A75;margin:0 0 8px;font-weight:700;display:flex;justify-content:space-between}' +
    '.cell h2 span{font-weight:500;color:#22B573}' +
    '.phone{background:#fff;border-radius:16px;padding:5px;box-shadow:0 8px 24px rgba(0,0,0,.10)}' +
    '.screen{background:#F4F5F8;border-radius:12px;overflow:hidden;min-height:640px;position:relative}' +
    '.rep{background:#FFECEE;color:#F2555A;font-size:11px;padding:10px;border-radius:8px;' +
    'white-space:pre-wrap;margin-top:8px;max-height:180px;overflow:auto}' +
    css + '</style></head><body>' +
    '<h1>大学 NPC 任务轴 · 真实模板渲染预览</h1>' +
    '<div class="sub">页面结构来自 miniprogram/pages/*.wxml，样式来自 app.wxss 与各页 wxss，' +
    '数据来自用真实 Page 对象跑出的 data。rpx 按 750→375 折算。' +
    '这不是小程序运行时，只用于确认模板渲染结果与视觉落地。</div>' +
    '<div class="grid">' + body + '</div></body></html>';

  fs.writeFileSync(path.join(OUT, 'pages-preview.html'), html);
  console.log('已生成 ' + path.join(OUT, 'pages-preview.html'));
  PAGES.forEach(function (p, i) {
    const src = fs.readFileSync(path.join(ROOT, 'pages', p, p + '.wxml'), 'utf8');
    const r = wx.render(wx.parse(src), datas[i] || {});
    console.log('  ' + p.padEnd(12) + (r.report.length ? '告警 ' + r.report.length : 'ok') +
      '   html ' + r.html.length + ' 字符');
  });
}).catch(function (e) {
  console.error('预览生成失败：', e && e.message);
  process.exitCode = 1;
});
