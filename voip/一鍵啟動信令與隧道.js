/**
 * 同時啟動信令伺服器 + HTTPS 隧道，並把網址寫進 tunnel-url.txt
 * 用法：node 一鍵啟動信令與隧道.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');

var PORT = Number(process.env.PORT) || 3001;
var root = __dirname;
var urlFile = path.join(root, 'tunnel-url.txt');

function log(msg) {
  console.log(msg);
}

log('');
log('========================================');
log(' PATS：信令 + HTTPS 隧道');
log('========================================');
log('');

process.env.PORT = String(PORT);
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://vincent1021210.github.io';

var server = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', function (buf) { process.stdout.write(buf); });
server.stderr.on('data', function (buf) { process.stderr.write(buf); });
server.on('exit', function (code) {
  log('信令伺服器已結束（code=' + code + '）');
  process.exit(code || 0);
});

setTimeout(function () {
  log('');
  log('正在建立 HTTPS 隧道（第一次可能要下載套件，請稍候）…');
  log('');

  var tunnel = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', 'localtunnel', '--port', String(PORT)],
    { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }
  );

  function handle(chunk) {
    var text = String(chunk);
    process.stdout.write(text);
    var match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.(loca\.lt|localtunnel\.me)[^\s]*/);
    if (!match) match = text.match(/https:\/\/[^\s]+/);
    if (match) {
      var url = match[0].replace(/[\])}'",]+$/, '');
      fs.writeFileSync(urlFile, url, 'utf8');
      log('');
      log('★★★★★★★★★★★★★★★★★★★★★★★★★★★★');
      log(' 請複製這個網址到手機 PATS → 通話設定：');
      log(' ' + url);
      log(' 也已寫入：' + urlFile);
      log('★★★★★★★★★★★★★★★★★★★★★★★★★★★★');
      log('');
      log('關掉此視窗會同時關閉信令與隧道。');
      log('');
    }
  }

  tunnel.stdout.on('data', handle);
  tunnel.stderr.on('data', handle);
  tunnel.on('exit', function () {
    log('隧道已結束。');
    try { server.kill(); } catch (e) { /* ignore */ }
  });
}, 1500);

process.on('SIGINT', function () {
  try { server.kill(); } catch (e) { /* ignore */ }
  process.exit(0);
});
