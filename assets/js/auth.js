/* =====================================================================
   PATS — 登入 / 登出
   ===================================================================== */

var PatsAuth = (function () {
  'use strict';

  var $ = PATS.$;
  var GIS_SRC = 'https://accounts.google.com/gsi/client';

  function showError(message) {
    showErrorIn('#login-error', message);
  }

  function showErrorIn(selector, message) {
    var box = $(selector);
    box.querySelector('[data-role="text"]').textContent = message;
    box.classList.remove('hidden');
  }

  function clearError() {
    $('#login-error').classList.add('hidden');
    $('#register-error').classList.add('hidden');
    $('#reset-error').classList.add('hidden');
  }

  /** 送出期間鎖住按鈕，避免重複點擊送出兩次請求。 */
  function busy(selector, label) {
    var button = $(selector);
    var original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    return function () {
      button.disabled = false;
      button.textContent = original;
    };
  }

  function setBusy(busy) {
    var button = $('#login-submit');
    button.disabled = busy;
    button.textContent = busy ? '登入中…' : '登入';
  }

  /* ------------------------------------------------------------ 帳密登入 */

  function handleSubmit(event) {
    event.preventDefault();
    clearError();

    var account = $('#login-account').value.trim();
    var password = $('#login-password').value;
    if (!account || !password) return showError('請輸入帳號與密碼。');

    setBusy(true);
    PATS.rpc('login', {
      account: account,
      password: password,
      remember: $('#login-remember').checked
    })
      .then(function (result) {
        PATS.writeToken(result.token);
        $('#login-password').value = '';
        PatsMain.enterApp(result.user);
      })
      .catch(function (err) { showError(err.message); })
      .finally(function () { setBusy(false); });
  }

  /* ---------------------------------------------------------------- 註冊 */

  var PANELS = {
    login: { el: '#login-panel', focus: '#login-account' },
    register: { el: '#register-panel', focus: '#register-name' },
    reset: { el: '#reset-panel', focus: '#reset-email' }
  };

  function switchPanel(target) {
    clearError();
    Object.keys(PANELS).forEach(function (name) {
      $(PANELS[name].el).classList.toggle('hidden', name !== target);
    });
    if (target === 'reset') resetFlow();
    if (target === 'register') paintGoogleButton($('#google-slot-register'), 'signup_with');
    var focus = $(PANELS[target].focus);
    if (focus) focus.focus();
  }

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * 把註冊表單清成初始狀態。
   *
   * 只在回到「乾淨的登入畫面」時呼叫（首次載入、登出），不在使用者
   * 於登入／註冊之間來回切換時清除，免得打到一半的資料被吃掉。
   */
  function resetRegisterForm() {
    ['#register-name', '#register-email',
      '#register-password', '#register-confirm', '#register-invite',
      '#register-code'].forEach(function (s) {
      $(s).value = '';
    });
    $('#invite-field').classList.add('hidden');
    signup = null;
    registerStep(1);
  }

  function validateRegisterFields() {
    var email = $('#register-email').value.trim();
    if (!EMAIL_PATTERN.test(email)) {
      showErrorIn('#register-error', PATS.describeError('EMAIL_INVALID'));
      return false;
    }
    return true;
  }

  /* 第一步填好的資料，等信箱驗證通過後才送去建立帳號。密碼只放在記憶體。 */
  var signup = null;

  function registerStep(step) {
    $('#register-form').classList.toggle('hidden', step !== 1);
    $('#register-verify-form').classList.toggle('hidden', step !== 2);
    $('#google-slot-register').classList.toggle('hidden', step !== 1);
    $('#register-divider').classList.toggle('hidden', step !== 1);

    PATS.$$('#register-steps .step').forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', n === step);
      li.classList.toggle('is-done', n < step);
    });

    $('#register-sub').textContent = step === 2 && signup
      ? '驗證碼已寄到 ' + signup.email + '，請查看收件匣'
      : '使用 Google 帳號即可建立並登入';

    var focus = step === 2 ? '#register-code' : '#register-name';
    if ($(focus)) $(focus).focus();
  }

  /** 第一步：驗證資料並請後端寄出驗證碼。 */
  function sendSignupCode(isResend) {
    clearError();

    if (!validateRegisterFields()) return Promise.resolve();

    var password = $('#register-password').value;
    if (!isResend && password !== $('#register-confirm').value) {
      showErrorIn('#register-error', PATS.describeError('PASSWORD_MISMATCH'));
      return Promise.resolve();
    }

    var draft = {
      displayName: $('#register-name').value.trim(),
      email: $('#register-email').value.trim(),
      inviteCode: $('#register-invite').value.trim(),
      password: password
    };

    var done = busy(isResend ? '#register-resend' : '#register-submit', '寄送中…');

    return PATS.rpc('requestSignupCode', {
      displayName: draft.displayName,
      email: draft.email,
      inviteCode: draft.inviteCode
    })
      .then(function () {
        signup = draft;
        if (isResend) PATS.toast('驗證碼已重新寄出。', 'success');
        else registerStep(2);
      })
      .catch(function (err) {
        // 後端啟用邀請碼時才把欄位顯示出來，一般情況不打擾使用者。
        if (err.code === 'INVITE_CODE_REQUIRED' || err.code === 'INVITE_CODE_INVALID') {
          $('#invite-field').classList.remove('hidden');
          $('#register-invite').focus();
        }
        showErrorIn('#register-error', err.message);
      })
      .finally(done);
  }

  function handleRegister(event) {
    event.preventDefault();
    sendSignupCode(false);
  }

  /** 第二步：送出驗證碼，通過就建立帳號並直接登入。 */
  function handleRegisterVerify(event) {
    event.preventDefault();
    clearError();
    if (!signup) return registerStep(1);

    var done = busy('#register-verify-submit', '建立中…');

    PATS.rpc('register', {
      email: signup.email,
      code: $('#register-code').value.trim(),
      displayName: signup.displayName,
      password: signup.password,
      remember: true
    })
      .then(function (result) {
        PATS.writeToken(result.token);
        signup = null;
        resetRegisterForm();
        PATS.toast('帳號建立完成，歡迎加入 PATS。', 'success');
        PatsMain.enterApp(result.user);
      })
      .catch(function (err) {
        showErrorIn('#register-error', err.message);
        // 這幾種情況該組驗證碼已經作廢，得重新填一次資料再寄一次。
        if (err.code === 'SIGNUP_CODE_EXPIRED' ||
            err.code === 'SIGNUP_TOO_MANY_ATTEMPTS' ||
            err.code === 'SIGNUP_NOT_REQUESTED') {
          registerStep(1);
        }
      })
      .finally(done);
  }

  /* ------------------------------------------------------------ 忘記密碼 */

  var reset = { email: '', ticket: '' };

  var RESET_STEPS = {
    1: { form: '#reset-email-form', sub: '輸入你的電子郵件，我們會寄一組驗證碼給你' },
    2: { form: '#reset-code-form', sub: '' },
    3: { form: '#reset-password-form', sub: '驗證成功，請設定你的新密碼' }
  };

  function resetFlow() {
    reset = { email: '', ticket: '' };
    ['#reset-email', '#reset-code', '#reset-new', '#reset-confirm'].forEach(function (s) {
      $(s).value = '';
    });
    resetStep(1);
  }

  function resetStep(step) {
    Object.keys(RESET_STEPS).forEach(function (n) {
      $(RESET_STEPS[n].form).classList.toggle('hidden', Number(n) !== step);
    });
    PATS.$$('#reset-steps .step').forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', n === step);
      li.classList.toggle('is-done', n < step);
    });
    $('#reset-sub').textContent = RESET_STEPS[step].sub ||
      ('驗證碼已寄到 ' + reset.email + '，請查看收件匣');
    var focus = { 1: '#reset-email', 2: '#reset-code', 3: '#reset-new' }[step];
    if ($(focus)) $(focus).focus();
  }

  function sendResetCode(isResend) {
    clearError();
    var email = $('#reset-email').value.trim();
    var done = busy(isResend ? '#reset-resend' : '#reset-email-submit', '寄送中…');

    return PATS.rpc('requestReset', { email: email })
      .then(function () {
        reset.email = email;
        // 後端刻意不透露信箱是否存在，所以這裡一律往下一步走。
        if (!isResend) resetStep(2);
        else PATS.toast('驗證碼已重新寄出。', 'success');
      })
      .catch(function (err) { showErrorIn('#reset-error', err.message); })
      .finally(done);
  }

  function handleResetEmail(event) {
    event.preventDefault();
    sendResetCode(false);
  }

  function handleResetCode(event) {
    event.preventDefault();
    clearError();
    var done = busy('#reset-code-submit', '驗證中…');

    PATS.rpc('verifyResetCode', { email: reset.email, code: $('#reset-code').value.trim() })
      .then(function (result) {
        reset.ticket = result.ticket;
        resetStep(3);
      })
      .catch(function (err) {
        showErrorIn('#reset-error', err.message);
        // 驗證碼過期或試太多次，這組碼已被後端作廢，得重新申請。
        if (err.code === 'RESET_CODE_EXPIRED' || err.code === 'RESET_TOO_MANY_ATTEMPTS') {
          resetStep(1);
        }
      })
      .finally(done);
  }

  function handleResetPassword(event) {
    event.preventDefault();
    clearError();

    var password = $('#reset-new').value;
    if (password !== $('#reset-confirm').value) {
      return showErrorIn('#reset-error', PATS.describeError('PASSWORD_MISMATCH'));
    }

    var done = busy('#reset-password-submit', '更新中…');
    PATS.rpc('resetPassword', { ticket: reset.ticket, newPassword: password })
      .then(function (result) {
        PATS.writeToken(result.token);
        resetFlow();
        PATS.toast('密碼已更新，已為你登入。', 'success');
        PatsMain.enterApp(result.user);
      })
      .catch(function (err) {
        showErrorIn('#reset-error', err.message);
        if (err.code === 'RESET_TICKET_INVALID' || err.code === 'RESET_CODE_EXPIRED') {
          resetStep(1);
        }
      })
      .finally(done);
  }

  /* --------------------------------------------------------- Google 登入 */

  /**
   * 用 Google Identity Services 渲染官方登入按鈕。
   * 取得的 ID Token 交給後端驗簽，換成 PATS 自己的工作階段權杖。
   */
  function googleButtonOptions(slot, text) {
    return {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: text,
      locale: 'zh_TW',
      logo_alignment: 'center',
      width: Math.min(slot.offsetWidth || 320, 400)
    };
  }

  var googleReady = false;

  function paintGoogleButton(slot, text) {
    if (!googleReady || !slot || slot.getAttribute('data-painted') === '1') return;
    if (slot.offsetWidth < 40) return;
    window.google.accounts.id.renderButton(slot, googleButtonOptions(slot, text));
    slot.setAttribute('data-painted', '1');
  }

  function initGoogle() {
    var clientId = PATS.state.config.googleClientId;
    var slots = [$('#google-slot'), $('#google-slot-register')];

    if (!clientId) {
      slots.forEach(function (slot) {
        slot.appendChild(PATS.el('p', {
          class: 'auth-hint',
          text: '尚未設定 Google 用戶端 ID，目前僅開放帳密登入。'
        }));
      });
      return;
    }

    if (PATS.isNativeApp) return initGoogleNative(clientId, slots);
    if (PATS.isDesktopApp && PATS.desktop.googleLogin) return initGoogleDesktop(slots);

    loadScript(GIS_SRC)
      .then(function () {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: onCredential,
          auto_select: true,
          cancel_on_tap_outside: true,
          context: 'signin',
          itp_support: true
        });
        googleReady = true;
        paintGoogleButton($('#google-slot'), 'signin_with');
        window.google.accounts.id.prompt();
      })
      .catch(function () {
        slots.forEach(function (slot) {
          slot.appendChild(PATS.el('p', {
            class: 'auth-hint',
            text: '無法載入 Google 登入元件，請檢查網路連線。'
          }));
        });
      });
  }

  /**
   * Android APP：Google 不允許在 WebView 裡用網頁版登入，改用系統的 Credential Manager。
   * webClientId 必須是「網頁」用戶端 ID，拿到的 ID Token aud 才會和後端比對的一致；
   * Android 用戶端 ID 只要在 Google Cloud 登記套件名稱與簽章 SHA-1，程式裡不用填。
   */
  var nativeGoogleReady = null;

  function initGoogleNative(clientId, slots) {
    var social = PATS.nativePlugin('SocialLogin');
    var iosClientId = (window.PATS_CONFIG && PATS_CONFIG.googleIosClientId) || '';
    if (PATS.isIosApp && !iosClientId) social = null;
    slots.forEach(function (slot, index) {
      if (!slot) return;
      slot.innerHTML = '';
      if (!social) {
        slot.appendChild(PATS.el('p', { class: 'auth-hint', text: '這個版本的 APP 不支援 Google 登入，請改用帳密登入。' }));
        return;
      }
      slot.appendChild(PATS.el('button', {
        class: 'btn btn-ghost btn-google-native',
        type: 'button',
        text: index === 0 ? '使用 Google 帳號登入' : '使用 Google 帳號註冊',
        onclick: nativeGoogleLogin
      }));
    });
    if (social) {
      var google = { webClientId: clientId, mode: 'online' };
      if (PATS.isIosApp) {
        google.iOSClientId = iosClientId;
        google.iOSServerClientId = clientId;
      }
      nativeGoogleReady = social.initialize({ google: google });
    }
  }

  function nativeGoogleLogin() {
    var social = PATS.nativePlugin('SocialLogin');
    if (!social || !nativeGoogleReady) return;
    clearError();
    nativeGoogleReady
      .then(function () {
        // 不可傳 scopes：外掛會要求改 MainActivity；ID Token 預設已含 email 與 profile
        return social.login({ provider: 'google', options: {} });
      })
      .then(function (res) {
        var idToken = res && res.result && res.result.idToken;
        onCredential({ credential: idToken });
      })
      .catch(function (err) {
        var text = String((err && err.message) || err || '');
        if (/cancel/i.test(text)) return;
        // 28444：Google Cloud 還沒在「正確專案」登記這個 APK 的套件名稱＋SHA-1
        if (/28444|Developer console is not set up/i.test(text)) {
          showError('Google 登入尚未設定完成：請在 Google Cloud 專案（網頁用戶端 354935544437… 那個）新增 Android 用戶端，套件名稱 tw.pats.chat，並填入正式版 SHA-1。設定後請等幾分鐘再試。');
          return;
        }
        showError('Google 登入失敗：' + text);
      });
  }

  /** 電腦版：Google 不允許內嵌瀏覽器登入，改開系統瀏覽器，登入完 APP 會自動接手。 */
  var desktopGoogleBusy = false;

  function initGoogleDesktop(slots) {
    slots.forEach(function (slot, index) {
      if (!slot) return;
      slot.innerHTML = '';
      slot.appendChild(PATS.el('button', {
        class: 'btn btn-ghost btn-google-native',
        type: 'button',
        text: index === 0 ? '使用 Google 帳號登入' : '使用 Google 帳號註冊',
        onclick: desktopGoogleLogin
      }));
    });
  }

  function desktopGoogleLogin() {
    if (desktopGoogleBusy) return;
    desktopGoogleBusy = true;
    clearError();
    PATS.toast('已在瀏覽器開啟 Google 登入，完成後會自動回到 PATS');
    PATS.desktop.googleLogin()
      .then(function (res) {
        if (res && res.idToken) return onCredential({ credential: res.idToken });
        var code = String((res && res.error) || '');
        if (code === 'GOOGLE_LOGIN_CANCELLED') return;
        if (code === 'GOOGLE_LOGIN_TIMEOUT') return showError('Google 登入逾時，請再按一次。');
        showError('Google 登入失敗：' + code);
      })
      .finally(function () { desktopGoogleBusy = false; });
  }

  function onCredential(response) {
    clearError();
    if (!response || !response.credential) return showError('沒有取得 Google 憑證，請重新嘗試。');

    PATS.rpc('googleLogin', { credential: response.credential })
      .then(function (result) {
        PATS.writeToken(result.token);
        PatsMain.enterApp(result.user);
      })
      .catch(function (err) {
        var onRegister = !$('#register-panel').classList.contains('hidden');
        if (onRegister) showErrorIn('#register-error', err.message);
        else showError(err.message);
      });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.defer = true;
      tag.onload = resolve;
      tag.onerror = reject;
      document.head.appendChild(tag);
    });
  }

  /* ---------------------------------------------------------------- 登出 */

  function logout(options) {
    var relogin = options && options.relogin;

    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    var social = PATS.nativePlugin('SocialLogin');
    if (social) {
      // 下次登入時重新讓使用者選帳號
      social.logout({ provider: 'google' }).catch(function () { /* 沒用 Google 登入過 */ });
    }

    PATS.rpc('logout', {})
      .catch(function () { /* 權杖失效也視同登出 */ })
      .finally(function () {
        PATS.writeToken(null);
        PATS.state.user = null;
        PatsMain.showAuth();
        if (relogin) PATS.toast('已登出，請重新登入。');
      });
  }

  /* ---------------------------------------------------------------- 綁定 */

  function init() {
    $('#login-form').addEventListener('submit', handleSubmit);
    $('#register-form').addEventListener('submit', handleRegister);
    $('#register-verify-form').addEventListener('submit', handleRegisterVerify);
    $('#register-resend').addEventListener('click', function () { sendSignupCode(true); });
    $('#register-back').addEventListener('click', function () {
      clearError();
      registerStep(1);
    });

    PATS.$$('[data-toggle-password]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = document.getElementById(button.getAttribute('data-toggle-password'));
        var toText = input.type === 'password';
        input.type = toText ? 'text' : 'password';
        button.querySelector('.material-symbols-outlined').textContent =
          toText ? 'visibility' : 'visibility_off';
        button.setAttribute('aria-label', toText ? '隱藏密碼' : '顯示密碼');
      });
    });

    $('#reset-email-form').addEventListener('submit', handleResetEmail);
    $('#reset-code-form').addEventListener('submit', handleResetCode);
    $('#reset-password-form').addEventListener('submit', handleResetPassword);
    $('#reset-resend').addEventListener('click', function () { sendResetCode(true); });

    $('#forgot-link').addEventListener('click', function (event) {
      event.preventDefault();
      // 已經打過的帳號如果是信箱，就順手帶進重設流程，少打一次。
      var account = $('#login-account').value.trim();
      switchPanel('reset');
      if (account.indexOf('@') > 0) $('#reset-email').value = account;
    });
    $('#reset-back').addEventListener('click', function (event) {
      event.preventDefault();
      switchPanel('login');
    });
    $('#go-register').addEventListener('click', function (event) {
      event.preventDefault();
      switchPanel('register');
    });
    $('#go-login').addEventListener('click', function (event) {
      event.preventDefault();
      switchPanel('login');
    });

    resetRegisterForm();
    initGoogle();
  }

  return {
    init: init,
    logout: logout,
    showError: showError,
    clearError: clearError,
    showLoginPanel: function () {
      resetRegisterForm();
      switchPanel('login');
      // GIS 常在 #auth 仍 hidden 時就載入完；當時 offsetWidth=0 會跳過繪製。
      // 登入畫面真正顯示後再補畫一次。
      paintGoogleButton($('#google-slot'), 'signin_with');
    }
  };
})();
