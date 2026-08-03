const { login, wechatLogin, bindOpenid, bindCurrent, toastError } = require('../../utils/auth');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    pendingOpenid: '',     // 微信登录后待绑定的 openid
    isWechatBind: false,   // 是否处于「微信绑定」模式
  },

  onLoad() {
    const token = wx.getStorageSync('token');
    if (token) {
      if (wx.getStorageSync('must_change_password')) {
        wx.redirectTo({ url: '/pages/change-password/change-password?first=1' });
      } else {
        wx.switchTab({ url: '/pages/hall/hall' });
      }
      return;
    }
    // 用户主动退出过：本次不静默自动登录，展示账号密码表单，等待手动登录
    if (wx.getStorageSync('manual_logout')) {
      return;
    }
    // 未登录：尝试微信静默登录，已绑定则直接进入
    this.trySilentLogin();
  },

  trySilentLogin() {
    wx.login({
      success: (res) => {
        if (!res.code) return;
        wechatLogin(res.code)
          .then((r) => {
            if (r.needBind) {
              // 已拿到微信身份，等待用户填写学号密码完成首次绑定
              this.setData({ pendingOpenid: r.openid, isWechatBind: true });
              return;
            }
            // 已绑定，进入系统
            this.enter(r.data);
          })
          .catch(() => {
            // 静默登录失败（如无网络），保留账号密码表单作为兜底
          });
      },
    });
  },

  onUser(e) { this.setData({ username: e.detail.value }); },
  onPwd(e) { this.setData({ password: e.detail.value }); },

  onLogin() {
    const { username, password, pendingOpenid } = this.data;
    if (!username.trim() || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    const done = (data) => {
      this.setData({ loading: false });
      this.enter(data);
    };
    const fail = (err) => {
      this.setData({ loading: false });
      toastError(err);
    };

    if (pendingOpenid) {
      // 微信首次绑定流程
      bindOpenid(pendingOpenid, username.trim(), password).then(done).catch(fail);
    } else {
      // 普通账号登录（学生 / 教职工）
      login(username.trim(), password)
        .then((data) => {
          // 登录成功后尝试绑定当前微信，便于下次一键登录
          wx.login({ success: (r) => { if (r.code) bindCurrent(r.code).catch(() => {}); } });
          done(data);
        })
        .catch(fail);
    }
  },

  enter(data) {
    // 手动登录成功，清除「主动退出」标记，恢复后续冷启动的微信一键登录
    wx.removeStorageSync('manual_logout');
    if (data.must_change_password) {
      wx.redirectTo({ url: '/pages/change-password/change-password?first=1' });
    } else {
      wx.switchTab({ url: '/pages/hall/hall' });
    }
  },
});
