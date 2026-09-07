'use strict';
function teacherNames(db, course) {
  if (!course) return [];
  if (course.teacher_names !== undefined && course.teacher_names !== null) return String(course.teacher_names).split(/[、,，;；\n]/).map((s) => s.trim()).filter(Boolean);
  return db.course_staff.filter((r) => r.course_id === course.id).map((r) => db.staff.find((s) => s.id === r.staff_id)?.name).filter(Boolean);
}
module.exports = { teacherNames };
