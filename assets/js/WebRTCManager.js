/* =====================================================================
   PATS — WebRTC 連線：Offer / Answer / ICE，以及連線失敗時重啟 ICE
   ===================================================================== */

var WebRTCManager = (function () {
  'use strict';

  function create(options) {
    var iceServers = (options && options.iceServers) || [
      { urls: 'stun:stun.l.google.com:19302' }
    ];
    var pc = new RTCPeerConnection({ iceServers: iceServers });
    var pendingCandidates = [];
    var closed = false;
    var localCandTypes = [];

    // #region agent log
    function dbgRtc_(hypothesisId, message, data) {
      var payload = JSON.stringify({
        sessionId: 'b641af',
        runId: 'pre-fix',
        hypothesisId: hypothesisId,
        location: 'WebRTCManager.js',
        message: message,
        data: data || {},
        timestamp: Date.now()
      });
      var opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b641af' },
        body: payload
      };
      // 本機 + 區網（手機測 http://192.168.1.136:8766 時用）
      [
        'http://127.0.0.1:7933/ingest/c8756446-874d-4039-81a0-9dd77fab3795',
        'http://192.168.1.136:7933/ingest/c8756446-874d-4039-81a0-9dd77fab3795'
      ].forEach(function (url) { fetch(url, opts).catch(function () {}); });
    }
    dbgRtc_('A', 'pc created', {
      iceServerUrls: iceServers.map(function (s) {
        return typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
      }),
      hasTurn: iceServers.some(function (s) {
        var u = typeof s.urls === 'string' ? s.urls : (s.urls || []).join(',');
        return /turn:/i.test(u);
      })
    });
    // #endregion

    pc.onicecandidate = function (event) {
      if (closed) return;
      if (!event.candidate) {
        // #region agent log
        dbgRtc_('C', 'ice gathering complete', { localCandTypes: localCandTypes.slice() });
        // #endregion
        return;
      }
      var typ = (event.candidate.type || (event.candidate.candidate || '').match(/ typ ([a-z0-9]+)/) || [])[1] ||
        (String(event.candidate.candidate || '').indexOf(' typ relay') >= 0 ? 'relay' :
          String(event.candidate.candidate || '').indexOf(' typ srflx') >= 0 ? 'srflx' :
            String(event.candidate.candidate || '').indexOf(' typ host') >= 0 ? 'host' : 'unknown');
      if (localCandTypes.indexOf(typ) < 0) localCandTypes.push(typ);
      // #region agent log
      dbgRtc_('C', 'local ice candidate', { type: typ, protocol: event.candidate.protocol || null });
      // #endregion
      if (!options.onIceCandidate) return;
      options.onIceCandidate(event.candidate);
    };

    pc.ontrack = function (event) {
      if (closed || !options.onTrack) return;
      // #region agent log
      dbgRtc_('B', 'ontrack remote media', { trackKind: event.track && event.track.kind });
      // #endregion
      var stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      options.onTrack(stream);
    };

    pc.oniceconnectionstatechange = function () {
      if (closed || !options.onConnectionState) return;
      // #region agent log
      dbgRtc_('B', 'iceConnectionState', {
        state: pc.iceConnectionState,
        connectionState: pc.connectionState,
        gathering: pc.iceGatheringState,
        localCandTypes: localCandTypes.slice()
      });
      // #endregion
      options.onConnectionState(pc.iceConnectionState);
    };

    function flushCandidates() {
      var queued = pendingCandidates.slice();
      pendingCandidates = [];
      return queued.reduce(function (chain, candidate) {
        return chain.then(function () {
          return pc.addIceCandidate(candidate);
        });
      }, Promise.resolve()).catch(function () { /* 過期的候選位址可以略過 */ });
    }

    function addIceCandidate(candidate) {
      if (closed || !candidate) return Promise.resolve();
      if (!pc.remoteDescription) {
        pendingCandidates.push(candidate);
        return Promise.resolve();
      }
      return pc.addIceCandidate(candidate).catch(function () {});
    }

    function createOffer(extra) {
      return pc.createOffer(extra || undefined).then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        return pc.localDescription;
      });
    }

    function acceptOffer(offer) {
      return pc.setRemoteDescription(offer).then(flushCandidates).then(function () {
        return pc.createAnswer();
      }).then(function (answer) {
        return pc.setLocalDescription(answer);
      }).then(function () {
        return pc.localDescription;
      });
    }

    function acceptAnswer(answer) {
      return pc.setRemoteDescription(answer).then(flushCandidates);
    }

    function addStream(stream) {
      stream.getTracks().forEach(function (track) {
        pc.addTrack(track, stream);
      });
    }

    /** 網路路徑失效時重開 ICE。只有原本的發話端可以送出新的 offer。 */
    function restartIce() {
      return createOffer({ iceRestart: true });
    }

    function close() {
      closed = true;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.oniceconnectionstatechange = null;
      pc.getSenders().forEach(function (sender) {
        if (sender.track) sender.track.stop();
      });
      pc.close();
    }

    return {
      addStream: addStream,
      createOffer: createOffer,
      acceptOffer: acceptOffer,
      acceptAnswer: acceptAnswer,
      addIceCandidate: addIceCandidate,
      restartIce: restartIce,
      close: close
    };
  }

  return { create: create };
})();
