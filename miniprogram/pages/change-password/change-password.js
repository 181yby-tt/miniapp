const { changePassword, toastError } = require('../../utils/auth');

Page({
  data: {
    old_password: '',
    new_password: '',
    confirm_password: '',
    loading: false,
    isFirst: false,
  },

  onLoad(options) {
    this.setData({ isFirst: options.first === '1' });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onSubmit() {
    const { old_password, new_password, confirm_password, loading } = this.data;
    if (loading) return;
    if (!new_password || new_password.length < 8) {
      wx.showToast({ title: '新密码至少 8 位', icon: 'none' });
      return;
    }
    if (new_password !== confirm_password) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    changePassword({ old_password, new_password, confirm_password })
      .then(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '密码已修改', icon: 'success' });
        setTimeout(() => {
          if (this.data.isFirst) {
            wx.switchTab({ url: '/pages/hall/hall' });
          } else {
            wx.navigateBack();
          }
        }, 1000);
      })
      .catch((err) => {
        this.setData({ loading: false });
        toastError(err);
      });
  },
});
