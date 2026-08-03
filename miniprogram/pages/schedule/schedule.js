const { request } = require('../../utils/request');
const { toastError } = require('../../utils/auth');

const WEEK = ['周一', '周二', '周三', '周四', '周五'];
const TONES = ['mint', 'blue', 'amber', 'violet', 'coral', 'navy'];

Page({
  data: {
    week: WEEK,
    periods: [],
    cells: [], // 二维数组：[节次][星期] -> 课程块或 null
    listItems: [], // 列表视图：按星期+节次展开
    view: 'grid', // grid | list
    courseCount: 0,
    loading: false,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  switchView(e) {
    this.setData({ view: e.currentTarget.dataset.view });
  },

  load(done) {
    this.setData({ loading: true });
    request({ url: '/api/me/schedule', method: 'GET' })
      .then((data) => {
        const items = data.items || [];
        const periods = new Set();
        const grid = {};
        const listMap = {};
        items.forEach((it) => {
          const tone = TONES[(it.course_id || 0) % TONES.length];
          const teacherText = (it.teachers || []).join('、');
          (it.schedules || []).forEach((s) => {
            if (!s.weekday || !s.period) return;
            periods.add(s.period);
            grid[s.weekday + '-' + s.period] = {
              course_id: it.course_id,
              name: it.name,
              tone,
              teacher: teacherText,
              venue: s.venue_name,
            };
            const key = (s.weekday - 1) * 20 + s.period;
            listMap[key] = {
              course_id: it.course_id,
              weekday: s.weekday,
              weekdayText: WEEK[s.weekday - 1],
              period: s.period,
              name: it.name,
              tone,
              teacher: teacherText,
              venue: s.venue_name,
            };
          });
        });
        const ps = [...periods].sort((a, b) => a - b);
        const cells = ps.map((p) =>
          WEEK.map((_, wi) => grid[(wi + 1) + '-' + p] || null)
        );
        const listItems = Object.values(listMap).sort((a, b) => (a.weekday - b.weekday) || (a.period - b.period));
        this.setData({ periods: ps, cells, listItems, courseCount: items.length, loading: false });
        if (done) done();
      })
      .catch((err) => {
        this.setData({ loading: false });
        toastError(err);
        if (done) done();
      });
  },

  tapCell(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },
});
