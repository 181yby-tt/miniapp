const cell = (value) => ({ value: String(value ?? ''), type: String, format: '@' });

export function buildEnrollmentRosterSheets(roster) {
  const headers = ['学号', '姓名', '年级', '班级'];
  const identity = (row) => [row.student_no, row.name, row.grade, row.class_name];
  const sheet = (name, titles, rows) => ({
    sheet: name,
    stickyRowsCount: 1,
    columns: titles.map((title) => ({ width: ['课程', '上课时间', '上课场地', '报名时间'].includes(title) ? 28 : 18 })),
    data: [titles.map((title) => ({ ...cell(title), fontWeight: 'bold', backgroundColor: '#EAF1FA', height: 26 })), ...rows.map((row) => row.map(cell))],
  });
  return [
    sheet('已报名', [...headers, '课程', '任课老师', '上课时间', '上课场地', '报名时间'], (roster.enrolled || []).map((row) => [...identity(row), row.course_name, row.teachers, row.time, row.venue, row.enrolled_at ? new Date(row.enrolled_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : ''])),
    sheet('未报名', [...headers, '状态'], (roster.unenrolled || []).map((row) => [...identity(row), '未报名'])),
  ];
}

export async function downloadEnrollmentRoster(api, groupId, name = '学生报名名单') {
  const roster = await api.getEnrollmentRoster(groupId);
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  await writeExcelFile(buildEnrollmentRosterSheets(roster)).toFile(`${name.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`);
  return roster;
}
