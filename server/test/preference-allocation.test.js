'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { allocatePreferences } = require('../src/preference-allocation');

const students = [
  { id: 1, choices: [10, 30] }, { id: 2, choices: [10, 30] },
  { id: 3, choices: [10, 30] }, { id: 4, choices: [20, 10] },
];
const courses = [{ id: 10, capacity: 2 }, { id: 20, capacity: 1 }, { id: 30, capacity: 1 }];

test('allocation is reproducible, respects capacities and uses lower preferences', () => {
  const first = allocatePreferences({ students, courses, preferenceCount: 2, seed: 'school-2026' });
  const second = allocatePreferences({ students, courses, preferenceCount: 2, seed: 'school-2026' });
  assert.deepEqual(first, second);
  for (const course of courses) assert.ok(first.assignments.filter((item) => item.course_id === course.id).length <= course.capacity);
  assert.equal(new Set(first.assignments.map((item) => item.student_id)).size, first.assignments.length);
  assert.ok(first.assignments.some((item) => item.source_rank === 2));
});

test('adjustment fills remaining seats without over-allocation', () => {
  const result = allocatePreferences({ students: [{ id: 1, choices: [10] }, { id: 2, choices: [10] }], courses: [{ id: 10, capacity: 1 }, { id: 20, capacity: 1 }], preferenceCount: 1, allowAdjustment: true, seed: 'adjust' });
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments.filter((item) => item.allocation_type === 'ADJUSTED').length, 1);
  assert.deepEqual(result.unassigned, []);
});

test('students remain unassigned when total capacity is insufficient', () => {
  const result = allocatePreferences({ students, courses: [{ id: 10, capacity: 1 }], preferenceCount: 2, allowAdjustment: true, seed: 'small' });
  assert.equal(result.assignments.length, 1);
  assert.equal(result.unassigned.length, 3);
});
