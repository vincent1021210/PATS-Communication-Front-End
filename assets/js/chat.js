/* =====================================================================
   PATS — 對話列表與訊息畫面
   ===================================================================== */

var PatsChat = (function () {
  'use strict';

  var $ = PATS.$;
  var el = PATS.el;
  var icon = PATS.icon;
  var state = PATS.state;

  var POLL_INTERVAL_MS = 6000;
  var LIST_POLL_EVERY = 2;

  var inbox = [];
  var listSignature = '';
  var loadedScope = '';
  var thread = { day: '', sender: '' };
  var polling = false;
  var pollTimer = null;
  var pollTick = 0;
  var pollRunning = false;

  var VIEW_META = {
    dm: {
      title: '私人訊息',
      search: '搜尋訊息或聯絡人',
      emptyIcon: 'forum',
      emptyTitle: '你還沒有朋友',
      emptyText: '邀請朋友開始聊天，或是發起新的對話。',
      emptyAction: { label: '邀請朋友', handler: promptInviteContact },
      placeholderIcon: 'chat_bubble',
      placeholderTitle: '請選擇一個對話',
      placeholderText: '從左側列表選擇現有的聯絡人或群組，開始傳送訊息。'
    },
    group: {
      title: '多人討論',
      search: '搜尋群組或聯絡人',
      emptyIcon: 'groups',
      emptyTitle: '你還沒有群組，請建立',
      emptyText: '建立一個群組，把團隊成員拉進來一起討論。',
      emptyAction: { label: '建立新群組', handler: promptCreateGroup },
      placeholderIcon: 'forum',
      placeholderTitle: '開始多人討論',
      placeholderText: '選擇左側的群組，或建立一個新的群組來與團隊進行協作與溝通。'
    },
    archive: {
      title: '封存內容',
      search: '搜尋封存訊息…',
      emptyIcon: 'archive',
      emptyTitle: '目前沒有封存的對話',
      emptyText: '當您封存對話後，它們會顯示在這裡，且不會出現在您的主要訊息列表中，直到收到新訊息。',
      emptyAction: { label: '返回私人訊息', handler: function () { PatsMain.setView('dm'); } },
      placeholderIcon: 'archive',
      placeholderTitle: '封存內容',
      placeholderText: '選擇一則封存的對話來查看歷史紀錄，或將它移回主要訊息列表。'
    }
  };

  /* ------------------------------------------------------------- 列表區 */

  function renderListHeader() {
    var meta = VIEW_META[state.view] || VIEW_META.dm;
    $('#list-title').textContent = meta.title;
    $('#list-search').placeholder = meta.search;

    var hint = $('#list-hint');
    var isEmpty = state.conversations.length === 0 && !state.keyword;
    hint.textContent = (state.view === 'group' && isEmpty) ? '你還沒有群組，請建立' : '';

    $('#list-compose').classList.toggle('hidden', state.view === 'archive');
  }

  function renderList() {
    renderListHeader();
    var container = $('#conv-list');
    container.innerHTML = '';

    var meta = VIEW_META[state.view] || VIEW_META.dm;

    if (!state.conversations.length) {
      container.appendChild(emptyState(
        meta.emptyIcon,
        state.keyword ? '找不到符合的結果' : meta.emptyTitle,
        state.keyword ? '換個關鍵字再試一次。' : meta.emptyText,
        state.keyword ? null : meta.emptyAction
      ));
      return;
    }

    state.conversations.forEach(function (conv) {
      container.appendChild(conversationItem(conv));
    });
  }

  function conversationItem(conv) {
    var classes = ['conv-item'];
    if (conv.id === state.activeId) classes.push('is-active');
    if (conv.unread > 0) classes.push('is-unread');

    return el('button', {
      class: classes.join(' '),
      type: 'button',
      onclick: function () { openConversation(conv.id); },
      oncontextmenu: function (event) { event.preventDefault(); openConversationMenu(event.currentTarget, conv); }
    }, [
      PATS.avatarNode(conv.title, conv.avatarUrl),
      el('span', { class: 'body' }, [
        el('span', { class: 'row' }, [
          el('span', { class: 'title', text: conv.title }),
          el('span', { class: 'time', text: PATS.formatListTime(conv.lastMessageAt) })
        ]),
        el('span', { class: 'preview', text: conv.preview || '尚無訊息' })
      ]),
      conv.unread > 0 ? el('span', { class: 'badge', text: String(conv.unread) }) : null
    ]);
  }

  function emptyState(iconName, title, text, action) {
    return el('div', { class: 'empty-state' }, [
      el('div', { class: 'glyph' }, [icon(iconName)]),
      el('h3', { text: title }),
      el('p', { text: text }),
      action ? el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: action.label,
        onclick: action.handler
      }) : null
    ]);
  }

  /* ------------------------------------------------------------- 對話區 */

  function isPrivateChat(conv) {
    return !!(conv && conv.type !== 'group');
  }

  function peerOf(conv) {
    var members = (conv && conv.members) || [];
    var me = state.user && state.user.id;
    for (var i = 0; i < members.length; i++) {
      if (members[i].id !== me) {
        return {
          id: members[i].id,
          name: members[i].name || conv.title || members[i].id,
          avatarUrl: members[i].avatarUrl || conv.avatarUrl || ''
        };
      }
    }
    return null;
  }

  function startCall(conv, options) {
    if (!window.PatsCall) {
      PATS.toast('通話模組尚未載入，請強制重新整理頁面。', 'error');
      return;
    }
    if (conv && conv.type === 'group') {
      startGroupCall(conv, options);
      return;
    }
    var peer = peerOf(conv);
    if (!peer || !peer.id) {
      PATS.toast('找不到通話對象。請先開啟對話再撥打。', 'error');
      return;
    }
    PatsCall.dial(peer, options);
  }

  function startGroupCall(conv, options) {
    var video = !!(options && options.video);
    function dialWith(full) {
      var me = state.user && state.user.id;
      var members = ((full && full.members) || []).filter(function (m) {
        return m && m.id && m.id !== me;
      }).map(function (m) {
        return { id: m.id, name: m.name || full.title || m.id };
      });
      if (!members.length) {
        PATS.toast('群組沒有其他成員可通話。', 'error');
        return;
      }
      if (!PatsCall.dialGroup) {
        PATS.toast('請強制重新整理以載入群組通話功能。', 'error');
        return;
      }
      var title = (full && full.title) || '群組通話';
      var conversationId = full && full.id;
      PatsCall.dialGroup(members, title, {
        video: video,
        onStarted: function (callId, groupName) {
          postGroupCallInvite(conversationId, callId, groupName || title);
        }
      });
    }

    if (conv.members && conv.members.length) {
      dialWith(conv);
      return;
    }
    PATS.rpc('listMessages', { conversationId: conv.id, limit: 1 })
      .then(function (data) { dialWith(data.conversation || conv); })
      .catch(handleError);
  }

  function renderPlaceholder() {
    var meta = VIEW_META[state.view] || VIEW_META.dm;
    var pane = $('#chat-pane');
    pane.innerHTML = '';
    pane.appendChild(emptyState(meta.placeholderIcon, meta.placeholderTitle, meta.placeholderText, null));
  }

  function renderConversation(data) {
    var pane = $('#chat-pane');
    pane.innerHTML = '';
    var conv = data.conversation;

    var subtitle = conv.type === 'group'
      ? conv.memberCount + ' 位成員'
      : '私人對話';

    pane.appendChild(el('header', { class: 'chat-head' }, [
      el('button', {
        class: 'icon-btn chat-back', type: 'button', 'aria-label': '返回列表',
        onclick: function () { PatsMain.setMobilePane('list'); }
      }, [icon('arrow_back')]),
      PATS.avatarNode(conv.title, conv.avatarUrl, 'avatar-sm'),
      el('div', { class: 'meta' }, [
        el('div', { class: 'title', text: conv.title }),
        el('div', { class: 'sub', text: subtitle })
      ]),
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'icon-btn call-btn', type: 'button',
          title: conv.type === 'group' ? '群組視訊' : '視訊通話',
          'aria-label': conv.type === 'group' ? '群組視訊' : '視訊通話',
          onclick: function () { startCall(conv, { video: true }); }
        }, [icon('videocam')]),
        el('button', {
          class: 'icon-btn call-btn', type: 'button',
          title: conv.type === 'group' ? '群組通話' : '語音通話',
          'aria-label': conv.type === 'group' ? '群組通話' : '語音通話',
          onclick: function () { startCall(conv); }
        }, [icon('call')]),
        el('button', {
          class: 'icon-btn', type: 'button', title: '更多',
          onclick: function (event) { openConversationMenu(event.currentTarget, conv); }
        }, [icon('more_vert')])
      ])
    ]));

    var body = el('div', { class: 'chat-body scroll-y', id: 'chat-body' });
    pane.appendChild(body);
    thread = { day: '', sender: '' };
    renderMessages(body, data.messages, false);

    pane.appendChild(composer());
    // 通話改由右上角綠色按鈕發起，避免手機底部再多一條藍鈕擠壓輸入區
    scrollToBottom();
  }

  /* ---------------------------------------------------------- 氣泡網址可點 */

  // 每次 match 新建 RegExp，避免 /g 的 lastIndex 狀態干擾
  function urlPattern() {
    return /https?:\/\/[^\s<>"'\u3000）】」』]+/g;
  }

  function trimUrlTrail(url) {
    return String(url || '').replace(/[。．、，,.;:!?）】」』>)\]\}]+$/g, '');
  }

  function isSafeHttpUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function fillLinkedText(container, text) {
    container.textContent = '';
    var raw = String(text == null ? '' : text);
    if (!raw) return;
    var re = urlPattern();
    var last = 0;
    var m;
    while ((m = re.exec(raw))) {
      var full = m[0];
      var href = trimUrlTrail(full);
      var start = m.index;
      var end = start + full.length;
      // 尾端被剝掉的標點仍當普通文字
      var trail = full.slice(href.length);
      if (start > last) {
        container.appendChild(document.createTextNode(raw.slice(last, start)));
      }
      if (href && isSafeHttpUrl(href)) {
        var a = document.createElement('a');
        a.className = 'msg-link';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = href;
        container.appendChild(a);
        if (trail) container.appendChild(document.createTextNode(trail));
      } else {
        container.appendChild(document.createTextNode(full));
      }
      last = end;
    }
    if (last < raw.length) {
      container.appendChild(document.createTextNode(raw.slice(last)));
    }
  }

  function bubbleNode(body) {
    var bubble = el('div', { class: 'bubble' });
    fillLinkedText(bubble, body);
    return bubble;
  }

  function renderMessages(container, messages, appending) {
    var lastDay = appending ? thread.day : '';
    var previousSender = appending ? thread.sender : '';

    messages.forEach(function (message) {
      if (messageNode(message.id)) return;
      if (message.mine && adoptPending(message)) {
        lastDay = PATS.formatDay(message.createdAt) || lastDay;
        previousSender = message.senderId;
        return;
      }

      var day = PATS.formatDay(message.createdAt);
      if (day !== lastDay) {
        container.appendChild(el('div', { class: 'msg-day', text: day }));
        lastDay = day;
        previousSender = '';
      }

      if (message.kind === 'system') {
        container.appendChild(el('div', { class: 'msg-system', text: message.body }));
        previousSender = '';
        return;
      }

      // kind 可能因舊版 API 未寫入而變成 text；用 body 辨識群組通話邀請
      if (isGroupCallInvite(message)) {
        container.appendChild(renderGroupCallInvite(message));
        previousSender = '';
        return;
      }

      var isTail = previousSender === message.senderId;
      previousSender = message.senderId;

      var showSender = !message.mine && !isTail && state.activeType === 'group';

      container.appendChild(el('div', {
        class: 'msg' + (message.mine ? ' is-mine' : '') + (isTail ? ' is-tail' : '') +
          (message.pending ? ' is-pending' : ''),
        'data-id': message.id,
        'data-sender': message.senderId || ''
      }, [
        isTail ? el('div', { class: 'avatar', style: 'visibility:hidden' })
               : PATS.avatarNode(message.senderName, message.senderAvatar),
        el('div', { class: 'stack' }, [
          showSender ? el('div', { class: 'sender', text: message.senderName }) : null,
          bubbleNode(message.body),
          el('div', { class: 'time', text: PATS.formatTime(message.createdAt) })
        ])
      ]));
    });

    thread.day = lastDay;
    thread.sender = previousSender;
  }

  function parseGroupCallMeta(message) {
    if (!message) return null;
    var body = message.body;

    // 後端偶發把 JSON 解析成物件
    if (body && typeof body === 'object') {
      if (body.callId) {
        return {
          callId: String(body.callId),
          groupName: String(body.groupName || '群組通話')
        };
      }
      return null;
    }

    var raw = String(body != null ? body : '').trim().replace(/^\uFEFF/, '');
    if (!raw) return null;

    // 新格式：GROUPCALL|callId|urlencodedName（試算表友善）
    if (raw.indexOf('GROUPCALL|') === 0) {
      var parts = raw.split('|');
      if (parts[1]) {
        var gName = parts.slice(2).join('|') || '群組通話';
        try { gName = decodeURIComponent(gName); } catch (e0) { /* keep */ }
        return { callId: String(parts[1]), groupName: gName || '群組通話' };
      }
    }

    // 舊格式：完整 JSON
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        var meta = JSON.parse(raw.slice(start, end + 1));
        if (meta && meta.callId) {
          return {
            callId: String(meta.callId),
            groupName: String(meta.groupName || '群組通話')
          };
        }
      } catch (e1) { /* ignore */ }

      // 試算表弄壞引號後：{callId:abc,groupName:xyz}
      var idMatch = raw.match(/callId\s*[:=]\s*"?([A-Za-z0-9_-]+)"?/i);
      if (idMatch) {
        var nameMatch = raw.match(/groupName\s*[:=]\s*"?([^"{},]+)"?/i);
        return {
          callId: idMatch[1],
          groupName: (nameMatch && nameMatch[1].trim()) || '群組通話'
        };
      }
    }

    return null;
  }

  function isGroupCallInvite(message) {
    if (!message) return false;
    if (message.kind === 'group-call') return true;
    return !!parseGroupCallMeta(message);
  }

  function renderGroupCallInvite(message) {
    var meta = parseGroupCallMeta(message) || {};
    var callId = meta.callId || '';
    var groupName = meta.groupName || '群組通話';
    var who = message.mine
      ? '你發起了群組通話'
      : ((message.senderName || '成員') + ' 發起了群組通話');

    return el('div', {
      class: 'msg msg-call-invite' + (message.mine ? ' is-mine' : ''),
      'data-id': message.id,
      'data-call-id': callId,
      'data-sender': message.senderId || ''
    }, [
      message.mine
        ? el('div', { class: 'avatar', style: 'visibility:hidden' })
        : PATS.avatarNode(message.senderName, message.senderAvatar),
      el('div', { class: 'stack' }, [
        (!message.mine && state.activeType === 'group')
          ? el('div', { class: 'sender', text: message.senderName })
          : null,
        el('div', { class: 'msg-call-card' }, [
          el('div', { class: 'msg-call-icon' }, [icon('call')]),
          el('div', { class: 'msg-call-body' }, [
            el('div', { class: 'msg-call-title', text: who }),
            el('div', { class: 'msg-call-sub', text: groupName }),
            el('button', {
              class: 'btn btn-primary msg-call-join',
              type: 'button',
              text: '進入群組通話',
              onclick: function () {
                if (!window.PatsCall || !PatsCall.joinGroupCall) {
                  PATS.toast('請強制重新整理以載入群組通話功能。', 'error');
                  return;
                }
                PatsCall.joinGroupCall(callId, groupName);
              }
            })
          ])
        ]),
        el('div', { class: 'time', text: PATS.formatTime(message.createdAt) })
      ])
    ]);
  }

  function postGroupCallInvite(conversationId, callId, groupName) {
    if (!conversationId || !callId) return;
    var gName = groupName || '群組通話';
    var payload = {
      conversationId: conversationId,
      kind: 'group-call',
      body: JSON.stringify({ callId: callId, groupName: gName })
    };
    PATS.rpc('sendMessage', payload)
      .then(function (message) {
        message.kind = 'group-call';
        // 若後端尚未更新，仍用可解析格式覆寫，避免畫面出現 JSON 亂碼
        if (!parseGroupCallMeta(message)) {
          message.body = 'GROUPCALL|' + callId + '|' + encodeURIComponent(gName);
        }
        if (state.activeId === conversationId) {
          // 先移除可能已輪詢進來的同 callId 文字氣泡
          removeBrokenCallBubbles(callId);
          appendMessages([message], { optimistic: false });
          scrollToBottom();
        }
        touchInboxPreview(conversationId, '發起了群組通話', message.createdAt || new Date().toISOString());
        return refreshList();
      })
      .catch(handleError);
  }

  function removeBrokenCallBubbles(callId) {
    var body = $('#chat-body');
    if (!body || !callId) return;
    var nodes = body.querySelectorAll('.msg .bubble');
    for (var i = 0; i < nodes.length; i++) {
      var text = nodes[i].textContent || '';
      if (text.indexOf(callId) >= 0 && text.indexOf('callId') >= 0) {
        var msg = nodes[i].closest('.msg');
        if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
      }
    }
  }

  function messageNode(id) {
    var body = $('#chat-body');
    if (!body || id === undefined || id === null) return null;
    var nodes = body.querySelectorAll('[data-id]');
    var key = String(id);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-id') === key) return nodes[i];
    }
    return null;
  }

  /** 輪詢比送出回應先到時，把暫顯氣泡改成伺服器那一則，避免同一句出現兩次。 */
  function adoptPending(message) {
    var body = $('#chat-body');
    if (!body || !message.mine) return false;
    var nodes = body.querySelectorAll('.msg.is-pending');
    for (var i = 0; i < nodes.length; i++) {
      var bubble = nodes[i].querySelector('.bubble');
      if (!bubble || bubble.textContent !== message.body) continue;
      nodes[i].setAttribute('data-id', message.id);
      nodes[i].classList.remove('is-pending');
      var time = nodes[i].querySelector('.time');
      if (time) time.textContent = PATS.formatTime(message.createdAt);
      return true;
    }
    return false;
  }

  function composer() {
    var textarea = el('textarea', {
      id: 'composer-input',
      rows: '1',
      placeholder: '輸入訊息…',
      'aria-label': '訊息內容'
    });
    var sendButton = el('button', {
      class: 'send', type: 'submit', 'aria-label': '傳送', disabled: 'disabled'
    }, [icon('send')]);

    textarea.addEventListener('input', function () {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
      sendButton.disabled = !textarea.value.trim();
    });
    textarea.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    var form = el('form', { class: 'composer' }, [textarea, sendButton]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var body = textarea.value.trim();
      if (!body) return;
      textarea.value = '';
      textarea.style.height = 'auto';
      sendButton.disabled = true;
      sendMessage(body);
    });

    return form;
  }

  function scrollToBottom() {
    var body = $('#chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  /* ------------------------------------------------------------ 資料流程 */

  function visibleConversations() {
    var q = String(state.keyword || '').toLowerCase();
    if (!q) return inbox;
    return inbox.filter(function (row) {
      return String(row.title || '').toLowerCase().indexOf(q) >= 0 ||
             String(row.preview || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function conversationSignature(list) {
    var parts = [state.view, state.activeId || '', state.keyword];
    for (var i = 0; i < list.length; i++) {
      var conv = list[i];
      parts.push(conv.id, conv.unread, conv.lastMessageAt, conv.preview, conv.title);
    }
    return parts.join('\n');
  }

  function publishList(options) {
    var list = visibleConversations();
    state.conversations = list;
    var sig = conversationSignature(list);
    var changed = sig !== listSignature;
    if (changed) {
      listSignature = sig;
      renderList();
      if (!state.activeId) renderPlaceholder();
    }
    PatsMain.updateBadges(inbox);

    if (options && options.autoSelect && !state.activeId && list.length &&
        window.matchMedia('(min-width: 721px)').matches) {
      return openConversation(list[0].id);
    }
  }

  function refreshList(options) {
    var scope = state.view;
    if (loadedScope !== scope) {
      inbox = [];
      listSignature = '';
      state.conversations = [];
      renderList();
      if (!state.activeId) renderPlaceholder();
    }
    return PATS.rpc('listConversations', { scope: scope })
      .then(function (list) {
        if (state.view !== scope) return;
        loadedScope = scope;
        var keptActive = findInboxRow_(state.activeId);
        inbox = list || [];
        return restoreActiveIfArchived_(options, keptActive);
      })
      .catch(function (err) {
        if (options && options.quiet) return;
        handleError(err);
      });
  }

  /** 對話已開啟卻不在目前列表時，檢查是否被自動封存並移回。 */
  function restoreActiveIfArchived_(options, keptActive) {
    var activeId = state.activeId;
    if (!activeId || state.view === 'archive') {
      return publishList(options);
    }
    if (findInboxRow_(activeId)) return publishList(options);
    return PATS.rpc('listConversations', { scope: 'archive' })
      .then(function (archived) {
        var hit = null;
        for (var j = 0; j < (archived || []).length; j++) {
          if (archived[j].id === activeId) { hit = archived[j]; break; }
        }
        if (hit) {
          return PATS.rpc('setArchived', { conversationId: activeId, archived: false })
            .then(function () {
              PATS.toast('對話曾在「封存」，已自動移回列表。', 'success');
              return refreshList(options);
            });
        }
        // 後端列表仍漏掉時，保留畫面上已開啟的那一筆，避免被輪詢清空
        if (keptActive) {
          inbox.unshift(keptActive);
          return publishList(options);
        }
        var titleEl = $('.chat-head .title');
        if (state.activeId) {
          upsertInboxFromConversation_({
            conversation: {
              id: state.activeId,
              type: state.activeType || 'dm',
              title: (titleEl && titleEl.textContent) || '對話',
              avatarUrl: '',
              memberCount: 0
            },
            messages: state.messages || []
          });
          return;
        }
        return publishList(options);
      })
      .catch(function () { return publishList(options); });
  }

  function findInboxRow_(id) {
    if (!id) return null;
    for (var i = 0; i < inbox.length; i++) {
      if (inbox[i].id === id) return inbox[i];
    }
    return null;
  }

  function openConversation(conversationId) {
    state.activeId = conversationId;
    state.lastMessageAt = null;
    thread = { day: '', sender: '' };
    publishList();
    PatsMain.setMobilePane('chat');

    return PATS.rpc('listMessages', { conversationId: conversationId })
      .then(function (data) {
        if (state.activeId !== conversationId) return;
        state.activeType = data.conversation.type;
        state.messages = data.messages;
        state.lastMessageAt = data.messages.length
          ? data.messages[data.messages.length - 1].createdAt
          : null;
        upsertInboxFromConversation_(data);
        renderConversation(data);
        return PATS.rpc('markRead', { conversationId: conversationId });
      })
      .then(function () { refreshBadgesOnly(); })
      .catch(handleError);
  }

  /** 後端列表漏掉時，用已開啟的對話補進左側，避免「右邊有人、左邊沒朋友」。 */
  function upsertInboxFromConversation_(data) {
    var conv = data && data.conversation;
    if (!conv || !conv.id) return;
    var preview = '';
    var lastAt = conv.lastMessageAt || '';
    var messages = data.messages || [];
    if (messages.length) {
      var last = messages[messages.length - 1];
      preview = last.kind === 'system'
        ? last.body
        : ((last.mine ? '你' : (last.senderName || '')) + (last.body ? '：' + last.body : ''));
      lastAt = last.createdAt || lastAt;
    }
    var row = {
      id: conv.id,
      type: conv.type === 'group' ? 'group' : 'dm',
      title: conv.title || '對話',
      avatarUrl: conv.avatarUrl || '',
      memberCount: conv.memberCount || 0,
      archived: false,
      lastMessageAt: lastAt || new Date().toISOString(),
      preview: preview || '尚無訊息',
      unread: 0
    };
    var found = false;
    for (var i = 0; i < inbox.length; i++) {
      if (inbox[i].id !== row.id) continue;
      inbox[i] = Object.assign({}, inbox[i], row);
      found = true;
      break;
    }
    if (!found) inbox.unshift(row);
    if (row.type === 'group' && state.view === 'dm') {
      // 群組開在私訊頁時仍先顯示於列表，避免以為沒建立成功
    }
    listSignature = '';
    publishList();
  }

  function refreshBadgesOnly() {
    for (var i = 0; i < inbox.length; i++) {
      if (inbox[i].id !== state.activeId) continue;
      if (!inbox[i].unread) return;
      inbox[i].unread = 0;
      break;
    }
    publishList();
  }

  function touchInboxPreview(conversationId, body, createdAt) {
    var conv = null;
    for (var i = 0; i < inbox.length; i++) {
      if (inbox[i].id === conversationId) { conv = inbox[i]; break; }
    }
    if (!conv) {
      conv = {
        id: conversationId,
        type: state.activeType === 'group' ? 'group' : 'dm',
        title: '對話',
        avatarUrl: '',
        memberCount: 0,
        archived: false,
        preview: '',
        unread: 0,
        lastMessageAt: createdAt
      };
      inbox.unshift(conv);
    }
    var name = state.user && (state.user.displayName || state.user.username);
    conv.preview = name ? name + '：' + body : body;
    conv.lastMessageAt = createdAt;
    conv.unread = 0;
    inbox.sort(function (a, b) {
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });
    publishList();
  }

  function sendMessage(body) {
    var conversationId = state.activeId;
    var user = state.user || {};
    var tempId = 'pending-' + Date.now();
    var createdAt = new Date().toISOString();
    appendMessages([{
      id: tempId,
      body: body,
      kind: 'text',
      createdAt: createdAt,
      mine: true,
      pending: true,
      senderId: user.id,
      senderName: user.displayName || user.username || '',
      senderAvatar: user.avatarUrl || ''
    }], { optimistic: true });
    touchInboxPreview(conversationId, body, createdAt);

    PATS.rpc('sendMessage', { conversationId: conversationId, body: body })
      .then(function (message) {
        if (state.activeId !== conversationId) return;
        settlePending(tempId, message);
        return refreshList();
      })
      .catch(function (err) {
        removeMessageNode(tempId);
        var input = $('#composer-input');
        if (input && state.activeId === conversationId && !input.value) {
          input.value = body;
          input.dispatchEvent(new Event('input'));
        }
        handleError(err);
      });
  }

  function settlePending(tempId, message) {
    var pending = messageNode(tempId);
    var existing = messageNode(message.id);
    if (existing) {
      if (pending) removeMessageNode(tempId);
    } else if (pending) {
      pending.setAttribute('data-id', message.id);
      pending.classList.remove('is-pending');
      var time = pending.querySelector('.time');
      if (time) time.textContent = PATS.formatTime(message.createdAt);
      syncThreadCursor();
    } else {
      appendMessages([message]);
    }
    state.lastMessageAt = message.createdAt;
  }

  function removeMessageNode(id) {
    var node = messageNode(id);
    if (!node) return;
    var prev = node.previousElementSibling;
    node.remove();
    if (prev && prev.classList.contains('msg-day')) {
      var next = prev.nextElementSibling;
      if (!next || !next.classList.contains('msg')) prev.remove();
    }
    syncThreadCursor();
  }

  function syncThreadCursor() {
    var body = $('#chat-body');
    thread = { day: '', sender: '' };
    if (!body) return;
    var days = body.querySelectorAll('.msg-day');
    var msgs = body.querySelectorAll('.msg');
    if (days.length) thread.day = days[days.length - 1].textContent;
    if (msgs.length) thread.sender = msgs[msgs.length - 1].getAttribute('data-sender') || '';
  }

  function appendMessages(messages, options) {
    var body = $('#chat-body');
    if (!body || !messages || !messages.length) return;
    var fresh = [];
    for (var i = 0; i < messages.length; i++) {
      if (!messageNode(messages[i].id)) fresh.push(messages[i]);
    }
    if (!fresh.length) return;
    var before = body.scrollHeight;
    renderMessages(body, fresh, true);
    if (!options || !options.optimistic) {
      state.lastMessageAt = fresh[fresh.length - 1].createdAt;
    }
    if (body.scrollHeight !== before) scrollToBottom();
  }

  function isChatView(view) {
    return view === 'dm' || view === 'group' || view === 'archive';
  }

  function schedulePoll(delay) {
    clearTimeout(pollTimer);
    if (!polling) return;
    pollTimer = setTimeout(runPoll, delay);
  }

  /**
   * 上一輪沒回來就不再疊加請求。分頁在背景時暫停。
   * 開著對話時，新訊息每 6 秒抓一次，列表每 12 秒抓一次。
   */
  function runPoll() {
    if (!polling || pollRunning) return;
    if (document.hidden || !state.user || !isChatView(state.view)) {
      schedulePoll(POLL_INTERVAL_MS);
      return;
    }

    pollRunning = true;
    pollTick += 1;
    var jobs = [];
    var conversationId = state.activeId;

    if (conversationId) {
      var payload = { conversationId: conversationId };
      if (state.lastMessageAt) payload.since = state.lastMessageAt;
      jobs.push(
        PATS.rpc('listMessages', payload)
          .then(function (data) {
            if (state.activeId !== conversationId || !data || !data.messages || !data.messages.length) return;
            appendMessages(data.messages);
            return PATS.rpc('markRead', { conversationId: conversationId });
          })
          .catch(function () { /* 輪詢錯誤不打擾使用者 */ })
      );
    }

    if (!conversationId || pollTick % LIST_POLL_EVERY === 0) {
      jobs.push(refreshList({ quiet: true }));
    }

    Promise.all(jobs).then(function () {
      pollRunning = false;
      schedulePoll(POLL_INTERVAL_MS);
    });
  }

  function startPolling() {
    stopPolling();
    polling = true;
    pollTick = 0;
    schedulePoll(POLL_INTERVAL_MS);
  }

  function stopPolling() {
    polling = false;
    pollRunning = false;
    clearTimeout(pollTimer);
    pollTimer = null;
    state.poller = null;
  }

  /* ------------------------------------------------------------ 互動操作 */

  function openConversationMenu(anchor, conv) {
    var archived = state.view === 'archive';
    var items = [];
    items.push({
      label: conv.type === 'group' ? '群組通話' : '語音通話',
      icon: 'call',
      onSelect: function () { startCall(conv); }
    });
    items.push({
      label: conv.type === 'group' ? '群組視訊' : '視訊通話',
      icon: 'videocam',
      onSelect: function () { startCall(conv, { video: true }); }
    });
    items.push(
      {
        label: archived ? '移回主要訊息' : '封存這個對話',
        icon: archived ? 'unarchive' : 'archive',
        onSelect: function () { setArchived(conv.id, !archived); }
      },
      {
        label: '標記為已讀',
        icon: 'mark_email_read',
        onSelect: function () {
          PATS.rpc('markRead', { conversationId: conv.id })
            .then(function () { return refreshList(); })
            .catch(handleError);
        }
      }
    );
    PATS.openMenu(anchor, items);
  }

  function setArchived(conversationId, archived) {
    PATS.rpc('setArchived', { conversationId: conversationId, archived: archived })
      .then(function () {
        if (state.activeId === conversationId) {
          state.activeId = null;
          renderPlaceholder();
        }
        PATS.toast(archived ? '已移至封存。' : '已移回主要訊息。', 'success');
        return refreshList();
      })
      .catch(handleError);
  }

  function promptInviteContact() {
    PATS.openModal({
      title: '邀請朋友',
      lead: '輸入對方在 PATS 的電子郵件或帳號，即可加入聯絡人並開始對話。',
      fields: [{ name: 'account', label: '電子郵件 / 帳號', placeholder: 'name@company.com' }],
      confirmText: '建立對話',
      onSubmit: function (values) {
        if (!values.account) throw new Error('請輸入電子郵件或帳號。');
        return PATS.rpc('startDirect', { account: values.account })
          .then(function (result) {
            PATS.toast('對話已建立。', 'success');
            // 不 await 列表重整，讓彈窗立刻關閉
            var id = result.conversationId;
            refreshList()
              .then(function () { return openConversation(id); })
              .catch(handleError);
          });
      }
    });
  }

  function promptCreateGroup() {
    PATS.openModal({
      title: '建立新群組',
      lead: '成員可一次加多人：用逗號、中文逗號或換行分隔電子郵件／帳號。之後仍可再新增。',
      fields: [
        { name: 'name', label: '群組名稱', placeholder: '例如：產品開發組' },
        {
          name: 'members',
          label: '成員（選填，可多人）',
          type: 'textarea',
          rows: 3,
          placeholder: '例：\na@company.com\nb@company.com\n或：a@company.com, b@company.com'
        }
      ],
      confirmText: '建立群組',
      onSubmit: function (values) {
        var members = values.members
          ? values.members.split(/[,，\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean)
          : [];
        return PATS.rpc('createGroup', { name: values.name, members: members })
          .then(function (result) {
            if (result.missing.length) {
              PATS.toast('找不到這些成員：' + result.missing.join('、'), 'error');
            } else {
              PATS.toast('群組已建立。', 'success');
            }
            // RPC 成功後立刻讓彈窗關閉；列表與開啟對話在背景進行
            var id = result.conversationId;
            PatsMain.setView('group');
            refreshList()
              .then(function () { return openConversation(id); })
              .catch(handleError);
          });
      }
    });
  }

  function compose() {
    if (state.view === 'group') promptCreateGroup();
    else promptInviteContact();
  }

  function handleError(err) {
    if (err.code === 'AUTH_REQUIRED') return PatsAuth.logout({ relogin: true });
    PATS.toast(err.message, 'error');
  }

  /* ---------------------------------------------------------------- 綁定 */

  function init() {
    $('#list-compose').addEventListener('click', compose);

    $('#list-more').addEventListener('click', function (event) {
      PATS.openMenu(event.currentTarget, [
        { label: '邀請朋友', icon: 'person_add', onSelect: promptInviteContact },
        { label: '建立新群組', icon: 'group_add', onSelect: promptCreateGroup },
        { label: '重新整理', icon: 'refresh', onSelect: function () { refreshList(); } }
      ]);
    });

    $('#list-search').addEventListener('input', function (event) {
      state.keyword = event.target.value.trim();
      publishList();
    });

    document.addEventListener('visibilitychange', function () {
      if (!polling || document.hidden || pollRunning) return;
      clearTimeout(pollTimer);
      runPoll();
    });
  }

  return {
    init: init,
    refreshList: refreshList,
    renderPlaceholder: renderPlaceholder,
    openConversation: openConversation,
    startPolling: startPolling,
    stopPolling: stopPolling,
    handleError: handleError
  };
})();
