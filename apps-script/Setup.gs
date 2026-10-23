/**
 * PATS — 初始化與診斷
 *
 * 這個檔案裡的函式都可以安全地從編輯器直接執行，不需要任何參數。
 */

/**
 * 一鍵初始化：建立試算表與所有工作表，並回報目前狀態與下一步。
 * 回傳值會顯示在編輯器的執行紀錄中。
 */
function initializeProject() {
  var url = setup();
  var mediaFolderId = ensureChatMediaFolder_();
  var userCount = dbAll_('users').length;

  var lines = [
    'PATS 初始化完成。',
    '資料庫試算表：' + url,
    '聊天圖片資料夾 ID：' + mediaFolderId,
    '目前使用者人數：' + userCount,
    'Google 用戶端 ID：' + (googleClientId_() || '（尚未設定，僅開放帳密登入）'),
    // 這行讀得到數字，就代表寄信權限已經授權完成（驗證碼會以授權者的帳號寄出）。
    '今日還可寄出的信件數：' + MailApp.getRemainingDailyQuota(),
    '',
    '圖片暫存：請在「觸發條件」新增每日時間驅動，執行 purgeExpiredChatImages。'
  ];

  if (userCount === 0) {
    lines.push('');
    lines.push('下一步：到登入頁點「立即註冊」建立第一個帳號，');
    lines.push('或設定 ADMIN_EMAIL / ADMIN_PASSWORD 指令碼屬性後執行 createAdminAccount。');
  } else {
    lines.push('');
    lines.push('下一步：點右上角「部署」→「新增部署作業」→「網頁應用程式」，');
    lines.push('執行身分選「我」、存取權限選「任何人」，再把產生的 /exec 網址填進前端的 config.js。');
  }

  var report = lines.join('\n');
  Logger.log(report);
  return report;
}

/**
 * 綁定正式「聊天室」試算表到本專案（寫入 PATS_SPREADSHEET_ID）。
 *
 * 試算表：
 *   https://docs.google.com/spreadsheets/d/1cHhqvKvKqCor-6u_gN4f9GHcZGQYK5tIMtQLr_qFgQw/edit
 * 本 Script 專案：
 *   https://script.google.com/u/0/home/projects/1mgXQCyQntaj6phZ53a28zQsfLU0HPouHc-zlrtBCIFPUI_U8l4rgJx3u/edit
 *
 * 用法：函式選單選 bindChatRoomDatabase → 執行。必要時再跑 initializeProject / setup 補齊工作表。
 */
function bindChatRoomDatabase() {
  var id = DEFAULT_CHAT_SPREADSHEET_ID;
  PropertiesService.getScriptProperties().setProperty(DB_PROP_KEY, id);
  SS_CACHE = null;
  SHEET_CACHE = {};
  ROW_CACHE = {};
  var ss = SpreadsheetApp.openById(id);
  var sheets = ss.getSheets().map(function (s) { return s.getName(); }).join(', ');
  var report = [
    '已綁定 PATS_SPREADSHEET_ID。',
    '試算表：' + ss.getUrl(),
    '工作表：' + sheets,
    '',
    '若缺表或缺欄，請再執行 initializeProject() 或 setup()。'
  ].join('\n');
  Logger.log(report);
  return report;
}

/**
 * 診斷目前後端實際寫入哪一份試算表、各表有幾列（排查「有聊天但試算表沒紀錄」）。
 */
function diagnoseChatRoomDatabase() {
  SS_CACHE = null;
  SHEET_CACHE = {};
  ROW_CACHE = {};
  var props = PropertiesService.getScriptProperties();
  var bound = props.getProperty(DB_PROP_KEY) || '（未設定，將用預設）';
  var ss = openSpreadsheet_();
  var lines = [
    '指令碼屬性 PATS_SPREADSHEET_ID：' + bound,
    '實際開啟：' + ss.getUrl(),
    '試算表 ID：' + ss.getId(),
    ''
  ];
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    var rows = sheet ? Math.max(0, sheet.getLastRow() - 1) : -1;
    lines.push(name + '：' + (rows < 0 ? '（無此工作表）' : rows + ' 列資料'));
  });
  var report = lines.join('\n');
  Logger.log(report);
  return report;
}

/**
 * 一鍵寫入 Google 登入用的 Client ID（解決「後端尚未設定 Google 用戶端 ID」）。
 *
 * 用法：Apps Script 編輯器上方函式選單選 setupGoogleClientId → 按「執行」。
 * 執行完後，用瀏覽器開 /exec 網址，應看到 googleClientId 有值。
 * 不需要重新部署（屬性是執行期讀取的）。
 */
function setupGoogleClientId() {
  var id = '354935544437-1vrje0je178afce6nturpghuu5r16qp6.apps.googleusercontent.com';
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLIENT_ID', id);
  var saved = googleClientId_();
  var report = '已寫入 GOOGLE_CLIENT_ID：\n' + saved +
    '\n\n請用瀏覽器開部署的 /exec 網址確認 googleClientId 有值，' +
    '\n再回 PATS 網頁強制重新整理後試 Google 登入。';
  Logger.log(report);
  return report;
}

/**
 * 建立（或讀取）聊天圖片暫存資料夾，並寫入 CHAT_MEDIA_FOLDER_ID。
 * 可在編輯器單獨執行；initializeProject 也會呼叫。
 */
function ensureChatMediaFolder() {
  var id = ensureChatMediaFolder_();
  var report = 'CHAT_MEDIA_FOLDER_ID：' + id +
    '\n\n請確認已授權 Drive，並部署「新版本」網頁應用程式。' +
    '\n另請新增每日觸發條件執行 purgeExpiredChatImages（圖片暫存 20 天）。';
  Logger.log(report);
  return report;
}

/**
 * 相容用的別名。
 *
 * 這個名字在舊版是內部函式，編輯器如果還記著它會出現
 * 「Script function not found: apiBootstrap」。保留一個安全的同名進入點，
 * 讓誤觸執行也能得到有用的結果，而不是一個看不懂的錯誤。
 */
function apiBootstrap() {
  return initializeProject();
}
