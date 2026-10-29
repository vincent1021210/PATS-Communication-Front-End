// 把 dist/ 的安裝檔上傳到 GitHub Release（vincent1021210.github.io 的 v<版本>），
// 已安裝的電腦版會從最新 Release 的 latest.yml 自動更新。
// 權杖沿用 git 的登入（git credential），不另外存。
//
// 用法：先 npm run dist，再 npm run release

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OWNER = 'vincent1021210';
const REPO = 'vincent1021210.github.io';
const ASSETS = ['PATS-Setup.exe', 'PATS-Setup.exe.blockmap', 'latest.yml'];

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(appDir, 'dist');
const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const tag = 'v' + version;

function githubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('password='));
  if (!line) throw new Error('找不到 GitHub 登入資訊，請先能 git push，或設定 GH_TOKEN');
  return line.slice('password='.length);
}

const token = githubToken();
const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(method + ' ' + url + ' → ' + res.status + ' ' + (await res.text()));
  return res.status === 204 ? null : res.json();
}

async function main() {
  for (const name of ASSETS) {
    if (!fs.existsSync(path.join(dist, name))) throw new Error('dist/ 缺少 ' + name + '，請先 npm run dist');
  }
  const yml = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
  if (!yml.includes('version: ' + version)) throw new Error('latest.yml 的版本與 package.json（' + version + '）不同，請重新 npm run dist');

  let release = await api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + tag);
  if (!release) {
    release = await api('POST', '/repos/' + OWNER + '/' + REPO + '/releases', {
      tag_name: tag,
      name: 'PATS 電腦版 ' + version,
      body: 'Windows 安裝檔：下載 PATS-Setup.exe 後執行。已安裝的電腦會自動更新。',
      make_latest: 'true'
    });
    console.log('已建立 Release ' + tag);
  }

  for (const name of ASSETS) {
    const old = (release.assets || []).find((a) => a.name === name);
    if (old) await api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + old.id);
    const data = fs.readFileSync(path.join(dist, name));
    const uploadUrl = release.upload_url.replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(name);
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
      body: data
    });
    if (!res.ok) throw new Error('上傳 ' + name + ' 失敗：' + res.status + ' ' + (await res.text()));
    console.log('已上傳 ' + name + '（' + (data.length / 1048576).toFixed(1) + ' MB）');
  }
  console.log('完成：https://github.com/' + OWNER + '/' + REPO + '/releases/tag/' + tag);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
