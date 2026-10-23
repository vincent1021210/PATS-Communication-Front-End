/**
 * PATS 信令伺服器
 *
 * 只負責「誰要打給誰」以及轉發 WebRTC 的 SDP / ICE。
 * 聲音走瀏覽器之間的 WebRTC，不會經過這支程式。
 *
 * 啟動：
 *   cd voip
 *   npm install
 *   npm start
 *
 * 環境變數：
 *   PORT         預設 3001（Render 會自動注入）
 *   CORS_ORIGIN  預設允許所有來源。正式環境請設成你的網站網址，
 *                例如 https://your-name.github.io
 *
 * Render 部署：見同目錄 Render部署說明.txt、倉庫根目錄 render.yaml。
 * Keep-alive：對外定時 GET /health（與是否安裝 PWA 無關）。
 */

'use strict';

var http = require('http');
var express = require('express');
var socketIo = require('socket.io');

var PORT = Number(process.env.PORT) || 3001;
var app = express();
var server = http.createServer(app);
var io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || true,
    methods: ['GET', 'POST']
  }
});

/** userId -> { socketId, name }。同一個人新連線會取代舊的。 */
var users = new Map();

app.get('/health', function (req, res) {
  res.json({ ok: true, app: 'PATS signaling', online: users.size });
});

function userOf(socket) {
  return users.get(socket.data.userId);
}

function relay(socket, event, payload, ack) {
  if (!socket.data.userId) {
    if (ack) ack({ ok: false, error: 'not-registered' });
    return;
  }
  var to = payload && payload.to;
  var target = users.get(to);
  if (!target) {
    if (ack) ack({ ok: false, error: 'offline' });
    socket.emit('call-failed', { to: to, reason: 'offline', callId: payload && payload.callId });
    return;
  }
  var from = userOf(socket) || {};
  io.to(target.socketId).emit(event, {
    from: socket.data.userId,
    fromName: from.name || socket.data.userId,
    to: to,
    callId: payload.callId,
    offer: payload.offer,
    answer: payload.answer,
    candidate: payload.candidate
  });
  if (ack) ack({ ok: true });
}

io.on('connection', function (socket) {
  socket.on('register', function (payload, ack) {
    var userId = String((payload && payload.userId) || '').trim();
    if (!userId) {
      if (ack) ack({ ok: false, error: 'missing-user' });
      return;
    }
    var previous = users.get(userId);
    if (previous && previous.socketId !== socket.id) {
      io.to(previous.socketId).emit('replaced');
    }
    users.set(userId, {
      socketId: socket.id,
      name: String((payload && payload.name) || userId)
    });
    socket.data.userId = userId;
    if (ack) ack({ ok: true, online: users.size });
  });

  socket.on('check-peer', function (payload, ack) {
    var userId = String((payload && payload.userId) || '').trim();
    var target = userId && users.get(userId);
    if (ack) {
      ack({
        ok: true,
        online: !!(target && target.socketId),
        name: target ? target.name : ''
      });
    }
  });

  socket.on('call-user', function (payload, ack) {
    relay(socket, 'incoming-call', payload || {}, ack);
  });

  socket.on('accept-call', function (payload, ack) {
    relay(socket, 'call-accepted', payload || {}, ack);
  });

  socket.on('reject-call', function (payload, ack) {
    relay(socket, 'call-rejected', payload || {}, ack);
  });

  socket.on('ice-candidate', function (payload, ack) {
    relay(socket, 'ice-candidate', payload || {}, ack);
  });

  socket.on('call-bind', function (payload) {
    if (!socket.data.userId) return;
    socket.data.inCallWith = String((payload && payload.peerId) || '').trim() || null;
  });

  socket.on('call-unbind', function () {
    socket.data.inCallWith = null;
  });

  socket.on('hang-up', function (payload, ack) {
    socket.data.inCallWith = null;
    relay(socket, 'hung-up', payload || {}, ack);
  });

  socket.on('renegotiate', function (payload, ack) {
    relay(socket, 'renegotiate', payload || {}, ack);
  });

  socket.on('renegotiate-answer', function (payload, ack) {
    relay(socket, 'renegotiate-answer', payload || {}, ack);
  });

  socket.on('request-restart', function (payload, ack) {
    relay(socket, 'request-restart', payload || {}, ack);
  });

  socket.on('disconnect', function () {
    var userId = socket.data.userId;
    var peerId = socket.data.inCallWith;
    var current = userId && users.get(userId);
    if (current && current.socketId === socket.id) users.delete(userId);
    // 通話中一方信令斷線 → 通知對方回到聊天並提示
    if (userId && peerId) {
      var peer = users.get(peerId);
      if (peer && peer.socketId) {
        io.to(peer.socketId).emit('peer-network-lost', {
          from: userId,
          reason: 'signaling-disconnect'
        });
      }
    }
    socket.data.inCallWith = null;
  });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('PATS 信令伺服器已啟動：http://0.0.0.0:' + PORT);
  console.log('本機測試：http://localhost:' + PORT + '/health');
  console.log('區網請用這台電腦的 IPv4，例如 http://192.168.x.x:' + PORT + '/health');
});
