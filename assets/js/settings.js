/* =====================================================================
   PATS — 設定區：封存時間、帳號安全、帳號切換
   ===================================================================== */

var PatsSettings = (function () {
  'use strict';

  var $ = PATS.$;
  var el = PATS.el;
  var icon = PATS.icon;
  var state = PATS.state;

  var ARCHIVE_OPTIONS = [
    { value: 30, label: '30 天' },
    { value: 90, label: '90 天 (預設)' },
    { value: 365, label: '1 年' },
    { value: 0, label: '永不封存', desc: '手動管理所有對話' }
  ];

  var draft = null;

  var TABS = [
    { id: 'archive', label: '封存設定', view: 'settings' },
    { id: 'account', label: '帳號安全', view: 'profile' },
    { id: 'call', label: '通話', view: 'call' },
    { id: 'admin', label: '帳號管理', view: 'admin', adminOnly: true },
    { id: 'switch', label: '帳號切換', view: 'switch' }
  ];

  function render(section) {
    var pane = $('#settings-pane');
    pane.innerHTML = '';

    if (section === 'admin' && !(state.user && state.user.isAdmin)) {
      PatsMain.setView('settings');
      return;
    }

    var content = section === 'account' ? renderAccount()
                : section === 'switch' ? renderSwitch()
                : section === 'admin' ? renderAdmin()
                : section === 'call' ? renderCall()
                : renderArchive();

    var visibleTabs = TABS.filter(function (tab) {
      return !tab.adminOnly || (state.user && state.user.isAdmin);
    });

    var tabs = el('nav', { class: 'settings-tabs' }, visibleTabs.map(function (tab) {
      return el('button', {
        class: tab.id === section ? 'is-active' : '',
        type: 'button',
        text: tab.label,
        onclick: function () { PatsMain.setView(tab.view); }
      });
    }));

    // 帳號切換頁是置中的確認卡片，塞頁籤會破壞版面，因此只在另外兩頁顯示。
    if (section === 'switch') {
      pane.appendChild(content);
    } else {
      content.insertBefore(tabs, content.firstChild);
      pane.appendChild(content);
    }
    pane.scrollTop = 0;
  }

  function sectionHead(title, lead) {
    return [
      el('h2', { class: 'settings-title', text: title }),
      el('p', { class: 'settings-lead', text: lead })
    ];
  }

  function cardHead(iconName, title, text) {
    return el('div', { class: 'settings-card-head' }, [
      el('div', { class: 'glyph' }, [icon(iconName)]),
      el('div', {}, [
        el('h3', { text: title }),
        text ? el('p', { text: text }) : null
      ])
    ]);
  }

  /* ------------------------------------------------------- 封存時間設定 */

  function renderArchive() {
    draft = { archiveDays: Number(state.user.settings.archiveDays) };

    var options = ARCHIVE_OPTIONS.map(function (option) {
      var input = el('input', {
        type: 'radio', name: 'archive-days', value: String(option.value)
      });
      if (option.value === draft.archiveDays) input.checked = true;
      input.addEventListener('change', function () { draft.archiveDays = option.value; });

      return el('label', { class: 'radio-card' }, [
        input,
        el('span', {}, [
          el('span', { class: 'label', text: option.label }),
          option.desc ? el('span', { class: 'desc', text: option.desc }) : null
        ])
      ]);
    });

    var usageText = el('span', { text: '計算中…' });
    PATS.rpc('storageUsage', {})
      .then(function (result) { usageText.textContent = PATS.formatBytes(result.bytes); })
      .catch(function () { usageText.textContent = '無法取得'; });

    var saveButton = el('button', {
      class: 'btn btn-primary', type: 'button', text: '儲存變更',
      onclick: function () { saveArchive(saveButton); }
    });

    return el('div', { class: 'settings-inner' }, sectionHead(
      '封存時間設定',
      '管理您的對話紀錄自動封存時間與快取資料，保持應用程式輕量且高效。'
    ).concat([
      el('section', { class: 'card settings-card' }, [
        cardHead('history', '自動封存時間',
          '設定超過多少時間未活動的對話將會被自動移至封存資料夾。這有助於保持您的主要收件匣整潔。封存的訊息仍可透過搜尋或在封存區找到。')
      ].concat(options)),

      el('section', { class: 'card settings-card' }, [
        el('div', { class: 'settings-card-head' }, [
          el('div', { class: 'glyph' }, [icon('mop')]),
          el('div', {}, [
            el('h3', { text: '清除快取資料' }),
            el('p', { text: '清除快取的圖片、影片與文件可以釋放裝置儲存空間。這不會刪除您的對話紀錄或檔案，但下次查看時需要重新下載。' }),
            el('div', { class: 'usage-row' }, [icon('storage'), el('span', { text: '目前使用空間：' }), usageText])
          ]),
          el('button', {
            class: 'btn btn-ghost', type: 'button', style: 'margin-left:auto',
            onclick: clearCache
          }, [icon('delete_sweep'), el('span', { text: '立即清除' })])
        ])
      ]),

      el('div', { class: 'settings-actions' }, [
        el('button', {
          class: 'btn btn-ghost', type: 'button', text: '取消',
          onclick: function () { render('archive'); }
        }),
        saveButton
      ])
    ]));
  }

  function saveArchive(button) {
    button.disabled = true;
    PATS.rpc('updateSettings', { settings: { archiveDays: draft.archiveDays } })
      .then(function (settings) {
        state.user.settings = settings;
        PATS.toast('封存設定已儲存。', 'success');
        return PatsChat.refreshList();
      })
      .catch(PatsChat.handleError)
      .finally(function () { button.disabled = false; });
  }

  function clearCache() {
    PATS.rpc('clearCache', {})
      .then(function () { PATS.toast('快取已清除。', 'success'); })
      .catch(PatsChat.handleError);
  }

  /* ----------------------------------------------------------- 通話設定 */

  function renderCall() {
    var current = (window.PatsCall && PatsCall.signalingUrl()) || '';
    var input = el('input', {
      class: 'input',
      type: 'url',
      value: current,
      placeholder: 'http://192.168.1.68:3001 或 https://xxxx.loca.lt'
    });
    var status = el('p', {
      class: 'settings-lead',
      text: signalLabel()
    });
    var saveButton = el('button', {
      class: 'btn btn-primary', type: 'button', text: '儲存並重新連線',
      onclick: function () {
        if (!window.PatsCall) {
          PATS.toast('通話模組尚未載入。', 'error');
          return;
        }
        PatsCall.setSignalingUrl(input.value);
        status.textContent = signalLabel();
        PATS.toast('已更新通話伺服器設定。', 'success');
      }
    });
    var clearButton = el('button', {
      class: 'btn btn-ghost', type: 'button', text: '還原預設',
      onclick: function () {
        if (!window.PatsCall) return;
        PatsCall.setSignalingUrl('');
        input.value = PatsCall.signalingUrl();
        status.textContent = signalLabel();
        PATS.toast('已還原為 config.js 預設值。', 'success');
      }
    });

    if (window.PatsCall) {
      PatsCall.onSignalChange(function () { status.textContent = signalLabel(); });
    }

    return el('div', { class: 'settings-inner' }, sectionHead(
      '語音通話',
      '信令伺服器負責「誰打給誰」。聲音走 WebRTC，不經過 Apps Script。'
    ).concat([
      el('section', { class: 'card settings-card' }, [
        cardHead('call', '信令伺服器網址',
          '同 Wi‑Fi：填後端電腦的 http://內網IP:3001。若使用 GitHub Pages（HTTPS），必須填 https:// 開頭的隧道網址。'),
        el('div', { class: 'field', style: 'margin-top:14px' }, [
          el('label', { class: 'field-label', text: 'signalingUrl' }),
          input
        ]),
        status,
        el('div', { class: 'settings-actions', style: 'margin-top:16px' }, [clearButton, saveButton])
      ]),
      el('section', { class: 'card settings-card' }, [
        cardHead('shield', '測試步驟',
          '1) 後端執行「啟動信令.bat」→ 2) 若要用手機開 github.io，再執行「啟動HTTPS隧道.bat」並把網址貼到上方 → 3) 雙方登入後看左下「通話就緒」→ 4) 開私訊按綠色電話。')
      ])
    ]));
  }

  function signalLabel() {
    if (!window.PatsCall) return '通話模組未載入';
    var st = PatsCall.signalState();
    var url = PatsCall.signalingUrl() || '（未設定）';
    var map = {
      online: '狀態：已連線（通話就緒）',
      connecting: '狀態：連線中…',
      offline: '狀態：離線（請確認後端 npm start）',
      blocked: '狀態：被瀏覽器阻擋（HTTPS 頁面不能連 HTTP 信令）',
      idle: '狀態：尚未連線'
    };
    return (map[st] || map.idle) + '｜' + url;
  }

  /* ------------------------------------------------------- 帳號安全設定 */

  function renderAccount() {
    var usernameInput = el('input', {
      class: 'input', type: 'text', value: state.user.username || '', maxlength: '40'
    });

    var currentInput = passwordField('輸入目前使用的密碼', 'current-password');
    var nextInput = passwordField('輸入新密碼', 'new-password');
    var confirmInput = passwordField('再次輸入新密碼', 'new-password');

    var saveButton = el('button', { class: 'btn btn-primary', type: 'submit' },
      [icon('save'), el('span', { text: '儲存變更' })]);

    var form = el('form', { class: 'card settings-card' }, [
      el('div', { class: 'settings-card-head' }, [
        el('div', { class: 'glyph' }, [icon('more_horiz')]),
        el('div', {}, [
          el('h3', { text: '密碼變更' }),
          el('p', { text: '定期更新密碼以維護帳號安全' })
        ])
      ]),
      el('div', { class: 'field', style: 'margin-bottom:16px' }, [
        el('label', { class: 'field-label' }, [el('strong', { text: '目前的密碼' })]),
        currentInput.node
      ]),
      el('div', { class: 'settings-grid' }, [
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label' }, [el('strong', { text: '新密碼' })]),
          nextInput.node
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label' }, [el('strong', { text: '確認新密碼' })]),
          confirmInput.node
        ])
      ]),
      el('div', { class: 'settings-actions', style: 'margin-top:20px' }, [
        el('button', {
          class: 'btn btn-quiet', type: 'button', text: '取消',
          onclick: function () { render('account'); }
        }),
        saveButton
      ])
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

    var usernameCard = el('section', { class: 'card settings-card' }, [
      cardHead('badge', '用戶名稱 (帳號)', null),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label' }, [el('strong', { text: '目前的用戶名稱' })]),
        usernameInput,
        el('span', { style: 'font-size:12px;color:var(--ink-500)',
          text: '這是其他使用者在系統中看見您的名稱。建議使用真實姓名或職稱以利辨識。' })
      ]),
      el('div', { class: 'settings-actions', style: 'margin-top:18px;border:0;padding-top:0' }, [
        el('button', {
          class: 'btn btn-outline', type: 'button', text: '更新名稱',
          onclick: function (event) { saveUsername(event.currentTarget, usernameInput.value); }
        })
      ])
    ]);

    return el('div', { class: 'settings-inner' }, sectionHead(
      '帳號安全設定',
      '管理您的帳號名稱與密碼，確保通訊安全。'
    ).concat([
      el('div', { class: 'settings-grid' }, [
        usernameCard,
        el('aside', { class: 'tip-card' }, [
          el('div', { class: 'glyph' }, [icon('shield')]),
          el('h4', { text: '高強度密碼建議' }),
          el('p', { text: '密碼應至少包含 8 個字元，並混用大小寫字母、數字及特殊符號，以符合企業資安規範。' })
        ])
      ]),
      form
    ]));
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

    return el('div', { class: 'settings-inner' }, sectionHead(
      '帳號管理',
      '管理員可清除使用者的登入密碼，或整個刪除帳號。清除密碼後對方需改用 Google 登入或自行重設密碼。'
    ).concat([
      el('section', { class: 'card settings-card' }, [
        cardHead('manage_accounts', '使用者清單',
          '清除密碼不會刪除帳號；刪除帳號會一併移除工作階段與聯絡人，歷史訊息仍會保留。'),
        el('div', { class: 'field', style: 'margin-bottom:16px' }, [
          el('div', { class: 'input-wrap' }, [
            icon('search'),
            search
          ])
        ]),
        list
      ])
    ]));
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

  /* --------------------------------------------------------- 帳號切換頁 */

  function renderSwitch() {
    return el('div', { class: 'switch-wrap' }, [
      el('section', { class: 'card switch-card' }, [
        el('div', { class: 'switch-head', text: '帳號切換與登入' }),
        el('div', { class: 'glyph' }, [icon('manage_accounts')]),
        el('h3', { text: '切換帳號或重新登入' }),
        el('p', { text: '您即將登出當前帳號。為確保資訊安全，繼續操作後系統將自動導向登入畫面，請備妥您的憑證以重新登入。' }),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: function () { PatsAuth.logout({ relogin: true }); }
        }, [icon('logout'), el('span', { text: '登出並重新登入' })]),
        el('button', {
          class: 'btn btn-ghost', type: 'button', text: '取消並返回設定',
          onclick: function () { PatsMain.setView('settings'); }
        })
      ])
    ]);
  }

  return { render: render };
})();
