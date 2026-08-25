-- 课序 · 校本选课排课系统 — 生产环境 MySQL 8 建表
-- 与 server/src/store.js 内存模型逐字段一致；不超卖请用事务 + 唯一索引（见 store.js 的 flush）。
-- 字符集统一 utf8mb4；时间字段默认 CURRENT_TIMESTAMP。
-- 说明：allowed_scope_json / before_json / after_json 以 TEXT 存储（已是 JSON 字符串），
--       避免驱动层自动解析改类型，保证与内存字符串形态一致。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(64) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `user_type` ENUM('STUDENT','STAFF','ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'STUDENT',
  `status` ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `failed_login_count` INT NOT NULL DEFAULT 0,
  `locked_until` DATETIME DEFAULT NULL,
  `wechat_openid` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  KEY `uk_openid` (`wechat_openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `grades` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(32) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `classes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `grade_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(32) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`),
  KEY `idx_classes_grade` (`grade_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `students` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_no` VARCHAR(32) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `grade_id` BIGINT UNSIGNED NOT NULL,
  `class_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_student_no` (`student_no`),
  KEY `idx_students_user` (`user_id`),
  KEY `idx_students_grade` (`grade_id`),
  KEY `idx_students_class` (`class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `staff` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED DEFAULT NULL,
  `staff_no` VARCHAR(32) DEFAULT NULL,
  `name` VARCHAR(64) NOT NULL,
  `title` VARCHAR(64) DEFAULT NULL,
  `department` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('ACTIVE','INACTIVE') DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `course_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `venues` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL,
  `capacity` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `remark` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_venues_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `time_slots` (
  `id` VARCHAR(32) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `weekday` TINYINT NOT NULL COMMENT '1=周一..5=周五',
  `period` TINYINT NOT NULL COMMENT '第几节',
  `start_time` TIME DEFAULT NULL,
  `end_time` TIME DEFAULT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`),
  KEY `idx_slots_wd_period` (`weekday`,`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `courses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `category_id` BIGINT UNSIGNED NOT NULL,
  `description` TEXT,
  `cover_url` VARCHAR(255) DEFAULT NULL,
  `capacity` INT NOT NULL DEFAULT 0,
  `active_count` INT NOT NULL DEFAULT 0 COMMENT '已报名且未退课人数',
  `status` ENUM('DRAFT','OPEN','CLOSED','FINISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `enroll_start_at` DATETIME DEFAULT NULL COMMENT '报名开始时间',
  `enroll_end_at` DATETIME DEFAULT NULL COMMENT '报名结束时间',
  `course_start_date` DATE DEFAULT NULL COMMENT '课程开始日期',
  `course_end_date` DATE DEFAULT NULL COMMENT '课程结束日期',
  `allowed_scope_json` TEXT COMMENT '报名范围(JSON 字符串): {type:"all"|"grades"|"classes", ...}',
  `version` BIGINT NOT NULL DEFAULT 0 COMMENT '乐观锁，防并发改写',
  `created_by` BIGINT UNSIGNED DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_courses_status` (`status`),
  KEY `idx_courses_category` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `course_staff` (
  `course_id` BIGINT UNSIGNED NOT NULL,
  `staff_id` BIGINT UNSIGNED NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'TEACHER',
  PRIMARY KEY (`course_id`,`staff_id`),
  KEY `idx_cstaff_staff` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `course_schedules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `time_slot_id` VARCHAR(32) NOT NULL,
  `venue_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_csched_course` (`course_id`),
  KEY `idx_csched_slot` (`time_slot_id`),
  KEY `idx_csched_venue` (`venue_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `enrollments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id` BIGINT UNSIGNED NOT NULL,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('ENROLLED','WITHDRAWN','CANCELLED') NOT NULL DEFAULT 'ENROLLED',
  `source` VARCHAR(32) DEFAULT NULL COMMENT 'STUDENT/STAFF/SEED',
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `enrolled_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME DEFAULT NULL,
  `operated_by` BIGINT UNSIGNED DEFAULT NULL,
  `reason` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_enroll_student_course` (`student_id`,`course_id`),
  UNIQUE KEY `uk_idempotency` (`idempotency_key`),
  KEY `idx_enroll_course` (`course_id`),
  KEY `idx_enroll_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `system_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(64) NOT NULL,
  `config_value` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(32) NOT NULL DEFAULT 'string',
  `updated_by` BIGINT UNSIGNED DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_id` BIGINT UNSIGNED DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(32) DEFAULT NULL,
  `target_id` BIGINT UNSIGNED DEFAULT NULL,
  `before_json` TEXT DEFAULT NULL,
  `after_json` TEXT DEFAULT NULL,
  `ip` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_actor` (`actor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 免费版/个人版通过 CloudBase SDK 网关访问 MySQL 时使用。
-- A/B 两个主键槽位轮换写入，单行 upsert 原子完成并保留上一份有效快照。
CREATE TABLE IF NOT EXISTS `app_snapshots` (
  `snapshot_key` VARCHAR(64) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`snapshot_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始化系统配置（仅作兜底；应用空库时会用内置种子覆盖）
INSERT INTO `system_configs` (`config_key`,`config_value`,`value_type`) VALUES
  ('security.password_min_length','8','int'),
  ('student.max_active_courses','2','int'),
  ('student.max_courses_per_category','0','int'),
  ('enrollment.allow_withdraw_after_start','false','bool'),
  ('enrollment.allow_reenroll','true','bool'),
  ('security.login_max_failures','5','int'),
  ('security.lock_minutes','15','int')
ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`);

SET FOREIGN_KEY_CHECKS = 1;
