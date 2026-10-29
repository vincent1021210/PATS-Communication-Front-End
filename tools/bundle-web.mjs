// 把 repo 根目錄的網頁前端打包成「APP 內建畫面」，Android 與電腦版共用。
//
// - 網頁原始檔只維護一份（repo 根目錄），每次打包重新複製，不要手改輸出資料夾
// - socket.io 與 Material Symbols 字型改成本機檔，畫面與程式不依賴外部網址
// - 拿掉只對網站有意義的 SEO 標籤（canonical、OG、JSON-LD、llms.txt）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FONT_CSS_URL_RE = /<link\s+href="(https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols[^"]+)"\s+rel="stylesheet">/;
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** 字型清單（icon_names）改了就重新下載；結果放在 vendorDir 並進版控，離線也能打包。 */
async function ensureFont(vendorDir, fontCssUrl) {
  const stampPath = path.join(vendorDir, 'material-symbols.url');
  const cssPath = path.join(vendorDir, 'material-symbols.css');
  if (fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === fontCssUrl && fs.existsSync(cssPath)) return;

  console.log('下載 Material Symbols 字型…');
  const css = await (await fetch(fontCssUrl, { headers: { 'User-Agent': CHROME_UA } })).text();
  const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
  if (!urls.length) throw new Error('字型 CSS 裡找不到 woff2 網址：\n' + css.slice(0, 300));

  let local = css;
  urls.forEach((url, i) => {
    local = local.replace(url, 'material-symbols-' + i + '.woff2');
  });
  await Promise.all(urls.map(async (url, i) => {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(vendorDir, 'material-symbols-' + i + '.woff2'), buf);
  }));
  fs.writeFileSync(cssPath, local);
  fs.writeFileSync(stampPath, fontCssUrl);
}

function transformIndex(html, keepViewportFit) {
  const fontMatch = html.match(FONT_CSS_URL_RE);
  if (!fontMatch) throw new Error('index.html 找不到 Material Symbols 的 <link>，請更新 tools/bundle-web.mjs');

  let out = html;
  // Android：拿掉 viewport-fit=cover，Capacitor 才會在 WebView 外圍留出狀態列與手勢列，
  // 否則新版 WebView 會讓畫面延伸到狀態列底下，登入頁標題被時鐘蓋住
  if (!keepViewportFit) out = out.replace(/,\s*viewport-fit=cover/, '');
  out = out
    .replace(FONT_CSS_URL_RE, '<link rel="stylesheet" href="vendor/material-symbols.css">')
    .replace(/<script defer src="https:\/\/cdn\.socket\.io\/[^"]+"><\/script>/, '<script defer src="vendor/socket.io.min.js"></script>')
    .replace(/^\s*<link rel="canonical"[^>]*>\r?\n/m, '')
    .replace(/^\s*<meta (property="og:|name="twitter:)[^>]*>\r?\n/gm, '')
    .replace(/^\s*<link rel="alternate"[^>]*llms\.txt[^>]*>\r?\n/m, '')
    .replace(/^\s*<script type="application\/ld\+json">[\s\S]*?<\/script>\r?\n/m, '')
    .replace(/^\s*<link rel="preconnect" href="https:\/\/fonts\.[^"]+"[^>]*>\r?\n/gm, '');

  // 外部資源都必須換掉，否則沒網路時畫面會缺字或少功能
  const leftovers = out.match(/(src|href)="https?:\/\/(?!script\.google)[^"]+"/g) || [];
  // 只是超連結（推薦網頁、電腦版下載），不是畫面需要的資源
  const bad = leftovers.filter((s) => !/href="https:\/\/(vincent1021210\.github\.io\/PATS-Recommendation|github\.com\/vincent1021210\/)/.test(s));
  if (bad.length) throw new Error('index.html 還有外部資源沒換成本機檔：\n' + bad.join('\n'));
  return { html: out, fontCssUrl: fontMatch[1] };
}

/**
 * @param {object} opts
 * @param {string} opts.outDir        輸出資料夾（每次清空重建）
 * @param {string} opts.vendorDir     字型與 socket.io 的本機副本（進版控）
 * @param {string} opts.socketIoPath  node_modules 裡的 socket.io.min.js
 * @param {string[]} [opts.extraFiles] 另外要複製的根目錄檔案
 * @param {boolean} [opts.keepViewportFit]
 * @returns {Promise<string>} 打包的網頁 build 編號
 */
export async function bundleWeb(opts) {
  const { outDir, vendorDir, socketIoPath, extraFiles = [], keepViewportFit = false } = opts;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });

  copyDir(path.join(webRoot, 'assets'), path.join(outDir, 'assets'));
  for (const name of ['version.json', ...extraFiles]) {
    fs.copyFileSync(path.join(webRoot, name), path.join(outDir, name));
  }

  const { html, fontCssUrl } = transformIndex(fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8'), keepViewportFit);
  await ensureFont(vendorDir, fontCssUrl);

  if (!fs.existsSync(socketIoPath)) throw new Error('找不到 socket.io-client，請先執行 npm install');
  fs.copyFileSync(socketIoPath, path.join(vendorDir, 'socket.io.min.js'));

  copyDir(vendorDir, path.join(outDir, 'vendor'));
  fs.rmSync(path.join(outDir, 'vendor', 'material-symbols.url'), { force: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  return JSON.parse(fs.readFileSync(path.join(webRoot, 'version.json'), 'utf8')).build;
}
