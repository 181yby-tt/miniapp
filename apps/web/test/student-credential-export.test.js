import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudentCredentialSheet } from '../src/utils/studentCredentialExport.js';

test('student account workbook includes class details and preserves IDs as text', () => {
  const sheet = buildStudentCredentialSheet([{
    name: '张三', student_no: '001234567890123456', grade: '七年级', class_name: '1 班',
    username: '001234567890123456', password: '12345678',
  }]);
  assert.deepEqual(sheet[0].map((cell) => cell.value), ['姓名', '学号', '年级', '班级', '登录账号', '初始密码']);
  assert.deepEqual(sheet[1].map((cell) => cell.value), ['张三', '001234567890123456', '七年级', '1 班', '001234567890123456', '12345678']);
  assert.equal(sheet[1][1].type, String);
  assert.equal(sheet[1][4].type, String);
});
