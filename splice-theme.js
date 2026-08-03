// splice-theme.js - 用新主题 CSS 替换 admin-console.html 的 <style> 块
const fs = require('fs');
const path = 'E:/181app/kexu/admin-console.html';
const css = fs.readFileSync('E:/181app/kexu/admin-theme.new.css', 'utf8');
let html = fs.readFileSync(path, 'utf8');

const open = html.indexOf('<style>');
const close = html.indexOf('</style>');
if (open === -1 || close === -1 || close < open) {
  console.error('FAIL: style block not found');
  process.exit(1);
}
const before = html.slice(0, open + '<style>'.length);
const after = html.slice(close);
const out = before + css + after;
fs.writeFileSync(path, out, 'utf8');
console.log('OK: style block replaced, new length =', out.length);
