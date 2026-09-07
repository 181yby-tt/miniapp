import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnrollmentRosterSheets } from '../src/utils/enrollmentRosterExport.js';
import writeExcelFile from 'write-excel-file/node';
import readExcelFile from 'read-excel-file/node';

test('真实 XLSX 包含已报名和未报名两个 sheet，学号保留前导零', async () => {
  const roster = {
    enrolled: [{ student_no: '000123', name: '学生甲', grade: '初一', class_name: '1班', course_name: '篮球', teachers: '老师甲', time: '周一第1节', venue: '球场', enrolled_at: '2026-09-07T01:00:00.000Z' }],
    unenrolled: [{ student_no: '000124', name: '=测试姓名', grade: '初一', class_name: '2班' }],
  };
  const sheets = buildEnrollmentRosterSheets(roster);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ['已报名', '未报名']);
  const buffer = await writeExcelFile(sheets).toBuffer();
  const workbook = await readExcelFile(buffer);
  const enrolled = workbook.find((sheet) => sheet.sheet === '已报名').data;
  const unenrolled = workbook.find((sheet) => sheet.sheet === '未报名').data;
  assert.deepEqual(enrolled[0].slice(0, 4), ['学号', '姓名', '年级', '班级']);
  assert.equal(enrolled[1][0], '000123');
  assert.equal(enrolled[1][2], '初一');
  assert.equal(enrolled[1][3], '1班');
  assert.deepEqual(unenrolled[1], ['000124', '=测试姓名', '初一', '2班', '未报名']);
});

test('没有报名或全部已报时，两张表仍保留表头', () => {
  const sheets = buildEnrollmentRosterSheets({ enrolled: [], unenrolled: [] });
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].data.length, 1);
  assert.equal(sheets[1].data.length, 1);
});
