// 從 assets/brand/pats-logo.svg 產生安裝檔與 exe 圖示（build/icon.png，electron-builder 會轉成 .ico）。
// 用法：node scripts/make-icons.cjs（npm run dist 會自動跑）

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const sharp = require(require.resolve('sharp', { paths: [path.join(root, 'android-app')] }));
const svg = fs.readFileSync(path.join(root, 'assets', 'brand', 'pats-logo.svg'));
const outDir = path.resolve(__dirname, '..', 'build');

fs.mkdirSync(outDir, { recursive: true });
sharp(svg, { density: 144 })
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile(path.join(outDir, 'icon.png'))
  .then(() => console.log('已產生 build/icon.png'))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
