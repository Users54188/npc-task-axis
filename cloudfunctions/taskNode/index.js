const cloud = require('wx-server-sdk');
const check = require('./check');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'taskNodes';

const pick = check.pick;
const validate = check.validate;

exports.main = async (event) => {
  const OPENID = cloud.getWXContext().OPENID;
  if (!OPENID) return { code: 401, msg: '未登录' };

  const action = event.action;
  const body = event.data || {};

  if (action === 'list') {
    const res = await db.collection(COL).where({ _openid: OPENID })
      .orderBy('updatedAt', 'desc').limit(200).get();
    return { code: 0, data: res.data };
  }

  if (action === 'add' || action === 'update') {
    const node = pick(body);
    const err = validate(Object.assign({ type: 'certificate' }, node));
    if (err) return { code: 400, msg: err };

    const now = Date.now();
    if (action === 'add') {
      const res = await db.collection(COL).add({
        data: Object.assign({}, node, { createdAt: now, updatedAt: now })
      });
      return { code: 0, id: res._id };
    }
    if (!body._id) return { code: 400, msg: '缺少 _id' };
    const res = await db.collection(COL).where({ _openid: OPENID, _id: body._id })
      .update({ data: Object.assign({}, node, { updatedAt: now }) });
    if (!res.stats.updated) return { code: 404, msg: '记录不存在或无权修改' };
    return { code: 0 };
  }

  if (action === 'remove') {
    if (!body._id) return { code: 400, msg: '缺少 _id' };
    const res = await db.collection(COL).where({ _openid: OPENID, _id: body._id }).remove();
    if (!res.stats.deleted) return { code: 404, msg: '记录不存在或无权删除' };
    // 级联清理该任务下的打卡记录
    await db.collection('checkIns').where({ _openid: OPENID, nodeId: body._id })
      .remove().catch(function () { return null; });
    return { code: 0 };
  }

  return { code: 400, msg: '未知 action：' + action };
};
