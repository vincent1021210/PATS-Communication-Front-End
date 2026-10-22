/* =====================================================================
   PATS — 應用外框：啟動流程、畫面切換、導覽列
   ===================================================================== */

var PatsMain = (function () {
  'use strict';

  var $ = PATS.$;
  var state = PATS.state;

  /* Rail 上的按鈕 → 設定區實際要顯示的子畫面 */
  var SETTINGS_SECTION = {
    settings: 'archive',
    profile: 'account',
    call: 'call',
    admin: 'admin',
    switch: 'switch'
  };

  /* 需要對話列表的畫面，家長身分看不到這些 */
  var CHAT_VIEWS = ['dm', 'group', 'archive'];

  /* --------------------------------------------------------------- 啟動 */

  function boot() {
    PatsAuth.init();
    PatsChat.init();
    bindRail();
    bindResize();

    if (!state.config.apiUrl) {
      PATS.hide($('#loading'));
      PATS.show($('#auth'));
      PatsAuth.showError(PATS.describeError('NO_API_URL'));
      return;
    }

    var token = PATS.readToken();
    if (!token) return showAuth();

    state.token = token;
    PATS.rpc('session', { token: token })
      .then(function (result) {
        if (!result) return showAuth();
        enterApp(result.user);
      })
      .catch(function (err) {
        showAuth();
        if (err.code === 'NETWORK' || err.code === 'BAD_RESPONSE') PatsAuth.showError(err.message);
      });
  }

  function showAuth() {
    PatsChat.stopPolling();
    if (window.PatsCall) PatsCall.disconnect();
    PATS.hide($('#loading'));
    PATS.hide($('#app'));
    PATS.show($('#auth'));
    PatsAuth.showLoginPanel();
  }

  function enterApp(user) {
    state.user = user;
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
    setView('dm', { autoSelect: true });
    PatsChat.startPolling();
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
    var avatar = $('#me-avatar');
    avatar.innerHTML = '';
    if (user.avatarUrl) {
      avatar.appendChild(PATS.el('img', { src: user.avatarUrl, alt: '' }));
    } else {
      avatar.textContent = PATS.initials(user.displayName || user.username);
    }
  }

  /* ----------------------------------------------------------- 畫面切換 */

  function setView(view, options) {
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
    PatsChat.refreshList({ autoSelect: options && options.autoSelect });
  }

  /** 手機版單欄時，決定要顯示列表還是對話。 */
  function setMobilePane(pane) {
    $('#app').setAttribute('data-mobile', pane);
  }

  function updateBadges(list) {
    if (state.view === 'archive') return;
    var total = list.reduce(function (sum, conv) { return sum + (conv.unread || 0); }, 0);
    var badge = document.querySelector('[data-count="' + state.view + '"]');
    if (!badge) return;
    badge.textContent = String(total);
    badge.classList.toggle('hidden', total === 0);
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
          { label: '通話設定', icon: 'call', onSelect: function () { setView('call'); } },
          { label: '個人資料', icon: 'person', onSelect: function () { setView('profile'); } },
          { label: '登出', icon: 'logout', tone: 'danger', onSelect: function () { setView('switch'); } }
        ]);
      });
    }
  }

  function bindResize() {
    var desktop = window.matchMedia('(min-width: 721px)');
    var handler = function () { if (desktop.matches) setMobilePane('list'); };
    if (desktop.addEventListener) desktop.addEventListener('change', handler);
    else desktop.addListener(handler);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
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
