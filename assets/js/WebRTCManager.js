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

    pc.onicecandidate = function (event) {
      if (closed || !event.candidate || !options.onIceCandidate) return;
      options.onIceCandidate(event.candidate);
    };

    pc.ontrack = function (event) {
      if (closed || !options.onTrack) return;
      var stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
      options.onTrack(stream, event.track);
    };

    pc.oniceconnectionstatechange = function () {
      if (closed || !options.onConnectionState) return;
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

    /** 限制送出影像的碼率與幀率；需在 setLocalDescription 之後呼叫才會生效 */
    function capVideoBitrate(maxBps, maxFps) {
      if (closed) return Promise.resolve();
      var jobs = pc.getSenders().filter(function (s) {
        return s.track && s.track.kind === 'video' && s.getParameters && s.setParameters;
      }).map(function (s) {
        var p = s.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = maxBps;
        if (maxFps) p.encodings[0].maxFramerate = maxFps;
        return s.setParameters(p).catch(function () {});
      });
      return Promise.all(jobs);
    }

    /** 切換鏡頭：直接替換送出的影像，不需重新協商 */
    function replaceVideoTrack(track) {
      if (closed) return Promise.resolve();
      var sender = pc.getSenders().filter(function (s) {
        return s.track && s.track.kind === 'video';
      })[0];
      if (!sender) return Promise.resolve();
      return sender.replaceTrack(track);
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
      // 麥克風由 AudioStreamManager 統一釋放；群組通話多條連線共用同一音軌，不可在此 stop
      pc.close();
    }

    return {
      addStream: addStream,
      createOffer: createOffer,
      acceptOffer: acceptOffer,
      acceptAnswer: acceptAnswer,
      addIceCandidate: addIceCandidate,
      capVideoBitrate: capVideoBitrate,
      replaceVideoTrack: replaceVideoTrack,
      restartIce: restartIce,
      close: close
    };
  }

  return { create: create };
})();
