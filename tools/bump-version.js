#!/usr/bin/env node
/* =====================================================================
   PATS — 發版版本號工具
   =====================================================================
   用法：
     node tools/bump-version.js            自動用「年月日時分」當版本號
     node tools/bump-version.js 20261026a  指定版本號

   會改寫：
     - index.html 的 <meta name="pats-build">
     - index.html 內所有 assets/ 的 ?v=（統一成同一個版本號）
     - version.json（前端用 no-store 讀它來判斷是否有新版）

   一律以 UTF-8 讀寫；改完若發現 U+FFFD（亂碼）就中止並還原。
   不要改用 PowerShell 的 Get-Content／Set-Content，會把中文寫壞。
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const versionPath = path.join(root, 'version.json');
const checkFiles = [
  'index.html',
  'assets/js/core.js',
  'assets/js/chat.js',
  'assets/js/main.js',
  'assets/css/styles.css'
];

function autoVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes());
}

const version = String(process.argv[2] || autoVersion()).trim();
if (!/^[0-9A-Za-z._-]{4,40}$/.test(version)) {
  console.error('版本號格式不正確：' + version);
  process.exit(1);
}

const original = fs.readFileSync(indexPath, 'utf8');
let html = original;

if (/<meta name="pats-build" content="[^"]*">/.test(html)) {
  html = html.replace(/<meta name="pats-build" content="[^"]*">/, '<meta name="pats-build" content="' + version + '">');
} else {
  html = html.replace(/(<meta name="theme-color"[^>]*>)/, '$1\n  <meta name="pats-build" content="' + version + '">');
}

html = html.replace(/((?:href|src)="assets\/[^"?]+)\?v=[^"]*"/g, '$1?v=' + version + '"');

if (/\uFFFD/.test(html)) {
  console.error('index.html 出現亂碼字元，已中止。');
  process.exit(1);
}

fs.writeFileSync(indexPath, html, 'utf8');
// 保留 androidMin 等其他欄位（Android APP 用來判斷是否要強制更新）
let versionInfo = {};
try { versionInfo = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch (e) { /* 第一次建立 */ }
versionInfo.build = version;
fs.writeFileSync(versionPath, JSON.stringify(versionInfo) + '\n', 'utf8');

let bad = false;
for (const f of checkFiles) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  if (/\uFFFD/.test(fs.readFileSync(p, 'utf8'))) {
    console.error('亂碼：' + f);
    bad = true;
  }
}
if (bad) {
  fs.writeFileSync(indexPath, original, 'utf8');
  console.error('偵測到亂碼，index.html 已還原。');
  process.exit(1);
}

const refs = html.match(/assets\/[^"?]+\?v=[^"]+/g) || [];
console.log('版本號：' + version);
console.log('已更新 ' + refs.length + ' 個資源：');
refs.forEach((r) => console.log('  ' + r));
