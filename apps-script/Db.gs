/**
 * PATS — 資料層
 *
 * 以 Google 試算表當作資料庫。第一次執行 setup() 會自動建立試算表、
 * 所有工作表與標題列，並把試算表 ID 記在指令碼屬性中。
 */

var DB_PROP_KEY = 'PATS_SPREADSHEET_ID';
var DB_LOCK_TIMEOUT_MS = 20000;

/** 正式「聊天室」試算表（未設指令碼屬性時使用，避免誤建空白資料庫）。 */
var DEFAULT_CHAT_SPREADSHEET_ID = '1cHhqvKvKqCor-6u_gN4f9GHcZGQYK5tIMtQLr_qFgQw';

/**
 * 資料表結構。欄位順序即工作表的欄位順序，變更後請執行 setup() 補齊。
 */
var SCHEMA = {
  users: [
    'id', 'email', 'username', 'displayName', 'avatarUrl',
    'passwordHash', 'passwordSalt', 'provider', 'status',
    'settings', 'createdAt', 'lastSeenAt', 'role', 'linkedStudentId'
  ],
  sessions: ['token', 'userId', 'createdAt', 'expiresAt', 'userAgent'],
  resets: [
    'id', 'userId', 'email', 'codeHash', 'codeSalt',
    'createdAt', 'expiresAt', 'attempts', 'ticket'
  ],
  signups: [
    'id', 'email', 'role', 'studentId', 'codeHash', 'codeSalt',
    'createdAt', 'expiresAt', 'attempts'
  ],
  contacts: ['id', 'userId', 'peerId', 'status', 'createdAt'],
  conversations: ['id', 'type', 'name', 'avatarUrl', 'createdBy', 'createdAt', 'lastMessageAt'],
  participants: ['id', 'conversationId', 'userId', 'role', 'joinedAt', 'lastReadAt', 'archived', 'archivedAt'],
  messages: ['id', 'conversationId', 'senderId', 'body', 'kind', 'createdAt', 'deleted']
};

/** 預設的使用者設定，寫在 users.settings（JSON 字串）。 */
var DEFAULT_USER_SETTINGS = {
  archiveDays: 0,
  notifications: true
};

/**
 * 建立（或修復）試算表結構。第一次部署時請在編輯器中手動執行一次。
 */
function setup() {
  SHEET_CACHE = {};
  ROW_CACHE = {};
  var ss = openSpreadsheet_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    var headers = SCHEMA[name];
    var current = sheet.getLastColumn()
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      : [];
    if (current.join('|') !== headers.join('|')) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    // 全部以純文字儲存，避免 ISO 時間字串被試算表自動轉成日期型別。
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  });
  var blank = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  return ss.getUrl();
}

/** 單次執行內的快取，避免每個查詢都重新開啟試算表或重讀同一張表。 */
var SS_CACHE = null;
var SHEET_CACHE = {};
var ROW_CACHE = {};

function invalidate_(name) { delete ROW_CACHE[name]; }

function openSpreadsheet_() {
  if (SS_CACHE) return SS_CACHE;
  SS_CACHE = createOrOpenSpreadsheet_();
  return SS_CACHE;
}

/** 曾誤綁、幾乎空白的試算表；讀到時自動改綁正式有資料的表 */
var EMPTY_CHAT_SPREADSHEET_ID = '1yuhSJSPUcOJOs_L7oyDf4Q9z73eR3C9XF5jClle9WX0';

function createOrOpenSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(DB_PROP_KEY) || DEFAULT_CHAT_SPREADSHEET_ID;
  // 空表誤綁時改回真資料（傳圖切後端時用）
  if (id === EMPTY_CHAT_SPREADSHEET_ID) {
    id = DEFAULT_CHAT_SPREADSHEET_ID;
    props.setProperty(DB_PROP_KEY, id);
  }
  if (id) {
    try {
      var existing = SpreadsheetApp.openById(id);
      if (!props.getProperty(DB_PROP_KEY)) {
        props.setProperty(DB_PROP_KEY, id);
      }
      return existing;
    } catch (err) {
      // ID 失效時往下重新建立
    }
  }
  var ss = SpreadsheetApp.create('PATS 資料庫');
  props.setProperty(DB_PROP_KEY, ss.getId());
  return ss;
}

