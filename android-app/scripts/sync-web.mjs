// 把 repo 根目錄的網頁前端複製進 android-app/www/，讓 APK 內建整套畫面。
// 打包細節在 tools/bundle-web.mjs（與電腦版共用）。
//
// 用法：node scripts/sync-web.mjs（npm run sync 會先跑這支再 cap sync）

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleWeb } from '../../tools/bundle-web.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

bundleWeb({
  outDir: path.join(appDir, 'www'),
  vendorDir: path.join(appDir, 'vendor'),
  socketIoPath: path.join(appDir, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js')
})
  .then((build) => console.log('已同步網頁前端到 www/（build ' + build + '）'))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
