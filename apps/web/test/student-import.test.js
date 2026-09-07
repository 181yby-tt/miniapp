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
    grade: '初一',
    class_name: '1 班',
  });
});

test('reports duplicate student numbers', () => {
  const result = parseStudentSheet([['学号', '姓名', '年级'], ['A001', '甲', '初一'], ['A001', '乙', '初二'], ['A002', '丙', '初三']]);
  assert.deepEqual(result.rows.map((row) => row.student_no), ['A001', 'A002']);
  assert.equal(result.rows[0].name, '甲');
  assert.equal(result.errors[0].row_number, 3);
});

test('requires a student number header', () => {
  assert.throws(() => parseStudentSheet([['姓名'], ['张三']]), /学号/);
});

test('requires a student name header', () => {
  assert.throws(() => parseStudentSheet([['学号'], ['A001']]), /姓名/);
});

test('固定年级拒绝空值和未知名称，保留班级信息', () => {
  const result = parseStudentSheet([['学号', '姓名', '年级', '班级'], ['1', '甲', '初四', '1班'], ['2', '乙', '', '2班'], ['3', '丙', '九年级', '3班']]);
  assert.equal(result.errors.length, 2);
  assert.equal(result.rows[0].grade, '初三');
  assert.equal(result.rows[0].class_name, '3班');
  assert.throws(() => parseStudentSheet([['学号', '姓名'], ['1', '甲']]), /年级/);
});
