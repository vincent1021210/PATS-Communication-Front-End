// 給網頁的電腦版功能：window.PATSDesktop。網站版沒有這個物件，前端以此判斷是不是電腦版。

const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--pats-desktop-version='));
const version = versionArg ? versionArg.split('=')[1] : '';
const clickHandlers = [];

ipcRenderer.on('pats:notification-click', (event, id) => {
  clickHandlers.forEach((fn) => {
    try { fn(id); } catch (e) { /* ignore */ }
  });
});

/** 工作列圖示右下角的紅色數字（Windows 只吃圖片，所以在這裡用 canvas 畫）。 */
function badgeDataUrl(count) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(16, 16, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + (count > 9 ? 16 : 20) + 'px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(count > 99 ? '99+' : String(count), 16, 17);
  return canvas.toDataURL('image/png');
}

contextBridge.exposeInMainWorld('PATSDesktop', {
  version,
  notify(title, body, id) {
    ipcRenderer.send('pats:notify', { title: String(title || ''), body: String(body || ''), id: id ? String(id) : '' });
  },
  setBadge(count) {
    const n = Math.max(0, Number(count) || 0);
    ipcRenderer.send('pats:badge', { count: n, dataUrl: n > 0 ? badgeDataUrl(n) : '' });
  },
  openExternal(url) {
    ipcRenderer.send('pats:open-external', String(url || ''));
  },
  onNotificationClick(fn) {
    if (typeof fn === 'function') clickHandlers.push(fn);
  }
});
