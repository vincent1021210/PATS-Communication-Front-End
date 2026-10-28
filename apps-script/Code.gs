/**
 * PATS — REST API 進入點
 *
 * 前端是託管在 GitHub Pages 的靜態網站，透過跨網域請求呼叫這支網頁應用程式。
 *
 * 關於 CORS：Apps Script 的網頁應用程式「不會」回應 OPTIONS 預檢請求，
 * 所以前端必須只送「簡單請求」——也就是 POST 搭配
 * Content-Type: text/plain。請求內容改成 JSON 字串放在 body，由 doPost 自行解析。
 * 這是在 Apps Script 上做跨網域 API 唯一可行的方式，請勿改用 application/json。
 */

var APP_NAME = 'PATS';

/** 瀏覽器直接開啟 /exec 時的健康檢查，方便確認部署是否成功。 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action) return handleRequest_(params.action, parseJson_(params.payload, {}), params.token);
  return json_({
    ok: true,
    data: {
      app: APP_NAME,
      status: 'ready',
      googleClientId: googleClientId_(),
      inviteCodeRequired: !!registrationCode_()
    }
  });
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_REQUEST' });
  }
  return handleRequest_(body.action, body.payload || {}, body.token);
}

function handleRequest_(action, payload, token) {
  var started = Date.now();
  var result = apiCall_(action, payload, token);
  // 伺服器端處理時間，前端 ?perf=1 時會印出來比對網路往返
  result.ms = Date.now() - started;
  return json_(result);
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

/* -------------------------------------------------------------- RPC 分派 */

/**
 * 路由表在呼叫時才建立，避免不同 .gs 檔的載入順序影響函式參照。
 */
function publicActions_() {
  return {
    ping: function () { return { app: APP_NAME, time: nowIso_() }; },
    /** 不需登入：確認目前綁哪份試算表、對話／訊息列數（排查切後端） */
    dbHint: function () {
      var ss = openSpreadsheet_();
      var id = ss.getId();
      var conv = ss.getSheetByName('conversations');
      var msg = ss.getSheetByName('messages');
      var users = ss.getSheetByName('users');
      return {
        spreadsheetId: id,
        conversations: conv ? Math.max(0, conv.getLastRow() - 1) : -1,
        messages: msg ? Math.max(0, msg.getLastRow() - 1) : -1,
        users: users ? Math.max(0, users.getLastRow() - 1) : -1
      };
    },
    config: function () {
      return {
        googleClientId: googleClientId_(),
        inviteCodeRequired: !!registrationCode_()
      };
    },
    login: function (payload) { return authLogin_(payload); },
    requestSignupCode: function (payload) { return authRequestSignupCode_(payload); },
    register: function (payload) { return authRegister_(payload); },
    requestReset: function (payload) { return authRequestReset_(payload); },
    verifyResetCode: function (payload) { return authVerifyResetCode_(payload); },
    resetPassword: function (payload) { return authResetPassword_(payload); },
    googleLogin: function (payload) { return authGoogleLogin_(payload); },
    session: function (payload) {
      var user = resolveSession_(payload.token);
      return user ? { user: publicUser_(user) } : null;
    }
  };
}

function privateActions_() {
  return {
    bootstrap: apiBootstrap_,
    listConversations: apiListConversations_,
    listMessages: apiListMessages_,
    sendMessage: apiSendMessage_,
    sendChatImage: apiSendChatImage_,
    downloadChatImage: apiDownloadChatImage_,
    markRead: apiMarkRead_,
    startDirect: apiStartDirect_,
    createGroup: apiCreateGroup_,
    listContacts: apiListContacts_,
    inviteContact: apiInviteContact_,
    setArchived: apiSetArchived_,
    updateProfile: apiUpdateProfile_,
    changePassword: apiChangePassword_,
    updateSettings: apiUpdateSettings_,
    clearCache: apiClearCache_,
    storageUsage: apiStorageUsage_,
    adminListUsers: apiAdminListUsers_,
    adminClearPassword: apiAdminClearPassword_,
    adminDeleteUser: apiAdminDeleteUser_
  };
}

/**
 * 統一的伺服器入口。永遠回傳 { ok: true, data } 或 { ok: false, error }，
 * 讓前端只需要處理一種格式。
 */
function apiCall_(action, payload, token) {
  payload = payload || {};
  try {
    if (action === 'logout') {
      destroySession_(token);
      return { ok: true, data: true };
    }
    var open = publicActions_();
    if (open[action]) {
      return { ok: true, data: open[action](payload) };
    }
    var handler = privateActions_()[action];
    if (!handler) return { ok: false, error: 'UNKNOWN_ACTION' };
    var user = requireUser_(token);
    return { ok: true, data: handler(user, payload) };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'UNKNOWN_ERROR' };
  }
}
