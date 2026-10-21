/**
 * PATS — 應用邏輯
 *
 * 這裡的每個函式都對應前端 rpc() 的一個 action，統一由 Code.gs 的
 * apiCall_() 分派並負責錯誤包裝。
 */

/* --------------------------------------------------------------- 呼叫守衛 */

/**
 * 所有 api* 函式的 user 參數都由 Code.gs 的 apiCall_() 帶入，
 * 從編輯器下拉選單直接執行時會是 undefined。這裡先擋下來並說明該執行什麼，
 * 免得使用者看到毫無頭緒的 TypeError。
 */
function requireApiContext_(user) {
  if (!user || !user.id) {
    throw new Error(
      '這個函式是給前端透過 API 呼叫的，不能從編輯器直接執行。' +
      '可以手動執行的只有三個：setup()（建立資料庫）、' +
      'createAdminAccount()（建立管理員帳號）、' +
      'purgeExpiredSessions()（清理過期工作階段）。'
    );
  }
  return user;
}

/**
 * 家長帳號不參與聊天，只用來查看孩子的違規與舉報紀錄。
 *
 * 前端會把聊天介面藏起來，但那只是介面；真正的界線必須畫在這裡，
 * 否則直接打 API 就繞過去了。
 */
function denyParent_(user) {
  if (roleOf_(user) === 'parent') throw new Error('PARENT_NO_CHAT');
  return user;
}

/* ------------------------------------------------------------ 共用查詢工具 */

function userMap_() {
  var map = {};
  dbAll_('users').forEach(function (u) { map[u.id] = u; });
  return map;
}

function myParticipations_(userId) {
  return dbFilter_('participants', function (p) { return p.userId === userId; });
}

function participantsOf_(conversationId) {
  return dbFilter_('participants', function (p) { return p.conversationId === conversationId; });
}

function assertMember_(userId, conversationId) {
  var row = dbFind_('participants', function (p) {
    return p.userId === userId && p.conversationId === conversationId;
  });
  if (!row) throw new Error('NOT_A_MEMBER');
  return row;
}

function conversationTitle_(conv, participants, users, meId) {
  if (conv.type === 'group') return conv.name || '未命名群組';
  var peer = participants.filter(function (p) { return p.userId !== meId; })[0];
  var peerUser = peer && users[peer.userId];
  return peerUser ? (peerUser.displayName || peerUser.username || peerUser.email) : '未知的聯絡人';
}

function conversationAvatar_(conv, participants, users, meId) {
  if (conv.type === 'group') return conv.avatarUrl || '';
  var peer = participants.filter(function (p) { return p.userId !== meId; })[0];
  var peerUser = peer && users[peer.userId];
  return peerUser ? peerUser.avatarUrl : '';
}

/* -------------------------------------------------------------- 啟動載入 */

function apiBootstrap_(user) {
  requireApiContext_(user);
  return {
    user: publicUser_(user),
    serverTime: nowIso_(),
    googleClientId: googleClientId_()
  };
}

/* -------------------------------------------------------------- 對話列表 */

/**
 * scope: 'dm' 私人訊息 / 'group' 多人討論 / 'archive' 封存
 */
function apiListConversations_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  payload = payload || {};
  applyAutoArchive_(user);

  var users = userMap_();
  var mine = myParticipations_(user.id);
  var byConv = {};
  mine.forEach(function (p) { byConv[p.conversationId] = p; });

  var allParticipants = dbAll_('participants');
  var participantsByConv = {};
  allParticipants.forEach(function (p) {
    (participantsByConv[p.conversationId] = participantsByConv[p.conversationId] || []).push(p);
  });

  var indexed = indexMessages_(liveMessages_());
  var scope = payload.scope || 'dm';
  var keyword = String(payload.q || '').trim().toLowerCase();

  var list = dbAll_('conversations')
    .filter(function (conv) { return !!byConv[conv.id]; })
    .filter(function (conv) {
      var me = byConv[conv.id];
      var archived = String(me.archived) === 'true' || me.archived === true;
      if (scope === 'archive') return archived;
      if (archived) return false;
      return scope === 'group' ? conv.type === 'group' : conv.type === 'dm';
    })
    .map(function (conv) {
      var members = participantsByConv[conv.id] || [];
      var me = byConv[conv.id];
      var last = indexed.latest[conv.id];
      var lastReadAt = me.lastReadAt ? timeMs_(me.lastReadAt) : 0;
      return {
        id: conv.id,
        type: conv.type,
        title: conversationTitle_(conv, members, users, user.id),
        avatarUrl: conversationAvatar_(conv, members, users, user.id),
        memberCount: members.length,
        archived: scope === 'archive',
        lastMessageAt: conv.lastMessageAt || conv.createdAt,
        preview: last ? previewText_(last, users) : '',
        unread: countUnreadBucket_(indexed.byConv[conv.id], user.id, lastReadAt),
        _stamp: timeMs_(conv.lastMessageAt || conv.createdAt)
      };
    })
    .filter(function (row) {
      if (!keyword) return true;
      return row.title.toLowerCase().indexOf(keyword) >= 0 ||
             String(row.preview).toLowerCase().indexOf(keyword) >= 0;
    })
    .sort(function (a, b) { return b._stamp - a._stamp; });

  list.forEach(function (row) { delete row._stamp; });
  return list;
}