function sheet_(name) {
  if (SHEET_CACHE[name]) return SHEET_CACHE[name];
  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    setup();
    sheet = openSpreadsheet_().getSheetByName(name);
  }
  SHEET_CACHE[name] = sheet;
  return sheet;
}

/**
 * 讀出整張表，回傳物件陣列。每筆多帶一個不可見的 _row（試算表列號）供更新使用。
 */
function dbAll_(name) {
  if (ROW_CACHE[name]) return ROW_CACHE[name];
  var sheet = sheet_(name);
  var lastRow = sheet.getLastRow();
  var headers = SCHEMA[name];
  if (lastRow < 2) {
    ROW_CACHE[name] = [];
    return ROW_CACHE[name];
  }
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) continue;
    var obj = { _row: i + 2 };
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[i][c];
    rows.push(obj);
  }
  ROW_CACHE[name] = rows;
  return rows;
}

function dbFind_(name, predicate) {
  var rows = dbAll_(name);
  for (var i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) return rows[i];
  }
  return null;
}

function dbFilter_(name, predicate) {
  return dbAll_(name).filter(predicate);
}

function dbGet_(name, id) {
  var key = SCHEMA[name][0];
  return dbFind_(name, function (r) { return String(r[key]) === String(id); });
}

function dbInsert_(name, obj) {
  var headers = SCHEMA[name];
  var record = {};
  headers.forEach(function (h) { record[h] = obj[h] === undefined ? '' : obj[h]; });
  if (!record[headers[0]]) record[headers[0]] = newId_();
  var row = headers.map(function (h) { return record[h]; });
  withLock_(function () { sheet_(name).appendRow(row); });
  invalidate_(name);
  return record;
}

function dbUpdate_(name, id, patch) {
  var updated = dbUpdateMany_(name, [{ id: id, patch: patch }]);
  return updated.length ? updated[0] : null;
}

/**
 * 一次鎖、每個列只寫一段連續欄位。
 * 舊版每個欄位各打一次 setValue，送出訊息時會連開好幾次鎖。
 */
function dbUpdateMany_(name, items) {
  if (!items || !items.length) return [];
  var headers = SCHEMA[name];
  var sheet = sheet_(name);
  var prepared = [];
  var results = [];

  items.forEach(function (item) {
    var existing = dbGet_(name, item.id);
    if (!existing) return;
    var patch = item.patch || {};
    var min = -1;
    var max = -1;
    Object.keys(patch).forEach(function (field) {
      var col = headers.indexOf(field);
      if (col < 0) return;
      if (min < 0 || col < min) min = col;
      if (col > max) max = col;
    });
    if (min < 0) {
      results.push(existing);
      return;
    }
    var slice = [];
    for (var col = min; col <= max; col++) {
      var field = headers[col];
      var value = Object.prototype.hasOwnProperty.call(patch, field) ? patch[field] : existing[field];
      slice.push(value === undefined || value === null ? '' : value);
    }
    prepared.push({ row: existing._row, col: min + 1, slice: slice });
    results.push(Object.assign({}, existing, patch));
  });

  if (!prepared.length) return results;
  withLock_(function () {
    prepared.forEach(function (item) {
      sheet.getRange(item.row, item.col, 1, item.slice.length).setValues([item.slice]);
    });
  });
  invalidate_(name);
  return results;
}

function dbDelete_(name, id) {
  var existing = dbGet_(name, id);
  if (!existing) return false;
  withLock_(function () { sheet_(name).deleteRow(existing._row); });
  invalidate_(name);
  return true;
}

var LOCK_DEPTH = 0;

/**
 * 同一輪執行裡可以巢狀呼叫。內層直接跑，避免對已持有的鎖再 waitLock 一次。
 */
function withLock_(fn) {
  if (LOCK_DEPTH > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(DB_LOCK_TIMEOUT_MS);
  LOCK_DEPTH++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH--;
    try { lock.releaseLock(); } catch (e) {}
  }
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

function nowIso_() {
  return new Date().toISOString();
}

function parseJson_(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}
