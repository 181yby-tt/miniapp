'use strict';

/**
 * 选课排课后端：零依赖 Node http 服务，实现选课排课核心逻辑。
 * - 报名：进程内课程锁串行化 + 条件更新（镜像 MySQL 行级锁/条件更新语义），保证不超卖、不重复。
 * - 幂等：enrollments.idempotency_key (student_id, key) 唯一约束。
 * - 冲突：教师 / 场地 / 学生时间 / 班额 硬冲突校验。
 * 生产环境将上述内存逻辑替换为 MySQL 事务 + 唯一索引（见 docs/schema.sql）。
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const pathlib = require('path');
const { URL } = require('url');
const { db, nextId, initStore, save } = require('./store');
const { hashPassword, verifyPassword, sign, verify } = require('./auth');
const { code2Session } = require('./config');

const PORT = process.env.PORT || 3000;
const STUDENT_PASSWORD_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_CONSOLE_FILE = pathlib.resolve(__dirname, '..', '..', 'admin-console.html');
const WEB_DIST_DIR = pathlib.resolve(process.env.WEB_DIST_DIR || pathlib.join(__dirname, '..', '..', 'apps', 'web', 'dist'));
const WEB_INDEX_FILE = pathlib.join(WEB_DIST_DIR, 'index.html');

// 异步初始化存储（MySQL 或文件模式），就绪后再监听端口
const storeReady = initStore();

/* ----------------------------- 工具 ----------------------------- */

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
  res.end(payload);
}

function ok(res, data) { send(res, 200, { code: 'OK', data }); }
function fail(res, code, message, status = 400, details = {}) { send(res, status, { code, message, request_id: `req_${Date.now()}`, details }); }

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

function generatedStudentPassword(name, studentNo) {
  const digest = crypto.createHmac('sha256', STUDENT_PASSWORD_SECRET).update(`${studentNo}|${name}`).digest('base64url');
  return `Xk@${digest.slice(0, 9)}`;
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

// 场地互斥集合（自身 + 父 + 子）
function expandVenue(vid) {
  const v = db.venues.find((x) => x.id === vid);
  const set = new Set([vid]);
  if (v && v.parent_id) set.add(v.parent_id);
  db.venues.forEach((x) => { if (x.parent_id === vid) set.add(x.id); });
  return set;
}

// 统计参与全局硬冲突（教师 / 场地时间重叠）的课程数量
function globalConflicts() {
  const active = db.courses.filter((c) => !['FINISHED', 'ARCHIVED'].includes(c.status));
  const bySlot = {};
  active.forEach((c) => {
    courseSchedules(c.id).forEach((sc) => {
      (bySlot[sc.time_slot_id] = bySlot[sc.time_slot_id] || []).push(c);
    });
  });
  const conflictIds = new Set();
  Object.values(bySlot).forEach((list) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]; const b = list[j];
        const ta = new Set(db.course_staff.filter((cs) => cs.course_id === a.id).map((cs) => cs.staff_id));
        const tb = new Set(db.course_staff.filter((cs) => cs.course_id === b.id).map((cs) => cs.staff_id));
        const teacherOverlap = [...ta].some((x) => tb.has(x));
        const va = expandVenueSet(a.id); const vb = expandVenueSet(b.id);
        const venueOverlap = [...va].some((x) => vb.has(x));
        if (teacherOverlap || venueOverlap) { conflictIds.add(a.id); conflictIds.add(b.id); }
      }
    }
  });
  return conflictIds.size;
}

