// 内容安全检测云函数：校验用户自定义昵称
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const content = String(event.content || '').slice(0, 100);
  const scene = event.scene || 1;              // 1 资料
  const wxContext = cloud.getWXContext();
  if (!content.trim()) return { pass: false, reason: 'empty' };

  // 优先 v2（带 openid / scene）
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid: wxContext.OPENID,
      scene,
      content,
    });
    const suggest = res && res.result && res.result.suggest;
    // pass / review 放行，只有明确 risky 才拦截
    return { pass: suggest !== 'risky', suggest, version: 2, label: res && res.result && res.result.label };
  } catch (e) {
    if (e && e.errCode === 87014) return { pass: false, reason: 'risky', version: 2 };
    // v2 失败时尝试 v1（只传 content）
    try {
      const res1 = await cloud.openapi.security.msgSecCheck({ content });
      return { pass: true, suggest: 'pass', version: 1 };
    } catch (e1) {
      if (e1 && e1.errCode === 87014) return { pass: false, reason: 'risky', version: 1 };
      return {
        pass: false,
        reason: 'error',
        version: 2,
        code: (e && e.errCode) || (e1 && e1.errCode) || 0,
        msg: (e && e.errMsg) || (e1 && e1.errMsg) || '',
      };
    }
  }
};
