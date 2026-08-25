'use strict';

function activeCourse(course) {
  return course && !['FINISHED', 'ARCHIVED'].includes(course.status);
}

function venueFamily(db, venueId) {
  const family = new Set();
  const queue = [Number(venueId)];
  while (queue.length) {
    const current = queue.shift();
    if (!current || family.has(current)) continue;
    family.add(current);
    const venue = db.venues.find((item) => item.id === current);
    if (venue?.parent_id) queue.push(Number(venue.parent_id));
    db.venues.forEach((item) => { if (Number(item.parent_id) === current) queue.push(Number(item.id)); });
  }
  return family;
}

function venueOverlaps(db, firstId, secondId) {
  const first = venueFamily(db, firstId);
  return [...venueFamily(db, secondId)].some((id) => first.has(id));
}

function slotName(db, slotId) {
  return db.time_slots.find((item) => String(item.id) === String(slotId))?.name || '该时间段';
}

function venueName(db, venueId) {
  return db.venues.find((item) => Number(item.id) === Number(venueId))?.name || '该场地';
}

function courseName(db, courseId) {
  return db.courses.find((item) => item.id === Number(courseId))?.name || `课程 ${courseId}`;
}

function teacherConflicts(db, courseId, staffIds, schedules) {
  if (!staffIds.length || !schedules.length) return [];
  const candidateSlots = new Set(schedules.map((item) => String(item.time_slot_id)));
  const results = [];
  db.courses.filter(activeCourse).forEach((course) => {
    if (course.id === Number(courseId)) return;
    const sharedStaffIds = db.course_staff
      .filter((item) => item.course_id === course.id && staffIds.includes(item.staff_id))
      .map((item) => item.staff_id);
    if (!sharedStaffIds.length) return;
    const overlap = db.course_schedules.find((item) => item.course_id === course.id && candidateSlots.has(String(item.time_slot_id)));
    if (!overlap) return;
    const teachers = sharedStaffIds.map((id) => db.staff.find((item) => item.id === id)?.name).filter(Boolean).join('、') || '任课教师';
    results.push({
      course_id: course.id,
      name: course.name,
      slot_name: slotName(db, overlap.time_slot_id),
      reason: `${teachers}在${slotName(db, overlap.time_slot_id)}已安排“${course.name}”`,
    });
  });
  return results;
}

function venueConflicts(db, courseId, schedules) {
  if (!schedules.length) return [];
  const results = new Map();
  db.courses.filter(activeCourse).forEach((course) => {
    if (course.id === Number(courseId)) return;
    const existingSchedules = db.course_schedules.filter((item) => item.course_id === course.id);
    for (const candidate of schedules) {
      const overlap = existingSchedules.find((item) => String(item.time_slot_id) === String(candidate.time_slot_id)
        && venueOverlaps(db, item.venue_id, candidate.venue_id));
      if (!overlap) continue;
      const result = {
        course_id: course.id,
        name: course.name,
        slot_name: slotName(db, candidate.time_slot_id),
        venue_name: venueName(db, candidate.venue_id),
        reason: `${slotName(db, candidate.time_slot_id)}的${venueName(db, candidate.venue_id)}与“${course.name}”占用的场地冲突`,
      };
      results.set(`${course.id}:${candidate.time_slot_id}:${candidate.venue_id}`, result);
    }
  });
  return [...results.values()];
}

function studentConflicts(db, courseId, schedules) {
  if (!schedules.length) return { count: 0, students: [], reasons: [] };
  const candidateSlots = new Set(schedules.map((item) => String(item.time_slot_id)));
  const affected = [];
  const reasons = [];
  db.enrollments.filter((item) => item.course_id === Number(courseId) && item.status === 'ENROLLED').forEach((enrollment) => {
    const otherCourseIds = db.enrollments
      .filter((item) => item.student_id === enrollment.student_id && item.course_id !== Number(courseId) && item.status === 'ENROLLED')
      .map((item) => item.course_id);
    const overlap = db.course_schedules.find((item) => otherCourseIds.includes(item.course_id) && candidateSlots.has(String(item.time_slot_id)));
    if (!overlap) return;
    const student = db.students.find((item) => item.id === enrollment.student_id);
    const studentName = student?.name || `学生 ${enrollment.student_id}`;
    affected.push(studentName);
    reasons.push(`${studentName}在${slotName(db, overlap.time_slot_id)}已报名“${courseName(db, overlap.course_id)}”`);
  });
  return { count: affected.length, students: affected.slice(0, 20), reasons: reasons.slice(0, 20) };
}

function globalConflictCourseIds(db) {
  const ids = new Set();
  const courses = db.courses.filter(activeCourse);
  for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < courses.length; rightIndex += 1) {
      const left = courses[leftIndex];
      const right = courses[rightIndex];
      const leftStaff = new Set(db.course_staff.filter((item) => item.course_id === left.id).map((item) => item.staff_id));
      const rightStaff = new Set(db.course_staff.filter((item) => item.course_id === right.id).map((item) => item.staff_id));
      const sharedTeacher = [...leftStaff].some((id) => rightStaff.has(id));
      const leftSchedules = db.course_schedules.filter((item) => item.course_id === left.id);
      const rightSchedules = db.course_schedules.filter((item) => item.course_id === right.id);
      const overlap = leftSchedules.some((first) => rightSchedules.some((second) => String(first.time_slot_id) === String(second.time_slot_id)
        && (sharedTeacher || venueOverlaps(db, first.venue_id, second.venue_id))));
      if (overlap) { ids.add(left.id); ids.add(right.id); }
    }
  }
  return ids;
}

module.exports = { globalConflictCourseIds, studentConflicts, teacherConflicts, venueConflicts, venueFamily, venueOverlaps };
