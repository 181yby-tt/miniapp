'use strict';

/**
 * 微信小程序凭证配置
 * ⚠️ 安全提醒：AppSecret 仅允许通过环境变量注入「服务端」，切勿硬编码或提交到公开仓库。
 *    本项目统一使用环境变量：APPID / APPSECRET（同时兼容云托管控制台的 WECHAT_APPID / WECHAT_SECRET 别名）。
 *    本地开发请复制 server/.env.example 为 .env 并填入；.env 已被 gitignore，不会进仓库。
 *
 * 注：AppID 以 wx 开头，AppSecret 为 32 位十六进制字符串，二者均不可出现在源码中。
 */

const APPID = process.env.APPID || process.env.WECHAT_APPID || '';
const APPSECRET = process.env.APPSECRET || process.env.WECHAT_SECRET || '';

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