function previewText_(message, users) {
  var sender = users[message.senderId];
  var name = sender ? (sender.displayName || sender.username) : '';
  var body = String(message.body || '');
  if (message.kind === 'system') return body;
  return name ? name + '：' + body : body;
}

function liveMessages_() {
  return dbAll_('messages').filter(function (m) {
    return String(m.deleted) !== 'true' && m.deleted !== true;
  });
}

function timeMs_(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var dateMs = value.getTime();
    return isNaN(dateMs) ? 0 : dateMs;
  }
  if (typeof value === 'number' && isFinite(value)) {
    // 已是毫秒，或 Sheets 序列日期（約 20000～100000）
    if (value > 1e11) return value;
    if (value > 20000 && value < 100000) {
      return Math.round((value - 25569) * 86400 * 1000);
    }
    return value;
  }
  var t = new Date(value).getTime();
  return isNaN(t) ? 0 : t;
}

/** 訊息只掃一遍，同時做出「依對話分組」與「各對話最後一則」。 */
function indexMessages_(messages) {
  var byConv = {};
  var latest = {};
  var latestAt = {};
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var id = m.conversationId;
    var bucket = byConv[id];
    if (!bucket) byConv[id] = bucket = [];
    bucket.push(m);
    var t = timeMs_(m.createdAt);
    if (latestAt[id] === undefined || t >= latestAt[id]) {
      latestAt[id] = t;
      latest[id] = m;
    }
  }
  return { byConv: byConv, latest: latest };
}

function countUnreadBucket_(bucket, userId, lastReadAt) {
  if (!bucket || !bucket.length) return 0;
  var count = 0;
  for (var i = 0; i < bucket.length; i++) {
    var m = bucket[i];
    if (m.senderId !== userId && timeMs_(m.createdAt) > lastReadAt) count++;
  }
  return count;
}

/* ------------------------------------------------------------------ 訊息 */

function apiListMessages_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var conversationId = payload.conversationId;
  assertMember_(user.id, conversationId);
  var users = userMap_();
  var since = payload.since ? timeMs_(payload.since) : 0;
  var pending = [];
  var all = dbAll_('messages');
  for (var i = 0; i < all.length; i++) {
    var raw = all[i];
    if (raw.conversationId !== conversationId) continue;
    if (String(raw.deleted) === 'true' || raw.deleted === true) continue;
    var at = timeMs_(raw.createdAt);
    if (at <= since) continue;
    pending.push({ m: raw, t: at });
  }
  pending.sort(function (a, b) { return a.t - b.t; });

  var rows = pending.map(function (row) {
    var m = row.m;
    var sender = users[m.senderId] || {};
    return {
      id: m.id,
      body: m.body,
      kind: m.kind || 'text',
      createdAt: m.createdAt,
      mine: m.senderId === user.id,
      senderId: m.senderId,
      senderName: sender.displayName || sender.username || '系統',
      senderAvatar: sender.avatarUrl || ''
    };
  });

  // 輪詢只補新訊息，不必再組一次成員名單。
  if (payload.since) return { messages: rows };

  var conv = dbGet_('conversations', conversationId);
  var members = participantsOf_(conversationId);
  return {
    conversation: {
      id: conversationId,
      type: conv.type,
      title: conversationTitle_(conv, members, users, user.id),
      avatarUrl: conversationAvatar_(conv, members, users, user.id),
      memberCount: members.length,
      members: members.map(function (p) {
        var u = users[p.userId] || {};
        return { id: p.userId, name: u.displayName || u.username, avatarUrl: u.avatarUrl || '', role: p.role };
      })
    },
    messages: rows
  };
}

