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
  function dbgCall_(hypothesisId, location, message, data) {
    var entry = {
      sessionId: 'b641af',
      runId: 'pre-fix',
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

  function iceServers() {
    var configured = PATS.state.config.iceServers;
    if (configured && configured.length) return configured;
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
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
      setStatus((min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec);
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
        userId: currentUser && currentUser.id
      });
      // #endregion
      setSignalState('offline');
      scheduleReconnect();
    });
    socket.on('connect_error', function () {
      setSignalState('offline');
      scheduleReconnect();
    });

    socket.on('incoming-call', onIncoming);
    socket.on('call-accepted', onAccepted);
    socket.on('call-rejected', function () { finish('對方已拒絕'); });
    socket.on('hung-up', function () { finish('通話已結束'); });
    socket.on('call-failed', function (payload) {
      if (payload && payload.reason === 'offline') finish('對方不在線上');
    });
    socket.on('ice-candidate', function (payload) {
      if (!sameCall(payload) || !session || !payload.candidate) return;
      if (!session.pc) {
        session.earlyIce.push(payload.candidate);
        return;
      }
      session.pc.addIceCandidate(payload.candidate);
    });
    socket.on('renegotiate', onRenegotiate);
    socket.on('renegotiate-answer', function (payload) {
      if (!sameCall(payload) || !session || !session.pc) return;
      session.pc.acceptAnswer(payload.answer).catch(function () { finish('重新連線失敗'); });
    });
    socket.on('request-restart', function (payload) {
      if (!sameCall(payload) || !session || !session.isCaller) return;
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
    socket.emit(event, Object.assign({ to: session.peerId, callId: session.callId }, extra || {}));
  }

  function dialHint() {
    var url = signalingUrl();
    if (!url) return '尚未設定通話伺服器。請到「設定 → 通話」填入信令網址。';
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
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } catch (e) { /* ignore */ }
  }

  function accept() {
    if (!session || session.phase !== 'ringing') return;
    var token = generation;
    var offer = session.offer;
    setStatus('接通中…');
    setActions('connecting');

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
    emit('reject-call', {});
    finish('已拒絕');
  }

  function hangup() {
    if (!session) return;
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
      callId: payload && payload.callId
    });
    // #endregion
    if (!sameCall(payload) || !session || !session.pc) return;
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

  function markActive() {
    if (!session || session.phase === 'active') return;
    session.phase = 'active';
    setActions('active');
    startTimer();
  }

  function onConnectionState(state) {
    if (!session) return;
    // #region agent log
    dbgCall_('B', 'call.js:onConnectionState', 'call connection state', {
      state: state,
      isCaller: !!(session && session.isCaller),
      retried: !!(session && session.retried),
      phase: session && session.phase
    });
    // #endregion
    if (state === 'connected' || state === 'completed') {
      markActive();
      return;
    }
    if (state === 'disconnected') {
      setStatus('連線不穩，正在重新連線…');
      scheduleRestart();
      return;
    }
    if (state === 'failed') restart();
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
    // #region agent log
    dbgCall_('E', 'call.js:restart', 'ice restart path', {
      alreadyRetried: !!session.retried,
      isCaller: !!session.isCaller,
      iceServerCount: (iceServers() || []).length,
      hasTurn: (iceServers() || []).some(function (s) {
        var u = typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
        return /turn:/i.test(u);
      })
    });
    // #endregion
    if (session.retried) {
      finish('目前無法建立語音連線（不同網路／4G 常見）。請雙方開同一 Wi‑Fi 再試，或稍後架設 TURN。');
      return;
    }
    session.retried = true;
    setStatus('正在重新連線…');
    if (session.isCaller) {
      session.pc.restartIce().then(function (offer) {
        emit('renegotiate', { offer: offer });
      }).catch(function () { finish('重新連線失敗'); });
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
      // #region agent log
      dbgCall_('A', 'call.js:openMedia', 'openMedia ice config', {
        isCaller: !!(session && session.isCaller),
        iceUrls: (iceServers() || []).map(function (s) {
          return typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
        }),
        pageHost: location.host,
        pageProto: location.protocol
      });
      // #endregion
      session.pc = WebRTCManager.create({
        iceServers: iceServers(),
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
      earlyIce: []
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
      callId: session && session.callId,
      peerId: session && session.peerId,
      pageHidden: !!document.hidden,
      socketConnected: !!(socket && socket.connected),
      signalState: signalState
    });
    // #endregion
    generation += 1;
    stopTimer();
    if (session) {
      if (session.restartTimer) clearTimeout(session.restartTimer);
      if (session.pc) session.pc.close();
      AudioStreamManager.stop(session.stream);
    }
    session = null;
    muted = false;
    var audio = $('call-remote');
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    hideLayer();
    if (message) PATS.toast(message);
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
    signalingUrl: signalingUrl,
    setSignalingUrl: setSignalingUrl,
    signalState: function () { return signalState; },
    onSignalChange: onSignalChange,
    isConnected: function () { return !!(socket && socket.connected); }
  };
})();
