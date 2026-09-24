/**
 * 轻量 WXML 解析 / 校验 / 渲染器，用于在 Node 侧验证模板。
 * 目标不是复刻小程序编译器，而是抓住三类真会翻车的问题：
 *  1) 标签不闭合、mustache 不配对；
 *  2) 表达式里写了模板不支持的 JS（函数、方法调用）；
 *  3) 表达式在真实页面数据上求值抛错，或渲染出 undefined。
 */

const ALLOWED_TAGS = new Set([
  'view', 'text', 'image', 'button', 'input', 'textarea', 'scroll-view', 'swiper',
  'swiper-item', 'block', 'navigator', 'picker', 'picker-view', 'checkbox',
  'checkbox-group', 'radio', 'radio-group', 'form', 'label', 'switch', 'slider',
  'progress', 'icon', 'canvas', 'video', 'camera', 'map', 'rich-text'
]);

const DIRECTIVE_RE = /^wx:(if|elif|else|for|for-item|for-index|key)$/;

/* ---------------- 解析 ---------------- */

function parse(src) {
  const errors = [];
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;

  function addText(text) {
    if (text.trim()) stack[stack.length - 1].children.push({ text: text });
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end < 0) { errors.push('注释未闭合'); break; }
      i = end + 3;
      continue;
    }

    const gt = findTagEnd(src, lt);
    if (gt < 0) { errors.push('标签未正确闭合'); break; }
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      const top = stack[stack.length - 1];
      if (stack.length === 1) { errors.push('多余的闭合标签 </' + name + '>'); continue; }
      if (top.tag !== name) errors.push('闭合标签不匹配：期望 </' + top.tag + '>，实际 </' + name + '>');
      stack.pop();
      continue;
    }

    const parsed = parseTag(raw);
    if (!parsed) { errors.push('无法解析标签：<' + raw.slice(0, 40)); continue; }
    const node = { tag: parsed.tag, attrs: parsed.attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!parsed.selfClosing) stack.push(node);
  }

  if (stack.length > 1) {
    errors.push('有标签未闭合：' + stack.slice(1).map(function (n) { return '<' + n.tag + '>'; }).join(' '));
  }
  return { root: root, errors: errors };
}

function findTagEnd(src, from) {
  let quote = null;
  for (let j = from + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '>') return j;
  }
  return -1;
}

function parseTag(raw) {
  const m = /^([a-zA-Z][\w-]*)/.exec(raw);
  if (!m) return null;
  const tag = m[1];
  let rest = raw.slice(tag.length);
  let selfClosing = false;
  if (/\/\s*$/.test(rest)) { selfClosing = true; rest = rest.replace(/\/\s*$/, ''); }

  const attrs = {};
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let mm;
  while ((mm = re.exec(rest))) {
    const name = mm[1];
    if (!name) continue;
    attrs[name] = mm[2] !== undefined ? mm[2]
      : mm[3] !== undefined ? mm[3]
      : mm[4] !== undefined ? mm[4] : '';
  }
  return { tag: tag, attrs: attrs, selfClosing: selfClosing };
}

function walk(node, fn) {
  (node.children || []).forEach(function (child) {
    fn(child);
    if (child.text === undefined) walk(child, fn);
  });
}

function sources(node) {
  const list = [];
  if (node.text !== undefined) list.push(node.text);
  Object.keys(node.attrs || {}).forEach(function (k) { list.push(String(node.attrs[k])); });
  return list;
}

/* ---------------- 校验 ---------------- */

function mustacheErrors(ast) {
  const errors = [];
  walk(ast.root, function (n) {
    sources(n).forEach(function (s) {
      const open = (s.match(/\{\{/g) || []).length;
      const close = (s.match(/\}\}/g) || []).length;
      if (open !== close) errors.push('mustache 不配对（' + open + '/' + close + '）：' + s.trim().slice(0, 60));
    });
  });
  return errors;
}

