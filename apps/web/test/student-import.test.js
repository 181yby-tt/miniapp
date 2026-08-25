import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudentSheet } from '../src/utils/studentImport.js';

test('parses common Chinese student headers and preserves numeric IDs', () => {
  const result = parseStudentSheet([
    ['学校学生名单'],
    ['学号', '姓名', '年级', '班级'],
    [20260101, '张三', '七年级', '1 班'],
  ]);
  assert.deepEqual(result.rows[0], {
    row_number: 3,
    student_no: '20260101',
    name: '张三',
    grade: '七年级',
    class_name: '1 班',
    password: '',
  });
});

test('accepts a student-number-only sheet and reports duplicates', () => {
  const result = parseStudentSheet([['学号'], ['A001'], ['A001'], ['A002']]);
  assert.deepEqual(result.rows.map((row) => row.student_no), ['A001', 'A002']);
  assert.equal(result.rows[0].name, 'A001');
  assert.equal(result.errors[0].row_number, 3);
});

test('requires a student number header', () => {
  assert.throws(() => parseStudentSheet([['姓名'], ['张三']]), /学号/);
});
