// 產生 APP 圖示與啟動畫面的原始圖（白底＋彩色對話框 PATS Logo，和網站一致），
// 再交給 @capacitor/assets 輸出各種解析度。
// 用法：node scripts/make-icons.cjs && npm run icons

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const out = path.resolve(__dirname, '..', 'assets');
const logoSvg = path.resolve(__dirname, '..', '..', 'assets', 'brand', 'pats-logo.svg');
fs.mkdirSync(out, { recursive: true });

const WHITE = '#ffffff';
const BG = '#f5f7fb';
const DARK = '#0f172a';

function logo(size) {
  return sharp(logoSvg, { density: Math.ceil(72 * size / 512) + 1 }).resize(size, size).png().toBuffer();
}

function canvas(size, color, rounded) {
  const shape = rounded
    ? `<rect width='${size}' height='${size}' rx='${Math.round(size * 0.22)}' fill='${color}'/>`
    : `<rect width='${size}' height='${size}' fill='${color}'/>`;
  return sharp(Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${shape}</svg>`));
}

function transparent(size) {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
}

async function place(base, size, logoSize, name) {
  const offset = Math.round((size - logoSize) / 2);
  await base
    .composite([{ input: await logo(logoSize), left: offset, top: offset }])
    .png()
    .toFile(path.join(out, name));
  return name;
}

// 自適應圖示的前景：Logo 要留在中間 66% 的安全區內，各家桌面裁成圓形或方形都不會切到
Promise.all([
  place(transparent(1024), 1024, 620, 'icon-foreground.png'),
  canvas(1024, WHITE, false).png().toFile(path.join(out, 'icon-background.png')).then(() => 'icon-background.png'),
  place(canvas(1024, WHITE, true), 1024, 860, 'icon-only.png'),
  place(canvas(2732, BG, false), 2732, 760, 'splash.png'),
  place(canvas(2732, DARK, false), 2732, 760, 'splash-dark.png')
])
  .then((names) => console.log('已產生 assets/ 原始圖：' + names.join('、')))
  .catch((err) => { console.error(err); process.exit(1); });
