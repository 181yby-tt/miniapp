'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureFixedGrades, fixedGrades, canonicalGradeId, normalizeGradeName } = require('../src/fixed-grades');
test('固定三个年级，兼容旧名称且不改变关联编号', () => {
  const db = { grades: [{ id: 9, name: '七年级' }, { id: 10, name: '初二' }] };
  let next = 10;
  assert.equal(ensureFixedGrades(db, () => ++next), true);
  assert.deepEqual(fixedGrades(db).map((g) => g.name), ['初一', '初二', '初三']);
  assert.equal(fixedGrades(db)[0].id, 9);
  assert.equal(ensureFixedGrades(db, () => ++next), false);
  db.grades.push({ id: 20, name: '七年级' }, { id: 21, name: '初四' });
  assert.equal(canonicalGradeId(db, 20), 9);
  assert.equal(canonicalGradeId(db, 21), undefined);
  assert.equal(fixedGrades(db).length, 3);
  assert.equal(normalizeGradeName(' 八年级 '), '初二');
});
test('旧验收年级归入初一，保留学生账号、班级编号和未知年级资料', () => {
  const db = {
    grades: [{ id: 1, name: '七年级' }, { id: 2, name: '验收七年级' }, { id: 3, name: '其他' }],
    students: [{ id: 40, user_id: 42, grade_id: 2, class_id: 5 }, { id: 41, grade_id: 3 }],
    classes: [{ id: 5, grade_id: 2, name: '验收4班' }]
  };
  let next = 3;
  assert.equal(ensureFixedGrades(db, () => ++next), true);
  assert.deepEqual(db.students, [{ id: 40, user_id: 42, grade_id: 1, class_id: 5 }, { id: 41, grade_id: 3 }]);
  assert.deepEqual(db.classes, [{ id: 5, grade_id: 1, name: '验收4班' }]);
  assert.equal(canonicalGradeId(db, 2), 1);
  assert.equal(normalizeGradeName('验收七年级'), '');
  assert.equal(ensureFixedGrades(db, () => ++next), false);
});
