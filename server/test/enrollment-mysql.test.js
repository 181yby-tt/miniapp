'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

// 注入连接故障验证事务回滚；不把 mock 结果当作真实 MySQL 性能测试。
function storeWithConnection({ existing = [], full = false, failInsert = false } = {}) {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
    query: async (sql) => {
      calls.push(sql);
      if (sql.startsWith('SELECT `active_count`,`capacity`')) return [[{ active_count: 0, capacity: 20 }]];
      if (sql.startsWith('SELECT `id`,`status`')) return [existing];
      if (sql.startsWith('UPDATE `courses`')) return [{ affectedRows: full ? 0 : 1 }];
      if (sql.startsWith('INSERT INTO `enrollments`') && failInsert) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      if (sql.startsWith('SELECT `active_count`,`version`')) return [[{ active_count: 1, version: 2 }]];
      return [{}];
    },
  };
  const filename = path.resolve(__dirname, '../src/store.js');
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: createRequire(filename), __dirname: path.dirname(filename), process: { env: { DB_MODE: 'mysql' } }, console, connection };
  vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}\nmysqlReady = true; pool = { getConnection: async () => connection }; module.exports.readVal = readVal; module.exports.writeVal = writeVal;`, context, { filename });
  return { ...module.exports, calls };
}
const enrollment = { id: 1, student_id: 1, course_id: 1, status: 'ENROLLED', idempotency_key: 'test-key' };

test('MySQL 唯一键冲突时回滚名额，不使用 upsert 覆盖学生', async () => {
  const store = storeWithConnection({ failInsert: true });
  await assert.rejects(store.persistEnrollmentMutation({ mode: 'enroll', courseId: 1, enrollment }), { code: 'ER_DUP_ENTRY' });
  assert.ok(store.calls.some((sql) => sql.includes('`active_count`<`capacity`')));
  assert.ok(store.calls.includes('rollback'));
  assert.ok(!store.calls.includes('commit'));
  assert.ok(!store.calls.some((sql) => sql.includes('ON DUPLICATE KEY UPDATE')));
});
test('MySQL 满额和重复报名不新增有效记录', async () => {
  for (const [options, code] of [[{ full: true }, 'COURSE_FULL'], [{ existing: [{ id: 1, status: 'ENROLLED' }] }, 'ALREADY_ENROLLED']]) {
    const store = storeWithConnection(options);
    await assert.rejects(store.persistEnrollmentMutation({ mode: 'enroll', courseId: 1, enrollment }), { code });
    assert.ok(!store.calls.some((sql) => sql.startsWith('INSERT INTO')));
    assert.ok(store.calls.includes('rollback'));
  }
});
test('MySQL 报名时间往返不会因服务器时区改变', () => {
  const store = storeWithConnection();
  const iso = '2026-09-07T01:00:00.000Z';
  const sql = store.writeVal('courses', 'enroll_start_at', iso);
  assert.equal(sql, '2026-09-07 01:00:00');
  assert.equal(Date.parse(store.readVal('courses', 'enroll_start_at', sql)), Date.parse(iso));
  assert.equal(Date.parse(store.readVal('enrollments', 'enrolled_at', sql)), Date.parse(iso));
});
