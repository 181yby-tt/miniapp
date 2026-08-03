const { request } = require('../../utils/request');
const { toastError } = require('../../utils/auth');

const TONES = ['mint', 'blue', 'amber', 'violet', 'coral', 'navy'];

function decorate(c) {
  const teachers = c.teachers || [];
  const schedules = c.schedules || [];
  return {
    id: c.id,
    name: c.name,
    tone: TONES[(c.id || 0) % TONES.length],
    mark: (c.name || '课').slice(0, 1),
    teacherText: teachers.join('、') || '待定',
    timeText: schedules.map((s) => s.slot_name).join('、') || '待定',
    venueText: schedules.map((s) => s.venue_name).join('、') || '待定',
    enrolled_at: c.enrolled_at,
  };
}

Page({
  data: {
    items: [],
    history: [],
    maxActive: 2,
    remainingSlots: 0,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  load(done) {
    request({ url: '/api/me/enrollments', method: 'GET' })
      .then((data) => {
        const items = (data.items || []).map(decorate);
        const remaining = Math.max(0, (data.max_active || 0) - items.length);
        this.setData({
          items,
          history: data.history || [],
          maxActive: data.max_active || 0,
          remainingSlots: remaining,
        });
        if (done) done();
      })
      .catch((err) => {
        toastError(err);
        if (done) done();
      });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  onWithdraw(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认退课',
      content: '退课后名额会立即释放，确定要退出该课程吗？',
      confirmText: '退课',
      confirmColor: '#d75b43',
      success: (res) => {
        if (res.confirm) this.doWithdraw(id);
      },
    });
  },

  doWithdraw(id) {
    wx.showLoading({ title: '退课中', mask: true });
    request({ url: '/api/courses/' + id + '/enrollment', method: 'DELETE' })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已退课', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        wx.hideLoading();
        toastError(err);
      });
  },
});
