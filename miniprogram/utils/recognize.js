/**
 * 报名表文字识别的客户端入口。
 *
 * 只在云端配置齐备时才可用：需要 CLOUD_ENV 已填、recognize 云函数已部署、
 * 且云函数侧环境变量 AI_MODEL 已设置。任一不满足都返回不可用，
 * 由界面提示改用知识库匹配回填 —— 后者零依赖、一定能用。
 */
const config = require('./config');
const store = require('./store');

function available() {
  return !store.offline() && !!config.RECOGNIZE_ENABLED;
}

function unavailableReason() {
  if (store.offline()) return '未配置云开发环境，无法调用识别服务';
  if (!config.RECOGNIZE_ENABLED) return '识别服务未开启（云函数 recognize 的环境变量 AI_MODEL 未配置）';
  return '';
}

/**
 * @param {string} text 报名表或通知中的文字
 * @returns {Promise<{ok:boolean, node?:Object, error?:string}>}
 */
function recognizeText(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.length < 6) {
    return Promise.resolve({ ok: false, error: '文字太少，至少贴 6 个字' });
  }
  if (!available()) {
    return Promise.resolve({ ok: false, error: unavailableReason(), unavailable: true });
  }

  return wx.cloud.callFunction({ name: 'recognize', data: { text: trimmed } })
    .then(function (res) {
      const r = (res && res.result) || {};
      if (r.code === 0 && r.data) return { ok: true, node: r.data };
      if (r.code === 501) return { ok: false, error: r.msg || '识别服务未启用', unavailable: true };
      if (r.code === 422) return { ok: false, error: '没能从文字里认出考试日期，请手工填写' };
      return { ok: false, error: r.msg || '识别失败，请改用知识库匹配' };
    }, function () {
      return { ok: false, error: '网络不可用，识别暂时失败' };
    });
}

module.exports = { available, unavailableReason, recognizeText };
