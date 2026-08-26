'use strict';

/**
 * 选课排课后端：零依赖 Node http 服务，实现志愿填报、统一分配与排课核心逻辑。
 * - 志愿：学生按教学组提交 2–3 个有顺序的项目志愿，不按提交先后抢占名额。
 * - 分配：同一随机种子产生可复现结果，逐志愿分配并严格限制项目容量。
 * - 冲突：教师 / 场地 / 学生时间 / 班额硬冲突校验。
 * 生产环境的持久化约束见 docs/schema.sql。
 */

const http = require('http');
const fs = require('fs');
const pathlib = require('path');
const { URL } = require('url');
const { db, nextId, initStore, save, refreshEnrollmentState, persistEnrollmentMutation } = require('./store');
const { hashPassword, verifyPassword, sign, verify } = require('./auth');
const { code2Session } = require('./config');
const { initRedis, rateLimit, getJson, setJson, invalidate, withScheduleLock, withStudentLock } = require('./redis');
const scheduleConflicts = require('./schedule-conflicts');
const { allocatePreferences } = require('./preference-allocation');

const PORT = process.env.PORT || 3000;
const ADMIN_CONSOLE_FILE = pathlib.resolve(__dirname, '..', '..', 'admin-console.html');
const WEB_DIST_DIR = pathlib.resolve(process.env.WEB_DIST_DIR || pathlib.join(__dirname, '..', '..', 'apps', 'web', 'dist'));
const WEB_INDEX_FILE = pathlib.join(WEB_DIST_DIR, 'index.html');

// 异步初始化存储（MySQL 或文件模式），就绪后再监听端口
const storeReady = Promise.all([initStore(), initRedis()]);

/* ----------------------------- 工具 ----------------------------- */

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
  res.end(payload);
}

function ok(res, data) { send(res, 200, { code: 'OK', data }); }
function fail(res, code, message, status = 400, details = {}) { send(res, status, { code, message, request_id: `req_${Date.now()}`, details }); }

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || '';
}

async function enforceRateLimit(res, key, limit, seconds) {
  try {
    const result = await rateLimit(key, limit, seconds);
    if (result.allowed) return true;
    fail(res, 'RATE_LIMITED', `操作太频繁，请 ${result.retryAfter} 秒后再试`, 429, { retry_after: result.retryAfter });
    return false;
  } catch (error) {
    console.error('[限流] 检查失败，允许请求继续:', error.message);
    return true;
  }
}

function sendAdminConsole(res) {
  fs.readFile(ADMIN_CONSOLE_FILE, (err, html) => {
    if (err) return fail(res, 'ADMIN_CONSOLE_UNAVAILABLE', '管理后台页面不可用', 503);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    res.end(html);
  });
}

const WEB_MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function sendWebFile(res, file, cacheControl) {
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(err.code === 'ENOENT' ? 'Not found' : 'Web application unavailable');
    }
    res.writeHead(200, {
      'Content-Type': WEB_MIME_TYPES[pathlib.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    return res.end(content);
  });
}

