SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM `audit_logs`;
DELETE FROM `enrollments`;
DELETE FROM `course_schedules`;
DELETE FROM `course_staff`;
DELETE FROM `courses`;
DELETE FROM `time_slots`;
DELETE FROM `venues`;
DELETE FROM `course_categories`;
DELETE FROM `staff`;
DELETE FROM `students`;
DELETE FROM `classes`;
DELETE FROM `grades`;
DELETE FROM `users` WHERE `user_type` IN ('STUDENT', 'STAFF');

ALTER TABLE `audit_logs` AUTO_INCREMENT = 1;
ALTER TABLE `enrollments` AUTO_INCREMENT = 1;
ALTER TABLE `course_schedules` AUTO_INCREMENT = 1;
ALTER TABLE `courses` AUTO_INCREMENT = 1;
ALTER TABLE `venues` AUTO_INCREMENT = 1;
ALTER TABLE `course_categories` AUTO_INCREMENT = 1;
ALTER TABLE `staff` AUTO_INCREMENT = 1;
ALTER TABLE `students` AUTO_INCREMENT = 1;
ALTER TABLE `classes` AUTO_INCREMENT = 1;
ALTER TABLE `grades` AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS = 1;
