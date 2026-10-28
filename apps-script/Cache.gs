/**
 * PATS — 跨請求快取（CacheService）
 *
 * Db.gs 的 ROW_CACHE 只活在單次請求裡；這裡的快取跨請求共用，
 * 讓「沒有新資料」的請求（輪詢、驗證登入）完全不必開試算表。
 *
 * 失效機制：每張表有一個版本號 ver:<表名>，Db.gs 每次寫入都會換新值，
 * 所有依賴該表的快取 key 都帶著版本號，版本一換就自然失效。
 * 版本號只保留 VER_TTL_S 秒：有人直接手改試算表時版本號不會變，
 * 過期後重新產生，最晚一分鐘內就會讀到新資料。
 */

var VERSIONED_TABLES = { users: true, conversations: true, participants: true, messages: true };
var VER_TTL_S = 60;
var SESSION_CACHE_TTL_S = 600;
var USER_CACHE_TTL_S = 600;
var CACHE_MAX_CHARS = 95000; // CacheService 單一值上限 100KB

var VER_MEMO = {};

function scriptCache_() {
  try { return CacheService.getScriptCache(); } catch (err) { return null; }
}

function cacheGet_(key) {
  var cache = scriptCache_();
  if (!cache) return null;
  try {
    var raw = cache.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function cachePut_(key, value, ttlSeconds) {
  var cache = scriptCache_();
  if (!cache) return;
  try {
    var raw = JSON.stringify(value);
    if (raw.length > CACHE_MAX_CHARS) return;
    cache.put(key, raw, ttlSeconds);
  } catch (err) { /* 快取寫不進去就當沒快取 */ }
}

function cacheRemove_(key) {
  var cache = scriptCache_();
  if (!cache) return;
  try { cache.remove(key); } catch (err) {}
}

function newVersion_() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/** 一次讀多張表的版本號；不存在（過期或被清掉）就產生新的。 */
function tableVersions_(names) {
  var out = {};
  var missing = [];
  names.forEach(function (name) {
    if (VER_MEMO[name]) out[name] = VER_MEMO[name];
    else missing.push(name);
  });
  if (!missing.length) return out;

  var cache = scriptCache_();
  var found = {};
  if (cache) {
    try { found = cache.getAll(missing.map(function (n) { return 'ver:' + n; })) || {}; } catch (err) { found = {}; }
  }
  var fresh = {};
  missing.forEach(function (name) {
    var v = found['ver:' + name];
    if (!v) {
      v = newVersion_();
      fresh['ver:' + name] = v;
    }
    VER_MEMO[name] = v;
    out[name] = v;
  });
  if (cache && Object.keys(fresh).length) {
    try { cache.putAll(fresh, VER_TTL_S); } catch (err) {}
  }
  return out;
}

function tableVersion_(name) {
  return tableVersions_([name])[name];
}

/** Db.gs 每次寫入時呼叫。 */
function bumpVersion_(name) {
  if (!VERSIONED_TABLES[name]) return;
  var v = newVersion_();
  VER_MEMO[name] = v;
  var cache = scriptCache_();
  if (!cache) return;
  try { cache.put('ver:' + name, v, VER_TTL_S); } catch (err) {}
}

/* -------------------------------------------------------------- 登入驗證 */

function sessionCacheKey_(token) {
  return 'sess:' + token;
}

/** 依權杖找工作階段；先查快取，查不到才讀 sessions 表。 */
function cachedSession_(token) {
  var key = sessionCacheKey_(token);
  var hit = cacheGet_(key);
  if (hit && hit.userId) return hit;
  var session = dbFind_('sessions', function (s) { return s.token === token; });
  if (!session) return null;
  var slim = { userId: session.userId, expiresAt: String(session.expiresAt || '') };
  cachePut_(key, slim, SESSION_CACHE_TTL_S);
  return slim;
}

function forgetSession_(token) {
  if (token) cacheRemove_(sessionCacheKey_(token));
}

/** 使用者資料快取，key 帶 users 表版本號，個人資料一改就失效。 */
function cachedUser_(userId) {
  var key = 'user:' + userId + ':' + tableVersion_('users');
  var hit = cacheGet_(key);
  if (hit && hit.id) return hit;
  var user = dbGet_('users', userId);
  if (user) cachePut_(key, user, USER_CACHE_TTL_S);
  return user;
}
