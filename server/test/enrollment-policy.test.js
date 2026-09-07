'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrollmentPolicy, courseEnrollmentScope } = require('../src/enrollment-policy');
const { createRequestGate } = require('../src/request-gate');
const { withStudentLock } = require('../src/redis');
const { enrollmentFixture } = require('./helpers/enrollment-fixture');

test('旧教学组与班级范围转成年级范围，旧状态不参与报名判断', () => {
  const { db } = enrollmentFixture();
  const course = db.courses[0];
  for (const status of ['DRAFT', 'CLOSED', 'ALLOCATED', 'PUBLISHED']) {
    db.teaching_groups[0].status = status;
    assert.equal(enrollmentPolicy(db, db.students[0], course).eligible, true);
  }
  db.teaching_group_courses = [];
  course.allowed_scope_json = JSON.stringify({ type: 'groups', groups: [1] });
  const byGroup = db.students.map((s) => enrollmentPolicy(db, s, course));
  course.allowed_scope_json = JSON.stringify({ type: 'classes', classes: db.teaching_group_classes.filter((r) => r.group_id === 1).map((r) => r.class_id) });
  assert.deepEqual(db.students.map((s) => enrollmentPolicy(db, s, course)), byGroup);
  course.allowed_scope_json = JSON.stringify({ type: 'groups', groups: [999] });
  assert.equal(enrollmentPolicy(db, db.students[0], course).code, 'STUDENT_SCOPE_MISMATCH');
});

test('同年级不同班级都可报名，其他年级被拒绝，班级资料保持不变', () => {
  const { db } = enrollmentFixture();
  const before = structuredClone(db.students);
  const course = db.courses[0];
  db.teaching_group_courses = [];
  course.allowed_scope_json = JSON.stringify({ type: 'classes', classes: [1] });
  assert.deepEqual(courseEnrollmentScope(db, course), { type: 'grades', grades: [1] });
  assert.equal(enrollmentPolicy(db, db.students[0], course).eligible, true); // 初一 2 班
  assert.equal(enrollmentPolicy(db, db.students[1], course).eligible, true); // 初一 3 班
  assert.equal(enrollmentPolicy(db, db.students[63], course).code, 'STUDENT_SCOPE_MISMATCH');
  assert.deepEqual(db.students, before);
  course.allowed_scope_json = JSON.stringify({ type: 'classes', classes: [99999] });
  assert.deepEqual(courseEnrollmentScope(db, course), { type: 'grades', grades: [] });
  assert.equal(enrollmentPolicy(db, db.students[0], course).code, 'STUDENT_SCOPE_MISMATCH');
});

test('验收年级迁移后，旧课程年级与教学组交集仍可报名', () => {
  const { db } = enrollmentFixture();
  const { ensureFixedGrades } = require('../src/fixed-grades');
  db.grades.push({ id: 90, name: '验收七年级' });
  db.classes.filter((c) => c.grade_id === 1).forEach((c) => { c.grade_id = 90; });
  db.students.filter((s) => s.grade_id === 1).forEach((s) => { s.grade_id = 90; });
  const course = db.courses[0];
  course.allowed_scope_json = JSON.stringify({ type: 'grades', grades: [90] });
  let next = 90;
  ensureFixedGrades(db, () => ++next);
  assert.deepEqual(courseEnrollmentScope(db, course), { type: 'grades', grades: [1] });
  assert.equal(enrollmentPolicy(db, db.students[0], course).eligible, true);
  assert.equal(enrollmentPolicy(db, db.students[63], course).code, 'STUDENT_SCOPE_MISMATCH');
});

test('开始时间包含边界，结束时间不包含边界', () => {
  const { db } = enrollmentFixture();
  const course = db.courses[0];
  course.enroll_start_at = '2026-09-07T01:00:00.000Z';
  course.enroll_end_at = '2026-09-07T02:00:00.000Z';
  const check = (time) => enrollmentPolicy(db, db.students[0], course, { now: Date.parse(time) });
  assert.equal(check(course.enroll_start_at).eligible, true);
  assert.equal(check(course.enroll_end_at).code, 'ENROLLMENT_ENDED');
  assert.equal(check('2026-09-07T00:59:59.999Z').code, 'ENROLLMENT_NOT_STARTED');
});

test('无 Redis 时同一个学生依然串行，异常后锁可继续使用', async () => {
  let active = 0;
  let max = 0;
  await Promise.all(Array.from({ length: 20 }, () => withStudentLock(100, async () => {
    active++; max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 1)); active--;
  })));
  assert.equal(max, 1);
  await assert.rejects(withStudentLock(100, () => { throw new Error('数据库故障'); }));
  assert.equal(await withStudentLock(100, () => 'ok'), 'ok');
});

test('管理写入等待在途报名，后续报名等待管理写入，读锁可以并发', async () => {
  const acquire = createRequestGate();
  const releaseA = await acquire(false);
  const releaseB = await acquire(false);
  const events = [];
  const writer = acquire(true).then((release) => { events.push('writer'); return release; });
  const next = acquire(false).then((release) => { events.push('next'); return release; });
  releaseA(); await Promise.resolve(); assert.deepEqual(events, []);
  releaseB(); const releaseWriter = await writer; assert.deepEqual(events, ['writer']);
  releaseWriter(); const releaseNext = await next; assert.deepEqual(events, ['writer', 'next']); releaseNext();
});
