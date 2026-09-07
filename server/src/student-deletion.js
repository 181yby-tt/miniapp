'use strict';
const crypto = require('node:crypto');
function deletionPreview(db, numbers) {
  if (!Array.isArray(numbers) || !numbers.length || numbers.length > 3000 || numbers.some((n) => typeof n !== 'string' || !n.trim() || n.trim().length > 32)) throw new Error('请提供 1 至 3000 个有效学号，学号按文本填写');
  const studentNos = [...new Set(numbers.map((n) => n.trim()))];
  const matches = db.students.filter((s) => studentNos.includes(s.student_no)).map((s) => {
    const user = db.users.find((u) => u.id === s.user_id);
    if (user && (user.user_type !== 'STUDENT' || db.students.some((other) => other.id !== s.id && other.user_id === user.id))) throw new Error('学生账号关联异常，请先检查资料，未执行删除');
    return { id:s.id, user_id:s.user_id, student_no:s.student_no, name:s.name, grade:db.grades.find((g) => g.id === s.grade_id)?.name || '', class_name:db.classes.find((c) => c.id === s.class_id)?.name || '', enrolled_count:db.enrollments.filter((e) => e.student_id === s.id && e.status === 'ENROLLED').length };
  });
  const ids = new Set(matches.map((s) => s.id));
  const records = db.enrollments.filter((e) => ids.has(e.student_id));
  const accounts = matches.map((s) => db.users.find((u) => u.id === s.user_id));
  const digest = crypto.createHash('sha256').update(JSON.stringify({matches,records,accounts})).digest('hex');
  return { student_nos:studentNos, matches, not_found:studentNos.filter((n) => !matches.some((s) => s.student_no === n)), duplicate_count:numbers.length-studentNos.length, release_count:matches.reduce((n,s) => n+s.enrolled_count,0), digest };
}
function deleteStudents(db, preview) {
  const ids = new Set(preview.matches.map((s) => s.id)), users = new Set(preview.matches.map((s) => s.user_id));
  const affected = new Set(db.enrollments.filter((e) => ids.has(e.student_id)).map((e) => e.course_id));
  const submissions = new Set(db.preference_submissions.filter((s) => ids.has(s.student_id)).map((s) => s.id));
  db.students = db.students.filter((s) => !ids.has(s.id));
  db.users = db.users.filter((u) => !users.has(u.id));
  db.enrollments = db.enrollments.filter((e) => !ids.has(e.student_id));
  db.preference_submissions = db.preference_submissions.filter((s) => !ids.has(s.student_id));
  db.preference_choices = db.preference_choices.filter((s) => !submissions.has(s.submission_id));
  db.allocation_results = db.allocation_results.filter((s) => !ids.has(s.student_id));
  for (const course of db.courses.filter((c) => affected.has(c.id))) {
    course.active_count = db.enrollments.filter((e) => e.course_id === course.id && e.status === 'ENROLLED').length;
    course.version += 1;
  }
}
module.exports = { deletionPreview, deleteStudents };
