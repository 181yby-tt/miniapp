'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { globalConflictCourseIds, studentConflicts, teacherConflicts, venueConflicts } = require('../src/schedule-conflicts');

function fixture() {
  return {
    courses: [
      { id: 1, name: '篮球基础', status: 'OPEN' },
      { id: 2, name: '合唱训练', status: 'DRAFT' },
      { id: 3, name: '历史课程', status: 'ARCHIVED' },
    ],
    staff: [{ id: 1, name: '陈老师' }, { id: 2, name: '李老师' }],
    course_staff: [{ course_id: 1, staff_id: 1 }, { course_id: 2, staff_id: 2 }, { course_id: 3, staff_id: 1 }],
    time_slots: [{ id: 'mon-1', name: '周一第 1 节' }, { id: 'tue-1', name: '周二第 1 节' }],
    venues: [
      { id: 10, name: '体育馆', parent_id: null },
      { id: 11, name: '体育馆 A 区', parent_id: 10 },
      { id: 20, name: '音乐室', parent_id: null },
    ],
    course_schedules: [
      { course_id: 1, time_slot_id: 'mon-1', venue_id: 11 },
      { course_id: 2, time_slot_id: 'tue-1', venue_id: 20 },
      { course_id: 3, time_slot_id: 'mon-1', venue_id: 10 },
    ],
    students: [{ id: 7, name: '小明' }],
    enrollments: [
      { student_id: 7, course_id: 1, status: 'ENROLLED' },
      { student_id: 7, course_id: 2, status: 'ENROLLED' },
    ],
  };
}

test('detects teacher overlap on the same time slot and ignores archived courses', () => {
  const db = fixture();
  const conflict = teacherConflicts(db, 99, [1], [{ time_slot_id: 'mon-1', venue_id: 20 }]);
  assert.equal(conflict.length, 1);
  assert.match(conflict[0].reason, /陈老师.*周一第 1 节.*篮球基础/);
  assert.equal(teacherConflicts(db, 99, [1], [{ time_slot_id: 'tue-1', venue_id: 20 }]).length, 0);
});

test('detects parent and child venue overlap only for the matching schedule pair', () => {
  const db = fixture();
  const conflict = venueConflicts(db, 99, [{ time_slot_id: 'mon-1', venue_id: 10 }]);
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].course_id, 1);

  const crossProductFalsePositive = venueConflicts(db, 99, [
    { time_slot_id: 'mon-1', venue_id: 20 },
    { time_slot_id: 'tue-1', venue_id: 10 },
  ]);
  assert.equal(crossProductFalsePositive.length, 0);
});

test('detects students whose existing selections would conflict after rescheduling', () => {
  const result = studentConflicts(fixture(), 1, [{ time_slot_id: 'tue-1', venue_id: 10 }]);
  assert.equal(result.count, 1);
  assert.deepEqual(result.students, ['小明']);
  assert.match(result.reasons[0], /小明.*合唱训练/);
});

test('global conflict scan uses exact time and venue pairs', () => {
  const db = fixture();
  assert.deepEqual([...globalConflictCourseIds(db)], []);
  db.course_staff.push({ course_id: 2, staff_id: 1 });
  db.course_schedules[1].time_slot_id = 'mon-1';
  assert.deepEqual([...globalConflictCourseIds(db)].sort(), [1, 2]);
});
