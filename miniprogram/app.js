// app.js - 全局登录态与入口控制
App({
  globalData: {
    baseUrl: 'https://class-app-292687-5-1464295280.sh.run.tcloudbase.com',
  },
  onLaunch() {
    // 微信云托管：全局初始化一次（启用内网通道 wx.cloud.callContainer）。
    // 本地模拟器联调不需要云托管，未启用时 wx.cloud 调用会被安全跳过。
    if (typeof wx.cloud !== 'undefined' && wx.cloud) {
      try { wx.cloud.init(); } catch (e) { /* 本地无云环境时静默忽略 */ }
    }
    // 入口页为 login；若已登录且非首次改密，直接进入课程大厅
    const token = wx.getStorageSync('token');
    if (token) {
      const mustChange = wx.getStorageSync('must_change_password');
      if (mustChange) {
        wx.redirectTo({ url: '/pages/change-password/change-password?first=1' });
      } else {
        wx.switchTab({ url: '/pages/hall/hall' });
      }
    }
  },
});
