// utils/auth.js - 登录、改密、登出、个人资料
const { request } = require('./request');

function login(username, password) {
  return request({ url: '/api/auth/login', method: 'POST', data: { username, password } }).then((data) => {
    wx.setStorageSync('token', data.token);
    wx.setStorageSync('must_change_password', !!data.must_change_password);
    wx.setStorageSync('user_type', data.user_type);
    return data;
  });
}

// 微信静默登录：用 wx.login 的 code 换 token。返回 { needBind, openid?, data? }
function wechatLogin(code) {
  return request({ url: '/api/auth/wechat-login', method: 'POST', data: { code } }).then((data) => {
    if (data.code === 'NEED_BIND') {
      return { needBind: true, openid: data.openid };
    }
    wx.setStorageSync('token', data.token);
    wx.setStorageSync('must_change_password', !!data.must_change_password);
    wx.setStorageSync('user_type', data.user_type);
    return { needBind: false, data };
  });
}

// 首次绑定：openid + 学号/工号 + 初始密码
function bindOpenid(openid, username, password) {
  return request({ url: '/api/auth/bind', method: 'POST', data: { openid, username, password } }).then((data) => {
    wx.setStorageSync('token', data.token);
    wx.setStorageSync('must_change_password', !!data.must_change_password);
    wx.setStorageSync('user_type', data.user_type);
    return data;
  });
}

// 已登录后绑定当前微信（便于下次一键登录）
function bindCurrent(code) {
  return request({ url: '/api/auth/bind-current', method: 'POST', data: { code } });
}

function changePassword(payload) {
  return request({ url: '/api/auth/change-password', method: 'POST', data: payload }).then((data) => {
    wx.removeStorageSync('must_change_password');
    return data;
  });
}

function logout() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('must_change_password');
  // 标记「用户主动退出」：登录页 onLoad 看到该标记不再静默自动登录，
  // 直到用户下次手动登录成功才清除。避免退出后立刻被微信静默登录拉回。
  wx.setStorageSync('manual_logout', true);
  wx.reLaunch({ url: '/pages/login/login' });
}

function getProfile() {
  return request({ url: '/api/me/profile', method: 'GET' });
}

// 统一的错误提示
function toastError(err) {
  const msg = (err && err.message) || '操作失败';
  wx.showToast({ title: msg, icon: 'none' });
}

module.exports = { login, wechatLogin, bindOpenid, bindCurrent, changePassword, logout, getProfile, toastError };
