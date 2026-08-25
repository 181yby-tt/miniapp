import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnrollmentSummarySheet, localDateStamp, summarizeEnrollmentCourses } from '../src/utils/enrollmentSummaryExport.js';

const courses = [{
  name: '机器人创意', category: '科技', teachers: ['张老师'], capacity: 20, active_count: 13, status: 'OPEN',
  schedules: [{ slot_name: '周二第 8 节', venue_name: '创客室' }],
}, {
  name: '篮球基础', category: '体育', teachers: [], capacity: 20, active_count: 20, status: 'CLOSED', schedules: [],
}];

test('enrollment summary calculates totals without exceeding remaining seats', () => {
  assert.deepEqual(summarizeEnrollmentCourses(courses), {
    courseCount: 2, totalCapacity: 40, totalEnrolled: 33, remaining: 7, fillRate: 0.825,
  });
});

test('export filename date uses local calendar date instead of UTC date', () => {
  assert.equal(localDateStamp(new Date(2026, 7, 26, 0, 30)), '2026-08-26');
});

test('enrollment workbook contains teacher, schedule, capacity and enrollment counts', () => {
  const sheet = buildEnrollmentSummarySheet(courses, new Date('2026-08-26T08:30:00+08:00'));
  assert.deepEqual(sheet[3].map((cell) => cell.value), [
    '序号', '课程名称', '课程分类', '任课教师', '上课时间', '上课场地', '课程容量', '已报名人数', '剩余名额', '报名率', '课程状态',
  ]);
  assert.deepEqual(sheet[4].map((cell) => cell.value), [1, '机器人创意', '科技', '张老师', '周二第 8 节', '创客室', 20, 13, 7, 0.65, '开放报名']);
  assert.equal(sheet[5][7].textColor, '#FF3B30');
});
