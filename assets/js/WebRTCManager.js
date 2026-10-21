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
      options.onTrack(stream);
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
