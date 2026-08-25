'use strict';

/**
 * 存储层：支持三种持久化后端
 *  1) 文件模式（默认，零依赖）：内存镜像 + data.json 兜底落盘。适合本地演示、无依赖启动。
 *  2) CloudBase MySQL SDK 网关（DB_MODE=cloudbase_mysql）：
 *       - 把完整运行时快照轮换写入 MySQL 的 app_snapshots A/B 两行，单行更新天然原子
 *       - 通过 CloudBase 服务端 SDK / HTTPS 网关调用，不依赖 VPC，也不暴露 MySQL 公网地址
 *  3) MySQL / 云数据库（配置 DB_HOST 或 DB_MODE=mysql 后启用）：
 *       - 启动跑 docs/schema.sql 建表（幂等）
 *       - 库为空则写入种子数据，否则从库加载快照到内存并恢复自增序列
 *       - 每次 save() 异步（事务批量）刷新到库，保证云托管弹性实例重启后数据不丢
 *
 * 无论哪种后端，server.js 都通过同步方式读内存 db（读路径零改动）；
 * MySQL 仅作为“持久化镜像”，写路径经 save() 异步落库。
 */

const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./auth');

// 容器环境可通过 DATA_FILE 指向可写的临时目录；生产数据仍应使用 MySQL 持久化。
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const SCHEMA_FILE = path.join(__dirname, '..', '..', 'docs', 'schema.sql');

const db = {
  users: [],
  grades: [],
  classes: [],
  students: [],
  staff: [],
  course_categories: [],
  venues: [],
  time_slots: [],
  courses: [],
  course_staff: [],
  course_schedules: [],
  enrollments: [],
  system_configs: [],
  audit_logs: [],
};

let seq = {};
function nextId(collection) {
  seq[collection] = (seq[collection] || 0) + 1;
  return seq[collection];
}

/* ----------------------------- MySQL 配置（懒加载） ----------------------------- */

const DB_MODE = String(
  process.env.DB_MODE || (process.env.DB_HOST ? 'mysql' : 'file')
).toLowerCase();
const USE_CLOUDBASE_MYSQL = DB_MODE === 'cloudbase_mysql';
const USE_MYSQL = DB_MODE === 'mysql';
const DB_CFG = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kexu',
  charset: 'utf8mb4',
  dateStrings: true,        // DATETIME/TIME 以字符串返回，避免时区漂移
  multipleStatements: true, // 允许一次性执行 schema.sql
  connectionLimit: 5,
  waitForConnections: true,
};

let _mysql = null;
function mysql2() {
  if (!USE_MYSQL) return null;
  if (!_mysql) {
    try {
      _mysql = require('mysql2/promise');
    } catch (e) {
      console.warn('[存储] 已配置 DB_HOST 但未安装 mysql2，回退到文件存储。请执行 `npm install mysql2`。');
      return null;
    }
  }
  return _mysql;
}

let pool = null;
let mysqlReady = false;
async function getPool() {
  if (!mysqlReady) return null;
  if (!pool) pool = mysql2().createPool(DB_CFG);
  return pool;
}

/* ------------------------- CloudBase MySQL SDK 网关 ------------------------- */

const CLOUDBASE_ENV_ID = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV || '';
const CLOUDBASE_MYSQL_TABLE = process.env.CLOUDBASE_MYSQL_TABLE || 'app_snapshots';
const CLOUDBASE_SNAPSHOT_KEY = process.env.CLOUDBASE_SNAPSHOT_KEY || 'runtime';
const CLOUDBASE_SNAPSHOT_SLOTS = [`${CLOUDBASE_SNAPSHOT_KEY}_a`, `${CLOUDBASE_SNAPSHOT_KEY}_b`];

let cloudbaseMysqlReady = false;
let cloudbaseMysql = null;
let cloudbaseSnapshotRevision = 0;

function cloudbaseSdk() {
  if (!USE_CLOUDBASE_MYSQL) return null;
  try {
    return require('@cloudbase/node-sdk');
  } catch (e) {
    console.error('[存储] 已配置 DB_MODE=cloudbase_mysql 但未安装 @cloudbase/node-sdk。');
    return null;
  }
}