function tagErrors(ast) {
  const errors = [];
  walk(ast.root, function (n) {
    if (n.text !== undefined) return;
    if (!ALLOWED_TAGS.has(n.tag)) errors.push('未知标签 <' + n.tag + '>');
    Object.keys(n.attrs || {}).forEach(function (k) {
      const v = n.attrs[k];
      if (/\s/.test(k)) errors.push('属性名含空格："' + k + '"');
      if (/^(bind|catch)[\w.]*$/.test(k) && /\{\{/.test(v)) {
        errors.push('事件绑定不能用 mustache：' + k + '="{{…}}"');
      }
      if (/^wx:(if|for)$/.test(k) && !/\{\{/.test(v)) {
        errors.push('<' + n.tag + '> 的 ' + k + ' 缺少 {{}}：' + v);
      }
    });
    if (n.attrs && 'wx:else' in n.attrs && 'wx:if' in n.attrs) {
      errors.push('<' + n.tag + '> 同时写了 wx:if 与 wx:else');
    }
    if (n.attrs && 'wx:else' in n.attrs && 'wx:elif' in n.attrs) {
      errors.push('<' + n.tag + '> 同时写了 wx:elif 与 wx:else');
    }
  });
  return errors;
}

const BANNED = /\bfunction\b|=>|\.\s*(filter|map|forEach|reduce|split|slice|join|concat|push|toFixed|charCodeAt)\s*\(|\beval\b|\bnew\s|\bthis\b/;

function expressions(ast) {
  const out = [];
  walk(ast.root, function (n) {
    sources(n).forEach(function (s) {
      const re = /\{\{([\s\S]*?)\}\}/g;
      let m;
      while ((m = re.exec(s))) out.push({ raw: s, expr: m[1].trim() });
    });
    Object.keys(n.attrs || {}).forEach(function (k) {
      if (DIRECTIVE_RE.test(k) || /^(wx:for-item|wx:for-index|wx:key)$/.test(k)) {
        const v = String(n.attrs[k]);
        const m = /^\{\{([\s\S]*)\}\}$/.exec(v.trim());
        if (m) out.push({ raw: k, expr: m[1].trim() });
      }
    });
  });
  return out;
}

function exprErrors(ast) {
  const errors = [];
  expressions(ast).forEach(function (e) {
    if (!e.expr) { errors.push('空表达式：' + e.raw.slice(0, 50)); return; }
    if (BANNED.test(e.expr)) errors.push('表达式含模板不支持的 JS：' + e.expr.slice(0, 60));
  });
  return errors;
}

/** 条件链必须在父级按兄弟顺序判定，单个节点无法自行判断 elif/else */
function chainErrors(ast) {
  const errors = [];
  function check(children) {
    let open = false;
    children.forEach(function (c) {
      const a = c.attrs || {};
      const isIf = 'wx:if' in a;
      const isElif = 'wx:elif' in a;
      const isElse = 'wx:else' in a;
      if (isIf) { open = true; return; }
      if (isElif || isElse) {
        if (!open) errors.push((isElif ? 'wx:elif' : 'wx:else') + ' 前面没有同级的 wx:if：<' + c.tag + '>');
        if (isElif) return;
        open = false;
        return;
      }
      open = false;
    });
  }
  check(ast.root.children);
  walk(ast.root, function (n) { if (n.children) check(n.children); });
  return errors;
}

/* ---------------- 求值与渲染 ---------------- */

function evalExpr(expr, scope) {
  const keys = Object.keys(scope);
  const vals = keys.map(function (k) { return scope[k]; });
  /* eslint-disable no-new-func */
  const fn = new Function(keys.join(','), '"use strict";return (' + expr + ');');
  return fn.apply(null, vals);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toText(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return '';
  if (v === true) return 'true';
  if (v === false) return 'false';
  return String(v);
}

function interpolate(str, scope, report) {
  return String(str).replace(/\{\{([\s\S]*?)\}\}/g, function (_, expr) {
    let v;
    try { v = evalExpr(expr.trim(), scope); }
    catch (e) { report.push('求值失败 {{' + expr.trim().slice(0, 40) + '}} → ' + e.message); return 'ERR'; }
    if (v === undefined) report.push('渲染出 undefined：{{' + expr.trim().slice(0, 40) + '}}');
    return esc(toText(v));
  });
}

const TAG_MAP = { view: 'div', text: 'span', image: 'img', block: 'div' };
const PASS_ATTRS = new Set(['class', 'style', 'placeholder', 'value', 'maxlength',
  'auto-height', 'mode', 'src', 'type', 'range', 'range-key', 'disabled', 'checked']);

function renderNode(node, scope, report, out) {
  if (node.text !== undefined) { out.push(interpolate(node.text, scope, report)); return; }

  const a = node.attrs || {};
  const tag = TAG_MAP[node.tag] || node.tag;
  // 属性必须等到有了最终作用域再求值：wx:for 的 item/index 在循环体内才存在
  const rawAttrs = [];
  Object.keys(a).forEach(function (k) {
    if (!PASS_ATTRS.has(k)) return;
    rawAttrs.push([k, String(a[k])]);
  });

  const emitted = [];
  const emit = function (childScope) {
    const inner = [];
    renderChildren(node.children || [], childScope, report, inner);
    const local = rawAttrs.map(function (pair) {
      return pair[0] + '="' + interpolate(pair[1], childScope, report) + '"';
    });
    emitted.push('<' + tag + (local.length ? ' ' + local.join(' ') : '') + '>' + inner.join('') + '</' + tag + '>');
  };

  if ('wx:for' in a) {
    let arr;
    try { arr = evalExpr(String(a['wx:for']).replace(/^\{\{|\}\}$/g, '').trim(), scope); }
    catch (e) { report.push('wx:for 求值失败：' + a['wx:for']); arr = []; }
    if (!Array.isArray(arr)) { report.push('wx:for 结果不是数组：' + a['wx:for']); arr = []; }
    const itemName = a['wx:for-item'] || 'item';
    const indexName = a['wx:for-index'] || 'index';
    arr.forEach(function (v, idx) {
      const s = Object.assign({}, scope);
      s[itemName] = v;
      s[indexName] = idx;
      emit(s);
    });
  } else {
    emit(scope);
  }
  out.push(emitted.join(''));
}

function truthy(expr, scope, report) {
  try { return !!evalExpr(String(expr).replace(/^\{\{|\}\}$/g, '').trim(), scope); }
  catch (e) { report.push('条件求值失败：' + expr); return false; }
}

function renderChildren(children, scope, report, out) {
  let chainOpen = false;
  children.forEach(function (c) {
    const a = c.attrs || {};
    if ('wx:if' in a) {
      chainOpen = truthy(a['wx:if'], scope, report);
      if (chainOpen) renderNode(c, scope, report, out);
      return;
    }
    if ('wx:elif' in a) {
      if (chainOpen) return;
      chainOpen = truthy(a['wx:elif'], scope, report);
      if (chainOpen) renderNode(c, scope, report, out);
      return;
    }
    if ('wx:else' in a) {
      if (!chainOpen) renderNode(c, scope, report, out);
      chainOpen = true;
      return;
    }
    chainOpen = false;
    renderNode(c, scope, report, out);
  });
}

function render(ast, scope) {
  const report = [];
  const out = [];
  renderChildren(ast.root.children || [], scope || {}, report, out);
  return { html: out.join('\n'), report: report };
}

/** 收集模板里用到的所有作用域变量名，用于检查页面 data 是否供得上 */
function usedVars(ast) {
  const names = new Set();
  const local = new Set(['item', 'index']);
  expressions(ast).forEach(function (e) {
    // 先剥掉字符串字面量，否则 'seg-on' 里的 on 会被误当成变量
    const stripped = String(e.expr).replace(/'[^']*'|"[^"]*"/g, ' ');
    stripped.replace(/(^|[^$\w.'"])([A-Za-z_$][\w$]*)/g, function (m, pre, id) {
      names.add(id);
      return m;
    });
  });
  walk(ast.root, function (n) {
    const a = n.attrs || {};
    if (a['wx:for-item']) local.add(a['wx:for-item']);
    if (a['wx:for-index']) local.add(a['wx:for-index']);
  });
  return { names: Array.from(names), local: Array.from(local) };
}

module.exports = {
  parse, walk, render, evalExpr, expressions, usedVars,
  mustacheErrors, tagErrors, exprErrors, chainErrors, ALLOWED_TAGS
};
