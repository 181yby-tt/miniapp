// utils/request.js - 统一请求层
// 双模式：本地 wx.request（模拟器联调） / 微信云托管 wx.cloud.callContainer（线上内网）
const BASE_URL = 'http://localhost:3000';
const CLOUDRUN = require('../config/cloudrun');

// 统一处理响应（两种模式共用）
function handleResponse(res, resolve, reject) {
  const body = res.data || {};
  if (res.statusCode === 401) {
    // 会话失效：清除本地态，跳回登录
    wx.removeStorageSync('token');
    wx.removeStorageSync('must_change_password');
    reject(body);
    return;
  }
  if (body.code === 'OK') {
    resolve(body.data);
  } else {
    reject(body);
  }
}

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    const header = Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}
    );

    // 线上模式：走微信云托管内网通道（免备案/证书/白名单，自动携带 openid）
    if (CLOUDRUN.enabled && typeof wx.cloud !== 'undefined' && wx.cloud) {
      wx.cloud.callContainer({
        config: { env: CLOUDRUN.env },
        path: options.url,
        method: options.method || 'GET',
        header: Object.assign({ 'X-WX-SERVICE': CLOUDRUN.service }, header),
        data: options.data || {},
        success(res) { handleResponse(res, resolve, reject); },
        fail(err) {
          reject({ code: 'NETWORK', message: '云托管请求失败，请稍后重试', detail: err });
        },
      });
      return;
    }

    // 本地/模拟器模式：直连 BASE_URL
    wx.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header,
      success(res) { handleResponse(res, resolve, reject); },
      fail(err) {
        reject({ code: 'NETWORK', message: '网络请求失败，请稍后重试', detail: err });
      },
    });
  });
}

module.exports = { request, BASE_URL, CLOUDRUN };