function snapshotJson(revision) {
  return JSON.stringify({
    schema_version: 1,
    revision,
    db,
    seq,
  });
}

async function saveCloudBaseMysqlSnapshot() {
  if (!cloudbaseMysql) throw new Error('CloudBase MySQL 网关尚未初始化');
  const nextRevision = cloudbaseSnapshotRevision + 1;
  const row = {
    snapshot_key: CLOUDBASE_SNAPSHOT_SLOTS[nextRevision % 2],
    payload: snapshotJson(nextRevision),
    updated_at: new Date().toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d+$/, ''),
  };

  // 网关偶发超时时重试一次；upsert 同一主键具备幂等性。
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await cloudbaseMysql
        .from(CLOUDBASE_MYSQL_TABLE)
        .upsert(row, { onConflict: 'snapshot_key' })
        .throwOnError();
      cloudbaseSnapshotRevision = nextRevision;
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function loadFromCloudBaseMysql() {
  if (!CLOUDBASE_ENV_ID) {
    throw new Error('缺少 CLOUDBASE_ENV_ID 环境变量');
  }

  const sdk = cloudbaseSdk();
  if (!sdk) throw new Error('CloudBase SDK 不可用');

  const app = sdk.init({ env: CLOUDBASE_ENV_ID });
  cloudbaseMysql = app.rdb();

  const result = await cloudbaseMysql
    .from(CLOUDBASE_MYSQL_TABLE)
    .select('snapshot_key,payload')
    .in('snapshot_key', CLOUDBASE_SNAPSHOT_SLOTS)
    .throwOnError();

  const snapshots = [];
  for (const row of (result && Array.isArray(result.data) ? result.data : [])) {
    if (!row || !row.payload) continue;
    try {
      const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (parsed && parsed.db) snapshots.push(parsed);
    } catch (e) {
      console.warn(`[存储] 忽略无法解析的 MySQL 快照槽位: ${row.snapshot_key}`);
    }
  }
  snapshots.sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0));
  const snapshot = snapshots[0];
  if (snapshot) {
    Object.assign(db, snapshot.db);
    seq = snapshot.seq || {};
    cloudbaseSnapshotRevision = Number(snapshot.revision || 0);
    console.log('[存储] 已通过 CloudBase SDK 网关从 MySQL 加载快照。');
    return;
  }

  seed();
  await saveCloudBaseMysqlSnapshot();
  console.log('[存储] MySQL 快照表为空，已通过 SDK 网关写入种子数据。');
}

const COLLECTIONS = [
  'users', 'grades', 'classes', 'students', 'staff',
  'course_categories', 'venues', 'time_slots', 'courses',
  'course_staff', 'course_schedules', 'enrollments',
  'system_configs', 'audit_logs',
];

// 需要 ISO <-> 'YYYY-MM-DD HH:MM:SS' 互转的列
const DATETIME_COLS = {
  users: ['created_at', 'updated_at', 'locked_until'],
  courses: ['created_at', 'updated_at'],
  enrollments: ['enrolled_at', 'cancelled_at'],
  system_configs: ['updated_at'],
  audit_logs: ['created_at'],
};

// 以 TEXT 存储的 JSON 字符串字段（已是序列化字符串），原样读写，避免驱动自动解析
const JSON_TEXT_COLS = {
  courses: ['allowed_scope_json'],
  audit_logs: ['before_json', 'after_json'],
};

function toSqlDatetime(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return toSqlDatetime(v.toISOString());
  if (typeof v === 'string') {
    // '2026-08-03T12:00:00.000Z' -> '2026-08-03 12:00:00'
    return String(v).replace('T', ' ').replace('Z', '').replace(/\.\d+$/, '');
  }
  return v;
}

function writeVal(collection, col, val) {
  if (val === null || val === undefined) return null;
  if ((JSON_TEXT_COLS[collection] || []).indexOf(col) !== -1) {
    return typeof val === 'string' ? val : JSON.stringify(val);
  }
  if ((DATETIME_COLS[collection] || []).indexOf(col) !== -1) {
    return toSqlDatetime(val);
  }
  return val;
}

