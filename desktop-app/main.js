// PATS 電腦版主程序。
//
// 畫面檔打包在安裝檔的 www/ 裡，但頁面網址仍是 https://vincent1021210.github.io/：
// 攔截這個網域的請求改回傳本機檔，其餘網址（Apps Script、通話信令、Google 登入）照常連網。
// 網址不變，Google 登入的授權網域與信令伺服器的 CORS 都不用另外設定。

const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ID = 'tw.pats.chat';
const SITE_ORIGIN = 'https://vincent1021210.github.io';
const SITE_HOST = 'vincent1021210.github.io';
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
const WWW = path.join(__dirname, 'www');
const ICON = path.join(WWW, 'assets', 'brand', 'icon-192.png');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

let win = null;
let tray = null;
let quitting = false;

app.setAppUserModelId(APP_ID);
// Google 會擋掉 UA 帶 Electron 的內嵌瀏覽器，登入前就要換掉
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|pats-desktop|PATS)\/\S+/g, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start);
}

/* ------------------------------------------------------------ 本機畫面 */

/** 網站路徑對應到 www/ 裡的檔案；沒有就回 null（例如 /download/、推薦網頁），改走網路。 */
function localFile(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(WWW, rel));
  if (!file.startsWith(WWW + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch (e) {
    return null;
  }
}

function serveLocalSite() {
  protocol.handle('https', async (request) => {
    const url = new URL(request.url);
    if (url.host === SITE_HOST && request.method === 'GET') {
      const file = localFile(url.pathname);
      if (file) {
        const res = await net.fetch(pathToFileURL(file).toString());
        // 不能讓瀏覽器快取：APP 更新後 www/ 換新，快取會繼續拿到舊版畫面
        return new Response(res.body, {
          status: 200,
          headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' }
        });
      }
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

/* ------------------------------------------------------------ 權限 */

const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);

function isSiteUrl(raw) {
  try {
    return new URL(raw).origin === SITE_ORIGIN;
  } catch (e) {
    return false;
  }
}

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isSiteUrl(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && requestingOrigin === SITE_ORIGIN;
  });
}

/* ------------------------------------------------------------ 視窗 */

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return { width: 1200, height: 800 };
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  const data = { ...bounds, maximized: win.isMaximized(), trayHintShown: loadWindowState().trayHintShown };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data));
  } catch (e) { /* 寫不進去就下次用預設大小 */ }
}

/** Google 登入的彈出視窗要留在 APP 裡（需要 window.opener 回傳結果），其他連結交給系統瀏覽器。 */
function isGoogleAuthUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (url.host === 'accounts.google.com' || url.host.endsWith('.accounts.google.com'));
  } catch (e) {
    return raw === 'about:blank';
  }
}

function openExternal(raw) {
  if (/^(https?|mailto):/i.test(raw)) shell.openExternal(raw);
}

function guardNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isGoogleAuthUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, icon: ICON, parent: win || undefined }
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

function createWindow(startHidden) {
  const state = loadWindowState();
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1200,
    height: state.height || 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'PATS',
    icon: ICON,
    backgroundColor: '#f5f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // 縮到系統匣時仍要照常輪詢新訊息、維持通話
      backgroundThrottling: false,
      additionalArguments: ['--pats-desktop-version=' + app.getVersion()]
    }
  });
  if (state.maximized) win.maximize();

  win.webContents.on('will-navigate', (event, url) => {
    if (isSiteUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  win.on('focus', () => win.flashFrame(false));
  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('close', (event) => {
    saveWindowState();
    if (quitting) return;
    event.preventDefault();
    win.hide();
    showTrayHintOnce();
  });

  win.loadURL(SITE_ORIGIN + '/');
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ------------------------------------------------------------ 系統匣 */

function showTrayHintOnce() {
  const state = loadWindowState();
  if (state.trayHintShown || !Notification.isSupported()) return;
  new Notification({ title: 'PATS 仍在背景執行', body: '有新訊息會通知你。要完全關閉，請在右下角 PATS 圖示按右鍵選「結束」。', icon: ICON }).show();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, trayHintShown: true }));
  } catch (e) { /* ignore */ }
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: '開啟 PATS', click: showWindow },
    {
      label: '開機時啟動',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
    },
    { label: '檢查更新', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: '結束', click: () => { quitting = true; app.quit(); } }
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('PATS');
  tray.setContextMenu(trayMenu());
  tray.on('click', showWindow);
}

function appMenu() {
  return Menu.buildFromTemplate([
    {
      label: '檢視',
      submenu: [
        { role: 'reload', label: '重新載入' },
        { role: 'resetZoom', label: '實際大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全螢幕' },
        { role: 'toggleDevTools', label: '開發人員工具' }
      ]
    },
    {
      label: '說明',
      submenu: [
        { label: '檢查更新', click: () => checkForUpdates(true) },
        { label: '關於 PATS', click: () => dialog.showMessageBox(win, { title: 'PATS', message: 'PATS 電腦版 ' + app.getVersion(), icon: ICON }) }
      ]
    }
  ]);
}

/* ------------------------------------------------------------ 給網頁用的功能 */

function setupIpc() {
  ipcMain.on('pats:notify', (event, payload) => {
    if (!Notification.isSupported() || !payload) return;
    const n = new Notification({ title: String(payload.title || 'PATS'), body: String(payload.body || ''), icon: ICON, silent: false });
    n.on('click', () => {
      showWindow();
      if (payload.id) event.sender.send('pats:notification-click', payload.id);
    });
    n.show();
    if (win && !win.isFocused()) win.flashFrame(true);
  });

  ipcMain.on('pats:badge', (event, payload) => {
    if (!win) return;
    const count = Number(payload && payload.count) || 0;
    const image = count > 0 && payload.dataUrl ? nativeImage.createFromDataURL(payload.dataUrl) : null;
    win.setOverlayIcon(image, count > 0 ? count + ' 則未讀' : '');
    if (tray) tray.setToolTip(count > 0 ? 'PATS（' + count + ' 則未讀）' : 'PATS');
  });

  ipcMain.on('pats:open-external', (event, url) => openExternal(String(url || '')));
}

/* ------------------------------------------------------------ 自動更新 */

let updater = null;

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox(win, { message: '開發模式不檢查更新。' });
    return;
  }
  if (!updater) {
    // 更新來源寫在安裝檔的 app-update.yml（electron-builder.yml 的 publish：GitHub Releases）
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.on('update-downloaded', (info) => {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'PATS 有新版本',
        message: '新版 ' + info.version + ' 已下載完成，重新啟動 PATS 即可更新。',
        buttons: ['立即重新啟動', '稍後'],
        defaultId: 0,
        cancelId: 1
      }).then((r) => {
        if (r.response !== 0) return;
        quitting = true;
        updater.quitAndInstall();
      });
    });
  }
  updater.checkForUpdates()
    .then((result) => {
      if (manual && (!result || !result.isUpdateAvailable)) {
        dialog.showMessageBox(win, { message: '目前已是最新版本（' + app.getVersion() + '）。' });
      }
    })
    .catch((err) => {
      if (manual) dialog.showMessageBox(win, { type: 'warning', message: '檢查更新失敗：' + (err && err.message ? err.message : err) });
    });
}

/* ------------------------------------------------------------ 啟動 */

function start() {
  serveLocalSite();
  setupPermissions();
  setupIpc();
  app.on('web-contents-created', (event, contents) => guardNavigation(contents));
  Menu.setApplicationMenu(appMenu());
  createWindow(process.argv.includes('--hidden'));
  createTray();
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_MS);
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* 留在系統匣，由「結束」關閉 */ });
