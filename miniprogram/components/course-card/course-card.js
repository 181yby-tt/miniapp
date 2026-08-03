Component({
  properties: {
    course: { type: Object, value: {} },
    enrolled: { type: Boolean, value: false },
    showSeat: { type: Boolean, value: true },
  },
  data: {
    tone: 'mint',
    mark: '课',
    teacherText: '',
    pct: 0,
    disabled: false,
    btnText: '报名',
  },
  observers: {
    'course, enrolled': function () {
      this.recompute();
    },
  },
  methods: {
    recompute() {
      const c = this.data.course;
      if (!c || !c.id) return;
      const tones = ['mint', 'blue', 'amber', 'violet', 'coral', 'navy'];
      const pct = c.capacity ? Math.min(100, Math.round((c.active_count || 0) / c.capacity * 100)) : 0;
      const enrolled = !!this.data.enrolled;
      const remaining = c.remaining || 0;
      this.setData({
        tone: tones[c.id % tones.length],
        mark: (c.name || '课').slice(0, 1),
        teacherText: (c.teachers || []).join(' '),
        pct,
        disabled: remaining <= 0 || enrolled,
        btnText: enrolled ? '已报名' : remaining > 0 ? '报名' : '已满',
      });
    },
    onSelect() {
      this.triggerEvent('select', { id: this.data.course.id });
    },
    onEnroll() {
      this.triggerEvent('enroll', { id: this.data.course.id });
    },
  },
});
