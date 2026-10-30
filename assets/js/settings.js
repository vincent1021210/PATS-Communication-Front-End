/* =====================================================================
   PATS — 設定區：首頁清單 → 子頁面（封存時間、帳號與密碼、帳號管理、切換帳號）
   ===================================================================== */

var PatsSettings = (function () {
  'use strict';

  var $ = PATS.$;
  var el = PATS.el;
  var icon = PATS.icon;
  var state = PATS.state;

  var ARCHIVE_OPTIONS = [
    { value: 30, label: '30 天' },
    { value: 90, label: '90 天' },
    { value: 365, label: '1 年' },
    { value: 0, label: '永不封存 (預設)', desc: '永久保留在主要列表，改為手動管理' }
  ];

  var TITLES = {
    home: '設定',
    archive: '自動封存時間',
    account: '帳號與密碼',
    admin: '帳號管理',
    switch: '切換帳號',
    call: '語音通話'
  };

  var current = 'home';

  function render(section) {
    var pane = $('#settings-pane');
    if (!TITLES[section]) section = 'home';
    if (section === 'admin' && !(state.user && state.user.isAdmin)) section = 'home';
    current = section;

    var body = section === 'archive' ? renderArchive()
             : section === 'account' ? renderAccount()
             : section === 'admin' ? renderAdmin()
             : section === 'switch' ? renderSwitch()
             : section === 'call' ? renderCall()
             : renderHome();

    pane.innerHTML = '';
    pane.appendChild(el('div', { class: 'set-page' }, [topBar(section), body]));
    pane.scrollTop = 0;
  }

  /** 返回：子頁面回設定首頁；首頁回聊天列表。回傳 true 代表已處理。 */
  function back() {
    if (current !== 'home') {
      render('home');
      return true;
    }
    PatsMain.setView(state.user && state.user.canChat === false ? 'guardian' : 'dm');
    return true;
  }

  function isSubPage() { return current !== 'home'; }

  function topBar(section) {
    return el('header', { class: 'set-bar' + (section === 'home' ? ' is-home' : '') }, [
      el('button', {
        class: 'icon-btn set-back', type: 'button', 'aria-label': '返回',
        onclick: back
      }, [icon('arrow_back')]),
      el('h2', { class: 'set-bar-title', text: TITLES[section] })
    ]);
  }

  /* ------------------------------------------------------- 清單元件 */

  function group(label, items) {
    return el('section', { class: 'set-section' }, [
      label ? el('h3', { class: 'set-label', text: label }) : null,
      el('div', { class: 'set-group' }, items.filter(Boolean))
    ]);
  }

  /** 一列設定：標題＋灰色說明；有 onClick 時整列可點並顯示右箭頭 */
  function item(title, sub, onClick, options) {
    var opts = options || {};
    var subNode = el('span', { class: 'set-sub', text: sub || '' });
    var node = el(onClick ? 'button' : 'div', {
      class: 'set-item' + (opts.danger ? ' is-danger' : ''),
      type: onClick ? 'button' : null,
      onclick: onClick || null
    }, [
      el('span', { class: 'set-text' }, [
        el('span', { class: 'set-title', text: title }),
        sub !== null && sub !== undefined ? subNode : null
      ]),
      opts.trailing || (onClick && !opts.noChevron ? icon('chevron_right', 'set-chevron') : null)
    ]);
    node._sub = subNode;
    return node;
  }

  function archiveLabel(days) {
    var found = ARCHIVE_OPTIONS.filter(function (o) { return o.value === days; })[0];
    return found ? found.label.replace(' (預設)', '') : days + ' 天';
  }

  function currentArchiveDays() {
    var days = Number(state.user.settings && state.user.settings.archiveDays);
    return isFinite(days) && days >= 0 ? days : 0;
  }

  /* ------------------------------------------------------- 設定首頁 */

  function renderHome() {
    var user = state.user || {};
    var isAdmin = !!user.isAdmin;
    var canChat = user.canChat !== false;

    var cacheItem = item('清除快取資料', '目前使用空間：計算中…', clearCache, { noChevron: true });
    PATS.rpc('storageUsage', {})
      .then(function (result) { cacheItem._sub.textContent = '目前使用空間：' + PATS.formatBytes(result.bytes); })
      .catch(function () { cacheItem._sub.textContent = '目前使用空間：無法取得'; });

    var versionItem = item('版本', versionText(), null);
    if (PATS.isNativeApp) {
      var app = PATS.nativePlugin('App');
      if (app) {
        app.getInfo().then(function (info) {
          var label = PATS.isIosApp ? 'iOS APP ' : 'Android APP ';
          versionItem._sub.textContent = label + info.version + '（' + info.build + '）・網頁 ' + versionText();
        }).catch(function () { /* 保留網頁版本 */ });
      }
    }
    if (PATS.isDesktopApp) versionItem._sub.textContent = 'Windows APP ' + PATS.desktop.version + '・網頁 ' + versionText();
    var inApp = PATS.isNativeApp || PATS.isDesktopApp;

    return el('div', { class: 'set-body' }, [
      group('帳號', [
        item('帳號與密碼', (user.username || user.displayName || '') + (user.email ? '・' + user.email : ''),
          function () { render('account'); })
      ]),
      canChat ? group('對話', [
        item('自動封存時間', archiveLabel(currentArchiveDays()) + '・超過時間未活動的對話會移到封存',
          function () { render('archive'); }),
        cacheItem
      ]) : null,
      isAdmin ? group('管理', [
        item('帳號管理', '清除使用者密碼或刪除帳號', function () { render('admin'); })
      ]) : null,
      group('其他', [
        versionItem,
        PATS.isIosBrowser ? item('安裝到 iPhone／iPad 主畫面', '全螢幕開啟、畫面存在裝置裡、自動更新', PATS.showIosInstall) : null,
        inApp || PATS.isIosBrowser ? null : item('下載電腦版', 'Windows 電腦版：開機自動啟動、新訊息桌面通知',
          function () { window.location.href = PATS.DESKTOP_DOWNLOAD_URL; }),
        item('隱私權政策', null, function () { PATS.openExternal('https://vincent1021210.github.io/privacy.html'); }),
        item('服務條款', null, function () { PATS.openExternal('https://vincent1021210.github.io/terms.html'); }),
        item('切換帳號或登出', '登出目前的帳號，回到登入畫面', function () { render('switch'); }, { danger: true })
      ])
    ]);
  }

  function versionText() {
    var meta = document.querySelector('meta[name="pats-build"]');
    return (meta && meta.getAttribute('content')) || '未知';
  }

  /* ------------------------------------------------------- 封存時間 */

  function renderArchive() {
    var days = currentArchiveDays();
    var saving = false;

    var rows = ARCHIVE_OPTIONS.map(function (option) {
      var input = el('input', { type: 'radio', name: 'archive-days', value: String(option.value) });
      if (option.value === days) input.checked = true;
      input.addEventListener('change', function () {
        if (saving) return;
        saving = true;
        PATS.rpc('updateSettings', { settings: { archiveDays: option.value } })
          .then(function (settings) {
            state.user.settings = settings;
            PATS.toast('已改為「' + archiveLabel(option.value) + '」。', 'success');
            return PatsChat.refreshList();
          })
          .catch(PatsChat.handleError)
          .finally(function () { saving = false; });
      });
      return el('label', { class: 'set-item set-radio' }, [
        input,
        el('span', { class: 'set-text' }, [
          el('span', { class: 'set-title', text: option.label }),
          option.desc ? el('span', { class: 'set-sub', text: option.desc }) : null
        ])
      ]);
    });

    return el('div', { class: 'set-body' }, [
      el('p', { class: 'set-hint', text: '設定超過多少時間未活動的對話會自動移到封存。封存的訊息仍可透過搜尋或在封存區找到。選擇後立即生效。' }),
      group(null, rows)
    ]);
  }

  function clearCache() {
    if (!window.confirm('清除快取的圖片與文件？對話紀錄不會被刪除，下次查看時會重新下載。')) return;
    PATS.rpc('clearCache', {})
      .then(function () {
        PATS.toast('快取已清除。', 'success');
        if (current === 'home') render('home');
      })
      .catch(PatsChat.handleError);
  }

  /* ----------------------------------------------------------- 通話設定 */

  function renderCall() {
    var input = el('input', {
      class: 'input', type: 'url',
      value: (window.PatsCall && PatsCall.signalingUrl()) || '',
      placeholder: 'https://xxxx.onrender.com'
    });
    var status = el('p', { class: 'set-hint', text: signalLabel() });
    if (window.PatsCall) PatsCall.onSignalChange(function () { status.textContent = signalLabel(); });

    return el('div', { class: 'set-body' }, [
      group('信令伺服器網址', [
        el('div', { class: 'set-item set-form' }, [
          input,
          el('div', { class: 'set-form-actions' }, [
            el('button', {
              class: 'btn btn-ghost', type: 'button', text: '還原預設',
              onclick: function () {
                if (!window.PatsCall) return;
                PatsCall.setSignalingUrl('');
                input.value = PatsCall.signalingUrl();
                status.textContent = signalLabel();
              }
            }),
            el('button', {
              class: 'btn btn-primary', type: 'button', text: '儲存並重新連線',
              onclick: function () {
                if (!window.PatsCall) return PATS.toast('通話模組尚未載入。', 'error');
                PatsCall.setSignalingUrl(input.value);
                status.textContent = signalLabel();
                PATS.toast('已更新通話伺服器設定。', 'success');
              }
            })
          ])
        ])
      ]),
      status
    ]);
  }

  function signalLabel() {
    if (!window.PatsCall) return '通話模組未載入';
    var map = {
      online: '狀態：已連線（通話就緒）',
      connecting: '狀態：連線中…',
      offline: '狀態：離線',
      blocked: '狀態：被瀏覽器阻擋（HTTPS 頁面不能連 HTTP 信令）',
      idle: '狀態：尚未連線'
    };
    return (map[PatsCall.signalState()] || map.idle) + '｜' + (PatsCall.signalingUrl() || '（未設定）');
  }

  /* ------------------------------------------------------- 帳號與密碼 */

  function renderAccount() {
    var usernameInput = el('input', {
      class: 'input', type: 'text', value: state.user.username || '', maxlength: '40'
    });

    var currentInput = passwordField('輸入目前使用的密碼', 'current-password');
    var nextInput = passwordField('新密碼（至少 8 個字元）', 'new-password');
    var confirmInput = passwordField('再次輸入新密碼', 'new-password');

    var saveButton = el('button', { class: 'btn btn-primary', type: 'submit', text: '更新密碼' });
    var form = el('form', { class: 'set-item set-form' }, [
      fieldBlock('目前的密碼', currentInput.node),
      fieldBlock('新密碼', nextInput.node),
      fieldBlock('確認新密碼', confirmInput.node),
      el('div', { class: 'set-form-actions' }, [saveButton])
    ]);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (nextInput.input.value !== confirmInput.input.value) {
        return PATS.toast('兩次輸入的新密碼不一致。', 'error');
      }
      saveButton.disabled = true;
      PATS.rpc('changePassword', {
        currentPassword: currentInput.input.value,
        newPassword: nextInput.input.value
      })
        .then(function () {
          PATS.toast('密碼已更新。', 'success');
          render('account');
        })
        .catch(PatsChat.handleError)
        .finally(function () { saveButton.disabled = false; });
    });

    return el('div', { class: 'set-body' }, [
      group('用戶名稱', [
        el('div', { class: 'set-item set-form' }, [
          usernameInput,
          el('span', { class: 'set-sub', text: '其他使用者在系統中看見的名稱。建議使用真實姓名以利辨識。' }),
          el('div', { class: 'set-form-actions' }, [
            el('button', {
              class: 'btn btn-outline', type: 'button', text: '更新名稱',
              onclick: function (event) { saveUsername(event.currentTarget, usernameInput.value); }
            })
          ])
        ])
      ]),
      group('密碼變更', [form]),
      el('p', { class: 'set-hint', text: '密碼應至少 8 個字元，並混用大小寫字母、數字及特殊符號。只用 Google 登入的帳號沒有密碼，可在登入頁用「忘記密碼」設定。' })
    ]);
  }

  function fieldBlock(label, node) {
    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label' }, [el('strong', { text: label })]),
      node
    ]);
  }

  function passwordField(placeholder, autocomplete) {
    var input = el('input', {
      type: 'password', placeholder: placeholder, autocomplete: autocomplete
    });
    var toggle = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '顯示密碼' },
      [icon('visibility_off')]);
    toggle.addEventListener('click', function () {
      var toText = input.type === 'password';
      input.type = toText ? 'text' : 'password';
      toggle.querySelector('.material-symbols-outlined').textContent =
        toText ? 'visibility' : 'visibility_off';
    });
    return { node: el('div', { class: 'input-wrap' }, [input, toggle]), input: input };
  }

  function saveUsername(button, value) {
    button.disabled = true;
    PATS.rpc('updateProfile', { username: value })
      .then(function (user) {
        state.user = user;
        PatsMain.renderIdentity();
        PATS.toast('用戶名稱已更新。', 'success');
      })
      .catch(PatsChat.handleError)
      .finally(function () { button.disabled = false; });
  }

  /* --------------------------------------------------------- 管理員 */

  function renderAdmin() {
    var list = el('div', { class: 'admin-user-list', id: 'admin-user-list' }, [
      el('div', { class: 'admin-loading', text: '載入帳號中…' })
    ]);
    var search = el('input', {
      class: 'input', type: 'search', placeholder: '搜尋信箱、名稱或帳號'
    });
    var searchTimer = null;
    search.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { loadAdminUsers(list, search.value.trim()); }, 220);
    });

    loadAdminUsers(list, '');

    return el('div', { class: 'set-body' }, [
      el('p', { class: 'set-hint', text: '清除密碼不會刪除帳號，對方需改用 Google 登入或自行重設密碼；刪除帳號會一併移除工作階段與聯絡人，歷史訊息仍會保留。' }),
      group('使用者清單', [
        el('div', { class: 'set-item set-form' }, [
          el('div', { class: 'input-wrap' }, [icon('search'), search]),
          list
        ])
      ])
    ]);
  }

  function loadAdminUsers(container, keyword) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'admin-loading', text: '載入帳號中…' }));
    PATS.rpc('adminListUsers', { q: keyword })
      .then(function (users) {
        container.innerHTML = '';
        if (!users.length) {
          container.appendChild(el('div', {
            class: 'admin-empty',
            text: keyword ? '找不到符合的帳號。' : '目前沒有任何帳號。'
          }));
          return;
        }
        users.forEach(function (user) {
          container.appendChild(adminUserRow(user, container, keyword));
        });
      })
      .catch(PatsChat.handleError);
  }

  function adminUserRow(user, container, keyword) {
    var me = state.user && state.user.id === user.id;
    var meta = [
      user.email,
      user.roleLabel || user.role,
      user.hasPassword ? '有密碼' : '無密碼',
      user.provider === 'google' ? 'Google' : '帳密'
    ].join(' · ');

    var clearBtn = el('button', {
      class: 'btn btn-ghost', type: 'button', text: '清除密碼',
      disabled: user.hasPassword ? null : 'disabled',
      onclick: function () { clearUserPassword(user, container, keyword); }
    });
    var deleteBtn = el('button', {
      class: 'btn btn-ghost is-danger-text', type: 'button', text: '刪除帳號',
      disabled: me ? 'disabled' : null,
      onclick: function () { deleteUserAccount(user, container, keyword); }
    });

    return el('div', { class: 'admin-user-row' }, [
      PATS.avatarNode(user.displayName, user.avatarUrl, 'avatar-sm'),
      el('div', { class: 'admin-user-meta' }, [
        el('div', { class: 'admin-user-name', text: user.displayName + (me ? '（你）' : '') }),
        el('div', { class: 'admin-user-sub', text: meta })
      ]),
      el('div', { class: 'admin-user-actions' }, [clearBtn, deleteBtn])
    ]);
  }

  function clearUserPassword(user, container, keyword) {
    if (!window.confirm('確定清除「' + user.displayName + '」的登入密碼？\n清除後該帳號無法再用密碼登入，需改用 Google 或忘記密碼重設。')) {
      return;
    }
    PATS.rpc('adminClearPassword', { userId: user.id })
      .then(function () {
        PATS.toast('已清除 ' + user.email + ' 的密碼。', 'success');
        loadAdminUsers(container, keyword);
      })
      .catch(PatsChat.handleError);
  }

  function deleteUserAccount(user, container, keyword) {
    if (!window.confirm('確定刪除帳號「' + user.displayName + '」（' + user.email + '）？\n此操作無法復原。')) {
      return;
    }
    PATS.rpc('adminDeleteUser', { userId: user.id })
      .then(function () {
        PATS.toast('已刪除帳號 ' + user.email + '。', 'success');
        loadAdminUsers(container, keyword);
      })
      .catch(PatsChat.handleError);
  }

  /* --------------------------------------------------------- 切換帳號 */

  function renderSwitch() {
    var user = state.user || {};
    return el('div', { class: 'set-body' }, [
      group('目前登入', [
        item(user.displayName || user.username || '', user.email || '', null)
      ]),
      el('p', { class: 'set-hint', text: '登出後會回到登入畫面，可以改用其他帳號登入。為了資訊安全，在學校或公用電腦使用後請務必登出。' }),
      el('div', { class: 'set-actions' }, [
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: function () { PatsAuth.logout({ relogin: true }); }
        }, [icon('logout'), el('span', { text: '登出並重新登入' })])
      ])
    ]);
  }

  return { render: render, back: back, isSubPage: isSubPage };
})();
