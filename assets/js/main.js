/* =====================================================================
   PATS — 應用外框：啟動流程、畫面切換、導覽列
   ===================================================================== */

var PatsMain = (function () {
  'use strict';

  var $ = PATS.$;
  var state = PATS.state;

  /* Rail 上的按鈕 → 設定區實際要顯示的子畫面 */
  var SETTINGS_SECTION = {
    settings: 'home',
    profile: 'account',
    admin: 'admin',
    switch: 'switch'
  };

  /* 需要對話列表的畫面，家長身分看不到這些 */
  var CHAT_VIEWS = ['dm', 'group', 'archive'];

  /* --------------------------------------------------------------- 啟動 */

  function boot() {
    PATS.cleanVersionParams();
    PATS.checkForUpdate('boot');
    bindUpdateChecks();
    PatsAuth.init();
    PatsChat.init();
    bindRail();
    bindResize();
    bindNativeBack();
    bindDesktopNotifications();

    if (!state.config.apiUrl) {
      PATS.hide($('#loading'));
      PATS.show($('#auth'));
      PatsAuth.showError(PATS.describeError('NO_API_URL'));
      return;
    }

    var token = PATS.readToken();
    if (!token) return showAuth();

    state.token = token;
    PATS.perfMark('boot');

    // 有上次的快取就先畫出來，不必等伺服器（Apps Script 一次往返要 1～3 秒）
    var cached = window.PatsCache ? PatsCache.load() : null;
    var fromCache = false;
    if (cached && cached.user && cached.user.canChat !== false) {
      var lastId = isDesktop() ? cached.activeId : null;
      enterApp(cached.user, {
        prefetched: {
          list: cached.lists.dm || [],
          thread: lastId ? PatsCache.getThread(lastId) : null,
          fromCache: true
        },
        deferPolling: true
      });
      fromCache = true;
      PATS.perfMark('cache-painted');
    }

    var wantId = fromCache ? state.activeId : (isDesktop() && cached ? cached.activeId : null);
    PATS.rpc('bootstrap', {
      withData: true,
      conversationId: wantId || '',
      autoSelect: isDesktop(),
      limit: 50
    })
      .then(function (result) {
        PATS.perfMark('bootstrap');
        if (!result || !result.user) return legacyBoot(token, fromCache);
        // 舊版後端的 bootstrap 不認得 withData，只回 user：改走原本的流程
        if (result.user.canChat !== false && !result.conversations) {
          return enterApp(result.user);
        }
        applyBootstrap(result, fromCache, wantId);
      })
      .catch(function (err) {
        if (err.code === 'UNKNOWN_ACTION') return legacyBoot(token, fromCache);
        if (err.code === 'AUTH_REQUIRED') {
          PATS.writeToken(null);
          state.user = null;
          showAuth();
          PATS.toast(err.message);
          return;
        }
        if (fromCache) {
          // 先留著快取畫面，輪詢會在網路恢復後自動補上新資料
          PATS.toast('目前連不上伺服器，先顯示上次的資料。', 'error');
          PatsChat.startPolling({ immediate: true });
          return;
        }
        showAuth();
        if (err.code === 'NETWORK' || err.code === 'BAD_RESPONSE') PatsAuth.showError(err.message);
      });
  }

  /** 後端還沒更新、沒有 bootstrap 時的舊流程。 */
  function legacyBoot(token, fromCache) {
    return PATS.rpc('session', { token: token })
      .then(function (result) {
        if (!result) {
          PATS.writeToken(null);
          return showAuth();
        }
        enterApp(result.user);
      })
      .catch(function (err) {
        if (fromCache && err.code !== 'AUTH_REQUIRED') return PatsChat.startPolling({ immediate: true });
        showAuth();
        if (err.code === 'NETWORK' || err.code === 'BAD_RESPONSE') PatsAuth.showError(err.message);
      });
  }

  /** bootstrap 回來：快取畫面已在就原地更新，否則正式進入。 */
  function applyBootstrap(result, fromCache, wantId) {
    var user = result.user;
    var prefetched = {
      list: result.conversations || [],
      thread: result.thread || null,
      // 要了這個對話卻沒拿到：多半已被刪除或移出群組
      missingId: result.thread ? '' : (wantId || ''),
      ver: result.ver || null
    };
    var sameUser = fromCache && state.user && state.user.id === user.id;
    if (!sameUser || user.canChat === false) {
      if (fromCache && window.PatsCache) PatsCache.clearAll();
      return enterApp(user, { prefetched: user.canChat === false ? null : prefetched });
    }
    state.user = user;
    if (window.PatsCache) PatsCache.saveUser(user);
    renderIdentity();
    applyRole(user);
    // 等待期間使用者切到別的頁就不覆蓋，回到私訊頁時會自己重抓
    if (state.view === 'dm') PatsChat.hydrate(prefetched);
    PatsChat.startPolling();
  }

  function isDesktop() {
    return window.matchMedia('(min-width: 721px)').matches;
  }

  function showAuth() {
    PatsChat.stopPolling();
    if (window.PatsCall) PatsCall.disconnect();
    PATS.hide($('#loading'));
    PATS.hide($('#app'));
    PATS.show($('#auth'));
    PatsAuth.showLoginPanel();
  }

  /**
   * options.prefetched  已有列表／對話資料（快取或 bootstrap），不用再打 listConversations
   * options.deferPolling 只畫了快取，等 bootstrap 回來才開始輪詢
   */
  function enterApp(user, options) {
    options = options || {};
    state.user = user;
    if (window.PatsCache) PatsCache.saveUser(user);
    state.activeId = null;
    state.keyword = '';
    $('#list-search').value = '';

    PATS.hide($('#loading'));
    PATS.hide($('#auth'));
    PATS.show($('#app'));

    renderIdentity();
    applyRole(user);

    // 家長沒有聊天功能，直接落在違規與舉報頁，也不需要輪詢新訊息。
    if (user.canChat === false) {
      setView('guardian');
      return;
    }
    setView('dm', { autoSelect: true, prefetched: options.prefetched });
    if (!options.deferPolling) PatsChat.startPolling();
    if (window.PatsCall) {
      PatsCall.connect(user);
      paintSignalBadge();
      if (!state._signalBound) {
        state._signalBound = true;
        PatsCall.onSignalChange(paintSignalBadge);
      }
    }
  }

  function paintSignalBadge() {
    if (!window.PatsCall) return;
    var st = PatsCall.signalState();
    var map = {
      online: { text: '通話就緒', cls: 'is-ok' },
      connecting: { text: '通話連線中…', cls: 'is-wait' },
      offline: { text: '通話離線', cls: 'is-bad' },
      blocked: { text: '需 HTTPS 信令', cls: 'is-bad' },
      idle: { text: '通話未設定', cls: 'is-bad' }
    };
    var info = map[st] || map.idle;
    ['signal-badge', 'signal-badge-mobile'].forEach(function (id) {
      var badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = info.text;
      badge.className = (id === 'signal-badge-mobile' ? 'signal-strip ' : 'signal-badge ') + info.cls;
      badge.classList.remove('hidden');
    });
  }

  /** 依身分決定側欄要出現哪些入口。 */
  function applyRole(user) {
    var isParent = user.canChat === false;
    PATS.$$('.rail-link[data-view]').forEach(function (link) {
      var view = link.getAttribute('data-view');
      if (view === 'guardian') link.classList.toggle('hidden', !isParent);
      else if (CHAT_VIEWS.indexOf(view) >= 0) link.classList.toggle('hidden', isParent);
    });

    if (!isParent) return;
    var student = user.linkedStudent;
    $('#guardian-student').textContent = student
      ? student.name + '（' + student.email + '）'
      : '尚未綁定，請聯絡管理員協助處理。';
  }

  function renderIdentity() {
    var user = state.user || {};
    $('#me-name').textContent = user.displayName || user.username || 'PATS';
    var roleNode = $('#me-role');
    if (roleNode) {
      roleNode.textContent = user.isAdmin
        ? '管理員'
        : (user.roleLabel || '成員');
    }
    var label = PATS.initials(user.displayName || user.username);
    function paintMeAvatar(node) {
      if (!node) return;
      node.innerHTML = '';
      if (user.avatarUrl) {
        var img = PATS.el('img', {
          src: user.avatarUrl,
          alt: '',
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
    }
    paintMeAvatar($('#me-avatar'));
    paintMeAvatar($('#me-avatar-mobile'));
    var mobileMe = $('#me-avatar-mobile');
    if (mobileMe && !mobileMe._bound) {
      mobileMe._bound = true;
      mobileMe.addEventListener('click', function () { setView('profile'); });
    }
    if (mobileMe) mobileMe.classList.remove('hidden');
  }

  /* ----------------------------------------------------------- 畫面切換 */

  function setView(view, options) {
    // 通話設定 UI 已隱藏；舊連結改導向一般設定
    if (view === 'call') view = 'settings';
    state.view = view;
    PATS.closeMenu();

    PATS.$$('.rail-link[data-view]').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-view') === view);
    });

    var app = $('#app');
    var isSettings = !!SETTINGS_SECTION[view];
    var isGuardian = view === 'guardian';
    var fullWidth = isSettings || isGuardian;

    app.setAttribute('data-list-hidden', fullWidth ? 'true' : 'false');
    $('#list-pane').classList.toggle('hidden', fullWidth);
    $('#chat-pane').classList.toggle('hidden', fullWidth);
    $('#settings-pane').classList.toggle('hidden', !isSettings);
    $('#guardian-pane').classList.toggle('hidden', !isGuardian);

    if (isGuardian) {
      setMobilePane('list');
      return;
    }

    if (isSettings) {
      setMobilePane('list');
      PatsSettings.render(SETTINGS_SECTION[view]);
      return;
    }

    state.activeId = null;
    state.keyword = '';
    $('#list-search').value = '';
    PatsChat.renderPlaceholder();
    setMobilePane('list');
    if (options && options.prefetched && view === 'dm') {
      PatsChat.hydrate(options.prefetched);
      return;
    }
    PatsChat.refreshList({ autoSelect: options && options.autoSelect });
  }

  /** 手機版單欄時，決定要顯示列表還是對話。 */
  function setMobilePane(pane) {
    $('#app').setAttribute('data-mobile', pane);
  }

  function updateBadges(list) {
    if (state.view === 'archive') return;
    var total = list.reduce(function (sum, conv) { return sum + (conv.unread || 0); }, 0);
    notifyDesktop(list, total);
    var badge = document.querySelector('[data-count="' + state.view + '"]');
    if (!badge) return;
    badge.textContent = String(total);
    badge.classList.toggle('hidden', total === 0);
  }

  /* 電腦版：每個列表（私訊、群組）各自記下每個對話最後訊息時間，第一次載入只當基準不通知 */
  var desktopSeen = {};

  /** 電腦版視窗不在前景時，對話有新的未讀訊息就跳 Windows 通知，並在工作列圖示顯示未讀數。 */
  function notifyDesktop(list, total) {
    var desktop = PATS.desktop;
    if (!desktop) return;
    desktop.setBadge(total);
    var first = !desktopSeen[state.view];
    var seen = desktopSeen[state.view] || (desktopSeen[state.view] = {});
    var focused = document.hasFocus();
    list.forEach(function (conv) {
      var prev = seen[conv.id];
      seen[conv.id] = conv.lastMessageAt;
      if (first || focused || !conv.unread || prev === conv.lastMessageAt) return;
      desktop.notify(conv.title || 'PATS', conv.preview || '你有新訊息', conv.id);
    });
  }

  function bindDesktopNotifications() {
    if (!PATS.desktop) return;
    PATS.desktop.onNotificationClick(function (id) {
      if (id) PatsChat.openConversation(id);
    });
  }

  /* --------------------------------------------------------------- 綁定 */

  function bindRail() {
    PATS.$$('.rail-link[data-view]').forEach(function (link) {
      link.addEventListener('click', function () { setView(link.getAttribute('data-view')); });
    });
    PATS.$$('.rail-link[data-action="logout"]').forEach(function (link) {
      link.addEventListener('click', function () { setView('switch'); });
    });
    var more = document.getElementById('rail-more');
    if (more) {
      more.addEventListener('click', function (event) {
        PATS.openMenu(event.currentTarget, [
          { label: '個人資料', icon: 'person', onSelect: function () { setView('profile'); } },
          { label: '登出', icon: 'logout', tone: 'danger', onSelect: function () { setView('switch'); } }
        ]);
      });
    }
  }

  /* ----------------------------------------------------------- 自動更新 */

  var UPDATE_CHECK_MS = 5 * 60 * 1000;

  /** 通話、打字、預覽／對話框開著時不重整，避免打斷使用者 */
  function isBusyForReload() {
    if (window.PatsCall && typeof PatsCall.isBusy === 'function' && PatsCall.isBusy()) return true;
    var input = document.getElementById('composer-input');
    if (input && String(input.value || '').trim()) return true;
    var modal = document.getElementById('modal-root');
    if (modal && modal.childElementCount > 0) return true;
    return false;
  }

  function maybeCheckForUpdate(reason) {
    if (document.hidden || isBusyForReload()) return;
    PATS.checkForUpdate(reason);
  }

  function bindUpdateChecks() {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) maybeCheckForUpdate('visible');
    });
    setInterval(function () { maybeCheckForUpdate('interval'); }, UPDATE_CHECK_MS);
  }

  /**
   * Android 返回鍵：由內往外一層一層退，最外層時讓 APP 退到背景（不關閉，
   * 下次點開不必重新載入）。通話中只退到背景，不掛斷。
   */
  function bindNativeBack() {
    var app = PATS.nativePlugin('App');
    if (!app) return;
    app.addListener('backButton', function () {
      var callLayer = document.getElementById('call-layer');
      if (callLayer && !callLayer.classList.contains('hidden')) return app.minimizeApp();
      if ($('#modal-root').childElementCount) return PATS.closeModal();
      if ($('#menu-root').childElementCount) return PATS.closeMenu();

      var inApp = !$('#app').classList.contains('hidden');
      if (inApp && $('#app').getAttribute('data-mobile') === 'chat') return setMobilePane('list');
      if (inApp && SETTINGS_SECTION[state.view] && PatsSettings.isSubPage()) return PatsSettings.back();
      if (inApp && state.user && state.user.canChat !== false && state.view !== 'dm') return setView('dm');

      var authOpen = !$('#auth').classList.contains('hidden');
      var loginPanel = document.getElementById('login-panel');
      if (authOpen && loginPanel && loginPanel.classList.contains('hidden')) return PatsAuth.showLoginPanel();

      app.minimizeApp();
    });
  }

  function bindResize() {
    var desktop = window.matchMedia('(min-width: 721px)');
    var handler = function () { if (desktop.matches) setMobilePane('list'); };
    if (desktop.addEventListener) desktop.addEventListener('change', handler);
    else desktop.addListener(handler);
  }

  // 一定要等這個 IIFE 回傳、PatsMain 有值之後才 boot：
  // 用 defer 載入時 readyState 已不是 loading，直接呼叫會在 PatsMain 還是 undefined 時就畫快取
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }

  return {
    enterApp: enterApp,
    showAuth: showAuth,
    setView: setView,
    setMobilePane: setMobilePane,
    updateBadges: updateBadges,
    renderIdentity: renderIdentity
  };
})();
