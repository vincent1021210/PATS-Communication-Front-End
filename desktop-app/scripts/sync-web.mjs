// 把 repo 根目錄的網頁前端複製進 desktop-app/www/，讓安裝檔內建整套畫面。
// 打包細節在 tools/bundle-web.mjs（與 Android 共用）。
//
// 用法：node scripts/sync-web.mjs（npm start、npm run dist 都會先跑）

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWeb } from '../../tools/bundle-web.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

bundleWeb({
  outDir: path.join(appDir, 'www'),
  vendorDir: path.join(appDir, 'vendor'),
  socketIoPath: path.join(appDir, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'),
  extraFiles: ['privacy.html', 'terms.html'],
  keepViewportFit: true
})
  .then((build) => console.log('已同步網頁前端到 www/（build ' + build + '）'))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
