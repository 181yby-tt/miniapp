'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit, withStudentLock } = require('../src/redis');

test('local rate limiter rejects requests above the configured window', async () => {
  const key = `test-${Date.now()}-${Math.random()}`;
  assert.equal((await rateLimit(key, 2, 60)).allowed, true);
  assert.equal((await rateLimit(key, 2, 60)).allowed, true);
  const rejected = await rateLimit(key, 2, 60);
  assert.equal(rejected.allowed, false);
  assert.ok(rejected.retryAfter > 0);
});

test('student lock falls back to executing the operation without Redis', async () => {
  const result = await withStudentLock(1, async () => '完成');
  assert.equal(result, '完成');
});
