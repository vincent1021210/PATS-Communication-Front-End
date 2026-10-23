/* =====================================================================
   PATS — 通話提示音（Web Audio，無需音檔）
   dialing  撥號回鈴｜ringing 來電鈴聲｜connected 接通｜ended 結束
   ===================================================================== */

var CallTones = (function () {
  'use strict';

  var ctx = null;
  var loopTimer = null;
  var activeNodes = [];
  var mode = 'idle'; // idle | dialing | ringing

  function audioCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
    return ctx;
  }

  function stopNodes() {
    activeNodes.forEach(function (n) {
      try {
        if (n.gain) {
          n.gain.gain.cancelScheduledValues(ctx ? ctx.currentTime : 0);
          n.gain.gain.setValueAtTime(0.0001, ctx ? ctx.currentTime : 0);
        }
        if (n.osc) n.osc.stop();
        if (n.src) n.src.stop();
      } catch (e) { /* ignore */ }
    });
    activeNodes = [];
  }

  function clearLoop() {
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
  }

  function stop() {
    clearLoop();
    stopNodes();
    mode = 'idle';
  }

  function tone(freqs, duration, gainValue, type) {
    var ac = audioCtx();
    if (!ac) return;
    var now = ac.currentTime;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gainValue || 0.08, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    g.connect(ac.destination);
    (freqs || [440]).forEach(function (f) {
      var osc = ac.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.connect(g);
      osc.start(now);
      osc.stop(now + duration + 0.05);
      activeNodes.push({ osc: osc, gain: g });
    });
  }

  /** 撥號回鈴：兩聲短響、停頓後循環（類似市話回鈴） */
  function dialingBurst() {
    tone([440, 480], 0.4, 0.07, 'sine');
    setTimeout(function () {
      if (mode !== 'dialing') return;
      tone([440, 480], 0.4, 0.07, 'sine');
    }, 450);
  }

  function startDialing() {
    stop();
    mode = 'dialing';
    dialingBurst();
    function tick() {
      if (mode !== 'dialing') return;
      loopTimer = setTimeout(function () {
        if (mode !== 'dialing') return;
        dialingBurst();
        tick();
      }, 2000);
    }
    tick();
  }

  /** 來電鈴聲：較高音階循環 */
  function ringingBurst() {
    tone([523.25, 659.25], 0.28, 0.09, 'triangle');
    setTimeout(function () {
      if (mode !== 'ringing') return;
      tone([587.33, 698.46], 0.28, 0.09, 'triangle');
    }, 320);
  }

  function startRinging() {
    stop();
    mode = 'ringing';
    ringingBurst();
    function tick() {
      if (mode !== 'ringing') return;
      loopTimer = setTimeout(function () {
        if (mode !== 'ringing') return;
        ringingBurst();
        tick();
      }, 1400);
    }
    tick();
  }

  /** 剛接通：兩聲上揚提示 */
  function playConnected() {
    stop();
    tone([523.25], 0.12, 0.1, 'sine');
    setTimeout(function () {
      tone([783.99], 0.18, 0.1, 'sine');
    }, 130);
  }

  /** 通話結束／掛斷 */
  function playEnded() {
    stop();
    tone([392], 0.16, 0.09, 'sine');
    setTimeout(function () {
      tone([293.66], 0.28, 0.08, 'sine');
    }, 150);
  }

  return {
    stop: stop,
    startDialing: startDialing,
    startRinging: startRinging,
    playConnected: playConnected,
    playEnded: playEnded
  };
})();
