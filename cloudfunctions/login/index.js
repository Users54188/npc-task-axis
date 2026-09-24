const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 返回调用者的 openid 与云环境信息，供小程序侧首次握手使用。
 * 数据表的归属字段 _openid 由云开发自动写入，客户端无需也无法指定。
 */
exports.main = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID || '',
    env: wxContext.ENV,
    serverTime: Date.now()
  };
};
