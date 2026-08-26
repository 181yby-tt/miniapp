'use strict';

const crypto = require('crypto');

function score(seed, ...parts) {
  return crypto.createHash('sha256').update([seed, ...parts].join(':')).digest('hex');
}

function ordered(seed, label, items) {
  return items.slice().sort((left, right) => score(seed, label, left.id).localeCompare(score(seed, label, right.id)) || Number(left.id) - Number(right.id));
}

function allocatePreferences({ students, courses, preferenceCount = 2, allowAdjustment = false, seed }) {
  const courseIds = new Set(courses.map((course) => Number(course.id)));
  const remaining = new Map(courses.map((course) => [Number(course.id), Math.max(0, Number(course.capacity) || 0)]));
  const assignments = [];
  const assigned = new Set();

  for (let rank = 1; rank <= preferenceCount; rank += 1) {
    for (const course of courses) {
      const courseId = Number(course.id);
      const applicants = students.filter((student) => !assigned.has(Number(student.id)) && Number(student.choices?.[rank - 1]) === courseId);
      const winners = ordered(seed, `rank-${rank}-course-${courseId}`, applicants).slice(0, remaining.get(courseId));
      winners.forEach((student) => {
        assigned.add(Number(student.id));
        remaining.set(courseId, remaining.get(courseId) - 1);
        assignments.push({ student_id: Number(student.id), course_id: courseId, source_rank: rank, allocation_type: 'PREFERENCE' });
      });
    }
  }

  if (allowAdjustment) {
    for (const student of ordered(seed, 'adjustment', students.filter((item) => !assigned.has(Number(item.id))))) {
      const available = courses.filter((course) => remaining.get(Number(course.id)) > 0 && courseIds.has(Number(course.id)));
      if (!available.length) break;
      available.sort((left, right) => remaining.get(Number(right.id)) - remaining.get(Number(left.id)) || score(seed, `adjust-${student.id}`, left.id).localeCompare(score(seed, `adjust-${student.id}`, right.id)));
      const courseId = Number(available[0].id);
      remaining.set(courseId, remaining.get(courseId) - 1);
      assigned.add(Number(student.id));
      assignments.push({ student_id: Number(student.id), course_id: courseId, source_rank: null, allocation_type: 'ADJUSTED' });
    }
  }

  const unassigned = students.filter((student) => !assigned.has(Number(student.id))).map((student) => Number(student.id));
  return {
    assignments: assignments.sort((left, right) => left.student_id - right.student_id),
    unassigned,
    remaining: Object.fromEntries([...remaining.entries()]),
  };
}

module.exports = { allocatePreferences };
