/* =====================================================================
   PATS — 本機快取（localStorage）

   打開網頁時先把上次看到的列表與對話畫出來，再等伺服器的新資料覆蓋，
   使用者不必盯著載入畫面等 Apps Script 回應。

   - 依 userId 分開存；登出（writeToken(null)）時整包清掉
   - 對話最多留 5 個、每個最近 50 則，整包超過約 1MB 時先丟最舊的對話
   - 寫入延後 300ms 合併，避免輪詢時頻繁序列化
   ===================================================================== */

var PatsCache = (function () {
  'use strict';

  var KEY = 'pats-cache-v1';
  var MAX_THREADS = 5;
  var MAX_MESSAGES = 50;
  var MAX_CHARS = 1000000;
  var WRITE_DELAY_MS = 300;

  var data = null;
  var writeTimer = null;

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function read() {
    if (data) return data;
    var ls = storage();
    if (!ls) return null;
    try {
      var raw = ls.getItem(KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }
    if (data && (!data.user || !data.threads)) data = null;
    return data;
  }

  /** 依最後使用時間丟掉最舊的對話，直到大小在上限內。 */
  function serialize() {
    var text = JSON.stringify(data);
    while (text.length > MAX_CHARS) {
      var oldest = oldestThreadId();
      if (!oldest) return null;
      delete data.threads[oldest];
      text = JSON.stringify(data);
    }
    return text;
  }

  function oldestThreadId() {
    var oldest = null;
    Object.keys(data.threads).forEach(function (id) {
      if (!oldest || data.threads[id].usedAt < data.threads[oldest].usedAt) oldest = id;
    });
    return oldest;
  }

  function flush() {
    clearTimeout(writeTimer);
    writeTimer = null;
    var ls = storage();
    if (!ls || !data) return;
    var text = serialize();
    if (!text) return;
    try {
      ls.setItem(KEY, text);
    } catch (e) {
      // 空間不足：只留目前對話再試一次，仍失敗就放棄快取
      var keep = data.activeId && data.threads[data.activeId];
      data.threads = {};
      if (keep) data.threads[data.activeId] = keep;
      try { ls.setItem(KEY, JSON.stringify(data)); } catch (e2) { clearAll(); }
    }
  }

  function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(flush, WRITE_DELAY_MS);
  }

  /** 回傳 { user, lists, threads, activeId }；沒有快取時回傳 null。 */
  function load() {
    return read();
  }

  /** 換了使用者就整包重來，避免讀到別人的對話。家長帳號沒有聊天，不存。 */
  function saveUser(user) {
    if (!user || !user.id || user.canChat === false) return;
    var current = read();
    if (!current || current.user.id !== user.id) {
      data = { user: user, lists: {}, threads: {}, activeId: null };
    } else {
      data.user = user;
    }
    scheduleWrite();
  }

  function owns() {
    var current = read();
    var me = window.PATS && PATS.state.user;
    return !!(current && me && current.user.id === me.id);
  }

  function saveList(scope, list) {
    if (!owns() || !Array.isArray(list)) return;
    data.lists[scope] = list;
    scheduleWrite();
  }

  function getList(scope) {
    var current = read();
    return current && current.lists[scope] || null;
  }

  /** 只保留最後 50 則；送出中（pending）的暫顯訊息不存。 */
  function saveThread(conversation, messages, hasMore) {
    if (!owns() || !conversation || !conversation.id) return;
    var clean = [];
    var seen = {};
    (messages || []).forEach(function (m) {
      if (!m || m.pending || !m.id || seen[m.id]) return;
      seen[m.id] = true;
      var copy = Object.assign({}, m);
      delete copy.localPreview;
      clean.push(copy);
    });
    var trimmed = clean.length > MAX_MESSAGES;
    data.threads[conversation.id] = {
      conversation: conversation,
      messages: trimmed ? clean.slice(-MAX_MESSAGES) : clean,
      hasMore: !!hasMore || trimmed,
      usedAt: Date.now()
    };
    var ids = Object.keys(data.threads);
    while (ids.length > MAX_THREADS) {
      delete data.threads[oldestThreadId()];
      ids = Object.keys(data.threads);
    }
    scheduleWrite();
  }

  function getThread(id) {
    var current = read();
    return (id && current && current.threads[id]) || null;
  }

  function setActive(id) {
    if (!owns()) return;
    data.activeId = id || null;
    scheduleWrite();
  }

  function clearAll() {
    clearTimeout(writeTimer);
    writeTimer = null;
    data = null;
    var ls = storage();
    if (ls) {
      try { ls.removeItem(KEY); } catch (e) { /* ignore */ }
    }
  }

  window.addEventListener('pagehide', function () { if (writeTimer) flush(); });

  return {
    load: load,
    saveUser: saveUser,
    saveList: saveList,
    getList: getList,
    saveThread: saveThread,
    getThread: getThread,
    setActive: setActive,
    clearAll: clearAll
  };
})();
