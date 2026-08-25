'use strict';

const baseUrl = String(process.env.TARGET_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const parsedTarget = new URL(baseUrl);
if (!['127.0.0.1', 'localhost'].includes(parsedTarget.hostname) && process.env.ALLOW_REMOTE_CONSISTENCY_TEST !== 'true') {
  throw new Error('一致性测试会创建测试数据，只允许本机环境；远程测试必须明确设置 ALLOW_REMOTE_CONSISTENCY_TEST=true');
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  return { status: response.status, ...result };
}

async function main() {
  const admin = await request('/api/auth/login', { method: 'POST', body: { username: process.env.ADMIN_USERNAME || process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || 'demo123456' } });
  if (!admin.data?.token) throw new Error(`管理员登录失败：${admin.message || admin.status}`);
  const adminToken = admin.data.token;
  const stamp = Date.now().toString(36);

  const [teacher, venue, slot, meta] = await Promise.all([
    request('/api/admin/meta/staff', { method: 'POST', token: adminToken, body: { name: `压测教师-${stamp}` } }),
    request('/api/admin/meta/venues', { method: 'POST', token: adminToken, body: { name: `压测场地-${stamp}` } }),
    request('/api/admin/meta/time-slots', { method: 'POST', token: adminToken, body: { name: `周六压测时段-${stamp}`, weekday: 6, period: 1 } }),
    request('/api/admin/meta', { token: adminToken }),
  ]);
  if (!teacher.data?.item || !venue.data?.item || !slot.data?.item) throw new Error('创建压测基础数据失败');

  const password = 'LoadTest123!';
  const studentRows = Array.from({ length: 60 }, (_, index) => ({ student_no: `LT${stamp}${String(index).padStart(3, '0')}`, name: `压测学生${index + 1}`, grade: '压测年级', class_name: '压测班级', password }));
  const imported = await request('/api/admin/students/import', { method: 'POST', token: adminToken, body: { rows: studentRows } });
  if (imported.status !== 200) throw new Error(`导入压测学生失败：${imported.message}`);

  const course = await request('/api/admin/courses', { method: 'POST', token: adminToken, body: {
    name: `并发一致性测试-${stamp}`, category_id: meta.data.categories[0].id, capacity: 30, status: 'OPEN',
    teachers: [teacher.data.item.id], schedules: [{ time_slot_id: slot.data.item.id, venue_id: venue.data.item.id }], allowed_scope: { type: 'all' },
  } });
  if (!course.data?.course) throw new Error(`创建压测课程失败：${course.message}`);

  const logins = await Promise.all(studentRows.map((student) => request('/api/auth/login', { method: 'POST', body: { username: student.student_no, password } })));
  const attempts = await Promise.all(logins.map((login, index) => request(`/api/courses/${course.data.course.id}/enroll`, {
    method: 'POST', token: login.data.token, body: { idempotency_key: `load-${stamp}-${index}` },
  })));
  const successes = attempts.filter((item) => item.status === 200).length;
  const full = attempts.filter((item) => item.code === 'COURSE_FULL').length;
  const courses = await request('/api/admin/courses', { token: adminToken });
  const saved = courses.data.items.find((item) => item.id === course.data.course.id);
  const result = { attempts: attempts.length, successes, rejected_as_full: full, active_count: saved.active_count, capacity: saved.capacity };
  console.log(JSON.stringify(result, null, 2));
  if (successes !== 30 || saved.active_count !== 30 || saved.active_count > saved.capacity) throw new Error('并发一致性验证失败');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