function apiSendMessage_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var conversationId = payload.conversationId;
  assertMember_(user.id, conversationId);
  var body = String(payload.body || '').trim();
  if (!body) throw new Error('EMPTY_MESSAGE');
  if (body.length > 4000) throw new Error('MESSAGE_TOO_LONG');

  var message = withLock_(function () {
    var created = dbInsert_('messages', {
      id: newId_(),
      conversationId: conversationId,
      senderId: user.id,
      body: body,
      kind: 'text',
      createdAt: nowIso_(),
      deleted: 'false'
    });
    dbUpdate_('conversations', conversationId, { lastMessageAt: created.createdAt });
    unarchiveForAll_(conversationId);
    apiMarkRead_(user, { conversationId: conversationId });
    return created;
  });

  return {
    id: message.id,
    body: message.body,
    kind: 'text',
    createdAt: message.createdAt,
    mine: true,
    senderId: user.id,
    senderName: user.displayName || user.username,
    senderAvatar: user.avatarUrl || ''
  };
}

function apiMarkRead_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var row = assertMember_(user.id, payload.conversationId);
  dbUpdate_('participants', row.id, { lastReadAt: nowIso_() });
  return true;
}

/* ---------------------------------------------------------------- 建立對話 */

function apiStartDirect_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var peer = findUserByAccount_(payload.account);
  if (!peer) throw new Error('USER_NOT_FOUND');
  if (peer.id === user.id) throw new Error('CANNOT_CHAT_SELF');

  var existing = findDirectConversation_(user.id, peer.id);
  if (existing) return { conversationId: existing };

  var conv = dbInsert_('conversations', {
    id: newId_(),
    type: 'dm',
    name: '',
    avatarUrl: '',
    createdBy: user.id,
    createdAt: nowIso_(),
    lastMessageAt: nowIso_()
  });
  addParticipant_(conv.id, user.id, 'member');
  addParticipant_(conv.id, peer.id, 'member');
  ensureContact_(user.id, peer.id);
  ensureContact_(peer.id, user.id);
  dbInsert_('messages', {
    id: newId_(),
    conversationId: conv.id,
    senderId: user.id,
    body: (user.displayName || user.username) + ' 開始了與 ' +
      (peer.displayName || peer.username) + ' 的對話',
    kind: 'system',
    createdAt: nowIso_(),
    deleted: 'false'
  });
  return { conversationId: conv.id };
}

function findDirectConversation_(a, b) {
  var byConv = {};
  dbAll_('participants').forEach(function (p) {
    (byConv[p.conversationId] = byConv[p.conversationId] || []).push(p.userId);
  });
  var found = null;
  dbAll_('conversations').forEach(function (conv) {
    if (found || conv.type !== 'dm') return;
    var ids = byConv[conv.id] || [];
    if (ids.length === 2 && ids.indexOf(a) >= 0 && ids.indexOf(b) >= 0) found = conv.id;
  });
  return found;
}

function apiCreateGroup_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var name = String(payload.name || '').trim();
  if (!name) throw new Error('GROUP_NAME_REQUIRED');

  var conv = dbInsert_('conversations', {
    id: newId_(),
    type: 'group',
    name: name,
    avatarUrl: '',
    createdBy: user.id,
    createdAt: nowIso_(),
    lastMessageAt: nowIso_()
  });
  addParticipant_(conv.id, user.id, 'owner');

  var missing = [];
  (payload.members || []).forEach(function (account) {
    var member = findUserByAccount_(account);
    if (!member) { missing.push(account); return; }
    if (member.id === user.id) return;
    addParticipant_(conv.id, member.id, 'member');
  });

  dbInsert_('messages', {
    id: newId_(),
    conversationId: conv.id,
    senderId: user.id,
    body: (user.displayName || user.username) + ' 建立了群組「' + name + '」',
    kind: 'system',
    createdAt: nowIso_(),
    deleted: 'false'
  });

  return { conversationId: conv.id, missing: missing };
}

function addParticipant_(conversationId, userId, role) {
  var exists = dbFind_('participants', function (p) {
    return p.conversationId === conversationId && p.userId === userId;
  });
  if (exists) return exists;
  return dbInsert_('participants', {
    id: newId_(),
    conversationId: conversationId,
    userId: userId,
    role: role || 'member',
    joinedAt: nowIso_(),
    lastReadAt: '',
    archived: 'false',
    archivedAt: ''
  });
}

/* ---------------------------------------------------------------- 聯絡人 */

