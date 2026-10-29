// 產生 Android APP 的「畫面更新包」：已安裝的 APP 會在背景下載，下次切回 APP 時換上新畫面，不必重裝 APK。
//
// 輸出（推送到 GitHub Pages 後生效）：
//   download/android-web/<build>.zip   與 APK 內建 www/ 相同內容
//   download/android-web/latest.json   { build, url, checksum, nativeMin }
//
// nativeMin 取自 version.json 的 androidLiveMin：這版畫面需要的最低 APK versionCode。
// 畫面用到新的原生外掛時，要先發新 APK，再把 androidLiveMin 調高。
//
// 用法：node scripts/make-web-update.mjs（tools/bump-version.js 會自動執行）

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bundleWeb, webRoot } from '../../tools/bundle-web.mjs';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(appDir, 'www');
const outDir = path.join(webRoot, 'download', 'android-web');
const SITE = 'https://vincent1021210.github.io';

async function main() {
  const build = await bundleWeb({
    outDir: www,
    vendorDir: path.join(appDir, 'vendor'),
    socketIoPath: path.join(appDir, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js')
  });
  const versionInfo = JSON.parse(fs.readFileSync(path.join(webRoot, 'version.json'), 'utf8'));
  const nativeMin = Number(versionInfo.androidLiveMin || 0);
  if (!nativeMin) throw new Error('version.json 缺少 androidLiveMin（支援畫面更新的最低 APK versionCode）');

  fs.mkdirSync(outDir, { recursive: true });
  // 只留最新一包，repo 不會越積越大
  for (const name of fs.readdirSync(outDir)) {
    if (name.endsWith('.zip')) fs.rmSync(path.join(outDir, name));
  }

  const zip = new AdmZip();
  zip.addLocalFolder(www);
  const zipName = build + '.zip';
  const data = zip.toBuffer();
  fs.writeFileSync(path.join(outDir, zipName), data);

  const latest = {
    build,
    url: SITE + '/download/android-web/' + zipName,
    checksum: crypto.createHash('sha256').update(data).digest('hex'),
    nativeMin
  };
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  console.log('已產生 Android 畫面更新包 ' + zipName + '（' + (data.length / 1024).toFixed(0) + ' KB，需 APK versionCode ≥ ' + nativeMin + '）');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
