'use strict';

const crypto = require('crypto');

const REDIS_URL = process.env.REDIS_URL || '';
let client = null;
let ready = false;
const localWindows = new Map();

async function initRedis() {
  if (!REDIS_URL) {
    console.log('[Redis] 未配置 REDIS_URL，使用单进程限流，不启用共享缓存。');
    return false;
  }
  try {
    const { createClient } = require('redis');
    client = createClient({ url: REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: (retries) => Math.min(retries * 100, 2000) } });
    client.on('error', (error) => { ready = false; console.error('[Redis] 连接异常:', error.message); });
    client.on('ready', () => { ready = true; });
    await client.connect();
    ready = true;
    console.log('[Redis] 限流、缓存与分布式学生锁已启用。');
    return true;
  } catch (error) {
    ready = false;
    client = null;
    console.error('[Redis] 初始化失败，回退到单进程模式:', error.message);
    return false;
  }
}

async function rateLimit(key, limit, windowSeconds) {
  if (ready && client) {
    const result = await client.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}",
      { keys: [`rate:${key}`], arguments: [String(windowSeconds)] },
    );
    return { allowed: Number(result[0]) <= limit, remaining: Math.max(0, limit - Number(result[0])), retryAfter: Math.max(1, Number(result[1])) };
  }

  const now = Date.now();
  const current = localWindows.get(key);
  const record = !current || current.expiresAt <= now ? { count: 0, expiresAt: now + windowSeconds * 1000 } : current;
  record.count += 1;
  localWindows.set(key, record);
  if (localWindows.size > 10000) {
    for (const [itemKey, item] of localWindows) if (item.expiresAt <= now) localWindows.delete(itemKey);
  }
  return { allowed: record.count <= limit, remaining: Math.max(0, limit - record.count), retryAfter: Math.max(1, Math.ceil((record.expiresAt - now) / 1000)) };
}

async function getJson(key) {
  if (!ready || !client) return null;
  try {
    const value = await client.get(`cache:${key}`);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

async function setJson(key, value, ttlSeconds) {
  if (!ready || !client) return;
  try { await client.set(`cache:${key}`, JSON.stringify(value), { EX: ttlSeconds }); } catch { /* 缓存失败不影响业务 */ }
}

async function invalidate(key) {
  if (!ready || !client) return;
  try { await client.del(`cache:${key}`); } catch { /* 缓存失败不影响业务 */ }
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withStudentLock(studentId, action) {
  if (!ready || !client) return action();
  const key = `lock:student:${studentId}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const acquired = await client.set(key, token, { NX: true, PX: 8000 });
    if (acquired) {
      try { return await action(); }
      finally {
        try {
          await client.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", { keys: [key], arguments: [token] });
        } catch { /* 锁会按 TTL 自动释放 */ }
      }
    }
    await pause(20 + Math.floor(Math.random() * 20));
  }
  const error = new Error('操作人数较多，请稍后再试');
  error.code = 'BUSY_RETRY';
  throw error;
}

function isReady() { return ready; }

module.exports = { initRedis, rateLimit, getJson, setJson, invalidate, withStudentLock, isReady };
