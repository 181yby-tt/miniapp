import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseSheet } from '../src/utils/courseImport.js';

const meta = {
  categories: [{ id: 1, name: '体育' }],
  staff: [{ id: 2, name: '张老师' }],
  venues: [{ id: 3, name: '体育馆' }],
  time_slots: [{ id: 'm1', name: '周一第 6 节', weekday: 1, period: 6 }],
};

test('merges repeated rows and teacher names without schedules', () => {
  const result = parseCourseSheet([
    ['课程名称', '分类', '容量', '教师', '星期', '节次', '场地', '状态'],
    ['篮球', '体育', 30, '张老师', '周一', '第6节', '体育馆', '开放报名'],
    ['篮球', '体育', 30, '张老师', '周一', '第6节', '体育馆', '开放报名'],
  ], meta);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, 'OPEN');
  assert.equal(result.rows[0].teacher_names, '张老师');
  assert.equal(result.rows[0].schedules, undefined);
});

test('accepts teacher names without staff accounts; ignores legacy schedule columns', () => {
  const result = parseCourseSheet([
    ['课程名称', '容量', '教师', '星期', '节次', '场地'],
    ['机器人', 20, '李老师', '周一', 6, '机房'],
  ], meta);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].teacher_names, '李老师');
});

test('省略选填列不覆盖已有课程的分类、报名范围、教师和状态', () => {
  const { rows } = parseCourseSheet([['课程名称', '课程容量'], ['篮球', 20]], meta);
  assert.deepEqual(rows, [{ name: '篮球', capacity: 20 }]);
});
