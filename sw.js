/* =====================================================================
   PATS — Service Worker：把畫面存在手機／電腦裡（iPhone「加入主畫面」、Android Chrome 安裝）
   =====================================================================
   - 每個網站版本一個快取：安裝時讀 index.html，把它引用的 assets 全部先下載好
   - 畫面（index.html 與 assets）一律先用快取，離線也能開；資料（Apps Script）照常連網
   - 發新版：tools/bump-version.js 會改寫下面的 BUILD，瀏覽器發現 sw.js 變了就在背景下載新版，
     前端 checkForUpdate 等新版就緒後重新整理
   - 只處理 PATS 自己的畫面；同網域的推薦網頁、下載檔、隱私權頁等一律不經手
   ===================================================================== */

'use strict';

var BUILD = '20261030a';
var CACHE = 'pats-shell-' + BUILD;
var RUNTIME = 'pats-runtime';
// 畫面用到的外部字型與 socket.io，第一次連網時存下來
var CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.socket.io'];

var scopePath = new URL(self.registration.scope).pathname;

function shellUrls(html) {
  var urls = ['./', 'manifest.webmanifest'];
  var re = /(?:href|src)="((?:assets\/)[^"]+)"/g;
  var m;
  while ((m = re.exec(html))) urls.push(m[1]);
  var cdn = /(?:href|src)="(https:\/\/(?:fonts\.googleapis\.com|cdn\.socket\.io)\/[^"]+)"/g;
  while ((m = cdn.exec(html))) urls.push(m[1].replace(/&amp;/g, '&'));
  return urls;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    fetch('./?sw=' + BUILD, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('index ' + res.status);
        return res.text();
      })
      .then(function (html) {
        return caches.open(CACHE).then(function (cache) {
          // index.html 用剛抓到的這份，確保與 assets 的 ?v= 版本一致
          var put = cache.put(new Request('./'), new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
          var rest = shellUrls(html).slice(1).map(function (url) {
            var cross = /^https:/.test(url);
            return fetch(new Request(url, cross ? { mode: 'cors', credentials: 'omit' } : { cache: 'no-store' }))
              .then(function (r) {
                if (!r.ok) throw new Error(url + ' ' + r.status);
                if (!cross) return cache.put(url, r);
                return caches.open(RUNTIME).then(function (c) {
                  if (url.indexOf('https://fonts.googleapis.com/') !== 0) return c.put(url, r);
                  // 字型 CSS 裡的 woff2 也要一起存，第一次離線開啟才有圖示
                  return r.clone().text().then(function (css) {
                    var fonts = css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [];
                    return Promise.all([c.put(url, r)].concat(fonts.map(function (f) {
                      return fetch(f, { mode: 'cors', credentials: 'omit' }).then(function (fr) { return fr.ok ? c.put(f, fr) : null; });
                    })));
                  });
                });
              });
          });
          return Promise.all([put].concat(rest));
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key.indexOf('pats-shell-') === 0 && key !== CACHE) return caches.delete(key);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// 前端問「你快取的是哪一版」，決定要不要等新版就緒再重新整理
self.addEventListener('message', function (event) {
  if (event.data === 'pats-build' && event.ports && event.ports[0]) event.ports[0].postMessage(BUILD);
});

function isShellNavigation(url, request) {
  return request.mode === 'navigate' && (url.pathname === scopePath || url.pathname === scopePath + 'index.html');
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isShellNavigation(url, request)) {
      event.respondWith(
        caches.open(CACHE)
          .then(function (cache) { return cache.match('./'); })
          .then(function (hit) { return hit || fetch(request); })
      );
      return;
    }
    if (url.pathname.indexOf(scopePath + 'assets/') !== 0 && url.pathname !== scopePath + 'manifest.webmanifest') return;
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit;
          return fetch(request).then(function (res) {
            if (res.ok) cache.put(request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  if (CDN_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(
      caches.open(RUNTIME).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit;
          return fetch(request).then(function (res) {
            if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
            return res;
          });
        });
      })
    );
  }
});
