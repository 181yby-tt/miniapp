'use strict';
const { teacherNames } = require('./course-teachers');

function buildEnrollmentRoster(db, groupId) {
  const classes = groupId ? new Set(db.teaching_group_classes.filter((row) => row.group_id === groupId).map((row) => row.class_id)) : null;
  const enrolled = [];
  const unenrolled = [];
  const students = db.students.filter((student) => student.status === 'ACTIVE' && (!classes || classes.has(student.class_id)));
  for (const student of students) {
    const identity = { student_id: student.id, student_no: student.student_no, name: student.name, grade: db.grades.find((row) => row.id === student.grade_id)?.name || '', class_name: db.classes.find((row) => row.id === student.class_id)?.name || '' };
    const active = db.enrollments.filter((row) => row.student_id === student.id && row.status === 'ENROLLED');
    if (!active.length) unenrolled.push({ ...identity, status: '未报名' });
    for (const record of active) {
      const course = db.courses.find((row) => row.id === record.course_id);
      const schedules = db.course_schedules.filter((row) => row.course_id === record.course_id);
      enrolled.push({ ...identity, course_id: record.course_id, course_name: course?.name || '历史课程', teachers: teacherNames(db, course).join('、'), time: '学校统一安排', venue: '', enrolled_at: record.enrolled_at, status: '已报名' });
    }
  }
  const order = (a, b) => `${a.grade}|${a.class_name}|${a.student_no}|${a.course_name || ''}`.localeCompare(`${b.grade}|${b.class_name}|${b.student_no}|${b.course_name || ''}`, 'zh-CN', { numeric: true });
  return { enrolled: enrolled.sort(order), unenrolled: unenrolled.sort(order), student_count: students.length, enrolled_student_count: new Set(enrolled.map((row) => row.student_id)).size, generated_at: new Date().toISOString() };
}
module.exports = { buildEnrollmentRoster };
