const BLUE = '#007AFF';
const TEXT = '#1D1D1F';
const MUTED = '#6E6E73';
const BORDER = '#D1D1D6';

const textCell = (value, extra = {}) => ({ value: String(value ?? ''), type: String, format: '@', ...extra });
const numberCell = (value, extra = {}) => ({ value: Number(value) || 0, type: Number, format: '#,##0', align: 'right', ...extra });
const headerCell = (value) => textCell(value, { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: BLUE, align: 'center', height: 28 });

export const PREFERENCE_ALLOCATION_COLUMNS = [
  { width: 8 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 22 },
  { width: 22 }, { width: 22 }, { width: 22 }, { width: 16 },
];

export function safeFileName(value) {
  return String(value || '教学组').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
}

export function buildPreferenceAllocationSheet(data, generatedAt = new Date()) {
  const group = data.group;
  const projects = group.projects || [];
  const resultsByStudent = new Map((data.results || []).map((item) => [Number(item.student_id), item]));
  const projectById = new Map(projects.map((item) => [Number(item.id), item]));
  const assignedCount = new Map(projects.map((item) => [Number(item.id), 0]));
  (data.results || []).forEach((item) => assignedCount.set(Number(item.course_id), (assignedCount.get(Number(item.course_id)) || 0) + 1));

  const title = textCell(`${group.name} 体育项目分配表`, { columnSpan: 9, fontWeight: 'bold', fontSize: 18, textColor: TEXT, height: 34 });
  const generated = textCell(`生成时间：${generatedAt.toLocaleString('zh-CN', { hour12: false })}`, { columnSpan: 9, textColor: MUTED, fontSize: 10, height: 22 });
  const summary = textCell(`组内学生 ${group.student_count} 人 · 已提交 ${group.submitted_count} 人 · 已分配 ${(data.results || []).length} 人 · 待处理 ${Math.max(0, group.student_count - (data.results || []).length)} 人`, {
    columnSpan: 9, fontWeight: 'bold', backgroundColor: '#F2F2F7', borderColor: BORDER, bottomBorderStyle: 'thin', height: 28,
  });
  const projectHeaders = ['项目', '计划人数', '已分配', '剩余名额', '', '', '', '', ''].map(headerCell);
  const projectRows = projects.map((project) => {
    const count = assignedCount.get(Number(project.id)) || 0;
    return [textCell(project.name, { fontWeight: 'bold' }), numberCell(project.capacity), numberCell(count), numberCell(Math.max(0, Number(project.capacity) - count)), ...Array(5).fill(null)];
  });
  const detailHeaders = ['序号', '班级', '学号', '姓名', '第一志愿', '第二志愿', '第三志愿', '最终分配', '分配依据'].map(headerCell);
  const detailRows = (data.students || []).slice().sort((left, right) => `${left.class_name}${left.student_no}`.localeCompare(`${right.class_name}${right.student_no}`, 'zh-CN')).map((student, index) => {
    const result = resultsByStudent.get(Number(student.id));
    const choiceName = (rank) => projectById.get(Number(student.choices?.[rank]))?.name || '';
    return [
      numberCell(index + 1), textCell(student.class_name), textCell(student.student_no), textCell(student.name),
      textCell(choiceName(0)), textCell(choiceName(1)), textCell(choiceName(2)),
      textCell(result?.course?.name || '待处理', { fontWeight: 'bold', textColor: result ? TEXT : '#FF3B30' }),
      textCell(result ? (result.allocation_type === 'ADJUSTED' ? '统一调剂' : `第 ${result.source_rank} 志愿`) : (student.submitted ? '未分配' : '未提交')),
    ];
  });
  return [
    [title, ...Array(8).fill(null)],
    [generated, ...Array(8).fill(null)],
    [summary, ...Array(8).fill(null)],
    projectHeaders,
    ...projectRows,
    Array(9).fill(null),
    detailHeaders,
    ...detailRows,
  ];
}
