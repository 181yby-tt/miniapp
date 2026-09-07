'use strict';
// 仅供本地 UI 验证：独立临时目录，不加载项目 data.json 或生产数据库。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { enrollmentFixture } = require('./enrollment-fixture');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enrollment-preview-'));
const file = path.join(directory, 'data.json');
fs.writeFileSync(file, JSON.stringify(enrollmentFixture()));
const child = spawn(process.execPath, [path.resolve(__dirname, '../../src/server.js')], {
  env: { ...process.env, DB_MODE: 'file', REDIS_URL: '', DATA_FILE: file, TOKEN_SECRET: crypto.randomBytes(32).toString('hex'), PORT: process.env.PREVIEW_PORT || '5186', NODE_ENV: 'test' },
  stdio: 'inherit',
});
console.log('隔离预览：学生 test1；教师 test-teacher；测试密码 TestOnly123!');
child.on('exit', () => { fs.rmSync(directory, { recursive: true, force: true }); process.exit(0); });
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
