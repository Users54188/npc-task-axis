/**
 * 云函数端获取 wx.cloud.extend.AI 句柄。
 *
 * 官方文档确认的调用面是「小程序端 wx.cloud.extend.AI.createModel(...)」，
 * 云函数端等价入口在不同 wx-server-sdk 版本上暴露方式不同，尚未在本环境实测。
 * 因此这里做能力探测：拿不到就返回 null，由调用方降级为 501，而不是抛异常。
 */
function getAI(cloud) {
  try {
    if (cloud && cloud.extend && cloud.extend.AI) return cloud.extend.AI;
    const cloudbase = require('@cloudbase/node-sdk');
    const app = cloudbase.init({ env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV });
    if (app && app.extend && app.extend.AI) return app.extend.AI;
    if (app && app.ai) return app.ai;
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { getAI };
