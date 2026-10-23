/**
 * PATS 信令伺服器
 *
 * 只負責「誰要打給誰」以及轉發 WebRTC 的 SDP / ICE。
 * 聲音走瀏覽器之間的 WebRTC，不會經過這支程式。
 *
 * 支援：一對一通話、群組 Mesh 通話（成員互相建立連線）。
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

/** userId -> { socketId, name } */
var users = new Map();

/** callId -> { hostId, groupName, members: Set<userId> } */
var rooms = new Map();

app.get('/health', function (req, res) {
  res.json({ ok: true, app: 'PATS signaling', online: users.size, rooms: rooms.size });
});

function userOf(socket) {
  return users.get(socket.data.userId);
}

function emitToUser(userId, event, payload) {
  var target = users.get(userId);
  if (!target) return false;
  io.to(target.socketId).emit(event, payload);
  return true;
}

function roomPeerList(room) {
  var list = [];
  room.members.forEach(function (id) {
    var u = users.get(id);
    list.push({ id: id, name: (u && u.name) || id });
  });
  return list;
}

function leaveRoom(userId, callId) {
  var room = callId && rooms.get(callId);
  if (!room || !room.members.has(userId)) return;
  room.members.delete(userId);
  var remaining = roomPeerList(room);
  // 一人離開後房間仍保留；其餘成員可繼續通話
  room.members.forEach(function (peerId) {
    emitToUser(peerId, 'group-peer-left', {
      callId: callId,
      from: userId,
      remaining: remaining,
      groupName: room.groupName
    });
  });
  if (room.members.size === 0) rooms.delete(callId);
}

function leaveAllRooms(userId) {
  rooms.forEach(function (room, callId) {
    if (room.members.has(userId)) leaveRoom(userId, callId);
  });
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
    candidate: payload.candidate,
    group: !!(payload && payload.group),
    groupName: (payload && payload.groupName) || ''
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
    socket.data.groupCallId = String((payload && payload.callId) || '').trim() || socket.data.groupCallId || null;
  });

  socket.on('call-unbind', function () {
    socket.data.inCallWith = null;
    socket.data.groupCallId = null;
  });

  socket.on('hang-up', function (payload, ack) {
    var callId = payload && payload.callId;
    if (callId && rooms.has(callId)) {
      leaveRoom(socket.data.userId, callId);
    }
    socket.data.inCallWith = null;
    socket.data.groupCallId = null;
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

  /** 發起群組通話：建立房間並向其他成員響鈴（尚無 SDP） */
  socket.on('group-call-start', function (payload, ack) {
    if (!socket.data.userId) {
      if (ack) ack({ ok: false, error: 'not-registered' });
      return;
    }
    var callId = String((payload && payload.callId) || '').trim();
    var groupName = String((payload && payload.groupName) || '群組通話').trim();
    var memberIds = (payload && payload.memberIds) || [];
    if (!callId) {
      if (ack) ack({ ok: false, error: 'missing-call' });
      return;
    }
    var hostId = socket.data.userId;
    var host = userOf(socket) || {};
    var room = { hostId: hostId, groupName: groupName, members: new Set([hostId]) };
    rooms.set(callId, room);
    socket.data.groupCallId = callId;

    var offline = [];
    var rung = [];
    memberIds.forEach(function (raw) {
      var id = String(raw || '').trim();
      if (!id || id === hostId) return;
      if (!users.get(id)) {
        offline.push(id);
        return;
      }
      rung.push(id);
      emitToUser(id, 'incoming-group-call', {
        callId: callId,
        from: hostId,
        fromName: host.name || hostId,
        groupName: groupName,
        memberIds: memberIds.concat([hostId]).filter(function (x, i, a) {
          return a.indexOf(x) === i;
        })
      });
    });
    if (ack) ack({ ok: true, rung: rung, offline: offline });
  });

  /** 接聽群組通話：加入房間；既有成員會向新人送 offer */
  socket.on('group-call-accept', function (payload, ack) {
    if (!socket.data.userId) {
      if (ack) ack({ ok: false, error: 'not-registered' });
      return;
    }
    var callId = String((payload && payload.callId) || '').trim();
    var room = rooms.get(callId);
    if (!room) {
      if (ack) ack({ ok: false, error: 'no-room' });
      return;
    }
    var userId = socket.data.userId;
    var me = userOf(socket) || {};
    var existing = [];
    room.members.forEach(function (id) {
      if (id !== userId) existing.push(id);
    });
    room.members.add(userId);
    socket.data.groupCallId = callId;

    existing.forEach(function (peerId) {
      emitToUser(peerId, 'group-peer-joined', {
        callId: callId,
        userId: userId,
        name: me.name || userId,
        groupName: room.groupName
      });
    });

    if (ack) {
      ack({
        ok: true,
        peers: roomPeerList(room).filter(function (p) { return p.id !== userId; }),
        groupName: room.groupName
      });
    }
  });

  socket.on('group-call-leave', function (payload, ack) {
    var callId = String((payload && payload.callId) || socket.data.groupCallId || '').trim();
    leaveRoom(socket.data.userId, callId);
    socket.data.groupCallId = null;
    socket.data.inCallWith = null;
    if (ack) ack({ ok: true });
  });

  socket.on('group-call-reject', function (payload, ack) {
    var callId = String((payload && payload.callId) || '').trim();
    var room = rooms.get(callId);
    if (room) {
      var from = socket.data.userId;
      room.members.forEach(function (peerId) {
        if (peerId !== from) {
          emitToUser(peerId, 'group-call-declined', {
            callId: callId,
            from: from,
            fromName: (userOf(socket) || {}).name || from
          });
        }
      });
    }
    if (ack) ack({ ok: true });
  });

  socket.on('disconnect', function () {
    var userId = socket.data.userId;
    var peerId = socket.data.inCallWith;
    var groupCallId = socket.data.groupCallId;
    var current = userId && users.get(userId);
    if (current && current.socketId === socket.id) users.delete(userId);

    if (groupCallId) {
      leaveRoom(userId, groupCallId);
    } else if (userId && peerId) {
      emitToUser(peerId, 'peer-network-lost', {
        from: userId,
        reason: 'signaling-disconnect'
      });
    } else if (userId) {
      leaveAllRooms(userId);
    }

    socket.data.inCallWith = null;
    socket.data.groupCallId = null;
  });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('PATS 信令伺服器已啟動：http://0.0.0.0:' + PORT);
  console.log('本機測試：http://localhost:' + PORT + '/health');
  console.log('區網請用這台電腦的 IPv4，例如 http://192.168.x.x:' + PORT + '/health');
});
