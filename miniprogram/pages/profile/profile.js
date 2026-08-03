const { getProfile, logout, toastError } = require('../../utils/auth');

Page({
  data: {
    profile: null, // { student_no, name, grade, class_name, username, avatar }
  },

  onShow() {
    this.load();
  },

  load() {
    getProfile()
      .then((p) => {
        p.avatar = (p.name || '我').slice(0, 1);
        this.setData({ profile: p });
      })
      .catch((err) => toastError(err));
  },

  goChangePwd() {
    wx.navigateTo({ url: '/pages/change-password/change-password' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmColor: '#d75b43',
      success: (res) => {
        if (res.confirm) logout();
      },
    });
  },
});
