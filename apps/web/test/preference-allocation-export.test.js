import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreferenceAllocationSheet, safeFileName } from '../src/utils/preferenceAllocationExport.js';

const data = {
  group: {
    name: '初一体育 A 组', student_count: 2, submitted_count: 1,
    projects: [{ id: 10, name: '足球', capacity: 1 }, { id: 20, name: '篮球', capacity: 2 }],
  },
  students: [
    { id: 1, student_no: '2026001', name: '小明', class_name: '初一 1 班', submitted: true, choices: [10, 20] },
    { id: 2, student_no: '2026002', name: '小雨', class_name: '初一 1 班', submitted: false, choices: [] },
  ],
  results: [{ student_id: 1, course_id: 10, source_rank: 1, allocation_type: 'PREFERENCE', course: { name: '足球' } }],
};

test('allocation export includes project counts, choices and unresolved students', () => {
  const sheet = buildPreferenceAllocationSheet(data, new Date('2026-08-26T08:30:00+08:00'));
  assert.deepEqual(sheet[3].slice(0, 4).map((cell) => cell.value), ['项目', '计划人数', '已分配', '剩余名额']);
  assert.deepEqual(sheet[4].slice(0, 4).map((cell) => cell.value), ['足球', 1, 1, 0]);
  const detailHeaderIndex = sheet.findIndex((row) => row[0]?.value === '序号');
  assert.deepEqual(sheet[detailHeaderIndex + 1].map((cell) => cell.value), [1, '初一 1 班', '2026001', '小明', '足球', '篮球', '', '足球', '第 1 志愿']);
  assert.deepEqual(sheet[detailHeaderIndex + 2].slice(6).map((cell) => cell.value), ['', '待处理', '未提交']);
});

test('allocation export filename removes reserved characters', () => {
  assert.equal(safeFileName('初一/A:组?'), '初一-A-组-');
});
