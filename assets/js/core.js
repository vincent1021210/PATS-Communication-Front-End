/* =====================================================================
   PATS — 前端核心：狀態、伺服器呼叫、共用 UI 工具
   ===================================================================== */

var PATS = (function () {
  'use strict';

  var TOKEN_KEY = 'pats.session';

  var state = {
    config: window.PATS_CONFIG || {},
    token: null,
    user: null,
    view: 'dm',          // dm | group | archive | settings | profile | switch
    conversations: [],
    activeId: null,
    activeType: null,
    messages: [],
    lastMessageAt: null,
    keyword: '',
    poller: null
  };

  /* ----------------------------------------------------------- 儲存權杖 */

  function readToken() {
    try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function writeToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 無痕模式等情況忽略 */ }
    // 登出或權杖失效時，連同本機的對話快取一起清掉（共用電腦不留下聊天內容）
    if (!token && window.PatsCache) window.PatsCache.clearAll();
    state.token = token;
  }

  /* ------------------------------------------------------------- 伺服器 */

  var ERROR_TEXT = {
    NO_API_URL: '尚未設定後端網址，請在 assets/js/config.js 填入 apiUrl。',
    NETWORK: '無法連線至伺服器，請確認網路與後端部署狀態。',
    BAD_RESPONSE: '伺服器回應格式不正確，請確認部署的是最新版本。',
    BAD_REQUEST: '請求格式錯誤。',
    AUTH_REQUIRED: '登入狀態已過期，請重新登入。',
    INVALID_CREDENTIALS: '帳號或密碼不正確，或是您還沒有註冊帳號，請在下方創建。',
    WRONG_PASSWORD: '目前的密碼不正確。',
    WEAK_PASSWORD: '密碼至少需要 8 個字元。',
    USERNAME_TOO_SHORT: '顯示名稱至少需要 2 個字元。',
    USERNAME_TOO_LONG: '顯示名稱不能超過 40 個字元。',
    USERNAME_TAKEN: '這個用戶名稱已被使用。',
    EMAIL_TAKEN: '這個電子郵件已經註冊過了，請直接登入。',
    EMAIL_INVALID: '請輸入有效的電子郵件格式。',
    PASSWORD_MISMATCH: '兩次輸入的密碼不一致。',
    INVITE_CODE_REQUIRED: '這個站台需要邀請碼才能註冊，請向管理員索取。',
    INVITE_CODE_INVALID: '邀請碼不正確。',
    RESET_CODE_INVALID: '驗證碼不正確，請確認後再試一次。',
    RESET_CODE_EXPIRED: '驗證碼已過期，請重新申請一組。',
    RESET_TOO_MANY_ATTEMPTS: '錯誤次數過多，這組驗證碼已失效，請重新申請。',
    RESET_TOO_SOON: '驗證碼剛剛才寄出，請等一分鐘再重新寄送。',
    RESET_TICKET_INVALID: '這次的重設流程已失效，請重新操作一次。',
    EMAIL_LOCAL_INVALID: '請輸入有效的電子郵件格式。',
    STUDENT_ACCOUNT_DOMAIN: '請輸入有效的電子郵件。',
    SIGNUP_CODE_INVALID: '驗證碼不正確，請確認後再試一次。',
    SIGNUP_CODE_EXPIRED: '驗證碼已過期，請重新填寫資料並索取一組新的。',
    SIGNUP_TOO_MANY_ATTEMPTS: '錯誤次數過多，這組驗證碼已失效，請重新申請。',
    SIGNUP_TOO_SOON: '驗證碼剛剛才寄出，請等一分鐘再重新寄送。',
    SIGNUP_NOT_REQUESTED: '找不到這次的註冊資料，請重新填寫一次。',
    ROLE_REQUIRED: '請先選擇你的身分。',
    EMAIL_DOMAIN_MISMATCH: '請使用有效的電子郵件登入或註冊。',
    STUDENT_ACCOUNT_REQUIRED: '請填寫電子郵件帳號。',
    STUDENT_NOT_FOUND: '找不到這個帳號，請確認對方已經註冊過。',
    NOT_A_STUDENT: '無法綁定這個帳號。',
    PARENT_MUST_REGISTER: '請改用「立即註冊」建立帳號。',
    PARENT_NO_CHAT: '此帳號不能使用聊天功能。',
    USER_NOT_FOUND: '找不到這位使用者，請確認電子郵件或帳號。',
    CANNOT_CHAT_SELF: '無法與自己建立對話。',
    CANNOT_ADD_SELF: '無法將自己加入聯絡人。',
    NOT_A_MEMBER: '你不在這個對話中。',
    EMPTY_MESSAGE: '訊息不可以是空的。',
    MESSAGE_TOO_LONG: '訊息長度超過上限。',
    IMAGE_TOO_LARGE: '圖片太大，請換一張或再壓縮後傳送。',
    IMAGE_BAD_TYPE: '這張圖無法傳送（手機請改選「照片」或 JPG／PNG，勿選 HEIC 原始檔）。',
    IMAGE_EXPIRED: '圖片已過期或已刪除，無法下載。',
    NOT_FOUND: '找不到這則訊息或圖片。',
    USE_SEND_CHAT_IMAGE: '請用圖片按鈕傳送圖片。',
    GROUP_NAME_REQUIRED: '請輸入群組名稱。',
    GOOGLE_LOGIN_NOT_CONFIGURED: '後端尚未設定 Google 用戶端 ID，請聯絡管理員。',
    GOOGLE_TOKEN_MISSING: '沒有取得 Google 憑證，請重新嘗試。',
    GOOGLE_TOKEN_INVALID: 'Google 憑證驗證失敗，請重新嘗試。',
    GOOGLE_TOKEN_EXPIRED: 'Google 憑證已過期，請重新登入。',
    GOOGLE_AUDIENCE_MISMATCH: '前後端的 Google 用戶端 ID 不一致，請聯絡管理員。',
    GOOGLE_ISSUER_MISMATCH: 'Google 憑證來源不正確。',
    GOOGLE_EMAIL_UNVERIFIED: '這個 Google 帳號的電子郵件尚未驗證。',
    UNKNOWN_ACTION: '伺服器不認得這個操作，請確認後端是最新版本。',
    ADMIN_REQUIRED: '只有管理員可以執行這個操作。',
    CANNOT_DELETE_SELF: '不能刪除自己的帳號。',
    PASSWORD_ALREADY_CLEARED: '這個帳號已經沒有密碼了。'
  };

  function describeError(code) {
    return ERROR_TEXT[code] || ('操作失敗（' + code + '）');
  }

  function fail(code) {
    var error = new Error(describeError(code));
    error.code = code;
    return error;
  }

  /**
   * 呼叫 Apps Script 後端。
   *
   * 注意 Content-Type 必須是 text/plain：Apps Script 不會回應 CORS 預檢請求，
   * 只要帶了 application/json 就會觸發預檢而整個失敗。用 text/plain 送 JSON
   * 字串屬於「簡單請求」，瀏覽器會直接送出，後端再自行解析 body。
   */
  /* ------------------------------------------------------- 自動更新版本 */

  // GitHub Pages 對 index.html 有 10 分鐘快取，改不了 header；
  // 改用 no-store 讀 version.json，版本不同就換網址重載一次。
  var RELOADED_KEY = 'pats-reloaded-for';
  var updateRunning = false;

  function currentBuild() {
    var meta = document.querySelector('meta[name="pats-build"]');
    return meta ? String(meta.getAttribute('content') || '') : '';
  }

  /** 拿掉 ?v= / ?r=，網址列維持固定網址 */
  function cleanVersionParams() {
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has('v') && !url.searchParams.has('r')) return;
      url.searchParams.delete('v');
      url.searchParams.delete('r');
      var clean = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
      window.history.replaceState(window.history.state, '', clean);
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------- Android APP 專用 */

  // 畫面打包在 APK 裡（Capacitor），沒有「重新整理拿新版」這回事，
  // 改成比對雲端 version.json 的 androidMin，APP 太舊就請使用者下載新版。
  var isNativeApp = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform());
  // iOS 版用同一套原生程式（Capacitor），版本門檻改看 version.json 的 iosMin／iosUrl
  var isIosApp = isNativeApp && typeof window.Capacitor.getPlatform === 'function' &&
    window.Capacitor.getPlatform() === 'ios';
  var APP_VERSION_URL = 'https://vincent1021210.github.io/version.json';
  var APP_DOWNLOAD_URL = 'https://vincent1021210.github.io/download/PATS.apk';
  var APP_CHECK_GAP_MS = 60 * 60 * 1000;
  var appCheckedAt = 0;
  var appUpdatePrompted = false;

  // 電腦版（Electron）：畫面同樣打包在安裝檔裡，新版由安裝檔自動更新，網頁不自己重新整理
  var desktop = window.PATSDesktop || null;
  var isDesktopApp = !!desktop;
  var DESKTOP_DOWNLOAD_URL = 'https://github.com/vincent1021210/vincent1021210.github.io/releases/latest/download/PATS-Setup.exe';

  function nativePlugin(name) {
    if (!isNativeApp || !window.Capacitor.Plugins) return null;
    return window.Capacitor.Plugins[name] || null;
  }

  /** 外部網址一律交給系統瀏覽器，不在 APP 裡跳離聊天畫面。 */
  function openExternal(url) {
    var browser = nativePlugin('Browser');
    if (browser) return browser.open({ url: url });
    if (desktop) return desktop.openExternal(url);
    window.open(url, '_blank', 'noopener');
  }

  function checkAppVersion() {
    var app = nativePlugin('App');
    if (!app || appUpdatePrompted || Date.now() - appCheckedAt < APP_CHECK_GAP_MS) return Promise.resolve(false);
    appCheckedAt = Date.now();
    return Promise.all([
      app.getInfo(),
      fetch(APP_VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
    ])
      .then(function (results) {
        var info = results[0] || {};
        var remote = results[1] || {};
        var min = Number((isIosApp ? remote.iosMin : remote.androidMin) || 0);
        var url = isIosApp ? remote.iosUrl : (remote.androidUrl || APP_DOWNLOAD_URL);
        if (!min || !url || Number(info.build || 0) >= min) {
          return checkLiveUpdate(info).then(function () { return false; });
        }
        appUpdatePrompted = true;
        openModal({
          title: '請更新 PATS APP',
          lead: '目前安裝的版本（' + (info.version || info.build) + '）太舊，部分功能可能無法使用。請' +
            (isIosApp ? '到 App Store 更新' : '下載並安裝新版') + '，聊天紀錄不會遺失。',
          confirmText: isIosApp ? '前往更新' : '前往下載',
          onSubmit: function () { openExternal(url); }
        });
        return true;
      })
      .catch(function () { return false; });
  }

  // 畫面更新包：APK 不必重裝，背景下載新版畫面，下次切回 APP 時自動換上（見 android-app/scripts/make-web-update.mjs）
  var LIVE_UPDATE_URL = 'https://vincent1021210.github.io/download/android-web/latest.json';
  var liveUpdateQueued = '';

  function checkLiveUpdate(info) {
    var updater = nativePlugin('CapacitorUpdater');
    if (!updater) return Promise.resolve();
    return fetch(LIVE_UPDATE_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (remote) {
        var latest = remote && remote.build ? String(remote.build) : '';
        var mine = currentBuild();
        // build 是可排序的日期字串，只往新版走
        if (!latest || !remote.url || latest <= mine || latest === liveUpdateQueued) return;
        var nativeMin = isIosApp ? remote.iosNativeMin : remote.nativeMin;
        if (isIosApp && !nativeMin) return;
        if (Number(info.build || 0) < Number(nativeMin || 0)) return;
        return updater.list()
          .then(function (res) {
            var bundles = (res && res.bundles) || [];
            for (var i = 0; i < bundles.length; i++) {
              if (bundles[i].version === latest && bundles[i].status !== 'error') return bundles[i];
            }
            return updater.download({ url: remote.url, version: latest, checksum: remote.checksum });
          })
          .then(function (bundle) { return updater.next({ id: bundle.id }); })
          .then(function () {
            liveUpdateQueued = latest;
            toast('新版畫面已下載，切換到其他 APP 再回來就會套用');
          });
      })
      .catch(function () { /* 下次再試 */ });
  }

  /* --------------------------------------------- 網站版：畫面存在裝置裡（sw.js） */

  var swSupported = !isNativeApp && !isDesktopApp && 'serviceWorker' in navigator && window.isSecureContext;

  function registerShell() {
    if (!swSupported) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 不支援就照舊每次連網 */ });
    });
  }

  function shellBuild() {
    var controller = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!controller || !window.MessageChannel) return Promise.resolve('');
    return new Promise(function (resolve) {
      var channel = new MessageChannel();
      channel.port1.onmessage = function (event) { resolve(String(event.data || '')); };
      controller.postMessage('pats-build', [channel.port2]);
      setTimeout(function () { resolve(''); }, 2000);
    });
  }

  /** 重新整理前先等 Service Worker 把新版畫面下載好，否則重新整理還是拿到快取裡的舊版。 */
  function waitForShell(latest) {
    if (!swSupported || !navigator.serviceWorker.controller) return Promise.resolve();
    return shellBuild().then(function (cached) {
      if (cached === latest) return;
      return new Promise(function (resolve) {
        var done = false;
        function finish() { if (!done) { done = true; resolve(); } }
        navigator.serviceWorker.addEventListener('controllerchange', finish);
        setTimeout(finish, 15000);
        navigator.serviceWorker.getRegistration()
          .then(function (reg) { return reg && reg.update(); })
          .catch(finish);
      });
    });
  }

  registerShell();

  /* ------------------------------------------ iPhone：教使用者「加入主畫面」 */

  var isIosBrowser = (function () {
    var ua = navigator.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return ios && !standalone && !isNativeApp;
  })();
  if (isIosBrowser) {
    document.documentElement.classList.add('is-ios-browser');
    document.addEventListener('click', function (event) {
      if (!event.target.closest || !event.target.closest('#ios-install')) return;
      event.preventDefault();
      showIosInstall();
    });
  }

  function showIosInstall() {
    openModal({
      title: '安裝到 iPhone／iPad 主畫面',
      lead: '1. 用 Safari 開啟這個網頁（iPhone 或 iPad 都可以）\n2. 點「分享」按鈕（方框加向上箭頭）：iPhone 在畫面下方，iPad 在畫面上方\n3. 選「加入主畫面」，再按「新增」\n\n之後從主畫面的 PATS 圖示開啟，就像一般 APP：全螢幕、畫面存在裝置裡、開啟更快，有新版會自動更新。',
      confirmText: '知道了',
      onSubmit: function () { closeModal(); }
    });
  }

  function checkForUpdate(reason) {
    if (isNativeApp) return checkAppVersion(reason);
    if (isDesktopApp || updateRunning || !window.fetch) return Promise.resolve(false);
    var mine = currentBuild();
    if (!mine) return Promise.resolve(false);
    updateRunning = true;
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var latest = data && data.build ? String(data.build) : '';
        if (!latest || latest === mine) return false;
        try {
          // 同一版本只自動重載一次，避免 Pages 還沒部署完時無限重載
          if (sessionStorage.getItem(RELOADED_KEY) === latest) return false;
          sessionStorage.setItem(RELOADED_KEY, latest);
        } catch (e) { return false; }
        return waitForShell(latest).then(function () {
          var url = new URL(window.location.href);
          url.searchParams.delete('r');
          url.searchParams.set('v', latest);
          window.location.replace(url.toString());
          return true;
        });
      })
      .catch(function () { return false; })
      .then(function (reloading) {
        updateRunning = false;
        return reloading;
      });
  }

  /* ------------------------------------------------------------ 效能量測 */

  // 網址帶 ?perf=1 開啟，之後同一分頁持續有效；?perf=0 關閉
  var PERF_KEY = 'pats-perf';
  var perfOn = (function () {
    try {
      var flag = new URL(window.location.href).searchParams.get('perf');
      if (flag === '1') sessionStorage.setItem(PERF_KEY, '1');
      if (flag === '0') sessionStorage.removeItem(PERF_KEY);
      return sessionStorage.getItem(PERF_KEY) === '1';
    } catch (e) { return false; }
  })();
  var perfMarked = {};

  function nowMs() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  /** 記錄開啟網頁後第一次到達某個里程碑的時間（每個標籤只記一次） */
  function perfMark(label) {
    if (!perfOn || perfMarked[label]) return;
    perfMarked[label] = true;
    console.info('[perf] ' + label + '：開啟後 ' + Math.round(nowMs()) + 'ms');
  }

  /* ----------------------------------------------------------- 呼叫後端 */

  var RPC_TIMEOUT_MS = 20000;
  // 只重試讀取類操作；寫入類（送訊息等）重送可能造成重複
  var RETRY_ACTIONS = { bootstrap: 1, session: 1, listConversations: 1, listMessages: 1 };

  function rpcOnce(action, payload) {
    var url = state.config.apiUrl;
    var started = nowMs();
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, RPC_TIMEOUT_MS) : null;

    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        action: action,
        payload: payload || {},
        token: state.token
      })
    })
      .then(function (response) {
        if (!response.ok) throw fail('NETWORK');
        return response.text();
      })
      .then(function (text) {
        var result;
        try {
          result = JSON.parse(text);
        } catch (err) {
          throw fail('BAD_RESPONSE');
        }
        if (perfOn) {
          console.info('[perf] rpc ' + action + '：' + Math.round(nowMs() - started) + 'ms' +
            (result && result.ms !== undefined ? '（伺服器 ' + result.ms + 'ms）' : ''));
        }
        if (result && result.ok) return result.data;
        if (result && result.error === 'UNKNOWN_ACTION') checkForUpdate('stale-backend');
        throw fail((result && result.error) || 'UNKNOWN_ERROR');
      })
      .catch(function (err) {
        if (err && err.code) throw err;
        throw fail('NETWORK');
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  function rpc(action, payload) {
    if (!state.config.apiUrl) return Promise.reject(fail('NO_API_URL'));
    return rpcOnce(action, payload).catch(function (err) {
      if (!RETRY_ACTIONS[action] || err.code !== 'NETWORK') throw err;
      return rpcOnce(action, payload);
    });
  }

  /* --------------------------------------------------------- DOM 小工具 */

  function $(selector, scope) { return (scope || document).querySelector(selector); }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function icon(name, extraClass) {
    return el('span', { class: 'material-symbols-outlined ' + (extraClass || ''), text: name });
  }

  function show(node) { node.classList.remove('hidden'); }
  function hide(node) { node.classList.add('hidden'); }

  /* ------------------------------------------------------------ 格式化 */

  function initials(name) {
    var text = String(name || '?').trim();
    if (!text) return '?';
    if (/[\u4e00-\u9fff]/.test(text)) return text.slice(-2);
    var parts = text.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return text.slice(0, 2).toUpperCase();
  }

  function avatarNode(name, url, extraClass) {
    var node = el('div', { class: 'avatar ' + (extraClass || '') });
    var label = initials(name);
    if (url) {
      var img = el('img', {
        src: url,
        alt: '',
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
        decoding: 'async'
      });
      img.addEventListener('error', function () {
        img.remove();
        if (!node.textContent) node.textContent = label;
      });
      node.appendChild(img);
    } else {
      node.textContent = label;
    }
    return node;
  }

  function formatTime(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date)) return '';
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatListTime(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date)) return '';
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return formatTime(iso);
    var diffDays = Math.floor((now - date) / 86400000);
    if (diffDays < 7) return ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][date.getDay()];
    return (date.getMonth() + 1) + '/' + date.getDate();
  }

  function formatDay(iso) {
    var date = new Date(iso);
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return '今天';
    var yesterday = new Date(now.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return '昨天';
    return date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    var mb = bytes / (1024 * 1024);
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return (mb < 0.1 ? 0.1 : mb).toFixed(1) + ' MB';
  }

  /* ------------------------------------------------------- 提示與對話框 */

  function toast(message, tone) {
    var node = el('div', { class: 'toast' + (tone ? ' is-' + tone : ''), text: message });
    $('#toast-root').appendChild(node);
    setTimeout(function () { node.remove(); }, 2600);
  }

  /**
   * 開啟自訂對話框。
   * options: { title, lead, fields: [{name,label,type,placeholder,value}],
   *            confirmText, onSubmit(values) -> Promise|void }
   */
  function openModal(options) {
    closeModal();
    var inputs = {};

    var fields = (options.fields || []).map(function (field) {
      var input;
      if (field.type === 'textarea') {
        input = el('textarea', {
          class: 'input',
          rows: String(field.rows || 3),
          placeholder: field.placeholder || ''
        });
        input.value = field.value || '';
      } else {
        input = el('input', {
          class: 'input',
          type: field.type || 'text',
          placeholder: field.placeholder || '',
          value: field.value || ''
        });
      }
      inputs[field.name] = input;
      return el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, [el('strong', { text: field.label })]),
        input
      ]);
    });

    var errorBox = el('div', { class: 'form-error hidden' }, [icon('error'), el('span')]);
    var confirmBtn = el('button', {
      class: 'btn btn-primary',
      type: 'submit',
      text: options.confirmText || '確定'
    });

    var form = el('form', { class: 'modal' }, [
      el('h3', { text: options.title || '' }),
      options.lead ? el('p', { class: 'lead', text: options.lead }) : null,
      errorBox,
      el('div', { class: 'fields' }, fields),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn btn-ghost', type: 'button', text: '取消', onclick: closeModal }),
        confirmBtn
      ])
    ]);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var values = {};
      Object.keys(inputs).forEach(function (key) { values[key] = inputs[key].value.trim(); });
      confirmBtn.disabled = true;
      Promise.resolve()
        .then(function () { return options.onSubmit(values); })
        .then(function () {
          // 成功後立刻關閉；後續導頁／重整由 onSubmit 自行背景處理
          closeModal();
        })
        .catch(function (err) {
          if (!$('#modal-root').contains(form)) return;
          errorBox.querySelector('span:last-child').textContent = err.message;
          errorBox.classList.remove('hidden');
          confirmBtn.disabled = false;
        });
    });

    var backdrop = el('div', { class: 'modal-backdrop' }, [form]);
    backdrop.addEventListener('mousedown', function (event) {
      if (event.target === backdrop) closeModal();
    });
    $('#modal-root').appendChild(backdrop);
    var first = form.querySelector('input');
    if (first) first.focus();
  }

  function closeModal() { $('#modal-root').innerHTML = ''; }

  /** items: [{ label, icon, tone, onSelect }] */
  function openMenu(anchor, items) {
    closeMenu();
    var menu = el('div', { class: 'menu' }, items.map(function (item) {
      return el('button', {
        class: item.tone === 'danger' ? 'is-danger' : '',
        type: 'button',
        onclick: function () { closeMenu(); item.onSelect(); }
      }, [icon(item.icon || 'chevron_right'), el('span', { text: item.label })]);
    }));
    $('#menu-root').appendChild(menu);

    var rect = anchor.getBoundingClientRect();
    var width = menu.offsetWidth;
    var left = Math.min(rect.right - width, window.innerWidth - width - 12);
    menu.style.left = Math.max(12, left) + 'px';
    menu.style.top = Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 12) + 'px';

    setTimeout(function () {
      document.addEventListener('mousedown', onOutside, { once: true });
    }, 0);

    function onOutside(event) { if (!menu.contains(event.target)) closeMenu(); }
  }

  function closeMenu() { $('#menu-root').innerHTML = ''; }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { closeModal(); closeMenu(); }
  });

  if (isNativeApp) {
    // 畫面更新包載入成功要立刻回報，否則外掛 10 秒後會退回上一版畫面
    var liveUpdater = nativePlugin('CapacitorUpdater');
    if (liveUpdater) liveUpdater.notifyAppReady().catch(function () { /* 舊版 APK 沒有這個外掛 */ });

    // APP 裡點到 http(s) 連結（訊息網址、推薦網站等）一律開系統瀏覽器，
    // 否則 WebView 會直接換頁，回不到聊天畫面
    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      openExternal(href);
    }, true);

    var statusBar = nativePlugin('StatusBar');
    if (statusBar) statusBar.setStyle({ style: 'LIGHT' }).catch(function () { /* 舊版 Android 不支援 */ });
    document.documentElement.classList.add('is-native-app');

    // 畫面包是 Android／iOS 共用的（Android 版拿掉了 viewport-fit），
    // iPhone 瀏海與底部橫條要靠 viewport-fit=cover 讓 CSS 的 safe-area 生效
    if (isIosApp) {
      var viewport = document.querySelector('meta[name=viewport]');
      if (viewport && !/viewport-fit/.test(viewport.content)) viewport.content += ', viewport-fit=cover';
      document.documentElement.classList.add('is-ios-app');
    }
  }
  if (isDesktopApp) document.documentElement.classList.add('is-desktop-app');

  return {
    state: state,
    rpc: rpc,
    readToken: readToken,
    writeToken: writeToken,
    describeError: describeError,
    fail: fail,
    $: $, $$: $$, el: el, icon: icon, show: show, hide: hide,
    initials: initials, avatarNode: avatarNode,
    formatTime: formatTime, formatListTime: formatListTime,
    formatDay: formatDay, formatBytes: formatBytes,
    toast: toast, openModal: openModal, closeModal: closeModal,
    openMenu: openMenu, closeMenu: closeMenu,
    checkForUpdate: checkForUpdate, cleanVersionParams: cleanVersionParams,
    perfMark: perfMark,
    isNativeApp: isNativeApp, isIosApp: isIosApp, nativePlugin: nativePlugin, openExternal: openExternal,
    isDesktopApp: isDesktopApp, desktop: desktop, DESKTOP_DOWNLOAD_URL: DESKTOP_DOWNLOAD_URL,
    isIosBrowser: isIosBrowser, showIosInstall: showIosInstall
  };
})();
