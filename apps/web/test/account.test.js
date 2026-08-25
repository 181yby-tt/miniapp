import test from 'node:test';
import assert from 'node:assert/strict';
import { accountNameForSession, canManageTeacherAccounts } from '../src/runtime/account.js';

test('admin account never reuses a stale student profile name', () => {
  const name = accountNameForSession(
    { username: 'admin', user_type: 'SUPER_ADMIN' },
    { name: '林晓雨', student_no: '20260108' },
  );
  assert.equal(name, 'admin');
});

test('student account uses the loaded student name', () => {
  const name = accountNameForSession(
    { username: '20260108', user_type: 'STUDENT' },
    { name: '林晓雨', student_no: '20260108' },
  );
  assert.equal(name, '林晓雨');
});

test('only super administrators can see teacher account management', () => {
  assert.equal(canManageTeacherAccounts({ user_type: 'SUPER_ADMIN' }), true);
  assert.equal(canManageTeacherAccounts({ user_type: 'STAFF' }), false);
  assert.equal(canManageTeacherAccounts({ user_type: 'STUDENT' }), false);
});
