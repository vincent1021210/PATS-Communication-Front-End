/* =====================================================================
   PATS — 麥克風串流：取得、靜音、釋放
   ===================================================================== */

var AudioStreamManager = (function () {
  'use strict';

  function getStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('這個瀏覽器不支援麥克風。請改用 Chrome、Edge 或 Firefox。'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }

  function setMuted(stream, muted) {
    if (!stream) return;
    stream.getAudioTracks().forEach(function (track) {
      track.enabled = !muted;
    });
  }

  function stop(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (track) { track.stop(); });
  }

  return {
    getStream: getStream,
    setMuted: setMuted,
    stop: stop
  };
})();
