'use strict';

/**
 * 重置演示数据：
 *  - 若未配置 DB_HOST：删除本地 data.json（下次启动文件模式重新种子）
 *  - 若配置了 DB_HOST：清空 MySQL 中所有集合表（下次启动重新种子）
 * 用法：node tools/reset.js    （需先 source .env 或注入 DB_* 环境变量）
 */

const fs = require('fs');
const path = require('path');

const TABLES = [
  'audit_logs', 'system_configs', 'enrollments', 'course_schedules',
  'course_staff', 'courses', 'time_slots', 'venues', 'course_categories',
  'staff', 'students', 'classes', 'grades', 'users',
];

async function resetMysql() {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kexu',
    multipleStatements: true,
  });
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TABLES) {
    await pool.query(`TRUNCATE TABLE \`${t}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  await pool.end();
  console.log(`✅ 已清空 MySQL 数据库 ${process.env.DB_NAME} 的 ${TABLES.length} 张表，下次启动将重新种子。`);
}

function resetFile() {
  const DATA_FILE = path.join(__dirname, '..', 'data.json');
  if (fs.existsSync(DATA_FILE)) {
    fs.renameSync(DATA_FILE, DATA_FILE + '.bak.' + Date.now());
    console.log('✅ 已备份并删除 data.json，下次启动将重新种子。');
  } else {
    console.log('ℹ️ 未找到 data.json，无需操作。');
  }
}

(async () => {
  if (process.env.DB_HOST) {
    try {
      await resetMysql();
    } catch (e) {
      console.error('❌ MySQL 重置失败:', e.message);
      process.exit(1);
    }
  } else {
    resetFile();
  }
})();
