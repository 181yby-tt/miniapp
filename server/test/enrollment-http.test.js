'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { enrollmentFixture } = require('./helpers/enrollment-fixture');

test('自主报名 HTTP 回归：隔离数据、并发名额、规则、名单及重启持久化', { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'enrollment-regression-'));
  const file = path.join(directory, 'data.json');
  const secret = crypto.randomBytes(32).toString('hex');
  await writeFile(file, JSON.stringify(enrollmentFixture()));
  let child;
  let base;
  async function start() {
    child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], { env: { ...process.env, TOKEN_SECRET: secret, PORT: '0', DATA_FILE: file, DB_MODE: 'file', REDIS_URL: '', NODE_ENV: 'test', RATE_LIMIT_ENROLL_PER_10_SECONDS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('服务启动超时')), 10000);
      let output = '';
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`服务退出 ${code}: ${output}`)); });
      child.stdout.on('data', (data) => { output += data; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
      child.stderr.on('data', (data) => { output += data; });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; } }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  const token = (id) => { const payload = Buffer.from(JSON.stringify({ uid: id })).toString('base64url'); return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; };
  const request = async (url, id = 1000, method = 'GET', body) => {
    const response = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const enroll = (student, course, key = `student-${student}-course-${course}`) => request(`/api/courses/${course}/enroll`, student, 'POST', { idempotency_key: key });
  const setConfig = (key, value) => request('/api/admin/configs', 1000, 'PUT', { items: [{ key, value }] });
  let winners;
  await t.test('60 个学生同时争抢 20 个名额，只成功 20 个', async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => enroll(i + 1, 1)));
    winners = results.flatMap((result, i) => result.status === 200 ? [i + 1] : []);
    assert.equal(winners.length, 20);
    assert.equal(results.filter((result) => result.code === 'COURSE_FULL').length, 40);
    const course = (await request('/api/admin/courses')).data.items.find((item) => item.id === 1);
    assert.equal(course.active_count, 20);
    assert.equal((await request('/api/admin/courses/1/enrollments')).data.items.length, 20);
  });
  await t.test('重复请求返回同一记录，课程人数不增加', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => enroll(winners[0], 1)));
    assert.ok(results.every((result) => result.status === 200 && result.data.idempotent));
    assert.equal((await request('/api/admin/courses/1/enrollments')).data.items.length, 20);
    assert.equal((await enroll(61, 2, `student-${winners[0]}-course-1`)).code, 'IDEMPOTENCY_CONFLICT');
  });
  await t.test('同一学生跨课程并发，选课上限只允许一门', async () => {
    const results = await Promise.all([enroll(61, 2), enroll(61, 3)]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.code === 'STUDENT_LIMIT_REACHED').length, 1);
  });
  await t.test('同一学生跨课程并发，时间冲突只允许一门', async () => {
    assert.equal((await setConfig('student.max_active_courses', '2')).status, 200);
    const results = await Promise.all([enroll(62, 2), enroll(62, 4)]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.code === 'STUDENT_TIME_CONFLICT').length, 1);
  });
  await t.test('教学组、开放时间、截止时间都在服务端校验', async () => {
    assert.equal((await enroll(64, 2)).code, 'STUDENT_SCOPE_MISMATCH');
    assert.equal((await request('/api/courses', 64)).data.items.length, 0);
    assert.equal((await enroll(63, 5)).code, 'ENROLLMENT_NOT_STARTED');
    assert.equal((await enroll(63, 6)).code, 'ENROLLMENT_ENDED');
    assert.equal((await request('/api/courses/5/eligibility', 63)).data.code, 'ENROLLMENT_NOT_STARTED');
  });
  await t.test('暂停后不能报名，重新开放不要求所有学生都有名额', async () => {
    assert.equal((await request('/api/admin/teaching-groups/1/close', 1000, 'POST', {})).status, 410);
    assert.equal((await request('/api/admin/courses/1/close', 1000, 'POST', {})).status, 200);
    assert.equal((await enroll(63, 1)).code, 'COURSE_NOT_OPEN');
    assert.equal((await request('/api/courses/1/enrollment', winners[0], 'DELETE', {})).code, 'WITHDRAW_CLOSED');
    const courses = (await request('/api/admin/courses')).data.items;
    for (const course of courses) {
      const payload = { ...course, teachers: course.teacher_ids, capacity: Math.max(course.active_count, 3) };
      if (course.id === 1) assert.equal((await request('/api/admin/courses/1', 1000, 'PUT', { ...payload, capacity: 19 })).code, 'CAPACITY_BELOW_ENROLLED');
      assert.equal((await request(`/api/admin/courses/${course.id}`, 1000, 'PUT', payload)).status, 200);
    }
    assert.ok((await request('/api/admin/courses')).data.items.reduce((sum, row) => sum + row.capacity, 0) < 63);
    assert.equal((await request('/api/admin/teaching-groups/1/open', 1000, 'POST', {})).status, 410);
    assert.equal((await request('/api/admin/courses/1/open', 1000, 'POST', {})).status, 200);
  });
  await t.test('报名时间保存生效，拒绝倒置时间和无效容量', async () => {
    const course = (await request('/api/admin/courses')).data.items.find((item) => item.id === 5);
    const payload = { ...course, teachers: course.teacher_ids };
    assert.equal((await request('/api/admin/courses/5', 1000, 'PUT', { ...payload, capacity: '3people' })).status, 400);
    assert.equal((await request('/api/admin/courses/5', 1000, 'PUT', { ...payload, enroll_start_at: '2030-01-01T01:00:00Z', enroll_end_at: '2030-01-01T00:00:00Z' })).code, 'INVALID_TIME');
    assert.equal((await request('/api/courses/5/eligibility', 63)).data.code, 'ENROLLMENT_NOT_STARTED');
    assert.equal((await setConfig('student.max_active_courses', 'NaN')).status, 400);
  });
  await t.test('重复退课仅释放一次名额，重新报名规则生效', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => request('/api/courses/1/enrollment', winners[0], 'DELETE', {})));
    assert.equal(results.reduce((sum, r) => sum + r.data.released, 0), 1);
    assert.equal((await setConfig('enrollment.allow_reenroll', 'false')).status, 200);
    assert.equal((await enroll(winners[0], 1, 'reenroll-denied')).code, 'REENROLL_DISABLED');
    assert.equal((await setConfig('enrollment.allow_reenroll', 'true')).status, 200);
    assert.equal((await enroll(winners[0], 1, 'reenroll-allowed')).status, 200);
  });
  await t.test('旧志愿写接口关闭，不能覆盖报名记录', async () => {
    assert.equal((await request('/api/preferences/current', 1, 'PUT', { course_ids: [1, 2] })).status, 410);
    for (const action of ['simulate', 'publish']) assert.equal((await request(`/api/admin/teaching-groups/1/${action}`, 1000, 'POST', {})).status, 410);
  });
  await t.test('管理端代报名与代退课，学生的课程和课表同步', async () => {
    const result = await request('/api/admin/courses/3/enrollments', 1000, 'POST', { student_id: 63, idempotency_key: 'staff-63' });
    assert.equal(result.status, 200);
    assert.equal((await request('/api/me/enrollments', 63)).data.items[0].id, 3);
    assert.equal((await request('/api/me/schedule', 63)).data.items[0].course_id, 3);
    assert.equal((await request(`/api/admin/enrollments/${result.data.enrollment.id}`, 1000, 'DELETE', {})).status, 200);
    assert.equal((await request('/api/me/enrollments', 63)).data.items.length, 0);
  });
  await t.test('已报名/未报名完整且互斥，退课学生进入未报名名单', async () => {
    const roster = (await request('/api/admin/enrollment-roster')).data;
    const registered = new Set(roster.enrolled.map((r) => r.student_id));
    assert.equal(registered.size + roster.unenrolled.length, 64);
    assert.ok(roster.unenrolled.every((row) => !registered.has(row.student_id)));
    assert.ok(roster.unenrolled.some((row) => row.student_id === 63));
    assert.ok(roster.enrolled.every((row) => row.class_name && row.grade && row.student_no.startsWith('00')));
    assert.equal((await request('/api/admin/enrollment-roster', 1)).status, 403);
    assert.equal((await request('/api/admin/enrollment-roster?group_id=1')).data.student_count, 63);
  });
  await t.test('报名范围可切换，教学组只是可复用的班级配置', async () => {
    const fixture = enrollmentFixture().db;
    const classId = fixture.students[0].class_id;
    const gradeId = fixture.students[0].grade_id;
    const created = await request('/api/admin/teaching-groups', 1000, 'POST', { name: '单班范围', grade_id: gradeId, class_ids: [classId] });
    assert.equal(created.status, 200);
    const groupId = created.data.group.id;
    assert.ok((await request('/api/admin/meta')).data.teaching_groups.some((g) => g.id === groupId));
    const course = (await request('/api/admin/courses')).data.items.find((c) => c.id === 5);
    const update = (allowed_scope) => request('/api/admin/courses/5', 1000, 'PUT', { ...course, teachers: course.teacher_ids, allowed_scope });
    assert.equal((await update({ type: 'groups', groups: [999999] })).code, 'INVALID_SCOPE');
    assert.equal((await update({ type: 'groups', groups: [groupId] })).status, 200);
    assert.equal((await request('/api/courses/5/eligibility', 1)).data.code, 'ENROLLMENT_NOT_STARTED');
    assert.equal((await request('/api/courses/5/eligibility', 64)).data.code, 'STUDENT_SCOPE_MISMATCH');
    assert.equal((await update({ type: 'all' })).status, 200);
    assert.equal((await request('/api/courses/5/eligibility', 64)).data.code, 'ENROLLMENT_NOT_STARTED');
  });
  await t.test('指定学生重置密码、改密状态与权限隔离', async () => {
    const before = (await request('/api/admin/students')).data.items;
    assert.equal(before.find((s) => s.id === 64).must_change_password, false);
    assert.equal((await request('/api/admin/students/64/reset-password', 1, 'POST', {})).status, 403);
    assert.equal((await request('/api/admin/students/999999/reset-password', 1000, 'POST', {})).status, 404);
    assert.equal((await request('/api/admin/students/64/reset-password', 1000, 'POST', {})).status, 200);
    const after = (await request('/api/admin/students')).data.items;
    assert.equal(after.find((s) => s.id === 64).must_change_password, true);
    assert.deepEqual(after.filter((s) => s.id !== 64), before.filter((s) => s.id !== 64));
    assert.ok(after.every((s) => !('password_hash' in s)));
    assert.equal((await request('/api/auth/login', 64, 'POST', { username: 'test64', password: 'TestOnly123!' })).code, 'INVALID_CREDENTIALS');
    assert.equal((await request('/api/auth/login', 64, 'POST', { username: 'test64', password: '12345678' })).data.must_change_password, true);
    assert.equal((await request('/api/auth/change-password', 64, 'POST', { old_password: '12345678', new_password: 'StudentNew123!', confirm_password: 'StudentNew123!' })).status, 200);
    assert.equal((await request('/api/admin/students')).data.items.find((s) => s.id === 64).must_change_password, false);
  });
  await t.test('重启后有效人数与名单保持一致', async () => {
    const prior = (await request('/api/admin/enrollment-roster')).data;
    await stop(); await start();
    const next = (await request('/api/admin/enrollment-roster')).data;
    assert.deepEqual(next.enrolled, prior.enrolled);
    assert.deepEqual(next.unenrolled, prior.unenrolled);
    const stored = JSON.parse(await readFile(file, 'utf8')).db;
    for (const course of stored.courses) {
      assert.equal(course.active_count, stored.enrollments.filter((r) => r.course_id === course.id && r.status === 'ENROLLED').length);
      assert.ok(course.active_count <= course.capacity);
    }
  });
});
