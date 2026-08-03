'use strict';
// 清空并重建 kexu 库（用于 MySQL 模式下重新种子）
const m = require('mysql2/promise');
(async () => {
  const c = await m.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: parseInt(process.env.DB_PORT || '3306', 10), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
  await c.query('DROP DATABASE IF EXISTS kexu');
  await c.query('CREATE DATABASE kexu CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
  console.log('✅ kexu 库已重建（空库）');
  await c.end();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
