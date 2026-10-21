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
  var userCount = dbAll_('users').length;

  var lines = [
    'PATS 初始化完成。',
    '資料庫試算表：' + url,
    '目前使用者人數：' + userCount,
    'Google 用戶端 ID：' + (googleClientId_() || '（尚未設定，僅開放帳密登入）'),
    // 這行讀得到數字，就代表寄信權限已經授權完成（驗證碼會以授權者的帳號寄出）。
    '今日還可寄出的信件數：' + MailApp.getRemainingDailyQuota()
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
 *   https://docs.google.com/spreadsheets/d/1yuhSJSPUcOJOs_L7oyDf4Q9z73eR3C9XF5jClle9WX0/edit
 * 本 Script 專案：
 *   https://script.google.com/u/0/home/projects/1mgXQCyQntaj6phZ53a28zQsfLU0HPouHc-zlrtBCIFPUI_U8l4rgJx3u/edit
 *
 * 用法：函式選單選 bindChatRoomDatabase → 執行。必要時再跑 initializeProject / setup 補齊工作表。
 */
function bindChatRoomDatabase() {
  var id = '1yuhSJSPUcOJOs_L7oyDf4Q9z73eR3C9XF5jClle9WX0';
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
 * 相容用的別名。
 *
 * 這個名字在舊版是內部函式，編輯器如果還記著它會出現
 * 「Script function not found: apiBootstrap」。保留一個安全的同名進入點，
 * 讓誤觸執行也能得到有用的結果，而不是一個看不懂的錯誤。
 */
function apiBootstrap() {
  return initializeProject();
}
