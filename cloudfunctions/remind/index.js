const cloud = require('wx-server-sdk');
const plan = require('./plan');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const PAGE_SIZE = 100;

/**
 * 订阅消息配置，来自云函数环境变量 REMIND_CONFIG（JSON）：
 * {
 *   "reg":   { "templateId": "…", "fields": { "thing1": "thing1", "date2": "date2", "thing3": "thing3" } },
 *   "admit": { … }, "exam": { … }, "score": { … }
 * }
 * 字段名取决于后台「订阅消息 → 我的模板」里选的内容，不配就整体跳过，
 * 避免每天发一堆注定失败的请求。
 */
function readConfig() {
  const raw = process.env.REMIND_CONFIG;
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) {
    return null;
  }
}

async function allTasks() {
  const rows = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const res = await db.collection('taskNodes').where({
      examDate: _.exists(true)
    }).skip(skip).limit(PAGE_SIZE).get();
    const batch = res.data || [];
    rows.push.apply(rows, batch);
    if (batch.length < PAGE_SIZE) break;
    if (skip > 5000) break;
  }
  return rows;
}

function todayUTC8() {
  // 云函数运行在 UTC，提醒必须按用户所在东八区的"今天"算
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

exports.main = async (event) => {
  const config = readConfig();
  if (!config) {
    return { code: 501, msg: '未配置 REMIND_CONFIG，跳过本次提醒', today: todayUTC8() };
  }

  const today = event && event.today ? String(event.today) : todayUTC8();
  const tasks = await allTasks();
  const jobs = plan.dueJobs(tasks, today);

  const result = { today: today, scanned: tasks.length, due: jobs.length, sent: 0, skipped: 0, noQuota: 0, failed: 0, errors: [] };

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const cfg = config[job.kind];
    const data = plan.buildData(job, cfg && cfg.fields);
    if (!cfg || !cfg.templateId || !data) {
      result.skipped++;
      continue;
    }

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: job.openid,
        templateId: cfg.templateId,
        page: 'pages/task-detail/task-detail?id=' + job.nodeId,
        data: data,
        miniprogramState: process.env.MINI_STATE || 'formal'
      });
      result.sent++;
    } catch (e) {
      const code = e && (e.errCode || e.code);
      // 43101：用户没有剩余订阅额度（一次性订阅每次授权只能发一条）
      if (code === 43101 || code === 47003) {
        result.noQuota++;
      } else {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(String((e && e.errMsg) || e));
      }
    }
  }

  return { code: 0, data: result };
};
