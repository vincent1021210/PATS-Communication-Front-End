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

  /** Android APP：把 WebRTC 聲音切到通訊模式＋喇叭，否則常走聽筒幾乎聽不到 */
  function nativeCallAudio(action, opts) {
    try {
      if (!window.PATS || !PATS.isNativeApp || !PATS.nativePlugin) return;
      var plugin = PATS.nativePlugin('CallAudio');
      if (!plugin || typeof plugin[action] !== 'function') return;
      plugin[action](opts || {}).catch(function () { /* 舊版 APK 沒此外掛 */ });
    } catch (e) { /* ignore */ }
  }

  function showLayer() {
    $('call-layer').classList.remove('hidden');
    // 視訊／語音都預設外放；之後若加「聽筒」鍵可改 setSpeaker
    nativeCallAudio('start', { speaker: true });
  }
  function hideLayer() {
    $('call-layer').classList.add('hidden');
    nativeCallAudio('stop');
  }

  /** 把遠端串流掛到 <audio>／視訊元素；APP 上視訊改靜音、聲音走 audio，避免 WebView 擋影音自動播放 */
  function playRemoteStream(stream) {
    if (!stream) return;
    var audio = $('call-remote');
    var remoteVideo = $('call-remote-video');
    var isVideo = !!(session && session.media === 'video');
    var native = !!(window.PATS && PATS.isNativeApp);

    if (isVideo && remoteVideo) {
      if (remoteVideo.srcObject !== stream) remoteVideo.srcObject = stream;
      $('call-layer').classList.toggle('has-remote-video', stream.getVideoTracks().length > 0);
      if (native && audio) {
        remoteVideo.muted = true;
        audio.srcObject = stream;
        audio.muted = false;
        audio.volume = 1;
        audio.play().catch(function () {});
        remoteVideo.play().catch(function () {});
      } else {
        remoteVideo.muted = false;
        playRemoteVideo();
      }
      return;
    }

    if (audio) {
      audio.srcObject = stream;
      audio.muted = false;
      audio.volume = 1;
      audio.play().catch(function () {});
    }
  }

  function setStatus(text) { $('call-status').textContent = text; }

  function setActions(mode) {
    if (session) session.actionMode = mode;
    var videoRinging = mode === 'ringing' && !!(session && session.media === 'video');
    var accept = $('call-accept');
    accept.classList.toggle('hidden', mode !== 'ringing');
    accept.querySelector('.material-symbols-outlined').textContent = videoRinging ? 'videocam' : 'call';
    accept.setAttribute('aria-label', videoRinging ? '視訊接聽' : '接聽');
    var acceptAudio = $('call-accept-audio');
    if (acceptAudio) acceptAudio.classList.toggle('hidden', !videoRinging);
    $('call-reject').classList.toggle('hidden', mode !== 'ringing');
    $('call-hangup').classList.toggle('hidden', mode === 'ringing' || mode === 'idle');
    var inCall = mode === 'active' || mode === 'dialing' || mode === 'connecting';
    $('call-mute').classList.toggle('hidden', !inCall);
    var canVideo = inCall && !!(session && session.media === 'video' && session.sendVideo);
    var cam = $('call-camera');
    if (cam) cam.classList.toggle('hidden', !canVideo);
    var flip = $('call-flip');
    if (flip) flip.classList.toggle('hidden', !canVideo || !(session && session.canFlip));
    $('call-layer').classList.toggle('is-preview', mode !== 'active');
  }

  function setCameraIcon() {
    var cam = $('call-camera');
    if (!cam) return;
    var on = !!(session && session.camOn);
    cam.querySelector('.material-symbols-outlined').textContent = on ? 'videocam' : 'videocam_off';
    cam.setAttribute('aria-label', on ? '關閉鏡頭' : '開啟鏡頭');
    cam.classList.toggle('is-off', !on);
  }

  function currentActionMode() {
    return (session && session.actionMode) || 'idle';
  }

  /* ---------------------------------------------------------- 視訊畫面 */

  function setVideoMode(on) {
    $('call-layer').classList.toggle('is-video', !!on);
  }

  function showLocalVideo(stream) {
    var local = $('call-local-video');
    if (!local) return;
    var has = AudioStreamManager.hasVideo(stream);
    var show = has && !!(session && session.camOn);
    local.classList.toggle('hidden', !show);
    local.classList.toggle('is-back', !!(session && session.facing === 'environment'));
    if (local.srcObject !== (has ? stream : null)) local.srcObject = has ? stream : null;
    if (show) local.play().catch(function () {});
  }

  function setRemoteNote(text) {
    var note = $('call-remote-note');
    $('call-layer').classList.toggle('remote-cam-off', !!text);
    if (!note) return;
    note.textContent = text || '';
    note.classList.toggle('hidden', !text);
  }

  function playMedia(el) {
    if (!el || !el.srcObject) return;
    el.play().then(function () {
      $('call-layer').classList.remove('needs-tap');
    }).catch(function () {
      // iOS 等瀏覽器擋自動播放時，請使用者點一下畫面
      $('call-layer').classList.add('needs-tap');
    });
  }

  function playRemoteVideo() {
    playMedia($('call-remote-video'));
  }

  function attachRemoteVideo(stream, track) {
    var remote = $('call-remote-video');
    if (!remote) return;
    if (remote.srcObject !== stream) remote.srcObject = stream;
    var hasVideo = stream.getVideoTracks().length > 0 || !!(track && track.kind === 'video');
    $('call-layer').classList.toggle('has-remote-video', hasVideo);
    playRemoteVideo();
  }

  function clearVideos() {
    ['call-remote-video', 'call-local-video'].forEach(function (id) {
      var v = $(id);
      if (!v) return;
      v.pause();
      v.srcObject = null;
    });
    var local = $('call-local-video');
    if (local) local.classList.add('hidden');
    var remote = $('call-remote-video');
    if (remote) remote.classList.remove('is-contain');
    setRemoteNote('');
    clearGroupVideo();
    $('call-layer').classList.remove('is-video', 'has-remote-video', 'needs-tap', 'is-preview');
  }

  /* ---------------------------------------------------------- 鏡頭控制 */

  function sendMediaState(extra) {
    if (!session || session.media !== 'video' || !session.sendVideo) return;
    if (session.phase === 'ringing' || !session.stream) return;
    var state = Object.assign({ video: !!session.camOn }, extra || {});
    if (session.isGroup) {
      Object.keys(session.links || {}).forEach(function (peerId) {
        emit('media-state', Object.assign({ to: peerId }, state));
      });
      return;
    }
    emit('media-state', state);
  }

  function toggleCamera() {
    if (!session || !session.stream || !session.sendVideo) return;
    session.camOn = !session.camOn;
    session.stream.getVideoTracks().forEach(function (t) { t.enabled = session.camOn; });
    setCameraIcon();
    showLocalVideo(session.stream);
    sendMediaState();
  }

  function flipCamera() {
    if (!session || !session.stream || !session.sendVideo || session.flipping) return;
    var token = session.token;
    var stream = session.stream;
    var old = stream.getVideoTracks()[0];
    var from = session.facing || 'user';
    var next = from === 'environment' ? 'user' : 'environment';
    session.flipping = true;
    // iOS 必須先停掉舊鏡頭才能開新的
    if (old) old.stop();

    function useTrack(track, facing) {
      if (!alive(token)) {
        track.stop();
        return;
      }
      track.enabled = !!session.camOn;
      if (old) stream.removeTrack(old);
      stream.addTrack(track);
      session.facing = facing;
      allPcs().forEach(function (pc) { pc.replaceVideoTrack(track).catch(function () {}); });
      var local = $('call-local-video');
      if (local) local.srcObject = null;
      showLocalVideo(stream);
    }

    AudioStreamManager.getVideoTrack({ facingMode: next }).then(function (track) {
      useTrack(track, next);
    }).catch(function () {
      PATS.toast('無法切換鏡頭。', 'error');
      return AudioStreamManager.getVideoTrack({ facingMode: from }).then(function (track) {
        useTrack(track, from);
      });
    }).catch(function () {
      if (alive(token)) PATS.toast('鏡頭無法使用。', 'error');
    }).then(function () {
      if (alive(token)) session.flipping = false;
    });
  }

  function onMediaState(payload) {
    if (!sameCall(payload) || !session || typeof payload.video !== 'boolean') return;
    if (session.isGroup) {
      setTileNote(payload.from, payload.video ? '' : (payload.reason === 'background' ? '已暫停視訊' : '已關閉鏡頭'));
      return;
    }
    if (payload.video) {
      setRemoteNote('');
      playRemoteVideo();
      return;
    }
    setRemoteNote(payload.reason === 'background' ? '對方已暫停視訊' : '對方已關閉鏡頭');
  }

  function onStageClick() {
    if ($('call-layer').classList.contains('needs-tap')) {
      playRemoteVideo();
      var grid = $('call-grid');
      if (grid) Array.prototype.forEach.call(grid.querySelectorAll('video'), playMedia);
      return;
    }
    if (session && session.isGroup) return;
    var remote = $('call-remote-video');
    if (remote && remote.srcObject) remote.classList.toggle('is-contain');
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
        setStatus(groupParticipantCount() + ' 人 · ' + clock);
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
      // 手機切到背景時瀏覽器會暫停鏡頭，先通知對方，避免畫面卡在最後一格
      if (document.hidden) {
        if (window.PATS && PATS.isDesktopApp) return;
        sendMediaState({ video: false, reason: 'background' });
        return;
      }
      sendMediaState();
      ensureSignalPresence();
    });
    window.addEventListener('pageshow', function () { ensureSignalPresence(); });
    window.addEventListener('focus', function () { ensureSignalPresence(); });
  }

  function registerSelf() {
    if (!socket || !currentUser) return;
    var displayName = currentUser.displayName || currentUser.username ||
      currentUser.email || currentUser.id;
    socket.emit('register', {
      userId: currentUser.id,
      name: displayName
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
      registerSelf();
    });
    socket.on('disconnect', function (reason) {
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
      if (session && session.isGroup) {
        // 群組：只拆與離開者的連線；是否結束整通交由 group-peer-left（含 remaining）
        if (payload && payload.from) dropGroupPeer(payload.from, null);
        return;
      }
      finish('通話已結束');
    });
    socket.on('peer-network-lost', function (payload) {
      if (!session) return;
      if (session.isGroup && payload && payload.from) {
        dropGroupPeer(payload.from, null);
        // 信令斷線時可能沒有 group-peer-left；若還有其他 link 就繼續
        if (groupLinkCount() === 0 && (session.wasActive || session.phase === 'active')) {
          finish('群組通話已結束（已無其他成員）');
        } else {
          updateGroupStatus();
        }
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
    socket.on('media-state', onMediaState);
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
      groupName: session.groupName || '',
      media: session.media || 'audio'
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
      playRemoteStream(stream);
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
    audio.muted = false;
    audio.volume = 1;
    audio.play().catch(function () {});
    // 群組通話也要切到通訊音訊模式（showLayer 已呼叫；這裡再保險一次）
    nativeCallAudio('start', { speaker: true });
  }

  function removeRemoteAudio(peerId) {
    var audio = document.getElementById('call-remote-' + peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      if (audio.parentNode) audio.parentNode.removeChild(audio);
    }
  }

  /* ------------------------------------------------------ 群組視訊格子 */

  function allPcs() {
    if (!session) return [];
    if (!session.isGroup) return session.pc ? [session.pc] : [];
    return Object.keys(session.links || {}).map(function (id) {
      return session.links[id].pc;
    }).filter(Boolean);
  }

  /** 每份畫面 min(300 kbps, 1.2 Mbps ÷ 其他人數)，最低 150 kbps，讓每人總上傳約維持在 1.2 Mbps 內 */
  function applyGroupBitrate() {
    if (!session || !session.isGroup || !session.sendVideo) return;
    var others = Math.max(1, groupParticipantCount() - 1);
    var bps = Math.max(150000, Math.min(300000, Math.floor(1200000 / others)));
    allPcs().forEach(function (pc) { pc.capVideoBitrate(bps, 15); });
  }

  function setGroupVideoMode(on) {
    setVideoMode(on);
    $('call-layer').classList.toggle('is-group-video', !!on);
  }

  function groupTile(peerId) {
    return document.getElementById('call-tile-' + peerId);
  }

  function attachGroupVideo(peerId, stream) {
    var grid = $('call-grid');
    if (!grid || !session) return;
    var link = session.links[peerId];
    var name = (link && link.name) || '成員';
    var tile = groupTile(peerId);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'call-tile';
      tile.id = 'call-tile-' + peerId;
      var video = document.createElement('video');
      video.autoplay = true;
      video.setAttribute('playsinline', '');
      ['call-tile-avatar', 'call-tile-name', 'call-tile-note hidden'].forEach(function (cls) {
        var div = document.createElement('div');
        div.className = cls;
        tile.appendChild(div);
      });
      tile.insertBefore(video, tile.firstChild);
      grid.appendChild(tile);
    }
    tile.querySelector('.call-tile-avatar').textContent = PATS.initials(name);
    tile.querySelector('.call-tile-name').textContent = name;
    var v = tile.querySelector('video');
    if (v.srcObject !== stream) v.srcObject = stream;
    // 格子裡的 <video> 會播放聲音，不再另外用隱藏的 <audio>
    removeRemoteAudio(peerId);
    playMedia(v);
    if (session.tileNotes && session.tileNotes[peerId]) setTileNote(peerId, session.tileNotes[peerId]);
    layoutGroupVideo();
  }

  function removeGroupTile(peerId) {
    var tile = groupTile(peerId);
    if (!tile) return;
    var v = tile.querySelector('video');
    if (v) {
      v.pause();
      v.srcObject = null;
    }
    if (tile.parentNode) tile.parentNode.removeChild(tile);
    layoutGroupVideo();
  }

  function setTileNote(peerId, text) {
    if (!peerId || !session) return;
    session.tileNotes = session.tileNotes || {};
    session.tileNotes[peerId] = text || '';
    var tile = groupTile(peerId);
    if (!tile) return;
    tile.classList.toggle('cam-off', !!text);
    var note = tile.querySelector('.call-tile-note');
    note.textContent = text || '';
    note.classList.toggle('hidden', !text);
  }

  /** 1 位對方全螢幕、2 位分割、3 位 2×2（自己補第 4 格）；語音成員列在下方 */
  function layoutGroupVideo() {
    var grid = $('call-grid');
    if (!grid || !session || !session.isGroup) return;
    var count = grid.children.length;
    grid.setAttribute('data-count', String(count));
    var layer = $('call-layer');
    layer.classList.toggle('has-remote-video', count > 0);
    layer.classList.toggle('grid-4', count >= 3);
    var strip = $('call-audio-strip');
    if (!strip) return;
    strip.innerHTML = '';
    Object.keys(session.links || {}).forEach(function (id) {
      var link = session.links[id];
      if (link.phase !== 'active' || groupTile(id)) return;
      var chip = document.createElement('span');
      chip.className = 'call-chip';
      chip.textContent = link.name || '成員';
      strip.appendChild(chip);
    });
    strip.classList.toggle('hidden', !strip.children.length);
  }

  function clearGroupVideo() {
    var grid = $('call-grid');
    if (grid) {
      Array.prototype.forEach.call(grid.querySelectorAll('video'), function (v) {
        v.pause();
        v.srcObject = null;
      });
      grid.innerHTML = '';
      grid.setAttribute('data-count', '0');
    }
    var strip = $('call-audio-strip');
    if (strip) {
      strip.innerHTML = '';
      strip.classList.add('hidden');
    }
    $('call-layer').classList.remove('is-group-video', 'grid-4');
  }

  function groupLinkCount() {
    if (!session || !session.links) return 0;
    return Object.keys(session.links).length;
  }

  /** 畫面顯示的通話人數（含自己） */
  function groupParticipantCount() {
    if (!session || !session.isGroup) return 0;
    if (typeof session.roomCount === 'number' && session.roomCount > 0) {
      return session.roomCount;
    }
    // links = 已連上的對方；再加自己
    return groupLinkCount() + 1;
  }

  function setGroupRoomCount(count) {
    if (!session || !session.isGroup) return;
    var n = Number(count);
    if (!isFinite(n) || n < 1) n = 1;
    session.roomCount = n;
  }

  function updateGroupStatus() {
    if (!session || !session.isGroup) return;
    paintPeer(session.groupName || '群組通話');
    var n = groupParticipantCount();
    if (session.phase === 'active' || session.wasActive) {
      if (!timerId) startTimer();
      return;
    }
    var video = session.media === 'video';
    if (session.phase === 'ringing') {
      setStatus(video ? '群組視訊來電…' : '群組來電…');
      return;
    }
    setStatus(n > 1 ? ('通話中 ' + n + ' 人') : (video ? '群組視訊撥號中…' : '群組撥號中…'));
  }

  function dropGroupPeer(peerId, toastMsg) {
    if (!session || !session.isGroup || !peerId) return;
    var link = session.links[peerId];
    if (link && link.pc) {
      try { link.pc.close(); } catch (e) { /* ignore */ }
    }
    delete session.links[peerId];
    if (session.tileNotes) delete session.tileNotes[peerId];
    removeRemoteAudio(peerId);
    removeGroupTile(peerId);
    layoutGroupVideo();
    updateGroupStatus();
    if (toastMsg) PATS.toast(toastMsg);
    // 不在此結束整通群組通話：其餘成員應可繼續
  }

  /** 與仍在房間內、尚未連線的成員補建 Mesh */
  function ensureGroupMesh(remaining) {
    if (!session || !session.isGroup || !session.stream) return;
    var me = currentUser && currentUser.id;
    (remaining || []).forEach(function (peer) {
      var id = peer && (peer.id || peer);
      var name = peer && peer.name;
      if (!id || id === me) return;
      if (session.links[id] && session.links[id].pc) return;
      // 用 userId 排序決定誰送 offer，避免雙方同時 offer 撞車
      if (me && String(me) > String(id)) return;
      offerToGroupPeer(id, name);
    });
  }

  function endGroupIfAlone(remaining) {
    if (!session || !session.isGroup) return;
    var me = currentUser && currentUser.id;
    var others = (remaining || []).filter(function (peer) {
      var id = peer && (peer.id || peer);
      return id && id !== me;
    });
    if (others.length === 0 && (session.wasActive || session.phase === 'active' || session.phase === 'connecting')) {
      finish('群組通話已結束（已無其他成員）');
    } else {
      ensureGroupMesh(others);
      updateGroupStatus();
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
    if (label && label !== id) return label;
    try {
      var titleEl = document.querySelector('#chat-pane .chat-head .title');
      if (titleEl) {
        var t = String(titleEl.textContent || '').trim();
        if (t) {
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
        return matched;
      }
      if (anyDm) {
        return anyDm;
      }
    } catch (e) { /* ignore */ }
    return '對方';
  }

  /* ------------------------------------------------------------- 通話 */

  function dial(peer, options) {
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

    socket.emit('check-peer', { userId: peer.id }, function (res) {
      if (!res || !res.ok || !res.online) {
        PATS.toast('對方通話未就緒。請對方打開 PATS、畫面保持在前景，並確認顯示「通話就緒」後再撥。', 'error');
        return;
      }
      startDial(peer, options);
    });
  }

  function startDial(peer, options) {
    var video = !!(options && options.video);
    var token = begin(peer, true, video ? 'video' : 'audio');
    paintPeer(displayCallName(peer.name, peer.id));
    setStatus(video ? '視訊撥號中…' : '撥號中…');
    setActions('dialing');
    setVideoMode(video);
    showLayer();
    if (window.CallTones) CallTones.startDialing();

    openMedia(token).then(function () {
      if (!alive(token)) return null;
      return session.pc.createOffer();
    }).then(function (offer) {
      if (!offer || !alive(token)) return;
      applyVideoBitrate();
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
    var incomingName = displayCallName(payload.fromName, payload.from);
    var incomingMedia = payload.media === 'video' ? 'video' : 'audio';
    begin({ id: payload.from, name: incomingName }, false, incomingMedia);
    session.callId = payload.callId;
    session.offer = payload.offer;
    paintPeer(incomingName);
    setStatus(incomingMedia === 'video' ? '視訊來電…' : '來電…');
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
    // 鏡頭是否真的開，接聽時再依伺服器名額決定
    Object.assign(session, mediaFields(payload.media === 'video'));
    paintPeer(session.groupName);
    setStatus(session.media === 'video' ? '群組視訊來電…' : '群組來電…');
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
    setGroupRoomCount(Math.max(groupParticipantCount() + 1, groupLinkCount() + 2));
    updateGroupStatus();
    // 既有成員向新人送 offer
    offerToGroupPeer(payload.userId, payload.name);
  }

  function onGroupPeerLeft(payload) {
    if (!session || !session.isGroup || !sameCall(payload)) return;
    if (payload && payload.from) dropGroupPeer(payload.from, null);
    if (payload && payload.remaining) {
      setGroupRoomCount(payload.remaining.length);
    }
    endGroupIfAlone(payload && payload.remaining);
    applyGroupBitrate();
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
          if (session.media === 'video' && remote.getVideoTracks().length) {
            attachGroupVideo(peerId, remote);
          } else if (!groupTile(peerId)) {
            attachRemoteAudio(peerId, remote);
          }
          if (link.phase !== 'active' && session.sendVideo && !session.camOn) {
            emit('media-state', { to: peerId, video: false });
          }
          link.phase = 'active';
          layoutGroupVideo();
          setGroupRoomCount(Math.max(groupParticipantCount(), groupLinkCount() + 1));
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
          // 單一連線失敗只移除該成員，不結束整通群組通話
          if (state === 'failed' || state === 'closed') {
            dropGroupPeer(peerId, null);
            if (groupLinkCount() === 0 && (session.wasActive || session.phase === 'active')) {
              finish('群組通話已結束（已無其他成員）');
            } else {
              updateGroupStatus();
            }
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
      // 自己是語音成員時也要在 offer 留影像欄位，對方的畫面才傳得過來
      var extra = session.media === 'video' ? { offerToReceiveAudio: true, offerToReceiveVideo: true } : undefined;
      return link.pc.createOffer(extra).then(function (offer) {
        emit('call-user', { to: peerId, offer: offer, group: true, groupName: session.groupName });
        applyGroupBitrate();
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
        applyGroupBitrate();
        updateGroupStatus();
      });
    }).catch(function () { /* ignore */ });
  }

  function dialGroup(peers, groupName, options) {
    options = options || {};
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
    Object.assign(session, mediaFields(!!options.video));
    var token = generation;
    paintPeer(session.groupName);
    setStatus(session.media === 'video' ? '群組視訊撥號中…' : '群組撥號中…');
    setGroupVideoMode(session.media === 'video');
    setActions('dialing');
    showLayer();
    if (window.CallTones) CallTones.startDialing();

    openMedia(token).then(function () {
      if (!alive(token)) return;
      socket.emit('group-call-start', {
        callId: callId,
        groupName: session.groupName,
        memberIds: list.map(function (p) { return p.id; }),
        media: session.media,
        hostVideo: !!session.sendVideo
      }, function (ack) {
        if (!alive(token)) return;
        if (!ack || !ack.ok) {
          finish('無法發起群組通話');
          return;
        }
        // 即使暫時無人在線，仍建立房間並送出聊天邀請按鈕，供稍後加入
        if (ack.offline && ack.offline.length) {
          PATS.toast(ack.rung && ack.rung.length
            ? '部分成員未在線，已向在線成員撥打。'
            : '成員目前未在線；已在群組送出「進入群組通話」邀請。');
        }
        updateGroupStatus();
        if (typeof options.onStarted === 'function') {
          try { options.onStarted(callId, session.groupName); } catch (e) { /* ignore */ }
        }
      });
    }).catch(function (err) {
      if (!alive(token)) return;
      finish(err && err.message ? err.message : '無法開始通話（請允許麥克風）');
    });
  }

  /** 從聊天室邀請按鈕加入進行中的群組通話 */
  function joinGroupCall(callId, groupName) {
    callId = String(callId || '').trim();
    if (!callId) {
      PATS.toast('無效的群組通話邀請。', 'error');
      return;
    }
    if (!window.isSecureContext) {
      PATS.toast(dialHint() || '此環境無法使用麥克風。', 'error');
      return;
    }
    var hint = dialHint();
    if (hint) {
      PATS.toast(hint, 'error');
      return;
    }
    if (session) {
      if (session.isGroup && session.callId === callId) {
        PATS.toast('你已在此群組通話中。');
        showLayer();
        return;
      }
      PATS.toast('已經有一通通話進行中。', 'error');
      return;
    }

    generation += 1;
    session = {
      token: generation,
      callId: callId,
      peerId: '',
      isCaller: false,
      isGroup: true,
      groupName: groupName || '群組通話',
      phase: 'connecting',
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
    // 邀請卡只有 callId，語音或視訊由 probe 回覆決定
    Object.assign(session, mediaFields(false));
    var token = generation;
    paintPeer(session.groupName);
    setStatus('正在加入群組通話…');
    setActions('connecting');
    showLayer();
    enterGroupCall(token, { wantVideo: true, failText: '無法加入（請允許麥克風）' });
  }

  var VIDEO_FULL_TOAST = '視訊人數已達上限（4 人），已改為語音加入';

  function groupJoinError(res) {
    if (res && res.error === 'no-room') return '此群組通話已結束';
    if (res && res.error === 'room-full') return '群組通話人數已滿（' + (res.max || 8) + ' 人）';
    return '無法加入群組通話';
  }

  /** 舊版伺服器沒有 probe 時當作語音房，不讓流程卡住 */
  function probeGroupCall(callId) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve({ ok: true, media: 'audio', videoAllowed: false });
      }, 8000);
      socket.emit('group-call-probe', { callId: callId }, function (res) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res || { ok: false });
      });
    });
  }

  /** 伺服器最後不給視訊名額時，收掉已開的鏡頭改為語音 */
  function dropOwnVideo() {
    if (!session) return;
    session.sendVideo = false;
    if (session.stream) {
      session.stream.getVideoTracks().forEach(function (track) {
        track.stop();
        session.stream.removeTrack(track);
      });
      showLocalVideo(session.stream);
    }
    setActions(currentActionMode());
  }

  /** 加入群組房間：先問視訊名額 → 開麥克風／鏡頭 → group-call-accept（伺服器做最終判斷） */
  function enterGroupCall(token, opts) {
    var callId = session.callId;
    probeGroupCall(callId).then(function (probe) {
      if (!alive(token)) return null;
      if (!probe || !probe.ok) {
        finish(groupJoinError(probe));
        return null;
      }
      var video = probe.media === 'video';
      session.media = video ? 'video' : 'audio';
      session.sendVideo = video && !!opts.wantVideo && !!probe.videoAllowed;
      setGroupVideoMode(video);
      if (video && opts.wantVideo && !probe.videoAllowed) PATS.toast(VIDEO_FULL_TOAST);
      return openMedia(token).then(function () {
        if (!alive(token)) return;
        session.phase = 'connecting';
        socket.emit('group-call-accept', { callId: callId, wantVideo: !!session.sendVideo }, function (ack) {
          if (!alive(token)) return;
          if (!ack || !ack.ok) {
            finish(groupJoinError(ack));
            return;
          }
          if (session.sendVideo && !ack.videoAllowed) {
            dropOwnVideo();
            PATS.toast(VIDEO_FULL_TOAST);
          }
          if (ack.groupName) session.groupName = ack.groupName;
          setGroupRoomCount(((ack.peers && ack.peers.length) || 0) + 1);
          paintPeer(session.groupName || '群組通話');
          updateGroupStatus();
          // 既有成員會向我們送 offer（incoming-call）；此處只需等待
        });
      });
    }).catch(function (err) {
      if (!alive(token)) return;
      if (opts.rejectOnFail) socket.emit('group-call-reject', { callId: callId });
      finish(err && err.message ? err.message : opts.failText);
    });
  }

  function accept(options) {
    if (!session || session.phase !== 'ringing') return;
    var token = generation;
    if (!session.isGroup && session.media === 'video') {
      // 語音接聽：只送聲音，但仍接收並顯示對方畫面
      session.sendVideo = !(options && options.audioOnly);
      setVideoMode(true);
    }
    if (window.CallTones) CallTones.stop();
    setStatus('接通中…');
    setActions('connecting');

    if (session.isGroup) {
      session.phase = 'connecting';
      enterGroupCall(token, {
        wantVideo: !(options && options.audioOnly),
        rejectOnFail: true,
        failText: '無法接聽（請允許麥克風）'
      });
      return;
    }

    var offer = session.offer;
    openMedia(token).then(function () {
      if (!alive(token)) return null;
      return session.pc.acceptOffer(offer);
    }).then(function (answer) {
      if (answer && alive(token)) applyVideoBitrate();
      return answer;
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

  /** 一對一視訊：約 800 kbps、24fps，兼顧手機畫質與 TURN 流量 */
  function applyVideoBitrate() {
    if (!session || session.isGroup || !session.pc || !session.sendVideo) return;
    session.pc.capVideoBitrate(800000, 24);
  }

  function markActive() {
    if (!session || session.phase === 'active') return;
    session.phase = 'active';
    session.wasActive = true;
    applyVideoBitrate();
    clearNetworkLostWatch();
    setActions('active');
    startTimer();
    bindCallPresence();
    if (window.CallTones) CallTones.playConnected();
  }

  function onConnectionState(state) {
    if (!session) return;
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
    var wantVideo = !!(session && session.sendVideo);
    var group = !!(session && session.isGroup);
    return AudioStreamManager.getStream({ video: wantVideo, group: group }).then(function (stream) {
      if (!alive(token)) {
        AudioStreamManager.stop(stream);
        return;
      }
      session.stream = stream;
      if (wantVideo && stream.videoFallback) {
        session.sendVideo = false;
        PATS.toast(stream.videoFallback);
        // 一對一撥號端沒有畫面時整通改為語音；接聽端與群組成員仍可看別人畫面
        if (session.isCaller && !session.isGroup) {
          session.media = 'audio';
          setVideoMode(false);
          setStatus('撥號中…');
        }
      }
      if (session.media === 'video') showLocalVideo(stream);
      if (session.sendVideo) {
        setCameraIcon();
        AudioStreamManager.hasMultipleCameras().then(function (multi) {
          if (!alive(token)) return;
          session.canFlip = multi;
          setActions(currentActionMode());
        });
      }
      return resolveIceServers().then(function (servers) {
        if (!alive(token)) {
          AudioStreamManager.stop(stream);
          return;
        }
        // 群組通話：只準備麥克風與 ICE，PeerConnection 按成員分別建立
        if (session.isGroup) {
          muted = false;
          setMuteIcon();
          return;
        }
        session.pc = WebRTCManager.create({
          iceServers: servers,
          onIceCandidate: function (candidate) {
            emit('ice-candidate', { candidate: candidate });
          },
          onTrack: function (remote, track) {
            if (session && session.media === 'video') {
              attachRemoteVideo(remote, track);
            }
            playRemoteStream(remote);
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

  function mediaFields(video) {
    return {
      media: video ? 'video' : 'audio',
      sendVideo: !!video,
      camOn: true,
      facing: 'user',
      canFlip: false,
      flipping: false
    };
  }

  function begin(peer, isCaller, media) {
    generation += 1;
    var video = media === 'video';
    session = {
      token: generation,
      callId: isCaller ? newId() : '',
      peerId: peer.id,
      isCaller: isCaller,
      media: video ? 'video' : 'audio',
      sendVideo: video,
      camOn: true,
      facing: 'user',
      canFlip: false,
      flipping: false,
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
    clearVideos();
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
    $('call-accept').addEventListener('click', function () { accept(); });
    var acceptAudio = $('call-accept-audio');
    if (acceptAudio) acceptAudio.addEventListener('click', function () { accept({ audioOnly: true }); });
    var stage = $('call-stage');
    if (stage) stage.addEventListener('click', onStageClick);
    var cam = $('call-camera');
    if (cam) cam.addEventListener('click', toggleCamera);
    var flip = $('call-flip');
    if (flip) flip.addEventListener('click', flipCamera);
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
    joinGroupCall: joinGroupCall,
    signalingUrl: signalingUrl,
    setSignalingUrl: setSignalingUrl,
    signalState: function () { return signalState; },
    onSignalChange: onSignalChange,
    isConnected: function () { return !!(socket && socket.connected); },
    /** 有通話（響鈴、撥號、通話中、群組）時為 true；自動更新會避開 */
    isBusy: function () {
      if (session) return true;
      var layer = $('call-layer');
      return !!(layer && !layer.classList.contains('hidden'));
    }
  };
})();
