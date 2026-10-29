// iPhone APP 的 Google 登入：把 config.js 的 googleIosClientId 反轉成網址配置寫進 Info.plist。
// Google 登入完成後會用 com.googleusercontent.apps.<id> 這個網址叫回 APP，沒有它登入畫面會關不掉。
//
// 用法：在 config.js 填好 googleIosClientId 後執行 node scripts/ios-google-scheme.mjs（重複執行沒關係）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(here, '../../assets/js/config.js');
const plistPath = path.resolve(here, '../ios/App/App/Info.plist');

const config = fs.readFileSync(configPath, 'utf8');
const match = config.match(/googleIosClientId:\s*'([^']*)'/);
const clientId = match ? match[1].trim() : '';
if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
  console.error('config.js 的 googleIosClientId 還沒填（格式：xxxx.apps.googleusercontent.com）');
  process.exit(1);
}
const scheme = 'com.googleusercontent.apps.' + clientId.replace(/\.apps\.googleusercontent\.com$/, '');

const begin = '\t<!-- PATS Google 登入 begin -->';
const end = '\t<!-- PATS Google 登入 end -->';
const block = [
  begin,
  '\t<key>CFBundleURLTypes</key>',
  '\t<array>',
  '\t\t<dict>',
  '\t\t\t<key>CFBundleURLSchemes</key>',
  '\t\t\t<array>',
  '\t\t\t\t<string>' + scheme + '</string>',
  '\t\t\t</array>',
  '\t\t</dict>',
  '\t</array>',
  end
].join('\n');

let plist = fs.readFileSync(plistPath, 'utf8');
const existing = /\t?<!-- PATS Google 登入 begin -->[\s\S]*?<!-- PATS Google 登入 end -->/;
if (existing.test(plist)) {
  plist = plist.replace(existing, block);
} else {
  plist = plist.replace(/\n<\/dict>\s*<\/plist>\s*$/, '\n' + block + '\n</dict>\n</plist>\n');
}
fs.writeFileSync(plistPath, plist);
console.log('已寫入 iOS 網址配置：' + scheme);
