/* 部署完成後，把下面兩段貼進 assets/js/config.js（網域／密碼改成你的） */

var PATS_CONFIG_ORACLE_EXAMPLE = {
  signalingUrl: 'https://pats-call.duckdns.org',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:pats-call.duckdns.org:3478' },
    {
      urls: 'turn:pats-call.duckdns.org:3478',
      username: 'pats',
      credential: 'please-change-this-password'
    }
  ]
};
