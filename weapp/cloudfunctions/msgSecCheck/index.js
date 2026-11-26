// 内容安全检测云函数：校验用户自定义昵称
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const content = String(event.content || '').slice(0, 100);
  const scene = event.scene || 1;              // 1 资料
  const wxContext = cloud.getWXContext();
  if (!content.trim()) return { pass: false, reason: 'empty' };

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid: wxContext.OPENID,
      scene,
      content,
    });
    const suggest = res && res.result && res.result.suggest;
    return { pass: suggest === 'pass', suggest, label: res && res.result && res.result.label };
  } catch (e) {
    // 87014：内容含有违法违规内容
    if (e && e.errCode === 87014) return { pass: false, reason: 'risky' };
    return { pass: false, reason: (e && e.errCode) || 'error', errMsg: e && e.errMsg };
  }
};
