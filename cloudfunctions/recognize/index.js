const cloud = require('wx-server-sdk');
const parser = require('./parse');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const SYSTEM = [
  '你是考试报名信息抽取器。输入是用户提供的报名表或考试通知中的文字。',
  '只输出一个 JSON 对象，不要输出解释文字。字段：',
  'name(任务全称) shortName(简称) type(certificate 或 contest) domain(学科)',
  'site(报名网址) place(报名地点) fee(费用原文)',
  'regStart regEnd admitStart admitEnd examDate scoreStart(均为 YYYY-MM-DD，未知则省略该字段)',
  'plan(数组，每项含 name weeks subjects focus)。',
  '严禁编造日期：文本中没有出现的日期一律省略。'
].join('\n');

/**
 * 从「报名表文字」抽取结构化任务节点。
 *
 * 图片 OCR 未接入：wx.cloud.extend.AI 的官方文档里只给了文本模型
 * （createModel → generateText / streamText），生图明确只能在云函数端调用，
 * 图片理解没有文档化的输入方式；腾讯云通用 OCR 与微信 OCR 插件二选一尚未确定。
 * 因此本函数只接受文字输入，图片路径待选型后在 recognizeImage 里补。
 */
exports.main = async (event) => {
  const OPENID = cloud.getWXContext().OPENID;
  if (!OPENID) return { code: 401, msg: '未登录' };

  const text = String((event && event.text) || '').trim();
  if (!text) return { code: 400, msg: '请提供报名表或通知中的文字' };
  if (text.length > 4000) return { code: 400, msg: '输入过长，请精简到 4000 字以内' };

  // 用户粘贴的内容属于外部输入，进模型前先过一遍内容安全
  try {
    const scan = await cloud.openapi.security.msgSecCheck({ content: text.slice(0, 500) });
    const suggest = (scan && scan.result && scan.result.suggest) || scan.suggest || 'pass';
    if (suggest === 'risky') return { code: 400, msg: '输入含违规内容' };
  } catch (e) {
    return { code: 503, msg: '内容安全接口不可用，稍后再试', detail: e.errMsg || e.message };
  }

  const modelName = process.env.AI_MODEL || '';
  if (!modelName) {
    return {
      code: 501,
      msg: 'AI 抽取未启用：云函数环境变量 AI_MODEL 未设置',
      hint: '在云开发控制台给本函数配置 AI_MODEL=hy3，并确认该环境已领取小程序成长计划额度；未启用前可用 pages/task-detail 的知识库匹配回填'
    };
  }

  try {
    const { getAI } = require('./ai');
    const ai = getAI(cloud);
    if (!ai) return { code: 501, msg: '当前云开发 SDK 未暴露 extend.AI，需在云函数端确认可用入口' };

    const model = ai.createModel(modelName);
    const res = await model.generateText({
      model: modelName,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text }
      ]
    });
    const raw = (res && (res.choices ? res.choices[0].message.content : res.text)) || '';
    const out = parser.parse(raw);
    if (!out.ok) return { code: 422, msg: out.error, raw: raw.slice(0, 500) };
    return { code: 0, data: out.node };
  } catch (e) {
    return { code: 500, msg: '模型调用失败', detail: e.errMsg || e.message };
  }
};
