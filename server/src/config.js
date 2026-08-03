'use strict';

/**
 * 微信小程序凭证配置
 * ⚠️ 安全提醒：AppSecret 仅允许存在于「服务端」，切勿写入小程序前端代码或提交到公开仓库。
 *    生产环境建议用环境变量覆盖：APPID / APPSECRET
 *    当前值来自用户提供的「课序」小程序凭证。
 *
 * 注：微信规范中 AppID 以 wx 开头（18 位），AppSecret 为 32 位十六进制字符串。
 *    用户给出的两组值里 wxe660278769911dc3 为 AppID，74a77f27c5f66b9153851a45055c7ad1 为 AppSecret。
 */

const APPID = process.env.APPID || 'wxe660278769911dc3';
const APPSECRET = process.env.APPSECRET || '74a77f27c5f66b9153851a45055c7ad1';

const https = require('https');

/**
 * 调用微信 auth.code2Session，用 wx.login 返回的 code 换取 openid / session_key。
 * @param {string} code
 * @returns {Promise<{openid:string, session_key:string, unionid?:string}>}
 */
function code2Session(code) {
  return new Promise((resolve, reject) => {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${APPID}&secret=${APPSECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    https
      .get(url, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            if (json.errcode) {
              return reject(new Error(`wechat_err_${json.errcode}: ${json.errmsg}`));
            }
            if (!json.openid) {
              return reject(new Error('wechat_return_no_openid'));
            }
            resolve({ openid: json.openid, session_key: json.session_key, unionid: json.unionid });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

module.exports = { APPID, APPSECRET, code2Session };
