/* =====================================================================
   PATS — 語音通話（WebRTC + Socket.io 信令）
   流程：撥號 → 響鈴 → 接通 → 通話中 → 掛斷
   ===================================================================== */

var PatsCall = (function () {
  'use strict';

  var SIGNAL_KEY = 'pats.signalingUrl';
  var socket = null;
  var session = null;
  var currentUser = null;
  var generation = 0;
  var timerId = null;
  var muted = false;
  var signalState = 'idle'; // idle | connecting | online | offline | blocked
  var listeners = [];
  var reconnectTimer = null;

  function $(id) { return document.getElementById(id); }

  // #region agent log
  function dbgCall_(hypothesisId, location, message, data, runId) {
    var entry = {
      sessionId: 'b641af',
      runId: runId || 'pre-fix',
      hypothesisId: hypothesisId,
      location: location,
      message: message,
      data: data || {},
      timestamp: Date.now()
    };
    try { console.debug('[PATS-dbg]', hypothesisId, location, message, entry.data); } catch (e) { /* ignore */ }
    try {
      var key = 'pats.debug.b641af';
      var buf = JSON.parse(window.localStorage.getItem(key) || '[]');
      if (!Array.isArray(buf)) buf = [];
      buf.push(entry);
      if (buf.length > 80) buf = buf.slice(-80);
      window.localStorage.setItem(key, JSON.stringify(buf));
    } catch (e2) { /* ignore */ }
    var payload = JSON.stringify(entry);
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b641af' },
      body: payload
    };
    [
      'http://127.0.0.1:7933/ingest/c8756446-874d-4039-81a0-9dd77fab3795',
      'http://192.168.1.136:7933/ingest/c8756446-874d-4039-81a0-9dd77fab3795'
    ].forEach(function (url) { fetch(url, opts).catch(function () {}); });
  }
  // #endregion

  function googleStunServers_() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }

  function configuredTurnServers_() {
    var configured = (PATS.state.config && PATS.state.config.iceServers) || [];
    return configured.filter(function (s) {
      var u = typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
      return /turns?:/i.test(u);
    });
  }

  function legacyOpenRelayServers_() {
    return [
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ];
  }

  function urlKinds_(servers) {
    var kinds = { stun: 0, turn: 0, turns: 0 };
    (servers || []).forEach(function (s) {
      var list = Array.isArray(s.urls) ? s.urls : [s.urls];
      list.forEach(function (u) {
        u = String(u || '').toLowerCase();
        if (u.indexOf('turns:') === 0) kinds.turns += 1;
        else if (u.indexOf('turn:') === 0) kinds.turn += 1;
        else if (u.indexOf('stun:') === 0) kinds.stun += 1;
      });
    });
    return kinds;
  }

  function hasTurnUrl_(servers) {
    return (servers || []).some(function (s) {
      var u = typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
      return /turns?:/i.test(u);
    });
  }

  function hmacSha1Base64_(secret, message) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    ).then(function (key) {
      return crypto.subtle.sign('HMAC', key, enc.encode(message));
    }).then(function (sig) {
      var bytes = new Uint8Array(sig);
      var binary = '';
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });
  }

  function buildStaticAuthServers_() {
    var username = String(Math.floor(Date.now() / 1000) + 6 * 3600);
    return hmacSha1Base64_('openrelayprojectsecret', username).then(function (credential) {
      return googleStunServers_().concat([
        { urls: 'turn:staticauth.openrelay.metered.ca:80', username: username, credential: credential },
        { urls: 'turn:staticauth.openrelay.metered.ca:443', username: username, credential: credential },
        { urls: 'turn:staticauth.openrelay.metered.ca:443?transport=tcp', username: username, credential: credential },
        { urls: 'turns:staticauth.openrelay.metered.ca:443', username: username, credential: credential }
      ], legacyOpenRelayServers_(), configuredTurnServers_());
    });
  }

  /** 同步讀取：優先 session 快取，否則僅 config STUN（開通前占位）。 */
  function iceServers() {
    if (session && session.resolvedIce && session.resolvedIce.length) {
      return session.resolvedIce;
    }
    var configured = PATS.state.config.iceServers;
    if (configured && configured.length) return configured;
    return googleStunServers_();
  }

  function resolveIceServers() {
    if (session && session.resolvedIce && session.resolvedIce.length) {
      return Promise.resolve(session.resolvedIce);
    }

    var apiUrl = String((PATS.state.config && PATS.state.config.meteredTurnApiUrl) || '').trim();
    var coturnServers = configuredTurnServers_();

    function finishResolve(servers, iceSource) {
      var list = servers && servers.length ? servers : googleStunServers_();
      if (session) {
        session.resolvedIce = list;
        session.iceSource = iceSource;
      }
      var kinds = urlKinds_(list);
      var hasTurn = hasTurnUrl_(list);
      // #region agent log
      dbgCall_('F', 'call.js:resolveIceServers', 'ice servers resolved', {
        hasTurn: hasTurn,
        urlKinds: kinds,
        iceSource: iceSource,
        iceServerCount: list.length
      }, 'post-fix');
      if (!hasTurn) {
        dbgCall_('G', 'call.js:resolveIceServers', 'no turn urls after resolve', {
          iceSource: iceSource,
          urlKinds: kinds
        }, 'post-fix');
      }
      // #endregion
      return list;
    }

    // 自架 Coturn（config.iceServers 內的 turn:）優先，不再混入公共 Open Relay
    if (coturnServers.length) {
      return Promise.resolve(
        finishResolve(googleStunServers_().concat(coturnServers), 'coturn')
      );
    }

    var apiPromise = Promise.resolve(null);
    if (apiUrl) {
      apiPromise = fetch(apiUrl).then(function (res) {
        if (!res.ok) throw new Error('metered api ' + res.status);
        return res.json();
      }).then(function (data) {
        var servers = (data && data.iceServers) || data;
        if (!Array.isArray(servers) || !servers.length) throw new Error('empty iceServers');
        return finishResolve(googleStunServers_().concat(servers), 'metered-api');
      }).catch(function () {
        return null;
      });
    }

    return apiPromise.then(function (fromApi) {
      if (fromApi) return fromApi;
      if (window.crypto && crypto.subtle) {
        return buildStaticAuthServers_().then(function (servers) {
          return finishResolve(servers, 'staticauth');
        }).catch(function () {
          return finishResolve(
            googleStunServers_().concat(legacyOpenRelayServers_()),
            'legacy'
          );
        });
      }
      return finishResolve(
        googleStunServers_().concat(legacyOpenRelayServers_()),
        'legacy'
      );
    });
  }

  function signalingUrl() {
    var fallback = String((PATS.state.config && PATS.state.config.signalingUrl) || '').replace(/\/$/, '');
    try {
      var saved = window.localStorage.getItem(SIGNAL_KEY);
      if (saved && saved.trim()) {
        saved = saved.trim().replace(/\/$/, '');
        // HTTPS 網站上不能用 HTTP 信令；清掉舊覆寫，改回 config 固定網址
        if (location.protocol === 'https:' && /^http:\/\//i.test(saved)) {
          window.localStorage.removeItem(SIGNAL_KEY);
          return fallback;
        }
        return saved;
      }
    } catch (e) { /* ignore */ }
    return fallback;
  }

  function setSignalingUrl(url) {
    url = String(url || '').trim().replace(/\/$/, '');
    try {
      if (url) window.localStorage.setItem(SIGNAL_KEY, url);
      else window.localStorage.removeItem(SIGNAL_KEY);
    } catch (e) { /* ignore */ }
    if (currentUser) connect(currentUser);
    return signalingUrl();
  }

  function isBlockedMixedContent(url) {
    return location.protocol === 'https:' && /^http:\/\//i.test(url || '');
  }

  function setSignalState(next) {
    if (signalState === next) return;
    signalState = next;
    listeners.forEach(function (fn) {
      try { fn(signalState); } catch (e) { /* ignore */ }
    });
  }

  function onSignalChange(fn) {
    listeners.push(fn);
    try { fn(signalState); } catch (e) { /* ignore */ }
    return function () {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  /* --------------------------------------------------------------- 畫面 */

  function showLayer() { $('call-layer').classList.remove('hidden'); }
  function hideLayer() { $('call-layer').classList.add('hidden'); }

  function setStatus(text) { $('call-status').textContent = text; }

  function setActions(mode) {
    $('call-accept').classList.toggle('hidden', mode !== 'ringing');
    $('call-reject').classList.toggle('hidden', mode !== 'ringing');
    $('call-hangup').classList.toggle('hidden', mode === 'ringing' || mode === 'idle');
    $('call-mute').classList.toggle('hidden', mode !== 'active' && mode !== 'dialing' && mode !== 'connecting');
  }

  function paintPeer(name) {
    $('call-name').textContent = name || '對方';
    var avatar = $('call-avatar');
    avatar.textContent = PATS.initials(name);
  }

  function setMuteIcon() {
    var icon = $('call-mute').querySelector('.material-symbols-outlined');
    icon.textContent = muted ? 'mic_off' : 'mic';
    $('call-mute').setAttribute('aria-label', muted ? '取消靜音' : '靜音麥克風');
  }

  function startTimer() {
    stopTimer();
    var started = Date.now();
    timerId = setInterval(function () {
      var seconds = Math.floor((Date.now() - started) / 1000);
      var min = Math.floor(seconds / 60);
      var sec = seconds % 60;
      var clock = (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
      if (session && session.isGroup) {
        setStatus(groupLinkCount() + ' 人 · ' + clock);
      } else {
        setStatus(clock);
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  /* ------------------------------------------------------------- 連線 */

  function clearReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    clearReconnect();
    if (!currentUser || !signalingUrl()) return;
    reconnectTimer = setTimeout(function () {
      if (currentUser && (!socket || !socket.connected)) connect(currentUser);
    }, 2500);
  }

  function ensureSignalPresence() {
    if (!currentUser) return;
    if (socket && socket.connected) registerSelf();
    else connect(currentUser);
  }

  function bindLifecycle() {
    if (bindLifecycle._done) return;
    bindLifecycle._done = true;
    document.addEventListener('visibilitychange', function () {
      // #region agent log
      dbgCall_('A', 'call.js:visibilitychange', document.hidden ? 'page hidden' : 'page visible', {
        hidden: !!document.hidden,
        signalState: signalState,
        socketConnected: !!(socket && socket.connected),
        hasSession: !!session
      });
      // #endregion
      if (document.hidden) return;
      // #region agent log
      dbgCall_('J', 'call.js:visibility', 'page visible — re-register', {
        signalState: signalState,
        socketConnected: !!(socket && socket.connected)
      });
      // #endregion
      ensureSignalPresence();
    });
    window.addEventListener('pageshow', function () { ensureSignalPresence(); });
    window.addEventListener('focus', function () { ensureSignalPresence(); });
  }

  function registerSelf() {
    if (!socket || !currentUser) return;
    var displayName = currentUser.displayName || currentUser.username ||
      currentUser.email || currentUser.id;
    // #region agent log
    dbgCall_('B', 'call.js:registerSelf', 'register emit', {
      userId: currentUser.id,
      hasDisplayName: !!displayName,
      nameEqualsId: String(displayName || '') === String(currentUser.id || ''),
      nameLen: String(displayName || '').length,
      socketConnected: !!(socket && socket.connected),
      signalState: signalState,
      pageHidden: !!document.hidden
    });
    // #endregion
    socket.emit('register', {
      userId: currentUser.id,
      name: displayName
    }, function (ack) {
      // #region agent log
      dbgCall_('B', 'call.js:registerSelf', 'register ack', {
        userId: currentUser && currentUser.id,
        ackOk: !!(ack && ack.ok),
        online: ack && ack.online
      });
      // #endregion
    });
  }

  function connect(user) {
    currentUser = user || currentUser;
    clearReconnect();

    var url = signalingUrl();
    if (!url || typeof io !== 'function' || !currentUser) {
      setSignalState('idle');
      return;
    }

    if (isBlockedMixedContent(url)) {
      setSignalState('blocked');
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      return;
    }

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    setSignalState('connecting');
    bindLifecycle();
    socket = io(url, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      timeout: 20000
    });

    socket.on('connect', function () {
      setSignalState('online');
      // #region agent log
      dbgCall_('A', 'call.js:socket', 'socket connected', {
        pageHidden: !!document.hidden,
        userId: currentUser && currentUser.id
      });
      // #endregion
      registerSelf();
    });
    socket.on('disconnect', function (reason) {
      // #region agent log
      dbgCall_('A', 'call.js:socket', 'socket disconnect', {
        reason: reason || null,
        pageHidden: !!document.hidden,
        hasSession: !!session,
        phase: session && session.phase,
        userId: currentUser && currentUser.id
      });
      // #endregion
      setSignalState('offline');
      scheduleReconnect();
      // 己方網路斷線且通話中：關閉通話層回到聊天
      if (session && (session.phase === 'active' || session.wasActive || session.phase === 'connecting')) {
        finish('網路已中斷');
      }
    });
    socket.on('connect_error', function () {
      setSignalState('offline');
      scheduleReconnect();
    });

    socket.on('incoming-call', onIncoming);
    socket.on('incoming-group-call', onIncomingGroup);
    socket.on('group-peer-joined', onGroupPeerJoined);
    socket.on('group-peer-left', onGroupPeerLeft);
    socket.on('group-call-declined', onGroupDeclined);
    socket.on('call-accepted', onAccepted);
    socket.on('call-rejected', function (payload) {
      if (session && session.isGroup) {
        if (payload && payload.from) dropGroupPeer(payload.from, null);
        return;
      }
      finish('對方已拒絕');
    });
    socket.on('hung-up', function (payload) {
      if (session && session.isGroup && payload && payload.from) {
        dropGroupPeer(payload.from, null);
        return;
      }
      finish('通話已結束');
    });
    socket.on('peer-network-lost', function (payload) {
      if (!session) return;
      if (session.isGroup && payload && payload.from) {
        dropGroupPeer(payload.from, null);
        updateGroupStatus();
        return;
      }
      if (payload && payload.from && session.peerId && payload.from !== session.peerId) return;
      finish('對方網路已斷線');
    });
    socket.on('call-failed', function (payload) {
      if (session && session.isGroup) return;
      if (payload && payload.reason === 'offline') finish('對方不在線上');
    });
    socket.on('ice-candidate', function (payload) {
      if (!sameCall(payload) || !session || !payload.candidate) return;
      if (session.isGroup) {
        var link = payload.from && session.links[payload.from];
        if (!link) return;
        if (!link.pc) {
          link.earlyIce.push(payload.candidate);
          return;
        }
        link.pc.addIceCandidate(payload.candidate);
        return;
      }
      if (!session.pc) {
        session.earlyIce.push(payload.candidate);
        return;
      }
      session.pc.addIceCandidate(payload.candidate);
    });
    socket.on('renegotiate', onRenegotiate);
    socket.on('renegotiate-answer', function (payload) {
      if (!sameCall(payload) || !session) return;
      if (session.isGroup) {
        var gLink = payload.from && session.links[payload.from];
        if (!gLink || !gLink.pc) return;
        gLink.pc.acceptAnswer(payload.answer).catch(function () {});
        return;
      }
      if (!session.pc) return;
      session.pc.acceptAnswer(payload.answer).catch(function () { finish('重新連線失敗'); });
    });
    socket.on('request-restart', function (payload) {
      if (!sameCall(payload) || !session || !session.isCaller || session.isGroup) return;
      restart();
    });
    socket.on('replaced', function () {
      finish('已在其他分頁登入');
    });
  }

  function disconnect() {
    clearReconnect();
    finish(null);
    currentUser = null;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    setSignalState('idle');
  }

  function sameCall(payload) {
    return session && payload && payload.callId === session.callId;
  }

  function emit(event, extra) {
    if (!socket || !socket.connected || !session) return;
    var to = (extra && extra.to) || session.peerId;
    socket.emit(event, Object.assign({
      to: to,
      callId: session.callId,
      group: !!session.isGroup,
      groupName: session.groupName || ''
    }, extra || {}));
  }

  function clearRemoteAudios() {
    var box = $('call-remotes');
    if (box) box.innerHTML = '';
    var single = $('call-remote');
    if (single) {
      single.pause();
      single.srcObject = null;
    }
  }

  function attachRemoteAudio(peerId, stream) {
    var box = $('call-remotes');
    if (!box) {
      var single = $('call-remote');
      if (single) {
        single.srcObject = stream;
        single.play().catch(function () {});
      }
      return;
    }
    var id = 'call-remote-' + peerId;
    var audio = document.getElementById(id);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = id;
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      box.appendChild(audio);
    }
    audio.srcObject = stream;
    audio.play().catch(function () {});
  }

  function removeRemoteAudio(peerId) {
    var audio = document.getElementById('call-remote-' + peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) audio.parentNode.removeChild(audio);
    }
  }

  function groupLinkCount() {
    if (!session || !session.links) return 0;
    return Object.keys(session.links).length;
  }

  function updateGroupStatus() {
    if (!session || !session.isGroup) return;
    paintPeer(session.groupName || '群組通話');
    var n = groupLinkCount();
    if (session.phase === 'active' || session.wasActive) {
      if (!timerId) startTimer();
      return;
    }
    setStatus(n ? ('已接通 ' + n + ' 人') : (session.phase === 'ringing' ? '群組來電…' : '群組撥號中…'));
  }

  function dropGroupPeer(peerId, toastMsg) {
    if (!session || !session.isGroup || !peerId) return;
    var link = session.links[peerId];
    if (link && link.pc) {
      try { link.pc.close(); } catch (e) { /* ignore */ }
    }
    delete session.links[peerId];
    removeRemoteAudio(peerId);
    updateGroupStatus();
    if (toastMsg) PATS.toast(toastMsg);
    if (groupLinkCount() === 0 && (session.wasActive || session.phase === 'active')) {
      finish('群組通話已結束');
    }
  }

  function dialHint() {
    var url = signalingUrl();
    if (!url) return '尚未設定通話伺服器。請確認 config.js 的 signalingUrl。';
    // 日誌證實：http://192.168.x.x 非安全環境，mediaDevices 不存在
    if (!window.isSecureContext) {
      return '此網址無法使用麥克風。請改用 https://vincent1021210.github.io/ ，或本機 http://127.0.0.1:8766/（不要用 192.168 區網 IP）。';
    }
    if (isBlockedMixedContent(url)) {
      return '目前是 HTTPS 網站，無法連 HTTP 信令。請確認通話設定為 https://pats-communication-front-end.onrender.com';
    }
    if (!socket || !socket.connected) {
      return '通話伺服器未連線。請確認「通話就緒」，或開啟 ' + url + '/health';
    }
    return '';
  }

  function displayCallName(name, userId) {
    var label = String(name || '').trim();
    var id = String(userId || '').trim();
    var source = 'payload';
    if (label && label !== id) {
      // #region agent log
      dbgCall_('C', 'call.js:displayCallName', 'resolved name', {
        source: source, usedIdFallback: false, hasId: !!id
      });
      // #endregion
      return label;
    }
    try {
      var titleEl = document.querySelector('#chat-pane .chat-head .title');
      if (titleEl) {
        var t = String(titleEl.textContent || '').trim();
        if (t) {
          // #region agent log
          dbgCall_('C', 'call.js:displayCallName', 'resolved name', {
            source: 'chat-head', usedIdFallback: false, hasId: !!id
          });
          // #endregion
          return t;
        }
      }
      var list = (window.PATS && PATS.state && PATS.state.conversations) || [];
      var matched = null;
      var anyDm = null;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || c.type === 'group' || !c.title) continue;
        if (!anyDm) anyDm = c.title;
        if (id && (c.peerId === id || (c.members || []).some(function (m) { return m && m.id === id; }))) {
          matched = c.title;
          break;
        }
      }
      if (matched) {
        // #region agent log
        dbgCall_('C', 'call.js:displayCallName', 'resolved name', {
          source: 'conv-peer', usedIdFallback: false, hasId: !!id
        });
        // #endregion
        return matched;
      }
      if (anyDm) {
        // #region agent log
        dbgCall_('C', 'call.js:displayCallName', 'resolved name', {
          source: 'any-dm', usedIdFallback: false, hasId: !!id
        });
        // #endregion
        return anyDm;
      }
    } catch (e) { /* ignore */ }
    // #region agent log
    dbgCall_('C', 'call.js:displayCallName', 'resolved name', {
      source: 'fallback-對方', usedIdFallback: true, hasId: !!id,
      rawWasId: !!(label && label === id)
    });
    // #endregion
    return '對方';
  }

  /* ------------------------------------------------------------- 通話 */

  function dial(peer) {
    if (!peer || !peer.id) {
      PATS.toast('找不到這位聯絡人。', 'error');
      return;
    }
    if (peer.id === (PATS.state.user && PATS.state.user.id)) return;

    var hint = dialHint();
    if (hint) {
      PATS.toast(hint, 'error');
      return;
    }
    if (session) {
      PATS.toast('已經有一通通話進行中。', 'error');
      return;
    }

    // #region agent log
    dbgCall_('D', 'call.js:dial', 'check-peer before', {
      peerId: peer.id,
      peerName: peer.name || null,
      myId: currentUser && currentUser.id,
      signalState: signalState,
      socketConnected: !!(socket && socket.connected),
      pageHidden: !!document.hidden,
      signalingHost: (function () {
        try { return new URL(signalingUrl()).host; } catch (e) { return 'bad'; }
      })()
    });
    // #endregion
    socket.emit('check-peer', { userId: peer.id }, function (res) {
      // #region agent log
      dbgCall_('D', 'call.js:dial', 'check-peer result', {
        peerId: peer.id,
        myId: currentUser && currentUser.id,
        resOk: !!(res && res.ok),
        resOnline: !!(res && res.online),
        resRaw: res ? { ok: res.ok, online: res.online, error: res.error || null } : null,
        signalState: signalState,
        pageHidden: !!document.hidden
      });
      // #endregion
      if (!res || !res.ok || !res.online) {
        PATS.toast('對方通話未就緒。請對方打開 PATS、畫面保持在前景，並確認顯示「通話就緒」後再撥。', 'error');
        return;
      }
      startDial(peer);
    });
  }

  function startDial(peer) {
    var token = begin(peer, true);
    paintPeer(displayCallName(peer.name, peer.id));
    setStatus('撥號中…');
    setActions('dialing');
    showLayer();
    if (window.CallTones) CallTones.startDialing();

    openMedia(token).then(function () {
      if (!alive(token)) return null;
      return session.pc.createOffer();
    }).then(function (offer) {
      if (!offer || !alive(token)) return;
      emit('call-user', { offer: offer });
    }).catch(function (err) {
      if (!alive(token)) return;
      finish(err && err.message ? err.message : '無法開始通話（請允許麥克風）');
    });
  }

  function onIncoming(payload) {
    if (!payload || !payload.offer) return;

    // 群組 Mesh：已在群組通話中，收到既有成員的 offer → 直接應答
    if (session && session.isGroup && sameCall(payload) && payload.from) {
      answerGroupOffer(payload);
      return;
    }

    if (session) {
      socket.emit('reject-call', { to: payload.from, callId: payload.callId, reason: 'busy' });
      return;
    }
    // #region agent log
    dbgCall_('E', 'call.js:onIncoming', 'incoming call', {
      from: payload.from || null,
      fromName: payload.fromName || null,
      callId: payload.callId || null,
      pageHidden: !!document.hidden,
      signalState: signalState
    });
    // #endregion
    var incomingName = displayCallName(payload.fromName, payload.from);
    begin({ id: payload.from, name: incomingName }, false);
    session.callId = payload.callId;
    session.offer = payload.offer;
    paintPeer(incomingName);
    setStatus('來電…');
    setActions('ringing');
    showLayer();
    if (window.CallTones) CallTones.startRinging();
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } catch (e) { /* ignore */ }
  }

  function onIncomingGroup(payload) {
    if (!payload || !payload.callId) return;
    if (session) {
      socket.emit('group-call-reject', { callId: payload.callId });
      return;
    }
    generation += 1;
    session = {
      token: generation,
      callId: payload.callId,
      peerId: payload.from,
      isCaller: false,
      isGroup: true,
      groupName: payload.groupName || '群組通話',
      phase: 'ringing',
      pc: null,
      stream: null,
      offer: null,
      links: {},
      retried: false,
      restartTimer: null,
      networkLostTimer: null,
      wasActive: false,
      earlyIce: [],
      resolvedIce: null,
      iceSource: null
    };
    paintPeer(session.groupName);
    setStatus('群組來電…');
    setActions('ringing');
    showLayer();
    if (window.CallTones) CallTones.startRinging();
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } catch (e) { /* ignore */ }
  }

  function onGroupPeerJoined(payload) {
    if (!session || !session.isGroup || !sameCall(payload)) return;
    if (!payload.userId || payload.userId === (currentUser && currentUser.id)) return;
    // 既有成員向新人送 offer
    offerToGroupPeer(payload.userId, payload.name);
  }

  function onGroupPeerLeft(payload) {
    if (!session || !session.isGroup || !sameCall(payload)) return;
    if (payload && payload.from) dropGroupPeer(payload.from, null);
  }

  function onGroupDeclined(payload) {
    if (!session || !session.isGroup || !sameCall(payload)) return;
    var name = (payload && payload.fromName) || '成員';
    PATS.toast(name + ' 已拒絕群組通話');
  }

  function createGroupPc(peerId, name) {
    var link = session.links[peerId] || {
      pc: null,
      name: name || peerId,
      earlyIce: [],
      phase: 'connecting'
    };
    link.name = name || link.name || peerId;
    session.links[peerId] = link;
    if (link.pc) return Promise.resolve(link);

    return resolveIceServers().then(function (servers) {
      if (!session || !session.isGroup) return null;
      link.pc = WebRTCManager.create({
        iceServers: servers,
        onIceCandidate: function (candidate) {
          emit('ice-candidate', { to: peerId, candidate: candidate });
        },
        onTrack: function (remote) {
          attachRemoteAudio(peerId, remote);
          link.phase = 'active';
          if (!session.wasActive) {
            session.wasActive = true;
            session.phase = 'active';
            setActions('active');
            if (window.CallTones) CallTones.playConnected();
          }
          updateGroupStatus();
        },
        onConnectionState: function (state) {
          if (!session || !session.links[peerId]) return;
          if (state === 'failed' || state === 'closed' || state === 'disconnected') {
            if (state === 'failed' || state === 'closed') dropGroupPeer(peerId, null);
          }
        }
      });
      if (session.stream) link.pc.addStream(session.stream);
      link.earlyIce.splice(0).forEach(function (c) { link.pc.addIceCandidate(c); });
      return link;
    });
  }

  function offerToGroupPeer(peerId, name) {
    if (!session || !session.isGroup || !session.stream) return;
    createGroupPc(peerId, name).then(function (link) {
      if (!link || !link.pc || !session) return;
      return link.pc.createOffer().then(function (offer) {
        emit('call-user', { to: peerId, offer: offer, group: true, groupName: session.groupName });
      });
    }).catch(function () { /* ignore */ });
  }

  function answerGroupOffer(payload) {
    var peerId = payload.from;
    var token = session.token;
    createGroupPc(peerId, payload.fromName).then(function (link) {
      if (!link || !link.pc || !alive(token)) return null;
      return link.pc.acceptOffer(payload.offer).then(function (answer) {
        emit('accept-call', { to: peerId, answer: answer });
        updateGroupStatus();
      });
    }).catch(function () { /* ignore */ });
  }

  function dialGroup(peers, groupName) {
    if (!window.isSecureContext) {
      PATS.toast(dialHint(), 'error');
      return;
    }
    var hint = dialHint();
    if (hint) {
      PATS.toast(hint, 'error');
      return;
    }
    if (session) {
      PATS.toast('已經有一通通話進行中。', 'error');
      return;
    }
    var list = (peers || []).filter(function (p) {
      return p && p.id && (!currentUser || p.id !== currentUser.id);
    });
    if (!list.length) {
      PATS.toast('群組沒有其他可通話成員。', 'error');
      return;
    }

    var callId = newId();
    generation += 1;
    session = {
      token: generation,
      callId: callId,
      peerId: list[0].id,
      isCaller: true,
      isGroup: true,
      groupName: groupName || '群組通話',
      phase: 'dialing',
      pc: null,
      stream: null,
      offer: null,
      links: {},
      retried: false,
      restartTimer: null,
      networkLostTimer: null,
      wasActive: false,
      earlyIce: [],
      resolvedIce: null,
      iceSource: null
    };
    var token = generation;
    paintPeer(session.groupName);
    setStatus('群組撥號中…');
    setActions('dialing');
    showLayer();
    if (window.CallTones) CallTones.startDialing();

    openMedia(token).then(function () {
      if (!alive(token)) return;
      socket.emit('group-call-start', {
        callId: callId,
        groupName: session.groupName,
        memberIds: list.map(function (p) { return p.id; })
      }, function (ack) {
        if (!alive(token)) return;
        if (!ack || !ack.ok) {
          finish('無法發起群組通話');
          return;
        }
        if (!ack.rung || !ack.rung.length) {
          finish('沒有成員在線上，無法群組通話');
          return;
        }
        if (ack.offline && ack.offline.length) {
          PATS.toast('部分成員未在線，已向在線成員撥打。');
        }
        updateGroupStatus();
      });
    }).catch(function (err) {
      if (!alive(token)) return;
      finish(err && err.message ? err.message : '無法開始通話（請允許麥克風）');
    });
  }

  function accept() {
    if (!session || session.phase !== 'ringing') return;
    var token = generation;
    if (window.CallTones) CallTones.stop();
    setStatus('接通中…');
    setActions('connecting');

    if (session.isGroup) {
      openMedia(token).then(function () {
        if (!alive(token)) return;
        session.phase = 'connecting';
        socket.emit('group-call-accept', { callId: session.callId }, function (ack) {
          if (!alive(token)) return;
          if (!ack || !ack.ok) {
            finish('無法加入群組通話');
            return;
          }
          if (ack.groupName) session.groupName = ack.groupName;
          paintPeer(session.groupName || '群組通話');
          updateGroupStatus();
          // 既有成員會向我們送 offer（incoming-call）；此處只需等待
        });
      }).catch(function (err) {
        if (!alive(token)) return;
        socket.emit('group-call-reject', { callId: session.callId });
        finish(err && err.message ? err.message : '無法接聽（請允許麥克風）');
      });
      return;
    }

    var offer = session.offer;
    openMedia(token).then(function () {
      if (!alive(token)) return null;
      return session.pc.acceptOffer(offer);
    }).then(function (answer) {
      if (!answer || !alive(token)) return;
      session.phase = 'connecting';
      emit('accept-call', { answer: answer });
    }).catch(function (err) {
      if (!alive(token)) return;
      emit('reject-call', {});
      finish(err && err.message ? err.message : '無法接聽（請允許麥克風）');
    });
  }

  function reject() {
    if (!session) return;
    if (session.isGroup) {
      socket.emit('group-call-reject', { callId: session.callId });
      finish('已拒絕');
      return;
    }
    emit('reject-call', {});
    finish('已拒絕');
  }

  function hangup() {
    if (!session) return;
    if (session.isGroup) {
      Object.keys(session.links || {}).forEach(function (peerId) {
        emit('hang-up', { to: peerId });
      });
      if (socket && socket.connected) {
        socket.emit('group-call-leave', { callId: session.callId });
      }
      finish('通話已結束');
      return;
    }
    emit('hang-up', {});
    finish('通話已結束');
  }

  function toggleMute() {
    if (!session || !session.stream) return;
    muted = !muted;
    AudioStreamManager.setMuted(session.stream, muted);
    setMuteIcon();
  }

  function onAccepted(payload) {
    // #region agent log
    dbgCall_('E', 'call.js:onAccepted', 'call-accepted received', {
      sameCall: sameCall(payload),
      hasSession: !!session,
      hasPc: !!(session && session.pc),
      phase: session && session.phase,
      callId: payload && payload.callId,
      isGroup: !!(session && session.isGroup)
    });
    // #endregion
    if (!sameCall(payload) || !session) return;
    if (session.isGroup) {
      var link = payload.from && session.links[payload.from];
      if (!link || !link.pc || !payload.answer) return;
      if (window.CallTones) CallTones.stop();
      link.pc.acceptAnswer(payload.answer).then(function () {
        updateGroupStatus();
      }).catch(function () {});
      return;
    }
    if (!session.pc) return;
    if (window.CallTones) CallTones.stop();
    session.phase = 'connecting';
    setStatus('接通中…');
    setActions('connecting');
    session.pc.acceptAnswer(payload.answer).catch(function () { finish('無法建立通話'); });
  }

  function onRenegotiate(payload) {
    if (!sameCall(payload) || !session || !session.pc || session.isCaller) return;
    session.pc.acceptOffer(payload.offer).then(function (answer) {
      emit('renegotiate-answer', { answer: answer });
    }).catch(function () { finish('重新連線失敗'); });
  }

  function bindCallPresence() {
    if (!socket || !socket.connected || !session || !session.peerId) return;
    socket.emit('call-bind', { peerId: session.peerId, callId: session.callId });
  }

  function unbindCallPresence() {
    if (!socket || !socket.connected) return;
    try { socket.emit('call-unbind', {}); } catch (e) { /* ignore */ }
  }

  function clearNetworkLostWatch() {
    if (session && session.networkLostTimer) {
      clearTimeout(session.networkLostTimer);
      session.networkLostTimer = null;
    }
  }

  function scheduleNetworkLostWatch() {
    if (!session || session.networkLostTimer) return;
    session.networkLostTimer = setTimeout(function () {
      if (!session) return;
      session.networkLostTimer = null;
      if (session.wasActive || session.phase === 'active') {
        finish('對方網路已斷線');
      }
    }, 8000);
  }

  function markActive() {
    if (!session || session.phase === 'active') return;
    session.phase = 'active';
    session.wasActive = true;
    clearNetworkLostWatch();
    setActions('active');
    startTimer();
    bindCallPresence();
    if (window.CallTones) CallTones.playConnected();
  }

  function onConnectionState(state) {
    if (!session) return;
    // #region agent log
    dbgCall_('B', 'call.js:onConnectionState', 'call connection state', {
      state: state,
      isCaller: !!(session && session.isCaller),
      retried: !!(session && session.retried),
      phase: session && session.phase,
      wasActive: !!(session && session.wasActive)
    });
    // #endregion
    if (state === 'connected' || state === 'completed') {
      markActive();
      return;
    }
    if (state === 'disconnected') {
      setStatus('連線不穩，正在重新連線…');
      if (session.wasActive || session.phase === 'active') scheduleNetworkLostWatch();
      scheduleRestart();
      return;
    }
    if (state === 'failed') {
      if (session.wasActive || session.phase === 'active') {
        if (session.retried) {
          finish('對方網路已斷線');
          return;
        }
      }
      restart();
    }
  }

  function scheduleRestart() {
    if (!session || session.restartTimer) return;
    session.restartTimer = setTimeout(function () {
      if (session) session.restartTimer = null;
      restart();
    }, 3000);
  }

  function restart() {
    if (!session || !session.pc) return;
    var ice = iceServers();
    // #region agent log
    dbgCall_('E', 'call.js:restart', 'ice restart path', {
      alreadyRetried: !!session.retried,
      isCaller: !!session.isCaller,
      iceServerCount: (ice || []).length,
      hasTurn: hasTurnUrl_(ice),
      urlKinds: urlKinds_(ice),
      iceSource: session.iceSource || null,
      wasActive: !!session.wasActive
    }, session.retried ? 'post-fix' : 'pre-fix');
    // #endregion
    if (session.retried) {
      finish(
        session.wasActive
          ? '對方網路已斷線'
          : '目前無法建立語音連線（不同網路／4G 常見）。已設定 TURN 中繼，若仍失敗可能是配額或網路阻擋；請雙方開同一 Wi‑Fi 再試，或稍後自架 TURN。'
      );
      return;
    }
    session.retried = true;
    setStatus('正在重新連線…');
    if (session.isCaller) {
      session.pc.restartIce().then(function (offer) {
        emit('renegotiate', { offer: offer });
      }).catch(function () {
        finish(session && session.wasActive ? '對方網路已斷線' : '重新連線失敗');
      });
    } else {
      emit('request-restart', {});
    }
  }

  function openMedia(token) {
    return AudioStreamManager.getStream().then(function (stream) {
      if (!alive(token)) {
        AudioStreamManager.stop(stream);
        return;
      }
      session.stream = stream;
      return resolveIceServers().then(function (servers) {
        if (!alive(token)) {
          AudioStreamManager.stop(stream);
          return;
        }
        // #region agent log
        dbgCall_('A', 'call.js:openMedia', 'openMedia ice config', {
          isCaller: !!(session && session.isCaller),
          isGroup: !!(session && session.isGroup),
          iceUrls: (servers || []).map(function (s) {
            return typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
          }),
          hasTurn: hasTurnUrl_(servers),
          urlKinds: urlKinds_(servers),
          pageHost: location.host,
          pageProto: location.protocol
        }, 'post-fix');
        // #endregion
        // 群組通話：只準備麥克風與 ICE，PeerConnection 按成員分別建立
        if (session.isGroup) {
          muted = false;
          setMuteIcon();
          return;
        }
        session.pc = WebRTCManager.create({
          iceServers: servers,
          onIceCandidate: function (candidate) {
            // #region agent log
            dbgCall_('D', 'call.js:onIceCandidate', 'emit ice-candidate', {
              hasSocket: !!socket,
              signalState: signalState
            });
            // #endregion
            emit('ice-candidate', { candidate: candidate });
          },
          onTrack: function (remote) {
            var audio = $('call-remote');
            audio.srcObject = remote;
            audio.play().catch(function () {});
          },
          onConnectionState: onConnectionState
        });
        session.pc.addStream(stream);
        var queued = session.earlyIce.splice(0);
        queued.forEach(function (candidate) {
          session.pc.addIceCandidate(candidate);
        });
        muted = false;
        setMuteIcon();
      });
    });
  }

  function begin(peer, isCaller) {
    generation += 1;
    session = {
      token: generation,
      callId: isCaller ? newId() : '',
      peerId: peer.id,
      isCaller: isCaller,
      phase: isCaller ? 'dialing' : 'ringing',
      pc: null,
      stream: null,
      offer: null,
      retried: false,
      restartTimer: null,
      networkLostTimer: null,
      wasActive: false,
      earlyIce: [],
      resolvedIce: null,
      iceSource: null
    };
    return generation;
  }

  function alive(token) {
    return session && session.token === token;
  }

  function finish(message) {
    // #region agent log
    dbgCall_('E', 'call.js:finish', 'call finish', {
      message: message || null,
      wasCaller: !!(session && session.isCaller),
      phase: session && session.phase,
      wasActive: !!(session && session.wasActive),
      callId: session && session.callId,
      peerId: session && session.peerId,
      pageHidden: !!document.hidden,
      socketConnected: !!(socket && socket.connected),
      signalState: signalState
    });
    // #endregion
    var hadSession = !!session;
    var wasGroup = !!(session && session.isGroup);
    var groupCallId = session && session.callId;
    generation += 1;
    stopTimer();
    unbindCallPresence();
    if (session) {
      if (wasGroup && socket && socket.connected && groupCallId) {
        try { socket.emit('group-call-leave', { callId: groupCallId }); } catch (e) { /* ignore */ }
      }
      if (session.restartTimer) clearTimeout(session.restartTimer);
      clearNetworkLostWatch();
      if (session.links) {
        Object.keys(session.links).forEach(function (id) {
          try {
            if (session.links[id].pc) session.links[id].pc.close();
          } catch (e2) { /* ignore */ }
        });
      }
      if (session.pc) session.pc.close();
      AudioStreamManager.stop(session.stream);
    }
    session = null;
    muted = false;
    clearRemoteAudios();
    hideLayer();
    if (hadSession && window.CallTones) CallTones.playEnded();
    if (message) {
      var tone = /斷線|中斷|失敗|無法|拒絕|不在/.test(message) ? 'error' : undefined;
      PATS.toast(message, tone);
    }
  }

  function newId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function bind() {
    $('call-accept').addEventListener('click', accept);
    $('call-reject').addEventListener('click', reject);
    $('call-hangup').addEventListener('click', hangup);
    $('call-mute').addEventListener('click', toggleMute);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  return {
    connect: connect,
    disconnect: disconnect,
    dial: dial,
    dialGroup: dialGroup,
    signalingUrl: signalingUrl,
    setSignalingUrl: setSignalingUrl,
    signalState: function () { return signalState; },
    onSignalChange: onSignalChange,
    isConnected: function () { return !!(socket && socket.connected); }
  };
})();
