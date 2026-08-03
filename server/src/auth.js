'use strict';

/**
 * 认证工具：密码哈希（scrypt，零依赖）与令牌签发/校验（HMAC）。
 * 生产环境应使用 bcrypt/Argon2id + Redis 会话，这里用 Node 内置 crypto 保证零依赖可运行。
 */

const crypto = require('crypto');

// 令牌签名密钥：务必通过环境变量 TOKEN_SECRET 注入，切勿硬编码（默认空串仅用于本地未配置时的显式失败）。
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, derived] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // 长度固定且 crypto.timingSafeEqual 要求等长
  if (check.length !== derived.length) return false;
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(derived));
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, sign, verify };
