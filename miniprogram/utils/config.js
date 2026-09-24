/**
 * 需要你从微信公众平台后台填入的两项配置。
 * 拿不到之前，代码会自动走本地存储 + 跳过订阅消息，功能仍可完整演示。
 */
module.exports = {
  /** 云开发环境 ID：后台「云开发」控制台 → 环境名/环境 ID */
  CLOUD_ENV: '',

  /**
   * 订阅消息模板 ID（最多 3 个）：后台「功能 → 订阅消息 → 我的模板」。
   * 个人主体 + 工具类目通常只能拿到「一次性订阅」，因此提醒必须在
   * 用户每次主动打卡/操作时顺带申请，不能假设可以长期推送。
   */
  SUBSCRIBE_TMPL_IDS: [],

  /**
   * 发送端在云函数 remind/，它读取的是云函数环境变量 REMIND_CONFIG（不是这里）。
   * 两处的模板 ID 必须一致，否则客户端申请了额度、服务端却发不出去。
   * REMIND_CONFIG 形状（字段名以后台实际模板为准）：
   * {
   *   "reg":   { "templateId": "…", "fields": { "thing1": "thing5", "date2": "date9", "thing3": "thing7", "thing4": "thing8" } },
   *   "admit": { … }, "exam": { … }, "score": { … }
   * }
   * 未配置时 remind 直接返回 501 并跳过，不会发一堆失败请求。
   */
  REMIND_ENV_KEY: 'REMIND_CONFIG',

  /**
   * 报名表文字识别开关。设为 true 之前必须同时满足：
   * 云函数 recognize 已部署、其环境变量 AI_MODEL 已设置、
   * 且已确认个人主体运行时调用大模型不需要深度合成类目。
   * 未确认前保持 false —— 知识库匹配这条路径零依赖且一定能用。
   */
  RECOGNIZE_ENABLED: false,

  /** 关键词建议按「考试提醒 / 报名截止提醒 / 成绩公布提醒」申请 */
  CATEGORY_HINT: '工具 > 效率'
};
