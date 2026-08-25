const BLUE = '#007AFF';
const TEXT = '#1D1D1F';
const MUTED = '#6E6E73';
const BORDER = '#D1D1D6';

const textCell = (value, extra = {}) => ({ value: String(value ?? ''), type: String, format: '@', ...extra });
const numberCell = (value, extra = {}) => ({ value: Number(value) || 0, type: Number, format: '#,##0', align: 'right', ...extra });
const headerCell = (value) => textCell(value, {
  fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: BLUE, align: 'center', height: 28,
});

const STATUS_LABELS = {
  OPEN: '开放报名', DRAFT: '尚未开放', CLOSED: '暂停报名', FINISHED: '课程结束', ARCHIVED: '历史课程',
};

export const ENROLLMENT_SUMMARY_COLUMNS = [
  { width: 8 }, { width: 24 }, { width: 16 }, { width: 20 }, { width: 24 }, { width: 22 },
  { width: 12 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 },
];

export function localDateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function summarizeEnrollmentCourses(courses = []) {
  const totalCapacity = courses.reduce((sum, course) => sum + (Number(course.capacity) || 0), 0);
  const totalEnrolled = courses.reduce((sum, course) => sum + (Number(course.active_count) || 0), 0);
  return {
    courseCount: courses.length,
    totalCapacity,
    totalEnrolled,
    remaining: Math.max(0, totalCapacity - totalEnrolled),
    fillRate: totalCapacity ? totalEnrolled / totalCapacity : 0,
  };
}

export function buildEnrollmentSummarySheet(courses = [], generatedAt = new Date()) {
  const summary = summarizeEnrollmentCourses(courses);
  const title = textCell('课程报课人数统计表', {
    columnSpan: 11, fontWeight: 'bold', fontSize: 18, textColor: TEXT, align: 'left', height: 34,
  });
  const generated = textCell(`生成时间：${generatedAt.toLocaleString('zh-CN', { hour12: false })}`, {
    columnSpan: 11, textColor: MUTED, fontSize: 10, height: 22,
  });
  const summaryCell = (label, value, span = 2) => textCell(`${label}：${value}`, {
    columnSpan: span, fontWeight: 'bold', backgroundColor: '#F2F2F7', textColor: TEXT, height: 26,
    borderColor: BORDER, bottomBorderStyle: 'thin',
  });
  const summaryRow = [
    summaryCell('课程数', summary.courseCount), null,
    summaryCell('总容量', summary.totalCapacity), null,
    summaryCell('已报名', summary.totalEnrolled), null,
    summaryCell('剩余名额', summary.remaining), null,
    summaryCell('总体报名率', `${Math.round(summary.fillRate * 100)}%`, 3), null, null,
  ];
  const headers = ['序号', '课程名称', '课程分类', '任课教师', '上课时间', '上课场地', '课程容量', '已报名人数', '剩余名额', '报名率', '课程状态'];
  const rows = courses.map((course, index) => {
    const capacity = Number(course.capacity) || 0;
    const enrolled = Number(course.active_count) || 0;
    const remaining = Math.max(0, capacity - enrolled);
    return [
      numberCell(index + 1),
      textCell(course.name),
      textCell(course.category || '未分类'),
      textCell(course.teachers?.join('、') || '尚未安排'),
      textCell(course.schedules?.map((item) => item.slot_name).filter(Boolean).join('；') || '尚未排课', { wrap: true }),
      textCell(course.schedules?.map((item) => item.venue_name).filter(Boolean).join('；') || '尚未安排', { wrap: true }),
      numberCell(capacity),
      numberCell(enrolled, { fontWeight: 'bold', textColor: enrolled >= capacity && capacity > 0 ? '#FF3B30' : TEXT }),
      numberCell(remaining),
      { value: capacity ? enrolled / capacity : 0, type: Number, format: '0%', align: 'right' },
      textCell(STATUS_LABELS[course.status] || course.status || '未知'),
    ];
  });
  return [
    [title, ...Array(10).fill(null)],
    [generated, ...Array(10).fill(null)],
    summaryRow,
    headers.map(headerCell),
    ...rows,
  ];
}
