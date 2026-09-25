/**
 * 页面级测试桩：把 Page({...}) 的配置对象捕获成可调用实例，
 * 支持路径式 setData（'draft.name' / ['form.'+f]）与回调参数。
 */
const { createHarness } = require('./wx-harness');

function setPath(target, path, value) {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  Object.keys(v).forEach(function (k) { out[k] = clone(v[k]); });
  return out;
}

function createPageLoader(opts) {
  const h = createHarness(opts || {});
  const captured = [];

  h.wx.setNavigationBarTitle = function () {};
  h.wx.vibrateLong = function () { h.vibrated = true; };
  // 这里不再覆盖 createSelectorQuery：原先那份只支持 boundingBox 链（代码里根本
  // 没用过），反而把基础桩支持的 canvas 2d 链路挡掉了，长图导出因此永远测不到。

  const modals = [];
  const toasts = [];
  // showModal 的 confirm 参数是「确认按钮文案/是否显示」，默认点确认，除非用例显式传 false
  h.wx.showModal = function (o) {
    modals.push(o);
    if (o && o.success) o.success({ confirm: o.confirm !== false, cancel: o.confirm === false, content: o.content || '' });
  };
  h.wx.showToast = function (o) { toasts.push(o); };
  h.modals = modals;
  h.toasts = toasts;

  global.Page = function (cfg) { captured.push(cfg); };
  global.Component = function (cfg) { captured.push(cfg); };

  function load(relPath) {
    const full = require.resolve(relPath);
    delete require.cache[full];
    captured.length = 0;
    require(full);
    if (!captured.length) throw new Error('页面未注册 Page(): ' + relPath);
    return instantiate(captured[0]);
  }

  function instantiate(cfg) {
    const inst = {};
    Object.keys(cfg).forEach(function (k) {
      inst[k] = typeof cfg[k] === 'function' ? cfg[k].bind(inst) : cfg[k];
    });
    inst.data = clone(cfg.data || {});
    inst.setData = function (patch, cb) {
      Object.keys(patch || {}).forEach(function (p) { setPath(inst.data, p, patch[p]); });
      if (typeof cb === 'function') cb();
    };
    return inst;
  }

  return { h: h, load: load, instantiate: instantiate };
}

/** 可控时钟：替换 Date.now，用于验证番茄钟的时间戳基准 */
function withNow(start, fn) {
  const realNow = Date.now;
  const clock = { t: start };
  Date.now = function () { return clock.t; };
  try {
    fn(clock);
  } finally {
    Date.now = realNow;
  }
}

module.exports = { createPageLoader, withNow, setPath, clone };
