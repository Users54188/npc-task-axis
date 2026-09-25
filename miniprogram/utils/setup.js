/**
 * 上线前配置自检：把散在注释里的待填项变成可判定、可显示的清单。
 * 纯函数，可在 Node 侧断言，因此「还差哪几项」这件事本身是被测过的。
 *
 * status:
 *   done     已配置
 *   pending  未配置，且是本地能判定的必填项
 *   cloud    云端环境变量，本地无法判定，需在控制台核对
 *   blocked  依赖外部结论（官方合规答复），当前刻意关闭
 */
const config = require('./config');

const ITEMS = [
  {
    key: 'CLOUD_ENV',
    label: '云开发环境 ID',
    where: 'miniprogram/utils/config.js',
    why: '不填则只有本地存储，换设备数据不互通，也无法使用识别与提醒',
    how: '云开发控制台 → 设置 → 环境ID',
    required: true,
    read: function (c) { return !!c.CLOUD_ENV; }
  },
  {
    key: 'SUBSCRIBE_TMPL_IDS',
    label: '订阅消息模板 ID',
    where: 'miniprogram/utils/config.js',
    why: '不填则到点无消息可发，「报名截止提醒」这个核心卖点落不了地',
    how: '公众平台 → 功能 → 订阅消息 → 我的模板（建议关键词：考试提醒 / 报名截止提醒 / 成绩公布提醒）',
    required: true,
    read: function (c) { return Array.isArray(c.SUBSCRIBE_TMPL_IDS) && c.SUBSCRIBE_TMPL_IDS.length > 0; }
  },
  {
    key: 'REMIND_CONFIG',
    label: '提醒云函数的模板与字段映射',
    where: '云开发控制台 → 云函数 remind → 环境变量',
    why: '与上面的模板 ID 必须一致，否则客户端申请了额度、服务端按另一个模板发不出去',
    how: 'JSON：{"reg":{"templateId":"…","fields":{…}},"admit":…,"exam":…,"score":…}',
    required: true,
    cloud: true
  },
  {
    key: 'dailyRemind',
    label: '提醒定时触发器（每天 09:00）',
    where: '云函数 remind → 触发器；或 CLI 部署 cloudfunctions/remind/config.json',
    why: '没有触发器，remind 永远不会被唤起',
    how: 'config.json 已写好，需在控制台或 CLI 部署后确认状态为「已启用」',
    required: true,
    cloud: true
  },
  {
    key: 'RECOGNIZE',
    label: '报名表文字识别（AI）',
    where: 'config.js → RECOGNIZE_ENABLED + 云函数 recognize 环境变量 AI_MODEL',
    why: '可选增强。知识库匹配已能覆盖同一场景，不开不影响上线',
    how: '先向官方确认个人主体运行时调用大模型是否需要深度合成类目，再打开',
    required: false,
    blocked: true,
    read: function (c) { return !!c.RECOGNIZE_ENABLED; }
  }
];

function audit(over) {
  const c = Object.assign({}, config, over || {});
  const items = ITEMS.map(function (it) {
    let status;
    if (it.cloud) status = 'cloud';
    else if (it.read && it.read(c)) status = 'done';
    else if (it.blocked) status = 'blocked';
    else status = 'pending';
    return {
      key: it.key, label: it.label, where: it.where, why: it.why, how: it.how,
      required: !!it.required, status: status
    };
  });

  // 订阅请求失败只在真机出现且没有任何界面提示，不接进清单就等于悄悄坏掉。
  // 清单只渲染 label / where / how，报错原文必须放进 how 才看得见。
  if (c.lastSubError) {
    items.push({
      key: 'subErr',
      label: '最近一次订阅消息请求失败',
      where: 'miniprogram/utils/config.js → SUBSCRIBE_TMPL_IDS',
      why: '提醒是核心功能，静默失败等于没上线',
      how: String(c.lastSubError) + ' —— 模板 ID 抄错、所选类目不支持该模板、或单次传了过多模板都会失败；回后台「我的模板」逐个核对 ID 与类目',
      required: false,
      status: 'error'
    });
  }

  const pending = items.filter(function (i) { return i.required && i.status === 'pending'; }).length;
  const cloud = items.filter(function (i) { return i.status === 'cloud'; }).length;
  const errored = items.filter(function (i) { return i.status === 'error'; }).length;
  return {
    items: items,
    pending: pending,
    cloud: cloud,
    errored: errored,
    blocked: items.filter(function (i) { return i.status === 'blocked'; }).length,
    ready: pending === 0 && errored === 0,
    summary: (pending === 0
      ? '本地配置齐备，还有 ' + cloud + ' 项需在云控制台核对'
      : '还差 ' + pending + ' 项本地配置' + (cloud ? '，另有 ' + cloud + ' 项需在云控制台核对' : ''))
      + (errored ? '；⚠ ' + errored + ' 项运行时报错' : '')
  };
}

module.exports = { audit, ITEMS };
