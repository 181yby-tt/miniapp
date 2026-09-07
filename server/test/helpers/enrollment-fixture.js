'use strict';
const { hashPassword } = require('../../src/auth');

function enrollmentFixture() {
  const passwordHash = hashPassword('TestOnly123!');
  const users = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, username: `test${i + 1}`, password_hash: passwordHash, user_type: 'STUDENT', status: 'ACTIVE', must_change_password: false }));
  users.push({ id: 1000, username: 'test-teacher', password_hash: passwordHash, user_type: 'SUPER_ADMIN', status: 'ACTIVE', must_change_password: false });
  const db = {
    users,
    students: users.filter((u) => u.user_type === 'STUDENT').map((u) => ({ id: u.id, user_id: u.id, student_no: `00${u.id}`, name: `测试学生${u.id}`, grade_id: u.id === 64 ? 2 : 1, class_id: u.id === 64 ? 4 : (u.id % 3) + 1, status: 'ACTIVE' })),
    grades: [{ id: 1, name: '初一', status: 'ACTIVE' }, { id: 2, name: '初二', status: 'ACTIVE' }],
    classes: [1, 2, 3, 4].map((id) => ({ id, grade_id: id === 4 ? 2 : 1, name: `${id}班`, status: 'ACTIVE' })),
    courses: [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `测试课程${id}`, category_id: 1, capacity: 20, active_count: 0, status: 'OPEN', version: 1, allowed_scope_json: '{"type":"all"}', enroll_start_at: id === 5 ? '2099-01-01T00:00:00.000Z' : null, enroll_end_at: id === 6 ? '2020-01-01T00:00:00.000Z' : null })),
    course_categories: [{ id: 1, name: '体育', status: 'ACTIVE' }],
    course_staff: [1, 2, 3, 4, 5, 6].map((id) => ({ course_id: id, staff_id: id, role: 'TEACHER' })),
    staff: [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `测试教师${id}`, status: 'ACTIVE' })),
    course_schedules: [1, 2, 3, 4, 5, 6].map((id) => ({ id, course_id: id, time_slot_id: `slot${id === 4 ? 2 : id}`, venue_id: id })),
    time_slots: [1, 2, 3, 4, 5, 6].map((id) => ({ id: `slot${id}`, weekday: 1, period: id, name: `周一第${id}节`, status: 'ACTIVE' })),
    venues: [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `测试场地${id}`, status: 'ACTIVE' })),
    teaching_groups: [{ id: 1, name: '初一教学组', grade_id: 1, status: 'OPEN', preference_count: 3, allow_adjustment: 0 }],
    teaching_group_classes: [1, 2, 3].map((class_id) => ({ group_id: 1, class_id })),
    teaching_group_courses: [1, 2, 3, 4, 5, 6].map((course_id) => ({ group_id: 1, course_id })),
    enrollments: [], preference_submissions: [], preference_choices: [], allocation_runs: [], allocation_results: [], audit_logs: [],
    system_configs: [['student.max_active_courses', '1', 'int'], ['student.max_courses_per_category', '0', 'int'], ['enrollment.allow_reenroll', 'true', 'bool'], ['enrollment.allow_withdraw_after_start', 'false', 'bool']].map(([config_key, config_value, value_type]) => ({ config_key, config_value, value_type })),
  };
  const seq = Object.fromEntries(Object.entries(db).map(([key, values]) => [key, Math.max(0, ...values.map((row) => typeof row.id === 'number' ? row.id : 0))]));
  return { db, seq };
}
module.exports = { enrollmentFixture };
