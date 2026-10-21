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
  function rpc(action, payload) {
    var url = state.config.apiUrl;
    if (!url) return Promise.reject(fail('NO_API_URL'));

    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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
        if (result && result.ok) return result.data;
        throw fail((result && result.error) || 'UNKNOWN_ERROR');
      })
      .catch(function (err) {
        if (err && err.code) throw err;
        throw fail('NETWORK');
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
    if (url) node.appendChild(el('img', { src: url, alt: '', loading: 'lazy' }));
    else node.textContent = initials(name);
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
      var input = el('input', {
        class: 'input',
        type: field.type || 'text',
        placeholder: field.placeholder || '',
        value: field.value || ''
      });
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
        .then(closeModal)
        .catch(function (err) {
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

  return {
    state: state,
    rpc: rpc,
    readToken: readToken,
    writeToken: writeToken,
    describeError: describeError,
    $: $, $$: $$, el: el, icon: icon, show: show, hide: hide,
    initials: initials, avatarNode: avatarNode,
    formatTime: formatTime, formatListTime: formatListTime,
    formatDay: formatDay, formatBytes: formatBytes,
    toast: toast, openModal: openModal, closeModal: closeModal,
    openMenu: openMenu, closeMenu: closeMenu
  };
})();
