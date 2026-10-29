const http = require("http");
const WebSocket = require("ws");
async function main() {
  const list = await new Promise((res, rej) => {
    http.get("http://127.0.0.1:9222/json", r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>res(JSON.parse(d))); }).on("error", rej);
  });
  const page = list.find(t => t.type === "page") || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.once("open", r));
  let id = 0;
  function evalExpr(expr) {
    return new Promise((resolve) => {
      const mid = ++id;
      const onMsg = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === mid) { ws.off("message", onMsg); resolve(msg.result && msg.result.result); }
      };
      ws.on("message", onMsg);
      ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    });
  }
  const info = await evalExpr(`(async () => {
    const out = {
      secure: window.isSecureContext,
      origin: location.origin,
      hasIo: typeof io,
      hasMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      signalUrl: (window.PATS_CONFIG && PATS_CONFIG.signalingUrl) || null,
      signalState: (window.PatsCall && PatsCall.signalState && PatsCall.signalState()) || null,
      capacitor: !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform())
    };
    // try socket connect status after short wait
    await new Promise(r => setTimeout(r, 2500));
    out.signalState2 = (window.PatsCall && PatsCall.signalState && PatsCall.signalState()) || null;
    try {
      const h = await fetch(PATS_CONFIG.signalingUrl + '/health').then(r => r.json());
      out.health = h;
    } catch (e) { out.healthErr = String(e && e.message || e); }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      out.gum = 'audio tracks=' + s.getAudioTracks().length;
      s.getTracks().forEach(t => t.stop());
    } catch (e) { out.gumErr = (e && e.name) + ': ' + (e && e.message); }
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      out.rtc = typeof pc.createOffer;
      pc.close();
    } catch (e) { out.rtcErr = String(e); }
    return out;
  })()`);
  console.log(JSON.stringify(info && info.value ? info.value : info, null, 2));
  ws.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
