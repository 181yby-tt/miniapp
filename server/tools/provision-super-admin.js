'use strict';

const mysql = require('mysql2/promise');
const { hashPassword } = require('../src/auth');

async function main() {
  const username = String(process.env.SUPER_ADMIN_USERNAME || '').trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
  const displayName = String(process.env.SUPER_ADMIN_NAME || username).trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) throw new Error('SUPER_ADMIN_USERNAME 格式不正确');
  if (password.length < 6 || password.length > 128) throw new Error('SUPER_ADMIN_PASSWORD 必须为 6 至 128 位');
  if (!displayName || displayName.length > 64) throw new Error('SUPER_ADMIN_NAME 格式不正确');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kexu',
  });
  try {
    await connection.beginTransaction();
    await connection.query("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `display_name` VARCHAR(64) NOT NULL DEFAULT '' AFTER `username`");
    const [rows] = await connection.query('SELECT `id` FROM `users` WHERE LOWER(`username`) = LOWER(?) LIMIT 1 FOR UPDATE', [username]);
    const passwordHash = hashPassword(password);
    if (rows.length) {
      await connection.query("UPDATE `users` SET `username`=?,`display_name`=?,`password_hash`=?,`user_type`='SUPER_ADMIN',`status`='ACTIVE',`must_change_password`=0,`failed_login_count`=0,`locked_until`=NULL WHERE `id`=?", [username, displayName, passwordHash, rows[0].id]);
    } else {
      await connection.query("INSERT INTO `users` (`username`,`display_name`,`password_hash`,`user_type`,`status`,`must_change_password`,`failed_login_count`,`locked_until`,`created_at`,`updated_at`) VALUES (?,?,?,'SUPER_ADMIN','ACTIVE',0,0,NULL,NOW(),NOW())", [username, displayName, passwordHash]);
    }
    await connection.commit();
    console.log(`超级管理员 ${username} 已配置；其他超级管理员账号保持不变。`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
