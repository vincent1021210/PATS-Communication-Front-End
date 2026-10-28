// 產生 APP 圖示與啟動畫面的原始圖（藍底白色 P，和網站 favicon 一致），
// 再交給 @capacitor/assets 輸出各種解析度。
// 用法：node scripts/make-icons.cjs && npm run icons

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const out = path.resolve(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });

const BLUE = '#2563eb';
const BG = '#f5f7fb';
const FONT = "font-family='Segoe UI, Roboto, Arial, sans-serif' font-weight='700'";

// 自適應圖示的前景：P 要留在中間 66% 的安全區內
const foreground = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
  <text x='512' y='640' font-size='420' ${FONT} fill='white' text-anchor='middle'>P</text>
</svg>`;
const background = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'><rect width='1024' height='1024' fill='${BLUE}'/></svg>`;
const iconOnly = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
  <rect width='1024' height='1024' rx='224' fill='${BLUE}'/>
  <text x='512' y='700' font-size='560' ${FONT} fill='white' text-anchor='middle'>P</text>
</svg>`;
const splash = (bg, ink) => `<svg xmlns='http://www.w3.org/2000/svg' width='2732' height='2732'>
  <rect width='2732' height='2732' fill='${bg}'/>
  <rect x='1166' y='1086' width='400' height='400' rx='88' fill='${BLUE}'/>
  <text x='1366' y='1390' font-size='240' ${FONT} fill='white' text-anchor='middle'>P</text>
  <text x='1366' y='1640' font-size='110' ${FONT} fill='${ink}' text-anchor='middle'>PATS</text>
</svg>`;

const jobs = [
  ['icon-foreground.png', foreground],
  ['icon-background.png', background],
  ['icon-only.png', iconOnly],
  ['splash.png', splash(BG, '#1e293b')],
  ['splash-dark.png', splash('#0f172a', '#e2e8f0')]
];

Promise.all(jobs.map(([name, svg]) => sharp(Buffer.from(svg)).png().toFile(path.join(out, name))))
  .then(() => console.log('已產生 assets/ 原始圖：' + jobs.map((j) => j[0]).join('、')))
  .catch((err) => { console.error(err); process.exit(1); });
