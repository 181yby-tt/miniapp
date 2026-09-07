'use strict';
const { canonicalGradeId } = require('./fixed-grades');

// 将旧版隐式关联显示为普通范围；保存课程后移除旧关联。
function legacyEnrollmentScope(db, course) {
  const scope = typeof course.allowed_scope_json === 'string' ? JSON.parse(course.allowed_scope_json) : course.allowed_scope_json || { type: 'all' };
  const groups = scope.type === 'groups' ? (scope.groups || []).map(Number) : (db.teaching_group_courses || []).filter((row) => row.course_id === course.id).map((row) => row.group_id);
  if (scope.type === 'groups' && !groups.length) return { type: 'classes', classes: [] };
  if (!groups.length) return scope;
  const classes = db.classes.filter((item) => db.teaching_group_classes.some((row) => groups.includes(row.group_id) && row.class_id === item.id));
  const gradeIds = (scope.grades || []).map((id) => canonicalGradeId(db, id)).filter((id) => id !== undefined);
  return { type: 'classes', classes: classes.filter((item) => ['all', 'groups'].includes(scope.type) || (scope.type === 'classes' ? scope.classes?.map(Number).includes(item.id) : scope.type === 'grades' && gradeIds.includes(canonicalGradeId(db, item.grade_id)))).map((item) => item.id) };
}

// 旧班级/教学组范围按所属年级兼容；班级资料仍供名单导出使用。
function courseEnrollmentScope(db, course) {
  const scope = legacyEnrollmentScope(db, course);
  if (!['classes', 'grades'].includes(scope.type)) return scope;
  const ids = new Set((scope.classes || []).map(Number));
  const grades = scope.type === 'grades' ? scope.grades || [] : db.classes.filter((c) => ids.has(c.id)).map((c) => c.grade_id);
  return { type: 'grades', grades: [...new Set(grades.map((id) => canonicalGradeId(db, id)).filter((id) => id !== undefined))] };
}

// 浏览、资格预检和报名使用同一套规则。未报名不会触发自动分配。
function enrollmentPolicy(db, student, course, { now = Date.now(), staff = false } = {}) {
  const deny = (code, reason) => ({ eligible: false, code, reason });
  const config = (key, fallback) => db.system_configs.find((row) => row.config_key === key)?.config_value ?? fallback;
  if (!student || student.status !== 'ACTIVE') return deny('STUDENT_INACTIVE', '学生资料不存在或已停用');
  if (!course) return deny('NOT_FOUND', '课程不存在');
  let scope;
  try { scope = courseEnrollmentScope(db, course); }
  catch { return deny('STUDENT_SCOPE_MISMATCH', '课程报名范围配置有误'); }
  if (scope && scope.type !== 'all' && !(scope.type === 'grades' && scope.grades?.map(Number).includes(canonicalGradeId(db, student.grade_id))) && !(scope.type === 'classes' && scope.classes?.map(Number).includes(student.class_id)) && !(scope.type === 'groups' && db.teaching_group_classes.some((row) => scope.groups?.map(Number).includes(row.group_id) && row.class_id === student.class_id))) return deny('STUDENT_SCOPE_MISMATCH', '该课程不在你的可报名范围内');
  if (course.status !== 'OPEN') return deny('COURSE_NOT_OPEN', '课程未开放报名');
  if (!staff && course.enroll_start_at && now < new Date(course.enroll_start_at).getTime()) return deny('ENROLLMENT_NOT_STARTED', '报名尚未开始');
  if (!staff && course.enroll_end_at && now >= new Date(course.enroll_end_at).getTime()) return deny('ENROLLMENT_ENDED', '报名已结束');
  const active = db.enrollments.filter((row) => row.student_id === student.id && row.status === 'ENROLLED');
  if (active.some((row) => row.course_id === course.id)) return deny('ALREADY_ENROLLED', '你已报名该课程');
  if (config('enrollment.allow_reenroll', 'true') !== 'true' && db.enrollments.some((row) => row.student_id === student.id && row.course_id === course.id)) return deny('REENROLL_DISABLED', '退课后不能重新报名该课程');
  if (active.length >= Number(config('student.max_active_courses', '2'))) return deny('STUDENT_LIMIT_REACHED', `每名学生最多报名 ${config('student.max_active_courses', '2')} 门课程`);
  const categoryLimit = Number(config('student.max_courses_per_category', '0'));
  if (categoryLimit > 0 && active.filter((row) => db.courses.find((item) => item.id === row.course_id)?.category_id === course.category_id).length >= categoryLimit) return deny('STUDENT_LIMIT_REACHED', `该分类最多报名 ${categoryLimit} 门课程`);
  if (Number(course.active_count) >= Number(course.capacity)) return deny('COURSE_FULL', '课程名额已满');
  return { eligible: true };
}

function inEnrollmentScope(db, student, course) {
  if (!student) return false;
  const result = enrollmentPolicy(db, student, course);
  return !['STUDENT_SCOPE_MISMATCH', 'STUDENT_INACTIVE', 'NOT_FOUND'].includes(result.code);
}

module.exports = { enrollmentPolicy, inEnrollmentScope, courseEnrollmentScope };
