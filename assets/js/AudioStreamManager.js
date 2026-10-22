/* =====================================================================
   PATS — 麥克風串流：取得、靜音、釋放
   ===================================================================== */

var AudioStreamManager = (function () {
  'use strict';

  function getStream() {
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/c8756446-874d-4039-81a0-9dd77fab3795', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b641af' },
      body: JSON.stringify({
        sessionId: 'b641af',
        runId: 'pre-fix',
        hypothesisId: 'I',
        location: 'AudioStreamManager.js:getStream',
        message: 'mic capability check',
        data: {
          isSecureContext: !!(window.isSecureContext),
          hasMediaDevices: !!(navigator.mediaDevices),
          hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
          protocol: location.protocol,
          host: location.host
        },
        timestamp: Date.now()
      })
    }).catch(function () {});
    // #endregion
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var why = !window.isSecureContext
        ? '目前網址不是安全連線（HTTPS／localhost），瀏覽器不開放麥克風。請改用 https://vincent1021210.github.io/ 或本機 http://127.0.0.1:8766/'
        : '這個瀏覽器不支援麥克風。請改用 Chrome、Edge 或 Firefox。';
      return Promise.reject(new Error(why));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    }).catch(function (err) {
      // #region agent log
      fetch('http://127.0.0.1:7933/ingest/c8756446-874d-4039-81a0-9dd77fab3795', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b641af' },
        body: JSON.stringify({
          sessionId: 'b641af',
          runId: 'pre-fix',
          hypothesisId: 'K',
          location: 'AudioStreamManager.js:getUserMedia',
          message: 'getUserMedia failed',
          data: {
            name: err && err.name,
            message: err && err.message,
            isSecureContext: !!(window.isSecureContext),
            host: location.host
          },
          timestamp: Date.now()
        })
      }).catch(function () {});
      // #endregion
      if (err && err.name === 'NotAllowedError') {
        throw new Error('請允許瀏覽器使用麥克風後再撥打。');
      }
      if (err && err.name === 'NotFoundError') {
        throw new Error('找不到麥克風裝置。');
      }
      throw err;
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