// 课程所有排课场地的互斥集合并集
function expandVenueSet(courseId) {
  const set = new Set();
  courseSchedules(courseId).forEach((sc) => expandVenue(sc.venue_id).forEach((x) => set.add(x)));
  return set;
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

// 教师冲突：返回与新排课重叠的其他课程
function teacherConflicts(courseId, staffIds, timeSlotIds) {
  if (!staffIds.length || !timeSlotIds.length) return [];
  const out = [];
  db.courses.forEach((c) => {
    if (c.id === courseId) return;
    if (['FINISHED', 'ARCHIVED'].includes(c.status)) return;
    const sharesStaff = db.course_staff.some((cs) => cs.course_id === c.id && staffIds.includes(cs.staff_id));
    if (!sharesStaff) return;
    const overlap = db.course_schedules.some((sc) => sc.course_id === c.id && timeSlotIds.includes(sc.time_slot_id));
    if (overlap) out.push({ course_id: c.id, name: c.name, reason: '教师时间冲突' });
  });
  return out;
}

// 场地冲突：展开场地互斥集合（自身+父+子）后按时段查重
function venueConflicts(courseId, venueIds, timeSlotIds) {
  if (!venueIds.length || !timeSlotIds.length) return [];
  const conflictVenues = new Set();
  venueIds.forEach((vid) => expandVenue(vid).forEach((x) => conflictVenues.add(x)));
  const out = [];
  db.courses.forEach((c) => {
    if (c.id === courseId) return;
    if (['FINISHED', 'ARCHIVED'].includes(c.status)) return;
    const overlap = db.course_schedules.some((sc) => sc.course_id === c.id && timeSlotIds.includes(sc.time_slot_id) && conflictVenues.has(sc.venue_id));
    if (overlap) out.push({ course_id: c.id, name: c.name, reason: '场地时间冲突' });
  });
  return out;
}

// 学生冲突：修改时间后，已报名学生是否与其他课程时间重叠
function studentConflicts(courseId, timeSlotIds) {
  if (!timeSlotIds.length) return { count: 0, students: [] };
  const newSlots = new Set();
  timeSlotIds.forEach((ts) => { const s = db.time_slots.find((t) => t.id === ts); if (s) newSlots.add(`${s.weekday}-${s.period}`); });
  const affected = [];
  db.enrollments.filter((e) => e.course_id === courseId && e.status === 'ENROLLED').forEach((e) => {
    const other = studentEnrollments(e.student_id, 'ENROLLED').filter((x) => x.course_id !== courseId);
    const busy = new Set();
    other.forEach((x) => courseSchedules(x.course_id).forEach((sc) => { if (sc.weekday && sc.period) busy.add(`${sc.weekday}-${sc.period}`); }));
    const hit = [...newSlots].some((s) => busy.has(s));
    if (hit) { const st = getStudent(e.student_id); affected.push(st ? st.name : `#${e.student_id}`); }
  });
  return { count: affected.length, students: affected.slice(0, 20) };
}

/* ----------------------------- 报名 / 退课 ----------------------------- */

async function doEnroll(req, res, body, courseId, source, actorUser) {
  const release = await lock(`course:${courseId}`);
  try {
    const course = getCourse(courseId);
    if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
    if (source === 'STUDENT' && course.status !== 'OPEN') return fail(res, 'COURSE_NOT_OPEN', '课程未开放报名');
    if (source === 'STAFF' && ['FINISHED', 'ARCHIVED'].includes(course.status)) return fail(res, 'COURSE_NOT_OPEN', '课程已结束或归档，无法代报名');

    const student = source === 'STUDENT' ? getStudentByUser(actorUser.id) : getStudent(body.student_id);
    if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生不存在', 404);

    const idemKey = body.idempotency_key || `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 幂等：同 (student, key) 已报名成功则直接返回
    const idemRec = db.enrollments.find((e) => e.student_id === student.id && e.idempotency_key === idemKey && e.status === 'ENROLLED');
    if (idemRec) return ok(res, { enrollment: idemRec, course: courseToView(course, student), idempotent: true });

    // 已报名（不同 key）
    const existing = db.enrollments.find((e) => e.student_id === student.id && e.course_id === course.id);
    if (existing && existing.status === 'ENROLLED') return fail(res, 'ALREADY_ENROLLED', '你已报名该课程');

    // 范围
    if (source === 'STUDENT' && !studentMatchesScope(student, course.allowed_scope_json)) return fail(res, 'STUDENT_SCOPE_MISMATCH', '该课程不在你的可报名范围内');

    // 数量上限
    const maxActive = parseInt(getConfig('student.max_active_courses', '2'), 10);
    const activeCount = studentEnrollments(student.id, 'ENROLLED').length;
    if (activeCount >= maxActive) return fail(res, 'STUDENT_LIMIT_REACHED', `每名学生最多报名 ${maxActive} 门课程`);

    const maxPerCat = parseInt(getConfig('student.max_courses_per_category', '0'), 10);
    if (maxPerCat > 0) {
      const catCount = studentEnrollments(student.id, 'ENROLLED').filter((e) => getCourse(e.course_id).category_id === course.category_id).length;
      if (catCount >= maxPerCat) return fail(res, 'STUDENT_LIMIT_REACHED', `该分类最多报名 ${maxPerCat} 门课程`);
    }

    // 时间冲突
    const busy = studentBusySlots(student.id);
    const conflictSlot = courseSchedules(course.id).find((sc) => sc.weekday && sc.period && busy.has(`${sc.weekday}-${sc.period}`));
    if (conflictSlot) {
      const clash = db.enrollments.find((e) => e.student_id === student.id && e.status === 'ENROLLED' && courseSchedules(e.course_id).some((s) => s.weekday === conflictSlot.weekday && s.period === conflictSlot.period));
      const clashName = clash ? getCourse(clash.course_id).name : '其他课程';
      return fail(res, 'STUDENT_TIME_CONFLICT', `与“${clashName}”上课时间冲突`);
    }

    // 条件更新（名额）
    if (course.active_count >= course.capacity) return fail(res, 'COURSE_FULL', '课程名额已满');
    course.active_count += 1;
    course.version += 1;

    // 写入/复用报名记录
    let rec;
    if (existing && existing.status === 'CANCELLED') {
      existing.status = 'ENROLLED'; existing.enrolled_at = new Date().toISOString(); existing.cancelled_at = null;
      existing.idempotency_key = idemKey; existing.source = source; existing.operated_by = actorUser ? actorUser.id : null; existing.reason = body.reason || null;
      rec = existing;
    } else {
      rec = { id: nextId('enrollments'), student_id: student.id, course_id: course.id, status: 'ENROLLED', source, idempotency_key: idemKey, enrolled_at: new Date().toISOString(), cancelled_at: null, operated_by: actorUser ? actorUser.id : null, reason: body.reason || null };
      db.enrollments.push(rec);
    }
    save();
    audit(actorUser ? actorUser.id : student.user_id, source === 'STUDENT' ? 'ENROLL' : 'STAFF_ENROLL', 'course', course.id, null, { student_id: student.id }, req.ip);
    return ok(res, { enrollment: rec, course: courseToView(course, student) });
  } finally {
    release();
  }
}

async function doWithdraw(req, res, courseId, source, actorUser, body) {
  const release = await lock(`course:${courseId}`);
  try {
    const course = getCourse(courseId);
    if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
    const student = source === 'STUDENT' ? getStudentByUser(actorUser.id) : getStudent(body.student_id);
    if (!student) return fail(res, 'STUDENT_NOT_FOUND', '学生不存在', 404);
    const rec = db.enrollments.find((e) => e.student_id === student.id && e.course_id === course.id);
    if (!rec || rec.status !== 'ENROLLED') {
      // 幂等：已是退课状态直接返回
      return ok(res, { status: rec ? rec.status : 'NONE', released: 0 });
    }
    rec.status = 'CANCELLED'; rec.cancelled_at = new Date().toISOString();
    rec.operated_by = actorUser ? actorUser.id : null; rec.reason = body && body.reason ? body.reason : (source === 'STUDENT' ? '学生主动退课' : '管理员代退课');
    if (course.active_count > 0) course.active_count = course.active_count - 1;
    course.version += 1;
    save();
    audit(actorUser ? actorUser.id : student.user_id, source === 'STUDENT' ? 'WITHDRAW' : 'STAFF_WITHDRAW', 'course', course.id, null, { student_id: student.id }, req.ip);
    return ok(res, { status: 'CANCELLED', released: 1 });
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
  const ip = req.socket.remoteAddress || '';
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') body = await readBody(req);

  const requireUser = () => { if (!user) { fail(res, 'UNAUTHORIZED', '请先登录', 401); return false; } return true; };
  const requireStaff = () => { if (!user || !['STAFF', 'SUPER_ADMIN'].includes(user.user_type)) { fail(res, 'FORBIDDEN', '无权访问', 403); return false; } return true; };

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
    return ok(res, { token, user_type: u.user_type, must_change_password: u.must_change_password, username: u.username });
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
      return ok(res, { token, user_type: u.user_type, must_change_password: u.must_change_password, username: u.username, openid: wx.openid });
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
    return ok(res, { token, user_type: u.user_type, must_change_password: u.must_change_password, username: u.username });
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

  // 学生端
  if (path === '/api/courses' && method === 'GET') {
    const student = getStudentByUser(user.id);
    const q = url.searchParams.get('q') || '';
    const category = url.searchParams.get('category') || '';
    const onlyOpen = url.searchParams.get('open') === '1';
    let list = db.courses.filter((c) => c.status === 'OPEN' && studentMatchesScope(student, c.allowed_scope_json));
    if (category) list = list.filter((c) => (db.course_categories.find((x) => x.id === c.category_id) || {}).name === category);
    if (q) list = list.filter((c) => `${c.name}${courseTeachers(c.id).join('')}`.toLowerCase().includes(q.toLowerCase()));
    return ok(res, { items: list.map((c) => courseToView(c, student)), categories: [...new Set(db.courses.map((c) => (db.course_categories.find((x) => x.id === c.category_id) || {}).name).filter(Boolean))] });
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
    return doEnroll(req, res, body, path.split('/')[3], 'STUDENT', user);
  }

  if (/^\/api\/courses\/\d+\/enrollment$/.test(path) && method === 'DELETE') {
    return doWithdraw(req, res, path.split('/')[3], 'STUDENT', user, body);
  }

  if (path === '/api/me/enrollments' && method === 'GET') {
    const student = getStudentByUser(user.id);
    const items = studentEnrollments(student.id, 'ENROLLED').map((e) => ({ ...courseToView(getCourse(e.course_id), student), enrolled_at: e.enrolled_at }));
    const history = db.enrollments.filter((e) => e.student_id === student.id && e.status !== 'ENROLLED').map((e) => ({ course_id: e.course_id, name: getCourse(e.course_id).name, status: e.status, cancelled_at: e.cancelled_at }));
    return ok(res, { items, history, max_active: parseInt(getConfig('student.max_active_courses', '2'), 10) });
  }

  if (path === '/api/me/schedule' && method === 'GET') {
    const student = getStudentByUser(user.id);
    const items = studentEnrollments(student.id, 'ENROLLED').map((e) => {
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
    db.audit_logs.push({ id: nextId('audit_logs'), actor_id: user.id, action: 'CREATE_BASE_DATA', target_type: type, target_id: record.id, before_json: null, after_json: JSON.stringify({ name }), ip, created_at: new Date().toISOString() });
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
    const r = await saveCourse(res, body, null, user, ip);
    if (r) ok(res, r);
    return;
  }

  if (/^\/api\/admin\/courses\/\d+$/.test(path) && method === 'PUT') {
    if (!requireStaff()) return;
    const r = await saveCourse(res, body, Number(path.split('/')[4]), user, ip);
    if (r) ok(res, r);
    return;
  }

  if (/^\/api\/admin\/courses\/\d+\/conflicts$/.test(path) && method === 'GET') {
    if (!requireStaff()) return;
    return ok(res, previewConflicts(Number(path.split('/')[4]), body));
  }

  if (/^\/api\/admin\/courses\/\d+\/(open|close|archive)$/.test(path) && method === 'POST') {
    if (!requireStaff()) return;
    const id = Number(path.split('/')[4]);
    const action = path.split('/')[5];
    const course = getCourse(id);
    if (!course) return fail(res, 'NOT_FOUND', '课程不存在', 404);
    if (action === 'open') {
      const teachers = db.course_staff.filter((item) => item.course_id === id);
      const schedules = db.course_schedules.filter((item) => item.course_id === id);
      if (!teachers.length || !schedules.length) {
        return fail(res, 'COURSE_NOT_READY', '开放报名之前，请先安排任课教师、上课时间和场地', 400);
      }
    }
    const before = { status: course.status };
    course.status = { open: 'OPEN', close: 'CLOSED', archive: 'ARCHIVED' }[action];
    course.version += 1; course.updated_by = user.id; course.updated_at = new Date().toISOString();
    save();
    audit(user.id, `COURSE_${action.toUpperCase()}`, 'course', id, before, { status: course.status }, ip);
    return ok(res, { course: courseToView(course) });
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
    return doEnroll(req, res, { ...body, idempotency_key: body.idempotency_key || `staff-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}` }, Number(path.split('/')[4]), 'STAFF', user);
  }

  if (/^\/api\/admin\/enrollments\/\d+$/.test(path) && method === 'DELETE') {
    if (!requireStaff()) return;
    const eid = Number(path.split('/')[4]);
    const rec = db.enrollments.find((e) => e.id === eid);
    if (!rec) return fail(res, 'NOT_FOUND', '报名记录不存在', 404);
    return doWithdraw(req, res, rec.course_id, 'STAFF', user, { student_id: rec.student_id, reason: body.reason || '管理员代退课' });
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
        password: String(raw.password ?? ''),
      };
      if (!item.student_no) errors.push({ row_number: rowNumber, message: '学号为空' });
      else if (item.student_no.length > 32) errors.push({ row_number: rowNumber, message: '学号不能超过 32 个字符' });
      else if (seen.has(item.student_no)) errors.push({ row_number: rowNumber, message: '文件内学号重复' });
      else seen.add(item.student_no);
      if (!item.name) errors.push({ row_number: rowNumber, message: '姓名为空' });
      if (item.name.length > 64) errors.push({ row_number: rowNumber, message: '姓名不能超过 64 个字符' });
      if (item.grade.length > 32 || item.class_name.length > 32) errors.push({ row_number: rowNumber, message: '年级或班级不能超过 32 个字符' });
      if (item.password && (item.password.length < passwordMinLength || item.password.length > 128)) errors.push({ row_number: rowNumber, message: `初始密码必须为 ${passwordMinLength} 至 128 位` });
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
          const initialPassword = item.password || generatedStudentPassword(item.name, item.student_no);
          account = { id: nextId('users'), username: item.student_no, password_hash: passwordHash(initialPassword), user_type: 'STUDENT', status: 'ACTIVE', must_change_password: true, failed_login_count: 0, locked_until: null, created_at: now, updated_at: now };
          db.users.push(account); student.user_id = account.id;
          credentials.push({ name: item.name, student_no: item.student_no, username: item.student_no, password: initialPassword });
        } else {
          account.status = 'ACTIVE'; account.updated_at = now;
          if (item.password || body.reset_existing_password) {
            const initialPassword = item.password || generatedStudentPassword(item.name, item.student_no);
            account.password_hash = passwordHash(initialPassword);
            account.must_change_password = true;
            account.failed_login_count = 0; account.locked_until = null;
            credentials.push({ name: item.name, student_no: item.student_no, username: item.student_no, password: initialPassword });
          }
        }
        updated += 1;
      } else {
        const initialPassword = item.password || generatedStudentPassword(item.name, item.student_no);
        const account = { id: nextId('users'), username: item.student_no, password_hash: passwordHash(initialPassword), user_type: 'STUDENT', status: 'ACTIVE', must_change_password: true, failed_login_count: 0, locked_until: null, created_at: now, updated_at: now };
        db.users.push(account);
        student = { id: nextId('students'), user_id: account.id, student_no: item.student_no, name: item.name, grade_id: grade.id, class_id: cls.id, status: 'ACTIVE' };
        db.students.push(student);
        credentials.push({ name: item.name, student_no: item.student_no, username: item.student_no, password: initialPassword });
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
    (body.items || []).forEach((it) => {
      const row = db.system_configs.find((c) => c.config_key === it.key);
      if (row) { row.config_value = String(it.value); row.updated_by = user.id; row.updated_at = new Date().toISOString(); }
    });
    save();
    audit(user.id, 'UPDATE_CONFIG', 'system', 0, null, body.items, ip);
    return ok(res, { saved: true });
  }

  if (path === '/api/admin/audit' && method === 'GET') {
    if (!requireStaff()) return;
    return ok(res, { items: db.audit_logs.slice(-50).reverse() });
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
  const timeSlotIds = schedules.map((s) => s.time_slot_id);
  const venueIds = schedules.map((s) => s.venue_id);

  const conflicts = {
    teacher: teacherConflicts(id || -1, teachers, timeSlotIds),
    venue: venueConflicts(id || -1, venueIds, timeSlotIds),
    student: existing ? studentConflicts(id, timeSlotIds) : { count: 0, students: [] },
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
  const timeSlotIds = schedules.map((s) => s.time_slot_id);
  const venueIds = schedules.map((s) => s.venue_id);
  return {
    teacher: teacherConflicts(id || -1, teachers, timeSlotIds),
    venue: venueConflicts(id || -1, venueIds, timeSlotIds),
    student: id ? studentConflicts(id, timeSlotIds) : { count: 0, students: [] },
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
