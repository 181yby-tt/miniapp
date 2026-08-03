const { request } = require('../../utils/request');
const { toastError } = require('../../utils/auth');

const STATUS = {
  OPEN: { text: '开放报名', cls: 'ok' },
  DRAFT: { text: '草稿', cls: 'gray' },
  CLOSED: { text: '停止报名', cls: 'amber' },
  FINISHED: { text: '已结束', cls: 'gray' },
  ARCHIVED: { text: '已归档', cls: 'gray' },
};

Page({
  data: {
    id: null,
    course: {},
    tone: 'mint',
    mark: '课',
    teacherText: '',
    timeText: '',
    venueText: '',
    statusText: '',
    statusClass: '',
    action: 'loading', // enrolled | can_enroll | disabled
    actionText: '',
    reason: '',
    loading: false,
  },

  onLoad(options) {
    this.setData({ id: options.id });
    this.load();
  },

  load() {
    const id = this.data.id;
    request({ url: '/api/courses/' + id, method: 'GET' })
      .then((data) => {
        const c = data.course;
        const tones = ['mint', 'blue', 'amber', 'violet', 'coral', 'navy'];
        const teachers = c.teachers || [];
        const schedules = c.schedules || [];
        const st = STATUS[c.status] || { text: c.status, cls: 'gray' };
        let action = 'disabled';
        let actionText = '暂不可报名';
        let reason = '';
        if (c.enrolled) { action = 'enrolled'; actionText = '已报名'; }
        else if (c.status !== 'OPEN') { action = 'disabled'; actionText = st.text; }
        else if (c.remaining <= 0) { action = 'disabled'; actionText = '已满员'; reason = '课程名额已满，可关注后续退课释放'; }
        else { action = 'can_enroll'; actionText = '立即报名'; }
        this.setData({
          course: c,
          tone: tones[(c.id || 0) % tones.length],
          mark: (c.name || '课').slice(0, 1),
          teacherText: teachers.join('、') || '待定',
          timeText: schedules.map((s) => s.slot_name).join('、') || '待定',
          venueText: schedules.map((s) => s.venue_name).join('、') || '待定',
          statusText: st.text,
          statusClass: st.cls,
          action,
          actionText,
          reason,
        });
        // 报名前预检：展示明确冲突/范围/上限原因
        if (!c.enrolled && c.status === 'OPEN' && c.remaining > 0) {
          request({ url: '/api/courses/' + id + '/eligibility', method: 'GET' })
            .then((el) => {
              if (el && el.eligible === false && el.reason) {
                this.setData({ action: 'disabled', actionText: '无法报名', reason: el.reason });
              }
            })
            .catch(() => {});
        }
      })
      .catch((err) => toastError(err));
  },

  onEnroll() {
    const id = this.data.id;
    const key = 'mp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    this.setData({ loading: true });
    request({ url: '/api/courses/' + id + '/enroll', method: 'POST', data: { idempotency_key: key } })
      .then(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        this.setData({ loading: false });
        toastError(err);
      });
  },

  onWithdraw() {
    const id = this.data.id;
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