function ensureContact_(userId, peerId) {
  var exists = dbFind_('contacts', function (c) {
    return c.userId === userId && c.peerId === peerId;
  });
  if (exists) return exists;
  return dbInsert_('contacts', {
    id: newId_(),
    userId: userId,
    peerId: peerId,
    status: 'active',
    createdAt: nowIso_()
  });
}

function apiListContacts_(user) {
  requireApiContext_(user);
  denyParent_(user);
  var users = userMap_();
  return dbFilter_('contacts', function (c) { return c.userId === user.id; })
    .map(function (c) {
      var peer = users[c.peerId] || {};
      return {
        id: peer.id,
        name: peer.displayName || peer.username || '',
        email: peer.email || '',
        avatarUrl: peer.avatarUrl || ''
      };
    })
    .filter(function (c) { return !!c.id; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function apiInviteContact_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var peer = findUserByAccount_(payload.account);
  if (!peer) throw new Error('USER_NOT_FOUND');
  if (peer.id === user.id) throw new Error('CANNOT_ADD_SELF');
  ensureContact_(user.id, peer.id);
  ensureContact_(peer.id, user.id);
  return { id: peer.id, name: peer.displayName || peer.username, email: peer.email };
}

/* ------------------------------------------------------------------ 封存 */

function apiSetArchived_(user, payload) {
  requireApiContext_(user);
  denyParent_(user);
  var row = assertMember_(user.id, payload.conversationId);
  var archived = !!payload.archived;
  dbUpdate_('participants', row.id, {
    archived: archived ? 'true' : 'false',
    archivedAt: archived ? nowIso_() : ''
  });
  return true;
}

function unarchiveForAll_(conversationId) {
  var pending = [];
  participantsOf_(conversationId).forEach(function (p) {
    if (String(p.archived) === 'true') {
      pending.push({ id: p.id, patch: { archived: 'false', archivedAt: '' } });
    }
  });
  if (pending.length) dbUpdateMany_('participants', pending);
}

/**
 * 依使用者設定的天數，把久未互動的對話自動搬進封存。
 * 粒度是「天」，不必跟著每 6 秒的列表輪詢各跑一次，同一人 10 分鐘內只檢查一回。
 */
function applyAutoArchive_(user) {
  var cache = CacheService.getScriptCache();
  var key = 'pats-archive:' + user.id;
  try {
    if (cache.get(key)) return;
  } catch (err) { /* 快取不可用時照常檢查 */ }

  var settings = Object.assign({}, DEFAULT_USER_SETTINGS, parseJson_(user.settings, {}));
  var days = Number(settings.archiveDays);
  if (!days || days <= 0) {
    try { cache.put(key, '1', 600); } catch (err2) {}
    return;
  }

  var threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  var conversations = {};
  dbAll_('conversations').forEach(function (c) { conversations[c.id] = c; });

  var stamp = nowIso_();
  var pending = [];
  myParticipations_(user.id).forEach(function (p) {
    if (String(p.archived) === 'true') return;
    var conv = conversations[p.conversationId];
    if (!conv) return;
    // 時間無效時不封存，避免新建對話因解析失敗被立刻藏進「封存」
    var stampMs = timeMs_(conv.lastMessageAt || conv.createdAt);
    if (!stampMs) return;
    if (stampMs < threshold) {
      pending.push({ id: p.id, patch: { archived: 'true', archivedAt: stamp } });
    }
  });
  if (pending.length) dbUpdateMany_('participants', pending);
  try { cache.put(key, '1', 600); } catch (err3) {}
}

/* ------------------------------------------------------------------ 設定 */

function apiUpdateProfile_(user, payload) {
  requireApiContext_(user);
  var patch = {};
  if (payload.username !== undefined) {
    var username = String(payload.username).trim();
    if (username.length < 2) throw new Error('USERNAME_TOO_SHORT');
    var taken = dbFind_('users', function (u) {
      return u.id !== user.id && String(u.username).toLowerCase() === username.toLowerCase();
    });
    if (taken) throw new Error('USERNAME_TAKEN');
    patch.username = username;
    patch.displayName = username;
  }
  if (payload.avatarUrl !== undefined) patch.avatarUrl = String(payload.avatarUrl).trim();
  if (!Object.keys(patch).length) return publicUser_(user);
  dbUpdate_('users', user.id, patch);
  return publicUser_(Object.assign({}, user, patch));
}

function apiChangePassword_(user, payload) {
  requireApiContext_(user);
  authChangePassword_(user, payload);
  return true;
}

function apiUpdateSettings_(user, payload) {
  requireApiContext_(user);
  var settings = Object.assign(
    {},
    DEFAULT_USER_SETTINGS,
    parseJson_(user.settings, {}),
    payload.settings || {}
  );
  settings.archiveDays = Number(settings.archiveDays) || 0;
  dbUpdate_('users', user.id, { settings: JSON.stringify(settings) });
  return settings;
}

/** 「清除快取資料」：只丟掉伺服器端快取，不動訊息本體。 */
function apiClearCache_(user) {
  requireApiContext_(user);
  CacheService.getScriptCache().removeAll(['conversations:' + user.id, 'messages:' + user.id]);
  return true;
}

function apiStorageUsage_(user) {
  requireApiContext_(user);
  // 這裡不擋家長：設定頁會用到，而家長沒有對話，本來就會算出 0。
  var mine = {};
  myParticipations_(user.id).forEach(function (p) { mine[p.conversationId] = true; });
  var bytes = 0;
  liveMessages_().forEach(function (m) {
    if (mine[m.conversationId]) bytes += String(m.body || '').length * 2;
  });
  return { bytes: bytes };
}

/* -------------------------------------------------------------- 管理員 */

function apiAdminListUsers_(user, payload) {
  requireApiContext_(user);
  requireAdmin_(user);
  payload = payload || {};
  var keyword = String(payload.q || '').trim().toLowerCase();

  return dbAll_('users')
    .map(function (row) {
      return {
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.displayName || row.username || row.email,
        role: roleOf_(row),
        roleLabel: (ROLES[roleOf_(row)] || {}).label || roleOf_(row),
        isAdmin: isAdmin_(row),
        provider: row.provider || 'password',
        hasPassword: !!(row.passwordHash && String(row.passwordHash)),
        status: row.status || 'active',
        createdAt: row.createdAt || ''
      };
    })
    .filter(function (row) {
      if (!keyword) return true;
      return String(row.email).toLowerCase().indexOf(keyword) >= 0 ||
             String(row.displayName).toLowerCase().indexOf(keyword) >= 0 ||
             String(row.username).toLowerCase().indexOf(keyword) >= 0;
    })
    .sort(function (a, b) {
      return String(a.email).localeCompare(String(b.email));
    });
}

/** 清除指定帳號的登入密碼；之後只能用 Google 登入或走忘記密碼重設。 */
function apiAdminClearPassword_(user, payload) {
  requireApiContext_(user);
  requireAdmin_(user);
  var target = resolveAdminTarget_(user, payload);
  if (!target.passwordHash) throw new Error('PASSWORD_ALREADY_CLEARED');

  dbUpdate_('users', target.id, { passwordHash: '', passwordSalt: '' });
  revokeSessionsForUser_(target.id);
  return { id: target.id, email: target.email, hasPassword: false };
}

/** 刪除帳號：使用者列、工作階段、聯絡人與對話成員一併移除。訊息本體保留。 */
function apiAdminDeleteUser_(user, payload) {
  requireApiContext_(user);
  requireAdmin_(user);
  var target = resolveAdminTarget_(user, payload);
  if (target.id === user.id) throw new Error('CANNOT_DELETE_SELF');

  revokeSessionsForUser_(target.id);

  dbFilter_('contacts', function (c) {
    return c.userId === target.id || c.peerId === target.id;
  }).forEach(function (c) { dbDelete_('contacts', c.id); });

  dbFilter_('participants', function (p) {
    return p.userId === target.id;
  }).forEach(function (p) { dbDelete_('participants', p.id); });

  dbFilter_('resets', function (r) {
    return r.userId === target.id ||
           String(r.email || '').toLowerCase() === String(target.email).toLowerCase();
  }).forEach(function (r) { dbDelete_('resets', r.id); });

  dbDelete_('users', target.id);
  return { deleted: true, id: target.id, email: target.email };
}

function resolveAdminTarget_(admin, payload) {
  var account = String((payload && (payload.account || payload.email)) || '').trim();
  var id = String((payload && payload.userId) || '').trim();
  var target = id ? dbGet_('users', id) : findUserByAccount_(account);
  if (!target) throw new Error('USER_NOT_FOUND');
  return target;
}

function revokeSessionsForUser_(userId) {
  dbFilter_('sessions', function (s) {
    return s.userId === userId;
  }).forEach(function (s) { dbDelete_('sessions', s.token); });
}