function sendWebApp(res, requestPath) {
  const isBundledAsset = requestPath.startsWith('/assets/');
  const isPublicFile = Boolean(pathlib.extname(requestPath));
  if (isBundledAsset || isPublicFile) {
    const relative = requestPath.replace(/^\/+/, '');
    const file = pathlib.resolve(WEB_DIST_DIR, relative);
    if (!file.startsWith(`${WEB_DIST_DIR}${pathlib.sep}`)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad request');
    }
    return sendWebFile(res, file, isBundledAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
  }
  return sendWebFile(res, WEB_INDEX_FILE, 'no-cache');
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

// 进程内按 key 串行锁（模拟数据库行锁）
const locks = new Map();
function lock(key) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  locks.set(key, prev.then(() => next));
  return prev.then(() => release);
}

/* ----------------------------- 鉴权 ----------------------------- */

function getAuth(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verify(token);
  if (!payload) return null;
  const user = db.users.find((u) => u.id === payload.uid);
  return user && user.status !== 'DISABLED' ? user : null;
}

function audit(actorId, action, targetType, targetId, before, after, ip) {
  db.audit_logs.push({
    id: nextId('audit_logs'), actor_id: actorId, action, target_type: targetType, target_id: targetId,
    before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null,
    ip: ip || '', created_at: new Date().toISOString(),
  });
  save();
}

/* ----------------------------- 查询助手 ----------------------------- */

const getCourse = (id) => db.courses.find((c) => c.id === Number(id));
const getStudentByUser = (uid) => db.students.find((s) => s.user_id === uid);
const getStudent = (id) => db.students.find((s) => s.id === Number(id));

function courseTeachers(courseId) {
  return db.course_staff.filter((cs) => cs.course_id === courseId)
    .map((cs) => db.staff.find((s) => s.id === cs.staff_id))
    .filter(Boolean).map((s) => s.name);
}

function courseSchedules(courseId) {
  return db.course_schedules.filter((sc) => sc.course_id === courseId).map((sc) => {
    const slot = db.time_slots.find((t) => t.id === sc.time_slot_id);
    const venue = db.venues.find((v) => v.id === sc.venue_id);
    return { time_slot_id: sc.time_slot_id, venue_id: sc.venue_id, weekday: slot ? slot.weekday : null, period: slot ? slot.period : null, slot_name: slot ? slot.name : '', venue_name: venue ? venue.name : '' };
  });
}

function studentEnrollments(studentId, status) {
  return db.enrollments.filter((e) => e.student_id === studentId && (!status || e.status === status));
}

// 统计参与全局硬冲突（教师 / 场地时间重叠）的课程数量
function globalConflicts() {
  return scheduleConflicts.globalConflictCourseIds(db).size;
}

function courseToView(course, student) {
  const teachers = courseTeachers(course.id);
  const schedules = courseSchedules(course.id);
  const enrolled = student ? studentEnrollments(student.id, 'ENROLLED').some((e) => e.course_id === course.id) : false;
  const remaining = Math.max(0, course.capacity - course.active_count);
  return {
    id: course.id, name: course.name, category: (db.course_categories.find((c) => c.id === course.category_id) || {}).name || '',
    description: course.description, cover_url: course.cover_url, capacity: course.capacity, active_count: course.active_count,
    remaining, status: course.status, teachers, schedules,
    allowed_scope: course.allowed_scope_json ? JSON.parse(course.allowed_scope_json) : null,
    enrolled, version: course.version,
  };
}

function groupCourseIds(groupId) {
  return db.teaching_group_courses.filter((item) => item.group_id === Number(groupId)).map((item) => item.course_id);
}

function groupClassIds(groupId) {
  return db.teaching_group_classes.filter((item) => item.group_id === Number(groupId)).map((item) => item.class_id);
}

function groupStudents(groupId) {
  const classIds = new Set(groupClassIds(groupId));
  return db.students.filter((student) => student.status === 'ACTIVE' && classIds.has(student.class_id));
}

function groupForStudent(student) {
  if (!student) return null;
  const membership = db.teaching_group_classes.find((item) => item.class_id === student.class_id && db.teaching_groups.some((group) => group.id === item.group_id && group.status !== 'ARCHIVED'));
  return membership ? db.teaching_groups.find((group) => group.id === membership.group_id) : null;
}

function teachingGroupView(group) {
  const classIds = groupClassIds(group.id);
  const courseIds = groupCourseIds(group.id);
  const students = groupStudents(group.id);
  const submitted = db.preference_submissions.filter((item) => item.group_id === group.id && item.status === 'SUBMITTED').length;
  const grade = db.grades.find((item) => item.id === group.grade_id);
  return {
    ...group,
    grade_name: grade?.name || '',
    classes: classIds.map((id) => db.classes.find((item) => item.id === id)).filter(Boolean).map((item) => ({ id: item.id, name: item.name })),
    projects: courseIds.map((id) => getCourse(id)).filter(Boolean).map((course) => courseToView(course)),
    student_count: students.length,
    submitted_count: submitted,
    unsubmitted_count: Math.max(0, students.length - submitted),
    total_capacity: courseIds.reduce((total, id) => total + Number(getCourse(id)?.capacity || 0), 0),
  };
}

function currentPreferenceData(student) {
  const group = groupForStudent(student);
  if (!group) return { group: null, projects: [], submission: null, result: null };
  const submission = db.preference_submissions.find((item) => item.group_id === group.id && item.student_id === student.id && item.status === 'SUBMITTED');
  const choices = submission ? db.preference_choices.filter((item) => item.submission_id === submission.id).sort((a, b) => a.rank - b.rank).map((item) => item.course_id) : [];
  const publishedRun = db.allocation_runs.filter((item) => item.group_id === group.id && item.status === 'PUBLISHED').sort((a, b) => b.id - a.id)[0];
  const allocation = publishedRun ? db.allocation_results.find((item) => item.run_id === publishedRun.id && item.student_id === student.id) : null;
  return {
    group: teachingGroupView(group),
    projects: groupCourseIds(group.id).map((id) => getCourse(id)).filter(Boolean).map((course) => courseToView(course, student)),
    submission: submission ? { id: submission.id, choices, submitted_at: submission.submitted_at, updated_at: submission.updated_at } : null,
    result: allocation ? { ...allocation, course: courseToView(getCourse(allocation.course_id), student), published_at: publishedRun.published_at } : null,
  };
}

function getConfig(key, fallback) {
  const row = db.system_configs.find((c) => c.config_key === key);
  return row ? row.config_value : fallback;
}

/* ----------------------------- 业务校验 ----------------------------- */

function studentMatchesScope(student, scope) {
  if (!scope) return true;
  try {
    const s = typeof scope === 'string' ? JSON.parse(scope) : scope;
    if (s.type === 'all') return true;
    if (s.type === 'grades' && s.grades && s.grades.includes(student.grade_id)) return true;
    if (s.type === 'classes' && s.classes && s.classes.includes(student.class_id)) return true;
    return false;
  } catch { return false; }
}

// 同一学生已报名课程的时间槽集合（weekday-period）
function studentBusySlots(studentId) {
  const set = new Set();
  studentEnrollments(studentId, 'ENROLLED').forEach((e) => {
    courseSchedules(e.course_id).forEach((sc) => { if (sc.weekday && sc.period) set.add(`${sc.weekday}-${sc.period}`); });
  });
  return set;
}

// 场地冲突：展开场地互斥集合（自身+父+子）后按时段查重
function venueConflicts(courseId, schedules) {
  return scheduleConflicts.venueConflicts(db, courseId, schedules);
}

// 学生冲突：修改时间后，已报名学生是否与其他课程时间重叠
function studentConflicts(courseId, schedules) {
  return scheduleConflicts.studentConflicts(db, courseId, schedules);
}

/* ----------------------------- 报名 / 退课 ----------------------------- */

async function doEnroll(req, res, body, courseId, source, actorUser) {
  const student = source === 'STUDENT' ? getStudentByUser(actorUser.id) : getStudent(body.student_id);
  if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生不存在', 404);
  const release = await lock(`course:${courseId}`);
  try {
    return await withStudentLock(student.id, async () => {
      await refreshEnrollmentState(student.id, courseId);
      const course = getCourse(courseId);
      if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
      if (source === 'STUDENT' && course.status !== 'OPEN') return fail(res, 'COURSE_NOT_OPEN', '课程未开放报名');
      if (source === 'STAFF' && ['FINISHED', 'ARCHIVED'].includes(course.status)) return fail(res, 'COURSE_NOT_OPEN', '课程已结束或归档，无法代报名');

      const idemKey = body.idempotency_key || `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const idemRec = db.enrollments.find((item) => item.student_id === student.id && item.idempotency_key === idemKey && item.status === 'ENROLLED');
      if (idemRec) return ok(res, { enrollment: idemRec, course: courseToView(course, student), idempotent: true });
      const existing = db.enrollments.find((item) => item.student_id === student.id && item.course_id === course.id);
      if (existing && existing.status === 'ENROLLED') return fail(res, 'ALREADY_ENROLLED', '你已报名该课程');
      if (source === 'STUDENT' && !studentMatchesScope(student, course.allowed_scope_json)) return fail(res, 'STUDENT_SCOPE_MISMATCH', '该课程不在你的可报名范围内');

      const maxActive = parseInt(getConfig('student.max_active_courses', '2'), 10);
      if (studentEnrollments(student.id, 'ENROLLED').length >= maxActive) return fail(res, 'STUDENT_LIMIT_REACHED', `每名学生最多报名 ${maxActive} 门课程`);
      const maxPerCat = parseInt(getConfig('student.max_courses_per_category', '0'), 10);
      if (maxPerCat > 0) {
        const categoryCount = studentEnrollments(student.id, 'ENROLLED').filter((item) => getCourse(item.course_id)?.category_id === course.category_id).length;
        if (categoryCount >= maxPerCat) return fail(res, 'STUDENT_LIMIT_REACHED', `该分类最多报名 ${maxPerCat} 门课程`);
      }

      const busy = studentBusySlots(student.id);
      const conflictSlot = courseSchedules(course.id).find((slot) => slot.weekday && slot.period && busy.has(`${slot.weekday}-${slot.period}`));
      if (conflictSlot) {
        const clash = db.enrollments.find((item) => item.student_id === student.id && item.status === 'ENROLLED' && courseSchedules(item.course_id).some((slot) => slot.weekday === conflictSlot.weekday && slot.period === conflictSlot.period));
        return fail(res, 'STUDENT_TIME_CONFLICT', `与“${clash ? getCourse(clash.course_id).name : '其他课程'}”上课时间冲突`);
      }
      if (course.active_count >= course.capacity) return fail(res, 'COURSE_FULL', '课程名额已满');

      const now = new Date().toISOString();
      const rec = existing ? { ...existing } : { id: nextId('enrollments'), student_id: student.id, course_id: course.id };
      Object.assign(rec, { status: 'ENROLLED', source, idempotency_key: idemKey, enrolled_at: now, cancelled_at: null, operated_by: actorUser ? actorUser.id : null, reason: body.reason || null });
      const auditLog = { id: nextId('audit_logs'), actor_id: actorUser ? actorUser.id : student.user_id, action: source === 'STUDENT' ? 'ENROLL' : 'STAFF_ENROLL', target_type: 'course', target_id: course.id, before_json: null, after_json: JSON.stringify({ student_id: student.id }), ip: requestIp(req), created_at: now };
      const persisted = await persistEnrollmentMutation({ mode: 'enroll', courseId: course.id, enrollment: rec, auditLog });
      if (existing) Object.assign(existing, rec); else db.enrollments.push(rec);
      course.active_count = persisted.handled ? persisted.activeCount : course.active_count + 1;
      course.version = persisted.handled ? persisted.version : course.version + 1;
      db.audit_logs.push(auditLog);
      if (!persisted.handled) await save();
      await invalidate('open-courses');
      return ok(res, { enrollment: rec, course: courseToView(course, student) });
    });
  } catch (error) {
    if (error.code === 'BUSY_RETRY') return fail(res, error.code, error.message, 429);
    if (error.code === 'COURSE_FULL') return fail(res, error.code, error.message, 409);
    console.error('[报名] 写入失败:', error.message);
    return fail(res, 'ENROLL_FAILED', '报名没有完成，请重试', 500);
  } finally {
    release();
  }
}

async function doWithdraw(req, res, courseId, source, actorUser, body) {
  const student = source === 'STUDENT' ? getStudentByUser(actorUser.id) : getStudent(body.student_id);
  if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生不存在', 404);
  const release = await lock(`course:${courseId}`);
  try {
    return await withStudentLock(student.id, async () => {
      await refreshEnrollmentState(student.id, courseId);
      const course = getCourse(courseId);
      if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
      const existing = db.enrollments.find((item) => item.student_id === student.id && item.course_id === course.id);
      if (!existing || existing.status !== 'ENROLLED') return ok(res, { status: existing ? existing.status : 'NONE', released: 0 });
      const now = new Date().toISOString();
      const rec = { ...existing, status: 'CANCELLED', cancelled_at: now, operated_by: actorUser ? actorUser.id : null, reason: body?.reason || (source === 'STUDENT' ? '学生主动退课' : '管理员代退课') };
      const auditLog = { id: nextId('audit_logs'), actor_id: actorUser ? actorUser.id : student.user_id, action: source === 'STUDENT' ? 'WITHDRAW' : 'STAFF_WITHDRAW', target_type: 'course', target_id: course.id, before_json: null, after_json: JSON.stringify({ student_id: student.id }), ip: requestIp(req), created_at: now };
      const persisted = await persistEnrollmentMutation({ mode: 'withdraw', courseId: course.id, enrollment: rec, auditLog });
      Object.assign(existing, rec);
      course.active_count = persisted.handled ? persisted.activeCount : Math.max(0, course.active_count - 1);
      course.version = persisted.handled ? persisted.version : course.version + 1;
      db.audit_logs.push(auditLog);
      if (!persisted.handled) await save();
      await invalidate('open-courses');
      return ok(res, { status: 'CANCELLED', released: 1 });
    });
  } catch (error) {
    if (error.code === 'BUSY_RETRY') return fail(res, error.code, error.message, 429);
    console.error('[退课] 写入失败:', error.message);
    return fail(res, 'WITHDRAW_FAILED', '退课没有完成，请重试', 500);
  } finally {
    release();
  }
}

/* ----------------------------- 路由 ----------------------------- */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method;
  const user = getAuth(req);
  const ip = requestIp(req);
  if (path.startsWith('/api/') && path !== '/api/health') {
    const globalLimit = parseInt(process.env.RATE_LIMIT_GLOBAL_PER_SECOND || '2500', 10);
    if (!await enforceRateLimit(res, 'global', globalLimit, 1)) return;
  }
  if (/\/enroll$/.test(path) && user && !await enforceRateLimit(res, `enroll:${user.id}`, parseInt(process.env.RATE_LIMIT_ENROLL_PER_10_SECONDS || '10', 10), 10)) return;
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') body = await readBody(req);
  if (path === '/api/auth/login') {
    const loginIdentity = String(body.username || 'unknown').trim().toLowerCase();
    if (!await enforceRateLimit(res, `login:${ip}:${loginIdentity}`, parseInt(process.env.RATE_LIMIT_LOGIN_PER_ACCOUNT_PER_MINUTE || '10', 10), 60)) return;
  }

  const requireUser = () => { if (!user) { fail(res, 'UNAUTHORIZED', '请先登录', 401); return false; } return true; };
  const requireStaff = () => { if (!user || !['STAFF', 'SUPER_ADMIN'].includes(user.user_type)) { fail(res, 'FORBIDDEN', '无权访问', 403); return false; } return true; };
  const requireSuperAdmin = () => { if (!user || user.user_type !== 'SUPER_ADMIN') { fail(res, 'FORBIDDEN', '只有超级管理员可以管理教师账号', 403); return false; } return true; };

  // 公开
  if (['/admin-console.html', '/admin/legacy'].includes(path) && method === 'GET') {
    return sendAdminConsole(res);
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const u = db.users.find((x) => x.username === body.username);
    if (!u || !verifyPassword(body.password || '', u.password_hash)) return fail(res, 'INVALID_CREDENTIALS', '账号或密码不正确', 401);
    if (u.locked_until && new Date(u.locked_until) > new Date()) return fail(res, 'ACCOUNT_LOCKED', '账号已锁定，请稍后再试', 423);
    if (u.status === 'DISABLED') return fail(res, 'ACCOUNT_DISABLED', '账号已停用', 403);
    const token = sign({ uid: u.id, user_type: u.user_type });
    return ok(res, { token, user_type: u.user_type, must_change_password: u.must_change_password, username: u.username, display_name: u.display_name || u.username });
  }

  // 微信登录（wx.login code -> openid）：已绑定返回 token，未绑定返回 NEED_BIND + openid
  if (path === '/api/auth/wechat-login' && method === 'POST') {
    const { code } = body;
    if (!code) return fail(res, 'INVALID_CODE', '缺少登录 code', 400);
    let wx;
    try {
      wx = await code2Session(code);
    } catch (e) {
      return fail(res, 'WECHAT_LOGIN_FAILED', '微信登录失败：' + e.message, 502);
    }
    const u = db.users.find((x) => x.wechat_openid === wx.openid);
    if (u && u.status !== 'DISABLED') {
      const token = sign({ uid: u.id, user_type: u.user_type });
      return ok(res, { token, user_type: u.user_type, must_change_password: u.must_change_password, username: u.username, display_name: u.display_name || u.username, openid: wx.openid });
    }
    // 未绑定：返回 openid，交由小程序走「学号 + 密码」绑定流程
    return ok(res, { code: 'NEED_BIND', openid: wx.openid });
  }

  // 首次绑定：openid + 学号/工号 + 初始密码
  if (path === '/api/auth/bind' && method === 'POST') {
    const { openid, username, password } = body;
    if (!openid || !username || !password) return fail(res, 'INVALID_PARAM', '参数不完整', 400);
    const u = db.users.find((x) => x.username === username);
    if (!u || !verifyPassword(password || '', u.password_hash)) return fail(res, 'INVALID_CREDENTIALS', '账号或密码不正确', 401);
    if (u.status === 'DISABLED') return fail(res, 'ACCOUNT_DISABLED', '账号已停用', 403);
    u.wechat_openid = openid;
    u.updated_at = new Date().toISOString();
    save();
    const token = sign({ uid: u.id, user_type: u.user_type });
    return ok(res, { token, user_type: u.user_type, must_change_password: u.must_change_password, username: u.username, display_name: u.display_name || u.username });
  }

  // 已登录用户绑定 openid（手动登录后自动关联，便于下次一键登录）
  if (path === '/api/auth/bind-current' && method === 'POST') {
    const { code } = body;
    if (!code) return fail(res, 'INVALID_CODE', '缺少登录 code', 400);
    if (!user) return fail(res, 'UNAUTHORIZED', '请先登录', 401);
    let wx;
    try {
      wx = await code2Session(code);
    } catch (e) {
      return fail(res, 'WECHAT_LOGIN_FAILED', '微信登录失败：' + e.message, 502);
    }
    user.wechat_openid = wx.openid;
    user.updated_at = new Date().toISOString();
    save();
    return ok(res, { bound: true, openid: wx.openid });
  }

  if (path === '/api/health' && method === 'GET') return ok(res, { status: 'up' });

  // 学生端与管理端共用同一个 SPA，使用路由区分；API 仍由当前服务直接提供。
  if (method === 'GET' && !path.startsWith('/api/')) return sendWebApp(res, path);

  if (!requireUser()) return;

  // 改密
  if (path === '/api/auth/change-password' && method === 'POST') {
    if (!verifyPassword(body.old_password || '', user.password_hash)) return fail(res, 'INVALID_OLD_PASSWORD', '原密码不正确', 400);
    if (!body.new_password || body.new_password.length < parseInt(getConfig('security.password_min_length', '8'), 10)) return fail(res, 'WEAK_PASSWORD', `密码至少 ${getConfig('security.password_min_length', '8')} 位`);
    if (body.new_password !== body.confirm_password) return fail(res, 'PASSWORD_MISMATCH', '两次输入密码不一致');
    user.password_hash = hashPassword(body.new_password);
    user.must_change_password = false;
    user.updated_at = new Date().toISOString();
    save();
    audit(user.id, 'CHANGE_PASSWORD', 'user', user.id, null, null, ip);
    return ok(res, { changed: true });
  }

  // 学生端：体育选项课采用志愿填报，统一分配后再发布结果。
  if (path === '/api/preferences/current' && method === 'GET') {
    if (!requireUser()) return;
    const student = getStudentByUser(user.id);
    if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生资料不存在', 404);
    return ok(res, currentPreferenceData(student));
  }

  if (path === '/api/preferences/current' && method === 'PUT') {
    if (!requireUser()) return;
    const student = getStudentByUser(user.id);
    if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生资料不存在', 404);
    const group = groupForStudent(student);
    if (!group) return fail(res, 'GROUP_NOT_ASSIGNED', '你还没有加入体育选项课教学组', 400);
    if (group.status !== 'OPEN') return fail(res, 'PREFERENCE_NOT_OPEN', group.status === 'PUBLISHED' ? '分配结果已经发布，不能再修改志愿' : '当前不在志愿填报时间', 409);
    const choices = Array.isArray(body.course_ids) ? body.course_ids.map(Number) : [];
    if (choices.length !== Number(group.preference_count)) return fail(res, 'INVALID_PREFERENCE_COUNT', `请完整填写 ${group.preference_count} 个志愿`, 400);
    if (new Set(choices).size !== choices.length) return fail(res, 'DUPLICATE_PREFERENCE', '每个志愿必须选择不同项目', 400);
    const allowed = new Set(groupCourseIds(group.id));
    if (choices.some((id) => !allowed.has(id))) return fail(res, 'INVALID_PREFERENCE', '志愿项目不属于你的教学组', 400);
    const now = new Date().toISOString();
    let submission = db.preference_submissions.find((item) => item.group_id === group.id && item.student_id === student.id);
    if (!submission) {
      submission = { id: nextId('preference_submissions'), group_id: group.id, student_id: student.id, status: 'SUBMITTED', submitted_at: now, updated_at: now };
      db.preference_submissions.push(submission);
    } else {
      submission.status = 'SUBMITTED'; submission.updated_at = now;
    }
    db.preference_choices = db.preference_choices.filter((item) => item.submission_id !== submission.id);
    choices.forEach((courseId, index) => db.preference_choices.push({ submission_id: submission.id, rank: index + 1, course_id: courseId }));
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'SUBMIT_PREFERENCES', target_type: 'teaching_group', target_id: group.id, before_json: null, after_json: JSON.stringify({ choices }), ip, created_at: now });
    await save();
    return ok(res, currentPreferenceData(student));
  }

  // 旧课程浏览接口保留给历史数据查看，但学生即时抢课写入已关闭。
  if (path === '/api/courses' && method === 'GET') {
    const student = getStudentByUser(user.id);
    if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生资料不存在', 404);
    const q = url.searchParams.get('q') || '';
    const category = url.searchParams.get('category') || '';
    let cached = await getJson('open-courses');
    if (!cached) {
      const items = db.courses.filter((course) => course.status === 'OPEN').map((course) => courseToView(course));
      cached = { items, categories: [...new Set(items.map((course) => course.category).filter(Boolean))] };
      await setJson('open-courses', cached, 5);
    }
    const enrolledIds = new Set(studentEnrollments(student.id, 'ENROLLED').map((item) => item.course_id));
    let list = cached.items.filter((course) => studentMatchesScope(student, course.allowed_scope));
    if (category) list = list.filter((course) => course.category === category);
    if (q) list = list.filter((course) => `${course.name}${course.teachers.join('')}`.toLowerCase().includes(q.toLowerCase()));
    return ok(res, { items: list.map((course) => ({ ...course, enrolled: enrolledIds.has(course.id) })), categories: cached.categories });
  }

  if (/^\/api\/courses\/\d+$/.test(path) && method === 'GET') {
    const course = getCourse(path.split('/')[3]);
    if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
    const student = getStudentByUser(user.id);
    return ok(res, { course: courseToView(course, student) });
  }

  // 学生端：报名资格预检（只读，不写库），详情页点击前展示明确原因
  if (/^\/api\/courses\/\d+\/eligibility$/.test(path) && method === 'GET') {
    const course = getCourse(path.split('/')[3]);
    if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
    const student = getStudentByUser(user.id);
    const enrolled = db.enrollments.find((e) => e.student_id === student.id && e.course_id === course.id && e.status === 'ENROLLED');
    if (enrolled) return ok(res, { eligible: false, already_enrolled: true, code: 'ALREADY_ENROLLED', reason: '你已报名该课程' });
    if (course.status !== 'OPEN') return ok(res, { eligible: false, already_enrolled: false, code: 'COURSE_NOT_OPEN', reason: '课程未开放报名' });
    if (!studentMatchesScope(student, course.allowed_scope_json)) return ok(res, { eligible: false, already_enrolled: false, code: 'STUDENT_SCOPE_MISMATCH', reason: '该课程不在你的可报名范围内' });
    const maxActive = parseInt(getConfig('student.max_active_courses', '2'), 10);
    const activeCount = studentEnrollments(student.id, 'ENROLLED').length;
    if (activeCount >= maxActive) return ok(res, { eligible: false, already_enrolled: false, code: 'STUDENT_LIMIT_REACHED', reason: `每名学生最多报名 ${maxActive} 门课程` });
    const busy = studentBusySlots(student.id);
    const conflictSlot = courseSchedules(course.id).find((sc) => sc.weekday && sc.period && busy.has(`${sc.weekday}-${sc.period}`));
    if (conflictSlot) {
      const clash = db.enrollments.find((e) => e.student_id === student.id && e.status === 'ENROLLED' && courseSchedules(e.course_id).some((s) => s.weekday === conflictSlot.weekday && s.period === conflictSlot.period));
      const clashName = clash ? getCourse(clash.course_id).name : '其他课程';
      return ok(res, { eligible: false, already_enrolled: false, code: 'STUDENT_TIME_CONFLICT', reason: `与“${clashName}”上课时间冲突` });
    }
    if (course.active_count >= course.capacity) return ok(res, { eligible: false, already_enrolled: false, code: 'COURSE_FULL', reason: '课程名额已满' });
    return ok(res, { eligible: true, already_enrolled: false });
  }

  if (/^\/api\/courses\/\d+\/enroll$/.test(path) && method === 'POST') {
    return fail(res, 'PREFERENCE_MODE_ENABLED', '当前采用志愿填报，不再支持即时抢课', 410);
  }

  if (/^\/api\/courses\/\d+\/enrollment$/.test(path) && method === 'DELETE') {
    return fail(res, 'PREFERENCE_MODE_ENABLED', '体育选项课由学校统一分配，如需调整请联系老师', 410);
  }

  if (path === '/api/me/enrollments' && method === 'GET') {
    const student = getStudentByUser(user.id);
    const group = groupForStudent(student);
    const groupCourses = new Set(group ? groupCourseIds(group.id) : []);
    const currentEnrollments = group ? studentEnrollments(student.id, 'ENROLLED').filter((item) => item.source === 'ALLOCATION' && groupCourses.has(item.course_id) && group.status === 'PUBLISHED') : [];
    const items = currentEnrollments.map((e) => ({ ...courseToView(getCourse(e.course_id), student), enrolled_at: e.enrolled_at }));
    const history = db.enrollments.filter((e) => e.student_id === student.id && e.status !== 'ENROLLED').map((e) => ({ course_id: e.course_id, name: getCourse(e.course_id).name, status: e.status, cancelled_at: e.cancelled_at }));
    return ok(res, { items, history, max_active: parseInt(getConfig('student.max_active_courses', '2'), 10) });
  }

  if (path === '/api/me/schedule' && method === 'GET') {
    const student = getStudentByUser(user.id);
    const group = groupForStudent(student);
    const groupCourses = new Set(group ? groupCourseIds(group.id) : []);
    const items = (group && group.status === 'PUBLISHED' ? studentEnrollments(student.id, 'ENROLLED').filter((item) => item.source === 'ALLOCATION' && groupCourses.has(item.course_id)) : []).map((e) => {
      const c = getCourse(e.course_id);
      return { course_id: c.id, name: c.name, teachers: courseTeachers(c.id), schedules: courseSchedules(c.id) };
    });
    return ok(res, { items });
  }

  if (path === '/api/me/profile' && method === 'GET') {
    const student = getStudentByUser(user.id);
    const grade = db.grades.find((g) => g.id === student.grade_id);
    const cls = db.classes.find((c) => c.id === student.class_id);
    return ok(res, { student_no: student.student_no, name: student.name, grade: grade ? grade.name : '', class_name: cls ? cls.name : '', username: user.username });
  }

  // 管理端
  if (path === '/api/admin/dashboard' && method === 'GET') {
    if (!requireStaff()) return;
    const openCourses = db.courses.filter((c) => c.status === 'OPEN');
    const seat = openCourses.reduce((s, c) => s + Math.max(0, c.capacity - c.active_count), 0);
    const totalSeats = openCourses.reduce((s, c) => s + c.capacity, 0);
    const usedSeats = openCourses.reduce((s, c) => s + c.active_count, 0);
    const fillRate = totalSeats ? Math.round(usedSeats / totalSeats * 100) : 0;
    const courseViews = openCourses.map((c) => ({ id: c.id, name: c.name, capacity: c.capacity, active_count: c.active_count, remaining: Math.max(0, c.capacity - c.active_count), fill: c.capacity ? Math.round(c.active_count / c.capacity * 100) : 0 }));
    const nearFull = courseViews.filter((x) => x.remaining <= 3 || x.fill >= 85).sort((a, b) => b.fill - a.fill);
    const topFill = courseViews.slice().sort((a, b) => b.fill - a.fill).slice(0, 6);

    const byGrade = {};
    db.students.forEach((s) => { const g = db.grades.find((x) => x.id === s.grade_id); const name = g ? g.name : '未知'; byGrade[name] = (byGrade[name] || 0) + 1; });
    const studentsByGrade = Object.entries(byGrade).map(([grade, count]) => ({ grade, count }));

    const studentsWechatBound = db.students.filter((s) => { const u = db.users.find((x) => x.id === s.user_id); return u && u.wechat_openid; }).length;
    const studentsNeedPwd = db.students.filter((s) => { const u = db.users.find((x) => x.id === s.user_id); return u && u.must_change_password; }).length;

    const catCount = {};
    db.courses.forEach((c) => { const name = (db.course_categories.find((x) => x.id === c.category_id) || {}).name || '未分类'; catCount[name] = (catCount[name] || 0) + 1; });
    const categoryDistribution = Object.entries(catCount).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);

    const recentEnrollments = db.enrollments.slice().sort((a, b) => (b.enrolled_at || '').localeCompare(a.enrolled_at || '')).slice(0, 8).map((e) => {
      const st = getStudent(e.student_id); const c = getCourse(e.course_id);
      return { enrollment_id: e.id, student_no: st ? st.student_no : '', name: st ? st.name : '', course_name: c ? c.name : '', status: e.status, source: e.source, enrolled_at: e.enrolled_at };
    });

    return ok(res, {
      students: db.students.length, staff: db.staff.length, open_courses: openCourses.length, total_courses: db.courses.length,
      active_enrollments: db.enrollments.filter((e) => e.status === 'ENROLLED').length, remaining_seats: seat,
      full_courses: openCourses.filter((c) => c.active_count >= c.capacity).length,
      draft_courses: db.courses.filter((c) => c.status === 'DRAFT').length,
      closed_courses: db.courses.filter((c) => c.status === 'CLOSED').length,
      finished_courses: db.courses.filter((c) => c.status === 'FINISHED' || c.status === 'ARCHIVED').length,
      total_seats: totalSeats, used_seats: usedSeats, fill_rate: fillRate,
      near_full_courses: nearFull, top_fill_courses: topFill,
      students_by_grade: studentsByGrade, students_wechat_bound: studentsWechatBound, students_need_pwd: studentsNeedPwd,
      category_distribution: categoryDistribution, conflict_courses: globalConflicts(),
      recent_enrollments: recentEnrollments,
      recent_audit: db.audit_logs.slice(-8).reverse(),
      teaching_groups: db.teaching_groups.filter((group) => group.status !== 'ARCHIVED').length,
      open_preference_groups: db.teaching_groups.filter((group) => group.status === 'OPEN').length,
      preference_submissions: db.preference_submissions.filter((item) => item.status === 'SUBMITTED').length,
      published_groups: db.teaching_groups.filter((group) => group.status === 'PUBLISHED').length,
    });
  }

  if (path === '/api/admin/meta' && method === 'GET') {
    if (!requireStaff()) return;
    return ok(res, {
      staff: db.staff.map((s) => ({ id: s.id, name: s.name, staff_no: s.staff_no })),
      venues: db.venues.map((v) => ({ id: v.id, name: v.name })),
      time_slots: db.time_slots.map((t) => ({ id: t.id, name: t.name, weekday: t.weekday, period: t.period })),
      categories: db.course_categories.map((c) => ({ id: c.id, name: c.name })),
      grades: db.grades.map((g) => ({ id: g.id, name: g.name })),
      classes: db.classes.map((c) => ({ id: c.id, name: c.name, grade_id: c.grade_id })),
    });
  }

  if (path === '/api/admin/teaching-groups' && method === 'GET') {
    if (!requireStaff()) return;
    const items = db.teaching_groups.filter((group) => group.status !== 'ARCHIVED').map(teachingGroupView).sort((a, b) => b.id - a.id);
    return ok(res, { items, grades: db.grades.filter((item) => item.status === 'ACTIVE'), classes: db.classes.filter((item) => item.status === 'ACTIVE'), projects: db.courses.filter((item) => item.status !== 'ARCHIVED').map((course) => courseToView(course)) });
  }

  if (path === '/api/admin/teaching-groups' && method === 'POST') {
    if (!requireStaff()) return;
    const name = String(body.name || '').trim();
    const gradeId = Number(body.grade_id);
    const classIds = [...new Set((Array.isArray(body.class_ids) ? body.class_ids : []).map(Number))];
    const courseIds = [...new Set((Array.isArray(body.course_ids) ? body.course_ids : []).map(Number))];
    const preferenceCount = Number(body.preference_count || 2);
    if (!name || name.length > 128) return fail(res, 'INVALID_GROUP_NAME', '教学组名称不能为空且不能超过 128 个字符', 400);
    if (!db.grades.some((item) => item.id === gradeId)) return fail(res, 'INVALID_GRADE', '请选择有效年级', 400);
    if (classIds.length < 3 || classIds.length > 4) return fail(res, 'INVALID_GROUP_CLASSES', '每个教学组请选择 3 至 4 个班级', 400);
    if (classIds.some((id) => !db.classes.some((item) => item.id === id && item.grade_id === gradeId))) return fail(res, 'INVALID_GROUP_CLASSES', '所选班级必须属于同一年级', 400);
    const occupiedClass = classIds.find((id) => db.teaching_group_classes.some((item) => item.class_id === id && db.teaching_groups.some((group) => group.id === item.group_id && group.status !== 'ARCHIVED')));
    if (occupiedClass) return fail(res, 'CLASS_ALREADY_GROUPED', `${db.classes.find((item) => item.id === occupiedClass)?.name || '所选班级'} 已经属于其他教学组`, 409);
    if (courseIds.length < 2) return fail(res, 'INVALID_GROUP_PROJECTS', '每个教学组至少选择 2 个体育项目', 400);
    if (courseIds.some((id) => !getCourse(id) || getCourse(id).status === 'ARCHIVED')) return fail(res, 'INVALID_GROUP_PROJECTS', '包含无效或历史项目', 400);
    const occupiedProject = courseIds.find((id) => db.teaching_group_courses.some((item) => item.course_id === id && db.teaching_groups.some((group) => group.id === item.group_id && group.status !== 'ARCHIVED')));
    if (occupiedProject) return fail(res, 'PROJECT_ALREADY_GROUPED', `${getCourse(occupiedProject)?.name || '所选项目'} 已经用于其他教学组，请为不同教学组分别建立项目`, 409);
    if (![2, 3].includes(preferenceCount) || preferenceCount > courseIds.length) return fail(res, 'INVALID_PREFERENCE_COUNT', '志愿数量只能是 2 或 3，且不能超过项目数', 400);
    const now = new Date().toISOString();
    const group = { id: nextId('teaching_groups'), name, grade_id: gradeId, status: 'DRAFT', preference_count: preferenceCount, allow_adjustment: body.allow_adjustment ? 1 : 0, submission_start_at: null, submission_end_at: null, published_at: null, created_by: user.id, created_at: now, updated_at: now };
    db.teaching_groups.push(group);
    classIds.forEach((classId) => db.teaching_group_classes.push({ group_id: group.id, class_id: classId }));
    courseIds.forEach((courseId) => db.teaching_group_courses.push({ group_id: group.id, course_id: courseId }));
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'CREATE_TEACHING_GROUP', target_type: 'teaching_group', target_id: group.id, before_json: null, after_json: JSON.stringify({ name, class_ids: classIds, course_ids: courseIds }), ip, created_at: now });
    await save();
    return ok(res, { group: teachingGroupView(group) });
  }

  if (/^\/api\/admin\/teaching-groups\/\d+\/(open|close)$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    const parts = path.split('/');
    const group = db.teaching_groups.find((item) => item.id === Number(parts[4]));
    const action = parts[5];
    if (!group) return fail(res, 'GROUP_NOT_FOUND', '教学组不存在', 404);
    if (action === 'open' && !['DRAFT', 'CLOSED', 'ALLOCATED'].includes(group.status)) return fail(res, 'INVALID_GROUP_STATUS', '当前状态不能开放填报', 409);
    if (action === 'close' && group.status !== 'OPEN') return fail(res, 'INVALID_GROUP_STATUS', '当前教学组未开放填报', 409);
    if (action === 'open') {
      const projects = groupCourseIds(group.id).map((id) => getCourse(id)).filter(Boolean);
      if (projects.some((project) => project.status !== 'OPEN')) return fail(res, 'GROUP_PROJECT_NOT_READY', '请先在项目管理中启用本组全部项目', 409);
      if (projects.reduce((total, project) => total + Number(project.capacity || 0), 0) < groupStudents(group.id).length) return fail(res, 'GROUP_CAPACITY_SHORTAGE', '本组项目总名额少于学生人数，请先调整项目容量', 409);
    }
    const now = new Date().toISOString();
    group.status = action === 'open' ? 'OPEN' : 'CLOSED';
    if (action === 'open') {
      group.submission_start_at = now;
      db.allocation_runs.filter((item) => item.group_id === group.id && item.status === 'SIMULATED').forEach((item) => { item.status = 'SUPERSEDED'; });
    }
    else group.submission_end_at = now;
    group.updated_at = now;
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: action === 'open' ? 'OPEN_PREFERENCES' : 'CLOSE_PREFERENCES', target_type: 'teaching_group', target_id: group.id, before_json: null, after_json: JSON.stringify({ status: group.status }), ip, created_at: now });
    await save();
    return ok(res, { group: teachingGroupView(group) });
  }

  if (/^\/api\/admin\/teaching-groups\/\d+\/allocation$/.test(path) && method === 'GET') {
    if (!requireStaff()) return;
    const groupId = Number(path.split('/')[4]);
    const group = db.teaching_groups.find((item) => item.id === groupId);
    if (!group) return fail(res, 'GROUP_NOT_FOUND', '教学组不存在', 404);
    const students = groupStudents(groupId);
    const submissions = db.preference_submissions.filter((item) => item.group_id === groupId && item.status === 'SUBMITTED');
    const latestRun = db.allocation_runs.filter((item) => item.group_id === groupId && ['SIMULATED', 'PUBLISHED'].includes(item.status)).sort((a, b) => b.id - a.id)[0];
    const results = latestRun ? db.allocation_results.filter((item) => item.run_id === latestRun.id).map((item) => ({ ...item, student: getStudent(item.student_id), course: courseToView(getCourse(item.course_id)) })) : [];
    return ok(res, { group: teachingGroupView(group), students: students.map((student) => {
      const submission = submissions.find((item) => item.student_id === student.id);
      const choices = submission ? db.preference_choices.filter((item) => item.submission_id === submission.id).sort((a, b) => a.rank - b.rank).map((item) => item.course_id) : [];
      return { ...student, class_name: db.classes.find((item) => item.id === student.class_id)?.name || '', submitted: Boolean(submission), choices };
    }), run: latestRun || null, results });
  }

  if (/^\/api\/admin\/teaching-groups\/\d+\/simulate$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    const groupId = Number(path.split('/')[4]);
    const release = await lock(`teaching-group:${groupId}`);
    try {
      const group = db.teaching_groups.find((item) => item.id === groupId);
      if (!group) return fail(res, 'GROUP_NOT_FOUND', '教学组不存在', 404);
      if (!['CLOSED', 'ALLOCATED'].includes(group.status)) return fail(res, 'PREFERENCES_STILL_OPEN', '请先停止志愿填报，再运行模拟分配', 409);
      const submissions = db.preference_submissions.filter((item) => item.group_id === groupId && item.status === 'SUBMITTED');
      if (!submissions.length) return fail(res, 'NO_PREFERENCES', '当前教学组还没有学生提交志愿', 409);
      const students = submissions.map((submission) => ({ id: submission.student_id, choices: db.preference_choices.filter((item) => item.submission_id === submission.id).sort((a, b) => a.rank - b.rank).map((item) => item.course_id) }));
      const courses = groupCourseIds(groupId).map((id) => getCourse(id)).filter(Boolean).map((course) => ({ id: course.id, capacity: course.capacity }));
      const seed = String(body.seed || `group-${groupId}-${Date.now()}`).slice(0, 128);
      const allocation = allocatePreferences({ students, courses, preferenceCount: group.preference_count, allowAdjustment: Boolean(group.allow_adjustment), seed });
      db.allocation_runs.filter((item) => item.group_id === groupId && item.status === 'SIMULATED').forEach((item) => { item.status = 'SUPERSEDED'; });
      const now = new Date().toISOString();
      const run = { id: nextId('allocation_runs'), group_id: groupId, seed, status: 'SIMULATED', summary_json: JSON.stringify({ submitted: students.length, assigned: allocation.assignments.length, unassigned: allocation.unassigned.length, unsubmitted: groupStudents(groupId).length - students.length, remaining: allocation.remaining }), created_by: user.id, created_at: now, published_at: null };
      db.allocation_runs.push(run);
      allocation.assignments.forEach((item) => db.allocation_results.push({ id: nextId('allocation_results'), run_id: run.id, group_id: groupId, ...item, created_at: now }));
      group.status = 'ALLOCATED'; group.updated_at = now;
      db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'SIMULATE_ALLOCATION', target_type: 'teaching_group', target_id: groupId, before_json: null, after_json: run.summary_json, ip, created_at: now });
      await save();
      return ok(res, { run, summary: JSON.parse(run.summary_json), group: teachingGroupView(group) });
    } finally { release(); }
  }

  if (/^\/api\/admin\/teaching-groups\/\d+\/publish$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    const groupId = Number(path.split('/')[4]);
    const release = await lock(`teaching-group:${groupId}`);
    try {
      const group = db.teaching_groups.find((item) => item.id === groupId);
      if (!group) return fail(res, 'GROUP_NOT_FOUND', '教学组不存在', 404);
      const run = db.allocation_runs.filter((item) => item.group_id === groupId && item.status === 'SIMULATED').sort((a, b) => b.id - a.id)[0];
      if (!run) return fail(res, 'NO_SIMULATION', '请先运行模拟分配并检查结果', 409);
      const summary = JSON.parse(run.summary_json || '{}');
      if ((summary.unassigned || summary.unsubmitted) && !body.confirm_incomplete) return fail(res, 'INCOMPLETE_ALLOCATION', '仍有未提交或未分配学生，请确认后再发布', 409, summary);
      const studentIds = new Set(groupStudents(groupId).map((item) => item.id));
      const courseIds = new Set(groupCourseIds(groupId));
      db.enrollments = db.enrollments.filter((item) => !(studentIds.has(item.student_id) && courseIds.has(item.course_id)));
      const now = new Date().toISOString();
      db.allocation_results.filter((item) => item.run_id === run.id).forEach((item) => db.enrollments.push({ id: nextId('enrollments'), student_id: item.student_id, course_id: item.course_id, status: 'ENROLLED', source: 'ALLOCATION', idempotency_key: `allocation-${run.id}-${item.student_id}`, enrolled_at: now, cancelled_at: null, operated_by: user.id, reason: item.allocation_type === 'ADJUSTED' ? '后台统一调剂' : `第${item.source_rank}志愿录取` }));
      db.courses.forEach((course) => { course.active_count = db.enrollments.filter((item) => item.course_id === course.id && item.status === 'ENROLLED').length; });
      run.status = 'PUBLISHED'; run.published_at = now;
      group.status = 'PUBLISHED'; group.published_at = now; group.updated_at = now;
      db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'PUBLISH_ALLOCATION', target_type: 'teaching_group', target_id: groupId, before_json: null, after_json: run.summary_json, ip, created_at: now });
      await save();
      return ok(res, { group: teachingGroupView(group), run });
    } finally { release(); }
  }

  if (path === '/api/admin/accounts' && method === 'GET') {
    if (!requireSuperAdmin()) return;
    const items = db.users
      .filter((account) => ['STAFF', 'SUPER_ADMIN'].includes(account.user_type))
      .map((account) => ({
        id: account.id,
        username: account.username,
        name: account.display_name || account.username,
        role: account.user_type,
        status: account.status,
        must_change_password: Boolean(account.must_change_password),
        created_at: account.created_at,
        current: account.id === user.id,
      }))
      .sort((left, right) => Number(right.role === 'SUPER_ADMIN') - Number(left.role === 'SUPER_ADMIN') || left.id - right.id);
    return ok(res, { items });
  }

  if (path === '/api/admin/accounts' && method === 'POST') {
    if (!requireSuperAdmin()) return;
    const username = String(body.username || '').trim();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'STAFF';
    const mustChangePassword = body.require_password_change !== false;
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) return fail(res, 'INVALID_USERNAME', '登录账号只能使用 3 至 64 位字母、数字、点、下划线或短横线', 400);
    if (!name || name.length > 64) return fail(res, 'INVALID_NAME', '姓名不能为空且不能超过 64 个字符', 400);
    if (password.length < 8 || password.length > 128) return fail(res, 'INVALID_PASSWORD', '初始密码必须为 8 至 128 位', 400);
    if (db.users.some((account) => account.username.toLowerCase() === username.toLowerCase())) return fail(res, 'DUPLICATE_USERNAME', '这个登录账号已经存在', 409);
    const now = new Date().toISOString();
    const account = {
      id: nextId('users'), username, display_name: name, password_hash: hashPassword(password),
      user_type: role, status: 'ACTIVE', must_change_password: mustChangePassword,
      failed_login_count: 0, locked_until: null, wechat_openid: null,
      created_at: now, updated_at: now,
    };
    db.users.push(account);
    let staff = null;
    if (role === 'STAFF') {
      staff = {
        id: nextId('staff'), user_id: account.id, staff_no: username,
        name, title: '', department: '', status: 'ACTIVE',
      };
      db.staff.push(staff);
    }
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'CREATE_ADMIN_ACCOUNT', target_type: 'admin_account', target_id: account.id, before_json: null, after_json: JSON.stringify({ username, name, role, must_change_password: mustChangePassword }), ip, created_at: now });
    await save();
    return ok(res, { account: { id: account.id, username, name, role: account.user_type, status: account.status, must_change_password: mustChangePassword, created_at: now }, staff });
  }

  if (/^\/api\/admin\/meta\/(staff|venues|categories|time-slots)$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    const type = path.split('/')[4];
    const name = String(body.name || '').trim();
    if (!name) return fail(res, 'INVALID_PARAM', '名称不能为空');
    let record;
    if (type === 'staff') {
      if (db.staff.some((item) => item.name === name)) return fail(res, 'DUPLICATE_NAME', '该教师已经存在');
      record = { id: nextId('staff'), user_id: null, staff_no: String(body.staff_no || '').trim() || `T${Date.now().toString().slice(-6)}`, name, title: '', department: '', status: 'ACTIVE' };
      db.staff.push(record);
    } else if (type === 'venues') {
      if (db.venues.some((item) => item.name === name)) return fail(res, 'DUPLICATE_NAME', '该场地已经存在');
      record = { id: nextId('venues'), name, parent_id: null, capacity: Number(body.capacity) || 0, status: 'ACTIVE', remark: String(body.remark || '') };
      db.venues.push(record);
    } else if (type === 'categories') {
      if (db.course_categories.some((item) => item.name === name)) return fail(res, 'DUPLICATE_NAME', '该课程分类已经存在');
      record = { id: nextId('course_categories'), name, sort_order: db.course_categories.length + 1, status: 'ACTIVE' };
      db.course_categories.push(record);
    } else {
      const weekday = Number(body.weekday);
      const period = Number(body.period);
      if (weekday < 1 || weekday > 7 || period < 1 || period > 20) return fail(res, 'INVALID_PARAM', '星期必须为 1 至 7，节次必须为 1 至 20');
      if (db.time_slots.some((item) => Number(item.weekday) === weekday && Number(item.period) === period)) return fail(res, 'DUPLICATE_SLOT', '这个星期和节次已经存在');
      record = { id: `custom-${weekday}-${period}-${Date.now().toString(36)}`, name, weekday, period, start_time: body.start_time || null, end_time: body.end_time || null, status: 'ACTIVE' };
      db.time_slots.push(record);
    }
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'CREATE_BASE_DATA', target_type: type, target_id: typeof record.id === 'number' ? record.id : 0, before_json: null, after_json: JSON.stringify({ id: record.id, name }), ip, created_at: new Date().toISOString() });
    await save();
    return ok(res, { item: record });
  }

  if (path === '/api/admin/courses' && method === 'GET') {
    if (!requireStaff()) return;
    const q = url.searchParams.get('q') || '';
    const status = url.searchParams.get('status') || '';
    let list = db.courses.slice();
    if (status) list = list.filter((c) => c.status === status);
    if (q) list = list.filter((c) => `${c.name}${courseTeachers(c.id).join('')}`.toLowerCase().includes(q.toLowerCase()));
    return ok(res, { items: list.map((c) => { const v = courseToView(c); v.category_id = c.category_id; v.teachers = courseTeachers(c.id); v.teacher_ids = db.course_staff.filter((cs) => cs.course_id === c.id).map((cs) => cs.staff_id); v.schedules = courseSchedules(c.id); return v; }) });
  }

  if (path === '/api/admin/courses' && method === 'POST') {
    if (!requireStaff()) return;
    const release = await lock('admin:schedule');
    try {
      const r = await withScheduleLock(() => saveCourse(res, body, null, user, ip));
      if (r) { await invalidate('open-courses'); ok(res, r); }
    } catch (error) {
      if (error.code === 'BUSY_RETRY') return fail(res, error.code, '其他教务人员正在保存排课，请稍后重试', 429);
      throw error;
    } finally { release(); }
    return;
  }

  if (/^\/api\/admin\/courses\/\d+$/.test(path) && method === 'PUT') {
    if (!requireStaff()) return;
    const release = await lock('admin:schedule');
    try {
      const r = await withScheduleLock(() => saveCourse(res, body, Number(path.split('/')[4]), user, ip));
      if (r) { await invalidate('open-courses'); ok(res, r); }
    } catch (error) {
      if (error.code === 'BUSY_RETRY') return fail(res, error.code, '其他教务人员正在保存排课，请稍后重试', 429);
      throw error;
    } finally { release(); }
    return;
  }

  if (/^\/api\/admin\/courses\/\d+\/conflicts$/.test(path) && ['GET', 'POST'].includes(method)) {
    if (!requireStaff()) return;
    return ok(res, previewConflicts(Number(path.split('/')[4]), body));
  }

  if (/^\/api\/admin\/courses\/\d+\/(open|close|archive)$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    const id = Number(path.split('/')[4]);
    const action = path.split('/')[5];
    try {
      return await withScheduleLock(async () => {
        const course = getCourse(id);
        if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
        const allowedFrom = { open: ['DRAFT', 'CLOSED'], close: ['OPEN'], archive: ['DRAFT', 'CLOSED', 'FINISHED'] };
        if (!allowedFrom[action].includes(course.status)) {
          const messages = {
            open: '只有草稿或已暂停报名的课程可以开放报名',
            close: '这门课程当前没有开放报名',
            archive: course.status === 'OPEN' ? '请先暂停学生报名，再将课程移入历史课程' : '这门课程已经移入历史课程',
          };
          return fail(res, 'INVALID_STATUS_TRANSITION', messages[action], 409);
        }
        if (action === 'open') {
          const teachers = db.course_staff.filter((item) => item.course_id === id);
          const schedules = db.course_schedules.filter((item) => item.course_id === id);
          if (!teachers.length || !schedules.length) {
            return fail(res, 'COURSE_NOT_READY', '开放报名之前，请先安排任课教师、上课时间和场地', 400);
          }
          const conflicts = previewConflicts(id, { teachers: teachers.map((item) => item.staff_id), schedules });
          if (conflicts.teacher.length || conflicts.venue.length || conflicts.student.count) {
            return fail(res, 'HARD_CONFLICT', '开放报名失败：当前排课存在冲突', 409, conflicts);
          }
        }
        const before = { status: course.status };
        course.status = { open: 'OPEN', close: 'CLOSED', archive: 'ARCHIVED' }[action];
        course.version += 1; course.updated_by = user.id; course.updated_at = new Date().toISOString();
        await save();
        audit(user.id, `COURSE_${action.toUpperCase()}`, 'course', id, before, { status: course.status }, ip);
        await invalidate('open-courses');
        return ok(res, { course: courseToView(course) });
      });
    } catch (error) {
      if (error.code === 'BUSY_RETRY') return fail(res, error.code, '其他教务人员正在修改课程状态，请稍后重试', 429);
      throw error;
    }
  }

  if (/^\/api\/admin\/courses\/\d+\/enrollments$/.test(path) && method === 'GET') {
    if (!requireStaff()) return;
    const id = Number(path.split('/')[4]);
    const status = url.searchParams.get('status') || 'ENROLLED';
    const items = db.enrollments.filter((e) => e.course_id === id && (status === 'ALL' ? true : e.status === status)).map((e) => {
      const st = getStudent(e.student_id);
      return { enrollment_id: e.id, student_id: e.student_id, student_no: st ? st.student_no : '', name: st ? st.name : '', enrolled_at: e.enrolled_at, status: e.status, source: e.source, operated_by: e.operated_by, reason: e.reason };
    });
    return ok(res, { items });
  }

  if (/^\/api\/admin\/courses\/\d+\/enrollments$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    return fail(res, 'PREFERENCE_MODE_ENABLED', '当前采用志愿统一分配，不能再手工代报名', 410);
  }

  if (/^\/api\/admin\/enrollments\/\d+$/.test(path) && method === 'DELETE') {
    if (!requireStaff()) return;
    return fail(res, 'PREFERENCE_MODE_ENABLED', '当前采用志愿统一分配，已发布结果需要通过教学组重新处理', 410);
  }

  if (path === '/api/admin/students' && method === 'GET') {
    if (!requireStaff()) return;
    const q = url.searchParams.get('q') || '';
    const items = db.students.map((s) => {
      const grade = db.grades.find((g) => g.id === s.grade_id);
      const cls = db.classes.find((c) => c.id === s.class_id);
      const u = db.users.find((x) => x.id === s.user_id);
      return { id: s.id, student_no: s.student_no, name: s.name, grade: grade ? grade.name : '', class_name: cls ? cls.name : '', status: s.status, account_status: u ? u.status : 'NONE', enrolled_count: studentEnrollments(s.id, 'ENROLLED').length };
    });
    if (q) return ok(res, { items: items.filter((i) => `${i.student_no}${i.name}`.includes(q)) });
    return ok(res, { items });
  }

  if (path === '/api/admin/students/import' && method === 'POST') {
    if (!requireStaff()) return;
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    if (!rawRows.length) return fail(res, 'EMPTY_IMPORT', '没有可导入的学生数据');
    if (rawRows.length > 3000) return fail(res, 'IMPORT_TOO_LARGE', '单次最多导入 3000 名学生');

    const passwordMinLength = parseInt(getConfig('security.password_min_length', '8'), 10);
    const initialPassword = String(getConfig('security.student_initial_password', '12345678'));
    if (initialPassword.length < passwordMinLength || initialPassword.length > 128) {
      return fail(res, 'INVALID_INITIAL_PASSWORD_CONFIG', `统一初始密码必须为 ${passwordMinLength} 至 128 位，请先到规则设置中修改`, 500);
    }

    const errors = [];
    const seen = new Set();
    const rows = rawRows.map((raw, index) => {
      const rowNumber = Number(raw.row_number) || index + 2;
      const item = {
        row_number: rowNumber,
        student_no: String(raw.student_no ?? '').trim(),
        name: String(raw.name ?? '').trim(),
        grade: String(raw.grade ?? '').trim() || '未分组',
        class_name: String(raw.class_name ?? '').trim() || '未分组',
      };
      if (!item.student_no) errors.push({ row_number: rowNumber, message: '学号为空' });
      else if (item.student_no.length > 32) errors.push({ row_number: rowNumber, message: '学号不能超过 32 个字符' });
      else if (seen.has(item.student_no)) errors.push({ row_number: rowNumber, message: '文件内学号重复' });
      else seen.add(item.student_no);
      if (!item.name) errors.push({ row_number: rowNumber, message: '姓名为空' });
      if (item.name.length > 64) errors.push({ row_number: rowNumber, message: '姓名不能超过 64 个字符' });
      if (item.grade.length > 32 || item.class_name.length > 32) errors.push({ row_number: rowNumber, message: '年级或班级不能超过 32 个字符' });
      const existingStudent = db.students.find((student) => student.student_no === item.student_no);
      const conflictingUser = db.users.find((account) => account.username === item.student_no && (!existingStudent || account.id !== existingStudent.user_id));
      if (conflictingUser) errors.push({ row_number: rowNumber, message: '该学号已被其他账号占用' });
      return item;
    });
    if (errors.length) return fail(res, 'INVALID_IMPORT_ROWS', `有 ${errors.length} 行数据无法导入`, 400, { errors: errors.slice(0, 100) });

    const now = new Date().toISOString();
    const passwordHashes = new Map();
    const passwordHash = (password) => {
      if (!passwordHashes.has(password)) passwordHashes.set(password, hashPassword(password));
      return passwordHashes.get(password);
    };
    let created = 0;
    let updated = 0;
    const credentials = [];
    for (const item of rows) {
      let grade = db.grades.find((record) => record.name === item.grade);
      if (!grade) {
        grade = { id: nextId('grades'), name: item.grade, sort_order: db.grades.length + 1, status: 'ACTIVE' };
        db.grades.push(grade);
      }
      let cls = db.classes.find((record) => record.grade_id === grade.id && record.name === item.class_name);
      if (!cls) {
        cls = { id: nextId('classes'), grade_id: grade.id, name: item.class_name, sort_order: db.classes.filter((record) => record.grade_id === grade.id).length + 1, status: 'ACTIVE' };
        db.classes.push(cls);
      }

      let student = db.students.find((record) => record.student_no === item.student_no);
      if (student) {
        student.name = item.name; student.grade_id = grade.id; student.class_id = cls.id; student.status = 'ACTIVE';
        let account = db.users.find((record) => record.id === student.user_id);
        if (!account) {
          account = { id: nextId('users'), username: item.student_no, display_name: item.name, password_hash: passwordHash(initialPassword), user_type: 'STUDENT', status: 'ACTIVE', must_change_password: true, failed_login_count: 0, locked_until: null, created_at: now, updated_at: now };
          db.users.push(account); student.user_id = account.id;
          credentials.push({ name: item.name, student_no: item.student_no, grade: grade.name, class_name: cls.name, username: item.student_no, password: initialPassword });
        } else {
          account.status = 'ACTIVE'; account.display_name = item.name; account.updated_at = now;
          if (body.reset_existing_password) {
            account.password_hash = passwordHash(initialPassword);
            account.must_change_password = true;
            account.failed_login_count = 0; account.locked_until = null;
            credentials.push({ name: item.name, student_no: item.student_no, grade: grade.name, class_name: cls.name, username: item.student_no, password: initialPassword });
          }
        }
        updated += 1;
      } else {
        const account = { id: nextId('users'), username: item.student_no, display_name: item.name, password_hash: passwordHash(initialPassword), user_type: 'STUDENT', status: 'ACTIVE', must_change_password: true, failed_login_count: 0, locked_until: null, created_at: now, updated_at: now };
        db.users.push(account);
        student = { id: nextId('students'), user_id: account.id, student_no: item.student_no, name: item.name, grade_id: grade.id, class_id: cls.id, status: 'ACTIVE' };
        db.students.push(student);
        credentials.push({ name: item.name, student_no: item.student_no, grade: grade.name, class_name: cls.name, username: item.student_no, password: initialPassword });
        created += 1;
      }
    }
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'IMPORT_STUDENTS', target_type: 'students', target_id: 0, before_json: null, after_json: JSON.stringify({ created, updated, total: rows.length }), ip, created_at: now });
    await save();
    return ok(res, { created, updated, total: rows.length, credentials });
  }

  if (path === '/api/admin/enrollments' && method === 'GET') {
    if (!requireStaff()) return;
    const status = url.searchParams.get('status') || 'ALL';
    const q = (url.searchParams.get('q') || '').trim();
    const items = db.enrollments
      .filter((e) => status === 'ALL' ? true : e.status === status)
      .map((e) => {
        const st = getStudent(e.student_id);
        const course = getCourse(e.course_id);
        return {
          enrollment_id: e.id, student_id: e.student_id, student_no: st ? st.student_no : '', student_name: st ? st.name : '',
          course_id: e.course_id, course_name: course ? course.name : '',
          status: e.status, source: e.source, enrolled_at: e.enrolled_at, reason: e.reason, operated_by: e.operated_by,
        };
      })
      .sort((a, b) => (b.enrolled_at || '').localeCompare(a.enrolled_at || ''));
    if (q) return ok(res, { items: items.filter((i) => `${i.student_no}${i.student_name}${i.course_name}`.includes(q)) });
    return ok(res, { items });
  }

  if (path === '/api/admin/configs' && method === 'GET') {
    if (!requireStaff()) return;
    return ok(res, { items: db.system_configs.map((c) => ({ key: c.config_key, value: c.config_value, type: c.value_type })) });
  }

  if (path === '/api/admin/configs' && method === 'PUT') {
    if (!requireStaff()) return;
    const items = Array.isArray(body.items) ? body.items : [];
    const initialPasswordItem = items.find((item) => item.key === 'security.student_initial_password');
    if (initialPasswordItem) {
      const passwordMinItem = items.find((item) => item.key === 'security.password_min_length');
      const minLength = parseInt(passwordMinItem?.value ?? getConfig('security.password_min_length', '8'), 10);
      const value = String(initialPasswordItem.value || '');
      if (value.length < minLength || value.length > 128) return fail(res, 'INVALID_INITIAL_PASSWORD', `统一初始密码必须为 ${minLength} 至 128 位`, 400);
    }
    items.forEach((it) => {
      const row = db.system_configs.find((c) => c.config_key === it.key);
      if (row) { row.config_value = String(it.value); row.updated_by = user.id; row.updated_at = new Date().toISOString(); }
    });
    save();
    audit(user.id, 'UPDATE_CONFIG', 'system', 0, null, items.map((item) => ({ key: item.key, value: item.key === 'security.student_initial_password' ? '已更新' : item.value })), ip);
    return ok(res, { saved: true });
  }

  if (path === '/api/admin/audit' && method === 'GET') {
    if (!requireStaff()) return;
    const items = db.audit_logs.slice(-100).reverse().map((item) => {
      const actor = db.users.find((account) => account.id === item.actor_id);
      const student = actor ? db.students.find((record) => record.user_id === actor.id) : null;
      const staff = actor ? db.staff.find((record) => record.user_id === actor.id) : null;
      let target_name = '';
      if (item.target_type === 'course') target_name = getCourse(item.target_id)?.name || '';
      if (item.target_type === 'student') target_name = getStudent(item.target_id)?.name || '';
      return { ...item, actor_name: student?.name || staff?.name || actor?.display_name || actor?.username || '系统', target_name };
    });
    return ok(res, { items });
  }

  return fail(res, 'NOT_FOUND', '接口不存在', 404);
});

/* ----------------------------- 课程保存（含冲突校验） ----------------------------- */

async function saveCourse(res, body, id, user, ip) {
  const name = (body.name || '').trim();
  if (!name) return fail(res, 'INVALID_PARAM', '课程名称必填', 400);
  if (db.courses.some((course) => course.id !== Number(id) && course.name === name && course.status !== 'ARCHIVED')) {
    return fail(res, 'DUPLICATE_COURSE', '已经存在同名课程，请直接编辑原课程', 409);
  }
  const capacity = parseInt(body.capacity, 10);
  if (!capacity || capacity < 1) return fail(res, 'INVALID_PARAM', '课程容量必须为正整数', 400);
  const categoryId = Number(body.category_id);
  if (!db.course_categories.some((category) => category.id === categoryId)) return fail(res, 'INVALID_CATEGORY', '请选择有效的课程分类', 400);
  const teachers = Array.isArray(body.teachers) ? body.teachers.map(Number).filter(Boolean) : (body.teacher_id ? [Number(body.teacher_id)] : []);
  if (teachers.some((staffId) => !db.staff.some((staff) => staff.id === staffId))) return fail(res, 'INVALID_TEACHER', '任课教师资料不存在，请刷新页面后重试', 400);
  const rawSchedules = Array.isArray(body.schedules) ? body.schedules : [];
  if (rawSchedules.some((schedule) => !schedule.time_slot_id || !schedule.venue_id)) return fail(res, 'INVALID_SCHEDULE', '每条排课都必须选择时间段和场地', 400);
  const schedules = rawSchedules.map((schedule) => ({ time_slot_id: String(schedule.time_slot_id), venue_id: Number(schedule.venue_id) }));
  if (schedules.some((schedule) => !db.time_slots.some((slot) => slot.id === schedule.time_slot_id))) return fail(res, 'INVALID_TIME_SLOT', '排课时间段不存在，请刷新页面后重试', 400);
  if (schedules.some((schedule) => !db.venues.some((venue) => venue.id === schedule.venue_id))) return fail(res, 'INVALID_VENUE', '排课场地不存在，请刷新页面后重试', 400);
  const scheduleKeys = schedules.map((schedule) => `${schedule.time_slot_id}|${schedule.venue_id}`);
  if (new Set(scheduleKeys).size !== scheduleKeys.length) return fail(res, 'DUPLICATE_SCHEDULE', '同一时间和场地不能重复添加', 400);
  const status = body.status || 'DRAFT';
  if (!['DRAFT', 'OPEN', 'CLOSED', 'FINISHED', 'ARCHIVED'].includes(status)) return fail(res, 'INVALID_STATUS', '课程状态无效', 400);
  if (status === 'OPEN' && (!teachers.length || !schedules.length)) return fail(res, 'COURSE_NOT_READY', '开放报名的课程必须安排教师、上课时间和场地', 400);

  const allowedScope = body.allowed_scope || { type: 'all' };
  if (!['all', 'grades', 'classes'].includes(allowedScope.type)) return fail(res, 'INVALID_SCOPE', '可报名范围无效', 400);
  if (allowedScope.type === 'grades' && (!(allowedScope.grades instanceof Array) || !allowedScope.grades.length || allowedScope.grades.some((gradeId) => !db.grades.some((grade) => grade.id === Number(gradeId))))) {
    return fail(res, 'INVALID_SCOPE', '请选择至少一个有效年级', 400);
  }
  if (allowedScope.type === 'classes' && (!(allowedScope.classes instanceof Array) || !allowedScope.classes.length || allowedScope.classes.some((classId) => !db.classes.some((schoolClass) => schoolClass.id === Number(classId))))) {
    return fail(res, 'INVALID_SCOPE', '请选择至少一个有效班级', 400);
  }

  const existing = id ? getCourse(id) : null;
  // 容量不可低于当前有效报名
  if (existing && capacity < existing.active_count) {
    return fail(res, 'CAPACITY_BELOW_ENROLLED', `容量(${capacity})低于当前已报名人数(${existing.active_count})`, 400);
  }
  const conflicts = {
    teacher: scheduleConflicts.teacherConflicts(db, id || -1, teachers, schedules),
    venue: venueConflicts(id || -1, schedules),
    student: existing ? studentConflicts(id, schedules) : { count: 0, students: [], reasons: [] },
  };
  if (conflicts.teacher.length || conflicts.venue.length || conflicts.student.count) {
    return fail(res, 'HARD_CONFLICT', '保存失败：存在硬冲突', 409, conflicts);
  }

  if (existing) {
    const before = { name: existing.name, capacity: existing.capacity, status: existing.status };
    existing.name = name; existing.category_id = categoryId; existing.capacity = capacity;
    existing.description = body.description || ''; existing.status = status;
    existing.allowed_scope_json = JSON.stringify(allowedScope);
    existing.version += 1; existing.updated_by = user.id; existing.updated_at = new Date().toISOString();
    // 重建老师与排课
    db.course_staff = db.course_staff.filter((x) => x.course_id !== existing.id);
    teachers.forEach((tid) => db.course_staff.push({ course_id: existing.id, staff_id: tid, role: 'TEACHER' }));
    db.course_schedules = db.course_schedules.filter((x) => x.course_id !== existing.id);
    schedules.forEach((s) => db.course_schedules.push({ id: nextId('course_schedules'), course_id: existing.id, time_slot_id: s.time_slot_id, venue_id: s.venue_id }));
    save();
    audit(user.id, 'UPDATE_COURSE', 'course', existing.id, before, { name, capacity, status }, ip);
    return { course: courseToView(existing) };
  }
  const cid = nextId('courses');
  db.courses.push({ id: cid, name, category_id: categoryId, description: body.description || '', cover_url: '', capacity, active_count: 0, status, enroll_start_at: null, enroll_end_at: null, course_start_date: null, course_end_date: null, allowed_scope_json: JSON.stringify(allowedScope), version: 1, created_by: user.id, updated_by: user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  teachers.forEach((tid) => db.course_staff.push({ course_id: cid, staff_id: tid, role: 'TEACHER' }));
  schedules.forEach((s) => db.course_schedules.push({ id: nextId('course_schedules'), course_id: cid, time_slot_id: s.time_slot_id, venue_id: s.venue_id }));
  save();
  audit(user.id, 'CREATE_COURSE', 'course', cid, null, { name }, ip);
  return { course: courseToView(getCourse(cid)) };
}

function previewConflicts(id, body) {
  const teachers = Array.isArray(body.teachers) ? body.teachers.map(Number).filter(Boolean) : [];
  const schedules = Array.isArray(body.schedules) ? body.schedules.filter((s) => s.time_slot_id && s.venue_id) : [];
  return {
    teacher: scheduleConflicts.teacherConflicts(db, id || -1, teachers, schedules),
    venue: venueConflicts(id || -1, schedules),
    student: id ? studentConflicts(id, schedules) : { count: 0, students: [], reasons: [] },
  };
}

// 存储就绪后再监听端口，确保请求到达时内存数据已加载
storeReady.then(() => {
  server.listen(PORT, () => {
    console.log(`[选课排课] 后端已启动: http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== 'production') console.log('[选课排课] 本地演示账号已加载，生产环境不会输出账号密码。');
  });
}).catch((err) => {
  console.error('[选课排课] 存储初始化失败，服务无法启动:', err);
  process.exit(1);
});
