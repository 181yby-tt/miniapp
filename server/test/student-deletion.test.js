'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrollmentFixture } = require('./helpers/enrollment-fixture');
const { deletionPreview, deleteStudents } = require('../src/student-deletion');
const { teacherNames } = require('../src/course-teachers');

test('删除预览精确匹配学号，不因同名删除他人，重复项只计一次', () => {
  const { db } = enrollmentFixture();
  const before = structuredClone(db);
  const result = deletionPreview(db, ['001', '001', '1', '不存在']);
  assert.deepEqual(result.matches.map((s) => s.id), [1]);
  assert.deepEqual(result.not_found, ['1', '不存在']);
  assert.equal(result.duplicate_count, 1);
  assert.deepEqual(db, before);
  for (const invalid of [[], [1], [''], ['1'.repeat(33)], Array(3001).fill('1')]) assert.throws(() => deletionPreview(db, invalid));
});
test('删除账号、报名和旧志愿关联，并按有效报名重算名额', () => {
  const { db } = enrollmentFixture();
  db.enrollments = [{ id: 1, student_id: 1, course_id: 1, status: 'ENROLLED' }, { id: 2, student_id: 2, course_id: 1, status: 'ENROLLED' }, { id: 3, student_id: 1, course_id: 2, status: 'CANCELLED' }];
  db.courses[0].active_count = 2;
  db.preference_submissions = [{ id: 1, student_id: 1 }, { id: 2, student_id: 2 }];
  db.preference_choices = [{ submission_id: 1 }, { submission_id: 2 }];
  db.allocation_results = [{ student_id: 1 }, { student_id: 2 }];
  const preview = deletionPreview(db, ['001']);
  assert.equal(preview.release_count, 1);
  deleteStudents(db, preview);
  assert.ok(!db.users.some((u) => u.id === 1));
  assert.ok(!db.students.some((s) => s.id === 1));
  assert.equal(db.enrollments.length, 1);
  assert.equal(db.courses[0].active_count, 1);
  assert.equal(db.courses[1].active_count, 0);
  assert.deepEqual(db.preference_choices, [{ submission_id: 2 }]);
  assert.deepEqual(db.allocation_results, [{ student_id: 2 }]);
  assert.ok(db.users.some((u) => u.id === 1000));
});
test('异常账号关联拒绝删除，报名或账号变化使预览失效', () => {
  const { db } = enrollmentFixture();
  const before = deletionPreview(db, ['001']).digest;
  db.enrollments.push({ student_id: 1, course_id: 1, status: 'ENROLLED' });
  assert.notEqual(deletionPreview(db, ['001']).digest, before);
  db.students[0].user_id = 1000;
  assert.throws(() => deletionPreview(db, ['001']), /关联异常/);
});
test('教师自由文本优先，旧课程姓名兼容，主动清空不回填旧关联', () => {
  const { db } = enrollmentFixture();
  const course = db.courses[0];
  assert.deepEqual(teacherNames(db, course), ['测试教师1']);
  course.teacher_names = '李老师、王老师';
  assert.deepEqual(teacherNames(db, course), ['李老师', '王老师']);
  course.teacher_names = '';
  assert.deepEqual(teacherNames(db, course), []);
});
