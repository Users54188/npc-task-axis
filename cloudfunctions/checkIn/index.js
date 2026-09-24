const cloud = require('wx-server-sdk');
const check = require('./check');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'checkIns';

/**
 * 内容安全：备注是用户自由输入，入库前必须过 msgSecCheck。
 * 命中 risky 直接拒写，review 降级为不展示文本。
 */
async function scanText(content) {
  if (!content) return { suggest: 'pass' };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: String(content).slice(0, 500) });
    const suggest = (res && res.result && res.result.suggest) || res.suggest || 'pass';
    return { suggest: suggest, detail: res };
  } catch (e) {
    // 接口异常时不放行敏感内容，按 review 处理
    return { suggest: 'review', error: e.errMsg || e.message };
  }
}

function dateErr(dateStr) { return check.checkDate(dateStr); }

exports.main = async (event) => {
  const OPENID = cloud.getWXContext().OPENID;
  if (!OPENID) return { code: 401, msg: '未登录' };

  const action = event.action;
  const body = event.data || {};

  if (action === 'list') {
    const res = await db.collection(COL).where({ _openid: OPENID })
      .orderBy('date', 'desc').limit(500).get();
    return { code: 0, data: res.data };
  }

  if (action === 'add') {
    if (!body.nodeId) return { code: 400, msg: '缺少 nodeId' };
    const derr = dateErr(body.date);
    if (derr) return { code: 400, msg: derr };

    const scan = await scanText(body.note);
    if (scan.suggest === 'risky') return { code: 400, msg: '备注含违规内容，未保存' };

    const now = Date.now();
    const payload = check.sanitize(body, { suggest: scan.suggest, now: now });

    // 同一任务 + 同一日期 + 同一科目 视为同一条，做原地更新而不是插入重复行
    const dup = await db.collection(COL).where({
      _openid: OPENID, nodeId: payload.nodeId, date: payload.date, subject: payload.subject
    }).limit(1).get();

    if (dup.data.length) {
      await db.collection(COL).doc(dup.data[0]._id).update({ data: payload });
      return { code: 0, id: dup.data[0]._id, merged: true };
    }
    const res = await db.collection(COL).add({ data: Object.assign({}, payload, { createdAt: now }) });
    return { code: 0, id: res._id };
  }

  if (action === 'remove') {
    if (!body._id) return { code: 400, msg: '缺少 _id' };
    const res = await db.collection(COL).where({ _openid: OPENID, _id: body._id }).remove();
    if (!res.stats.deleted) return { code: 404, msg: '记录不存在或无权删除' };
    return { code: 0 };
  }

  if (action === 'stats') {
    const res = await db.collection(COL).where({ _openid: OPENID }).limit(1000).get();
    const rows = res.data;
    const days = {};
    let minutes = 0;
    rows.forEach(function (r) {
      days[r.date] = true;
      minutes += r.focusMinutes || 0;
    });
    return {
      code: 0,
      data: { total: rows.length, days: Object.keys(days).length, focusMinutes: minutes }
    };
  }

  return { code: 400, msg: '未知 action：' + action };
};
