const { request } = require('../../utils/request');
const { toastError } = require('../../utils/auth');

Page({
  data: {
    courses: [],
    categories: [],
    search: '',
    selectedCategory: '',
    onlyAvailable: false,
    selectedCount: 0,
    maxCount: 2,
    openCount: 0,
    loading: false,
  },

  onShow() {
    this.loadCourses();
    this.loadMine();
  },

  onPullDownRefresh() {
    Promise.all([this.loadCourses(), this.loadMine()]).then(() => wx.stopPullDownRefresh());
  },

  loadCourses() {
    this.setData({ loading: true });
    const q = this.data.search.trim();
    const url = '/api/courses?open=1' + (q ? '&q=' + encodeURIComponent(q) : '') + (this.data.selectedCategory ? '&category=' + encodeURIComponent(this.data.selectedCategory) : '');
    return request({ url })
      .then((data) => {
        const items = this.data.onlyAvailable ? data.items.filter((c) => c.remaining > 0) : data.items;
        this.setData({
          courses: items,
          categories: data.categories || [],
          openCount: data.items.length,
          loading: false,
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        toastError(err);
      });
  },

  onToggleAvailable() {
    this.setData({ onlyAvailable: !this.data.onlyAvailable });
    this.loadCourses();
  },

  loadMine() {
    return request({ url: '/api/me/enrollments', method: 'GET' })
      .then((data) => {
        this.setData({ selectedCount: (data.items || []).length, maxCount: data.max_active || 2 });
      })
      .catch(() => {});
  },

  onSearch(e) {
    this.setData({ search: e.detail.value });
    this.loadCourses();
  },

  onCat(e) {
    this.setData({ selectedCategory: e.currentTarget.dataset.cat });
    this.loadCourses();
  },

  reload() {
    this.loadCourses();
  },

  onSelect(e) {
    const id = e.detail.id;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  onEnroll(e) {
    const id = e.detail.id;
    const idempotencyKey = 'mp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    wx.showLoading({ title: '报名中', mask: true });
    request({ url: '/api/courses/' + id + '/enroll', method: 'POST', data: { idempotency_key: idempotencyKey } })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.loadCourses();
        this.loadMine();
      })
      .catch((err) => {
        wx.hideLoading();
        toastError(err);
      });
  },
});