function readVal(collection, col, val) {
  if (val === null || val === undefined) return null;
  if ((JSON_TEXT_COLS[collection] || []).indexOf(col) !== -1) {
    return val; // 已是字符串
  }
  if ((DATETIME_COLS[collection] || []).indexOf(col) !== -1) {
    if (typeof val === 'string' && val.indexOf(' ') !== -1) return val.replace(' ', 'T');
    return val;
  }
  return val;
}

/* ----------------------------- 种子数据 ----------------------------- */

function seed() {
  // 时间槽：周一~周五 × 第6/7/8节
  const periodTimes = { 6: ['14:00', '14:45'], 7: ['15:00', '15:45'], 8: ['16:00', '16:45'] };
  const wdName = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五' };
  for (let wd = 1; wd <= 5; wd++) {
    for (const p of [6, 7, 8]) {
      db.time_slots.push({
        id: `t-${wd}-${p}`,
        name: `${wdName[wd]} 第${p}节`,
        weekday: wd,
        period: p,
        start_time: periodTimes[p][0],
        end_time: periodTimes[p][1],
        status: 'ACTIVE',
      });
    }
  }
  const slot = (wd, p) => `t-${wd}-${p}`;

  // 年级 / 班级
  const g1 = nextId('grades'); db.grades.push({ id: g1, name: '七年级', sort_order: 1, status: 'ACTIVE' });
  const g2 = nextId('grades'); db.grades.push({ id: g2, name: '八年级', sort_order: 2, status: 'ACTIVE' });
  const g3 = nextId('grades'); db.grades.push({ id: g3, name: '九年级', sort_order: 3, status: 'ACTIVE' });
  const c1 = nextId('classes'); db.classes.push({ id: c1, grade_id: g1, name: '七年级 1 班', sort_order: 1, status: 'ACTIVE' });
  const c2 = nextId('classes'); db.classes.push({ id: c2, grade_id: g1, name: '七年级 2 班', sort_order: 2, status: 'ACTIVE' });
  const c3 = nextId('classes'); db.classes.push({ id: c3, grade_id: g2, name: '八年级 1 班', sort_order: 1, status: 'ACTIVE' });

  // 课程分类
  const catMap = {};
  ['球类运动', '特色项目', '科技体育', '低冲撞', '基础课程', '科技课程', '传统体育', '创客', '阅读', '艺术', '体育', '语言'].forEach((name, i) => {
    const id = nextId('course_categories');
    db.course_categories.push({ id, name, sort_order: i + 1, status: 'ACTIVE' });
    catMap[name] = id;
  });

  // 场地
  const venueMap = {};
  ['创客教室', '机房 A', '阅览室', '美术教室', '体育馆', '报告厅', '实验室 2', '田径场东区', '田径场西区',
   '体育馆 A 区', '体育馆 B 区', '架空层 1 区', '架空层 2 区', '电脑室 2', '校园定向路线', '音乐教室'].forEach((name) => {
    const id = nextId('venues');
    db.venues.push({ id, name, parent_id: null, status: 'ACTIVE', remark: '' });
    venueMap[name] = id;
  });

  // 教职工（教师）
  const staffMap = {};
  ['张老师', '王老师', '李老师', '陈老师', '刘老师', '梁老师', '黄老师', '周老师', '谢老师', '吴老师', '罗老师'].forEach((name) => {
    const id = nextId('staff');
    db.staff.push({ id, user_id: null, staff_no: `T${id}`, name, status: 'ACTIVE' });
    staffMap[name] = id;
  });

  // 超级管理员（bootstrap）
  const adminPwd = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'demo123456';
  const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
  db.users.push({
    id: nextId('users'), username: adminUsername, display_name: process.env.BOOTSTRAP_ADMIN_NAME || adminUsername,
    password_hash: hashPassword(adminPwd), user_type: 'SUPER_ADMIN', status: 'ACTIVE',
    must_change_password: true, failed_login_count: 0, locked_until: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  // 学生 + 登录账号
  const studentSeed = [
    { no: '20260108', name: '林晓雨', grade: g1, cls: c1, status: 'ACTIVE' },
    { no: '20260112', name: '赵子安', grade: g1, cls: c1, status: 'ACTIVE' },
    { no: '20260126', name: '顾言川', grade: g1, cls: c1, status: 'ACTIVE' },
    { no: '20260203', name: '周清禾', grade: g1, cls: c2, status: 'ACTIVE' },
    { no: '20260218', name: '许星遥', grade: g1, cls: c2, status: 'ACTIVE' },
    { no: '20270105', name: '沈知夏', grade: g2, cls: c3, status: 'ACTIVE' },
  ];
  const studentUserMap = {};
  studentSeed.forEach((s) => {
    const uid = nextId('users');
    db.users.push({
      id: uid, username: s.no, display_name: s.name, password_hash: hashPassword('123456'),
      user_type: 'STUDENT', status: 'ACTIVE', must_change_password: true,
      failed_login_count: 0, locked_until: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const sid = nextId('students');
    db.students.push({ id: sid, user_id: uid, student_no: s.no, name: s.name, grade_id: s.grade, class_id: s.cls, status: s.status });
    studentUserMap[s.no] = { uid, sid };
  });

  // 课程定义
  const STATUS = { OPEN: 'OPEN', DRAFT: 'DRAFT', CLOSED: 'CLOSED', FINISHED: 'FINISHED', ARCHIVED: 'ARCHIVED' };
  const scope = (type, ids) => JSON.stringify(type === 'all' ? { type: 'all' } : { type, [type === 'grades' ? 'grades' : 'classes']: ids });

  const courseDefs = [
    { name: '羽毛球进阶', cat: '球类运动', teacher: '陈老师', wd: 2, p: 8, venue: '体育馆 A 区', cap: 28, active: 22, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '极限飞盘', cat: '特色项目', teacher: '梁老师', wd: 4, p: 8, venue: '田径场东区', cap: 36, active: 24, status: STATUS.OPEN, scope: scope('grades', [g1, g2]) },
    { name: 'AI 智能跳绳', cat: '科技体育', teacher: '黄老师', wd: 2, p: 8, venue: '架空层 2 区', cap: 40, active: 37, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '地壶球', cat: '低冲撞', teacher: '周老师', wd: 4, p: 8, venue: '体育馆 B 区', cap: 30, active: 15, status: STATUS.OPEN, scope: scope('grades', [g1, g2, g3]) },
    { name: '体适能与体测提升', cat: '基础课程', teacher: '李老师', wd: 3, p: 7, venue: '田径场西区', cap: 42, active: 31, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '无线电测向', cat: '科技体育', teacher: '谢老师', wd: 5, p: 7, venue: '校园定向路线', cap: 24, active: 24, status: STATUS.OPEN, scope: scope('grades', [g1, g2]) },
    { name: '武术基础', cat: '传统体育', teacher: '吴老师', wd: 1, p: 8, venue: '架空层 1 区', cap: 35, active: 19, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '趣味编程', cat: '科技课程', teacher: '罗老师', wd: 3, p: 8, venue: '电脑室 2', cap: 32, active: 26, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '机器人创客', cat: '创客', teacher: '张老师', wd: 1, p: 7, venue: '创客教室', cap: 26, active: 24, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '经典阅读', cat: '阅读', teacher: '李老师', wd: 2, p: 7, venue: '阅览室', cap: 30, active: 21, status: STATUS.OPEN, scope: scope('all') },
    { name: '绘画基础', cat: '艺术', teacher: '陈老师', wd: 3, p: 7, venue: '美术教室', cap: 25, active: 22, status: STATUS.DRAFT, scope: scope('grades', [g1]) },
    { name: '篮球基础', cat: '体育', teacher: '刘老师', wd: 5, p: 6, venue: '体育馆', cap: 36, active: 30, status: STATUS.OPEN, scope: scope('all') },
    { name: '英语戏剧', cat: '语言', teacher: '王老师', wd: 4, p: 7, venue: '报告厅', cap: 30, active: 19, status: STATUS.OPEN, scope: scope('grades', [g2]) },
    { name: '科学实验', cat: '科技课程', teacher: '张老师', wd: 2, p: 8, venue: '实验室 2', cap: 24, active: 18, status: STATUS.OPEN, scope: scope('grades', [g1]) },
    { name: '校园主持', cat: '语言', teacher: '李老师', wd: 4, p: 8, venue: '报告厅', cap: 25, active: 17, status: STATUS.FINISHED, scope: scope('all') },
  ];

  const courseByName = {};
  courseDefs.forEach((def) => {
    const cid = nextId('courses');
    db.courses.push({
      id: cid, name: def.name, category_id: catMap[def.cat], description: `${def.name}：面向学生的校本课程。`,
      cover_url: '', capacity: def.cap, active_count: def.active, status: def.status,
      enroll_start_at: null, enroll_end_at: null, course_start_date: null, course_end_date: null,
      allowed_scope_json: def.scope, version: 1, created_by: 1, updated_by: 1,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    // 负责老师
    db.course_staff.push({ course_id: cid, staff_id: staffMap[def.teacher], role: 'TEACHER' });
    // 排课
    db.course_schedules.push({ id: nextId('course_schedules'), course_id: cid, time_slot_id: slot(def.wd, def.p), venue_id: venueMap[def.venue] });
    courseByName[def.name] = cid;
  });

  // 林晓雨 已报名：趣味编程 + 科学实验
  const lin = studentUserMap['20260108'];
  [courseByName['趣味编程'], courseByName['科学实验']].forEach((cid) => {
    db.enrollments.push({
      id: nextId('enrollments'), student_id: lin.sid, course_id: cid, status: 'ENROLLED',
      source: 'SEED', idempotency_key: `seed-${lin.sid}-${cid}`, enrolled_at: new Date().toISOString(),
      cancelled_at: null, operated_by: null, reason: null,
    });
  });

  // 系统配置（默认值见 PRD 待确认项）
  const defaults = [
    ['student.max_active_courses', '2', 'int'],
    ['student.max_courses_per_category', '0', 'int'],
    ['enrollment.allow_withdraw_after_start', 'false', 'bool'],
    ['enrollment.allow_reenroll', 'true', 'bool'],
    ['security.password_min_length', '8', 'int'],
    ['security.student_initial_password', '12345678', 'string'],
    ['security.login_max_failures', '5', 'int'],
    ['security.lock_minutes', '15', 'int'],
  ];
  defaults.forEach(([k, v, t]) => {
    db.system_configs.push({ config_key: k, config_value: v, value_type: t, updated_by: 1, updated_at: new Date().toISOString() });
  });
}

/* ----------------------------- 文件模式 ----------------------------- */

function loadOrSeedFile() {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.assign(db, raw.db);
    seq = raw.seq || {};
    return;
  }
  seed();
  saveFile();
}

function saveFile() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ db, seq }, null, 2));
}

/* ----------------------------- MySQL 模式 ----------------------------- */

async function loadFromMysql() {
  const p = await getPool();
  if (!p) throw new Error('连接池不可用');

  // 1) 兼容旧库迁移，再建表（MySQL 不支持 ADD COLUMN IF NOT EXISTS）
  const [userTables] = await p.query(
    "SELECT 1 FROM `information_schema`.`tables` WHERE `table_schema`=? AND `table_name`='users' LIMIT 1",
    [DB_CFG.database],
  );
  if (userTables.length) {
    const [displayNameColumns] = await p.query(
      "SELECT 1 FROM `information_schema`.`columns` WHERE `table_schema`=? AND `table_name`='users' AND `column_name`='display_name' LIMIT 1",
      [DB_CFG.database],
    );
    if (!displayNameColumns.length) {
      await p.query("ALTER TABLE `users` ADD COLUMN `display_name` VARCHAR(64) NOT NULL DEFAULT '' AFTER `username`");
    }
  }
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  await p.query(schema);

  // 2) 是否已初始化
  const [cnt] = await p.query('SELECT COUNT(*) AS n FROM `users`');
  if (cnt[0].n === 0) {
    seed();
    const conn = await p.getConnection();
    try {
      await flush(conn);
    } finally {
      conn.release();
    }
    console.log('[存储] MySQL 为空，已写入种子数据。');
  } else {
    for (const col of COLLECTIONS) {
      const [rows] = await p.query(`SELECT * FROM \`${col}\``);
      db[col] = rows.map((r) => {
        const o = {};
        for (const k of Object.keys(r)) o[k] = readVal(col, k, r[k]);
        return o;
      });
    }
    // 恢复自增序列，避免新插入 id 与已有冲突
    for (const col of COLLECTIONS) {
      const nums = db[col].map((r) => r.id).filter((x) => typeof x === 'number');
      seq[col] = nums.length ? Math.max(...nums) : 0;
    }
    console.log('[存储] 已从 MySQL 加载数据。');
  }
}

// 在事务内把内存快照批量同步到库（DELETE + INSERT）
async function flush(conn) {
  await conn.beginTransaction();
  try {
    for (const col of COLLECTIONS) {
      await conn.query(`DELETE FROM \`${col}\``);
      const rows = db[col] || [];
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const sql = `INSERT INTO \`${col}\` (${cols.map((c) => '`' + c + '`').join(',')}) VALUES ?`;
        const values = rows.map((r) => cols.map((c) => writeVal(col, c, r[c])));
        await conn.query(sql, [values]);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

// 序列化的异步落库链，避免并发 flush 互相覆盖
let saveChain = Promise.resolve();
let snapshotPending = false;
let activeDirectMutations = 0;
let snapshotDrain = null;
let mutationWaiters = [];

async function enterDirectMutation() {
  while (snapshotPending) await new Promise((resolve) => mutationWaiters.push(resolve));
  activeDirectMutations += 1;
}

function leaveDirectMutation() {
  activeDirectMutations = Math.max(0, activeDirectMutations - 1);
  if (activeDirectMutations === 0 && snapshotDrain) { snapshotDrain(); snapshotDrain = null; }
}

async function save() {
  // 同步写文件作为容器内临时兜底；持久数据仍以所选云存储为准。
  try { saveFile(); } catch (e) { /* ignore */ }
  if (!cloudbaseMysqlReady && !mysqlReady) return;
  saveChain = saveChain
    .then(async () => {
      snapshotPending = true;
      if (activeDirectMutations > 0) await new Promise((resolve) => { snapshotDrain = resolve; });
      try {
        if (cloudbaseMysqlReady) {
          await saveCloudBaseMysqlSnapshot();
          return;
        }
        const p = await getPool();
        if (!p) return;
        const conn = await p.getConnection();
        try {
          await flush(conn);
        } finally {
          conn.release();
        }
      } finally {
        snapshotPending = false;
        const waiters = mutationWaiters; mutationWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    })
    .catch((e) => console.error('[存储] 云端写入失败:', e.message));
  return saveChain;
}

// 报名高并发路径只更新相关行，避免每次报名都执行整库 DELETE + INSERT。
// 课程行使用 FOR UPDATE + 条件更新防止超卖；学生行由上层 Redis 锁串行化。
async function refreshEnrollmentState(studentId, courseId) {
  if (!mysqlReady) return false;
  const p = await getPool();
  if (!p) return false;
  const [[courseRows], [enrollmentRows]] = await Promise.all([
    p.query('SELECT * FROM `courses` WHERE `id` = ? LIMIT 1', [courseId]),
    p.query('SELECT * FROM `enrollments` WHERE `student_id` = ?', [studentId]),
  ]);
  if (courseRows[0]) {
    const current = db.courses.find((item) => item.id === Number(courseId));
    const fresh = {};
    for (const key of Object.keys(courseRows[0])) fresh[key] = readVal('courses', key, courseRows[0][key]);
    if (current) Object.assign(current, fresh);
  }
  db.enrollments = db.enrollments.filter((item) => item.student_id !== Number(studentId));
  enrollmentRows.forEach((row) => {
    const fresh = {};
    for (const key of Object.keys(row)) fresh[key] = readVal('enrollments', key, row[key]);
    db.enrollments.push(fresh);
  });
  return true;
}

async function persistEnrollmentMutation({ mode, courseId, enrollment, auditLog }) {
  if (!mysqlReady) return { handled: false };
  const p = await getPool();
  if (!p) return { handled: false };
  await enterDirectMutation();
  let conn;
  try {
    conn = await p.getConnection();
    await conn.beginTransaction();
    const [courseRows] = await conn.query('SELECT `active_count`,`capacity` FROM `courses` WHERE `id` = ? FOR UPDATE', [courseId]);
    if (!courseRows.length) {
      const error = new Error('课程不存在'); error.code = 'NOT_FOUND'; throw error;
    }
    if (mode === 'enroll') {
      const [updated] = await conn.query('UPDATE `courses` SET `active_count`=`active_count`+1,`version`=`version`+1 WHERE `id`=? AND `active_count`<`capacity`', [courseId]);
      if (!updated.affectedRows) { const error = new Error('课程名额已满'); error.code = 'COURSE_FULL'; throw error; }
    } else {
      await conn.query('UPDATE `courses` SET `active_count`=GREATEST(0,`active_count`-1),`version`=`version`+1 WHERE `id`=?', [courseId]);
    }

    const columns = Object.keys(enrollment);
    const values = columns.map((column) => writeVal('enrollments', column, enrollment[column]));
    const updates = columns.filter((column) => column !== 'id').map((column) => `\`${column}\`=VALUES(\`${column}\`)`).join(',');
    await conn.query(`INSERT INTO \`enrollments\` (${columns.map((column) => `\`${column}\``).join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON DUPLICATE KEY UPDATE ${updates}`, values);

    if (auditLog) {
      const auditColumns = Object.keys(auditLog);
      await conn.query(
        `INSERT INTO \`audit_logs\` (${auditColumns.map((column) => `\`${column}\``).join(',')}) VALUES (${auditColumns.map(() => '?').join(',')})`,
        auditColumns.map((column) => writeVal('audit_logs', column, auditLog[column])),
      );
    }
    const [freshRows] = await conn.query('SELECT `active_count`,`version` FROM `courses` WHERE `id`=?', [courseId]);
    await conn.commit();
    return { handled: true, activeCount: Number(freshRows[0].active_count), version: Number(freshRows[0].version) };
  } catch (error) {
    if (conn) await conn.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
    leaveDirectMutation();
  }
}

/* ----------------------------- 统一初始化入口 ----------------------------- */

async function initStore() {
  if (USE_CLOUDBASE_MYSQL) {
    try {
      if (!cloudbaseSdk()) throw new Error('CloudBase SDK 不可用');
      await loadFromCloudBaseMysql();
      cloudbaseMysqlReady = true;
      console.log(`[存储] 使用 CloudBase MySQL SDK 网关: ${CLOUDBASE_ENV_ID}/${CLOUDBASE_MYSQL_TABLE}/${CLOUDBASE_SNAPSHOT_KEY}_{a,b}`);
      return;
    } catch (e) {
      cloudbaseMysqlReady = false;
      cloudbaseMysql = null;
      throw new Error(`CloudBase MySQL SDK 网关初始化失败: ${e.message}`);
    }
  }
  if (USE_MYSQL && mysql2()) {
    try {
      pool = mysql2().createPool(DB_CFG);
      mysqlReady = true;
      await loadFromMysql();
      console.log(`[存储] 使用 MySQL 持久化: ${DB_CFG.host}:${DB_CFG.port}/${DB_CFG.database}`);
      return;
    } catch (e) {
      console.error('[存储] MySQL 初始化失败，回退到文件存储:', e.message);
      mysqlReady = false;
      pool = null;
    }
  }
  loadOrSeedFile();
}

module.exports = { db, nextId, initStore, save, refreshEnrollmentState, persistEnrollmentMutation };
