/* =====================================================================
   PATS — 麥克風／攝影機串流：取得、靜音、釋放
   ===================================================================== */

var AudioStreamManager = (function () {
  'use strict';

  var AUDIO = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };

  var VIDEO_FALLBACK_HINT = {
    NotAllowedError: '未允許使用攝影機，已改為語音通話。',
    SecurityError: '未允許使用攝影機，已改為語音通話。',
    NotFoundError: '找不到攝影機，已改為語音通話。',
    NotReadableError: '攝影機被其他程式使用中，已改為語音通話。',
    OverconstrainedError: '攝影機不支援目前設定，已改為語音通話。',
    AbortError: '攝影機無法啟動，已改為語音通話。'
  };

  function videoConstraints(opts) {
    var group = !!(opts && opts.group);
    return {
      facingMode: (opts && opts.facingMode) || 'user',
      width: { ideal: group ? 480 : 640 },
      height: { ideal: group ? 270 : 360 },
      frameRate: { ideal: group ? 15 : 24, max: group ? 15 : 24 }
    };
  }

  function micError(err) {
    if (err && err.name === 'NotAllowedError') {
      return new Error('請允許瀏覽器使用麥克風後再撥打。');
    }
    if (err && err.name === 'NotFoundError') {
      return new Error('找不到麥克風裝置。');
    }
    return err;
  }

  /**
   * opts.video 為 true 時同時開攝影機；攝影機失敗會退回純語音，
   * 並在回傳的串流上標記 videoFallback（給使用者看的原因）。
   */
  function getStream(opts) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var why = !window.isSecureContext
        ? '目前網址不是安全連線（HTTPS／localhost），瀏覽器不開放麥克風。請改用 https://vincent1021210.github.io/ 或本機 http://127.0.0.1:8766/'
        : '這個瀏覽器不支援麥克風。請改用 Chrome、Edge 或 Firefox。';
      return Promise.reject(new Error(why));
    }
    var wantVideo = !!(opts && opts.video);
    var audioOnly = function () {
      return navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false });
    };
    if (!wantVideo) return audioOnly().catch(function (err) { throw micError(err); });

    return navigator.mediaDevices.getUserMedia({
      audio: AUDIO,
      video: videoConstraints(opts)
    }).catch(function (err) {
      var hint = VIDEO_FALLBACK_HINT[err && err.name] || '攝影機無法使用，已改為語音通話。';
      return audioOnly().then(function (stream) {
        stream.videoFallback = hint;
        return stream;
      }).catch(function (err2) { throw micError(err2); });
    });
  }

  function hasVideo(stream) {
    return !!(stream && stream.getVideoTracks().some(function (t) { return t.readyState === 'live'; }));
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
    hasVideo: hasVideo,
    setMuted: setMuted,
    stop: stop
  };
})();
