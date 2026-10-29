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
  var PAGE_SIZE = 50;
  var OLDER_TRIGGER_PX = 120;

  /* 目前對話的往上翻頁狀態；currentConv 是存進本機快取用的對話資訊 */
  var older = { hasMore: false, loading: false };
  var currentConv = null;

  var inbox = [];
  var listSignature = '';
  var loadedScope = '';
  var thread = { day: '', sender: '' };
  var scrollState = { unseen: 0 };
  var NEAR_BOTTOM_PX = 120;
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
    currentConv = conv;

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

    var body = el('div', { class: 'chat-body scroll-y', id: 'chat-body', 'data-conv': conv.id });
    pane.appendChild(body);
    thread = { day: '', sender: '' };
    renderMessages(body, data.messages, false);

    scrollState.unseen = 0;
    var jump = el('button', {
      class: 'chat-jump', type: 'button', id: 'chat-jump',
      title: '滑到最新訊息', 'aria-label': '滑到最新訊息'
    }, [icon('keyboard_arrow_down'), el('span', { class: 'chat-jump-badge' })]);
    jump.addEventListener('click', function () { scrollToBottom({ smooth: true }); });
    pane.appendChild(jump);

    var scrollQueued = false;
    body.addEventListener('scroll', function () {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(function () {
        scrollQueued = false;
        var near = isNearBottom(body);
        body.setAttribute('data-stick', near ? '1' : '0');
        if (near) scrollState.unseen = 0;
        syncJumpButton();
        if (body.scrollTop < OLDER_TRIGGER_PX) loadOlder();
      });
    }, { passive: true });

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

  /* ---------------------------------------------------------- 聊天圖片 */

  var IMAGE_MAX_EDGE = 1280;
  var IMAGE_JPEG_QUALITY = 0.72;
  var IMAGE_MAX_BYTES = 1200000; // 1.2MB

  function isImageMessage(message) {
    if (!message) return false;
    if (message.kind === 'image') return true;
    if (message.localPreview) return true;
    return String(message.body || '').indexOf('IMAGE|') === 0;
  }

  /** IMAGE|<fileId>|<expiresAt>|<w>|<h>；fileId 為 EXPIRED 表示已過期 */
  function parseImageMeta(message) {
    if (!message) return null;
    if (message.localPreview) {
      return {
        expired: false,
        fileId: '',
        expiresAt: '',
        width: message.width || 0,
        height: message.height || 0,
        previewUrl: message.localPreview
      };
    }
    var raw = String(message.body || '');
    if (raw.indexOf('IMAGE|') !== 0) return null;
    var parts = raw.split('|');
    var fileId = parts[1] || '';
    return {
      expired: fileId === 'EXPIRED',
      fileId: fileId === 'EXPIRED' ? '' : fileId,
      expiresAt: parts[2] || '',
      width: Number(parts[3]) || 0,
      height: Number(parts[4]) || 0,
      previewUrl: ''
    };
  }

  /** 顯示用網址：lh3 較穩；失敗再退回 Drive thumbnail */
  function driveImageUrl(fileId, size, kind) {
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) return '';
    var sz = size || 'w1000';
    var w = parseInt(String(sz).replace(/\D/g, ''), 10) || 1000;
    if (kind === 'thumb') {
      return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=' + sz;
    }
    // googleusercontent 直接出圖，比 thumbnail 少遇到空白／壞圖
    return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=w' + w;
  }

  function attachImageFallbacks(img, fileId, size) {
    if (!img || !fileId) return;
    var tried = 0;
    img.addEventListener('error', function onErr() {
      tried += 1;
      if (tried === 1) {
        img.src = driveImageUrl(fileId, size, 'thumb');
        return;
      }
      if (tried === 2) {
        img.src = 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(fileId);
        return;
      }
      img.removeEventListener('error', onErr);
    });
  }

  function defaultImageFileName() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return 'pats-' + d.getFullYear()
      + pad(d.getMonth() + 1) + pad(d.getDate()) + '-'
      + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.jpg';
  }

  function base64ToBlob(b64, mime) {
    var bin = atob(String(b64 || ''));
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i += 1) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/jpeg' });
  }

  function saveImageBlob(blob, fileName) {
    fileName = fileName || defaultImageFileName();
    if (PATS.isNativeApp) return saveImageNative(blob, fileName);
    var mime = blob.type || 'image/jpeg';
    var file;
    try {
      file = new File([blob], fileName, { type: mime });
    } catch (e) {
      file = null;
    }

    if (file && navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: fileName }).then(function () {
            PATS.toast('已分享／儲存', 'success');
          }).catch(function (err) {
            if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
            return fallbackDownloadBlob(blob, fileName);
          });
        }
      } catch (e2) { /* fall through */ }
    }
    return fallbackDownloadBlob(blob, fileName);
  }

  /**
   * Android APP 的 WebView 不支援 Web Share，也不會處理 blob 下載：
   * 先寫進 APP 的快取資料夾，再叫出系統分享選單（可存到相簿、傳給別人）。
   */
  function saveImageNative(blob, fileName) {
    var fs = PATS.nativePlugin('Filesystem');
    var share = PATS.nativePlugin('Share');
    if (!fs || !share) return Promise.reject(new Error('請更新 APP 後再下載圖片。'));
    return blobToBase64(blob)
      .then(function (data) {
        return fs.writeFile({ path: fileName, data: data, directory: 'CACHE' });
      })
      .then(function (written) {
        return share.share({ title: fileName, files: [written.uri] });
      })
      .catch(function (err) {
        // 使用者自己關掉分享選單不算錯誤
        if (err && /cancel/i.test(String(err.message || err))) return;
        throw err;
      });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function fallbackDownloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIos) {
      var opened = window.open(url, '_blank');
      if (!opened) {
        PATS.toast('請允許開啟新分頁，再長按圖片儲存到照片。', 'error');
      } else {
        PATS.toast('請長按圖片 → 儲存到照片');
      }
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }, 60000);
      return Promise.resolve();
    }

    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 2000);
    PATS.toast('已下載', 'success');
    return Promise.resolve();
  }

  function fetchBlobFromUrl(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw PATS.fail('NETWORK');
      return res.blob();
    });
  }

  /**
   * opts: { url, conversationId, messageId, localBlobUrl }
   */
  function openImageViewer(opts) {
    if (typeof opts === 'string') opts = { url: opts };
    opts = opts || {};
    var url = opts.url || opts.localBlobUrl || '';
    if (!url) return;
    var root = $('#modal-root');
    if (!root) return;
    function close() { root.innerHTML = ''; }

    var img = el('img', {
      class: 'img-viewer-pic', src: url, alt: '圖片',
      referrerpolicy: 'no-referrer'
    });
    if (opts.fileId && !opts.localBlobUrl) attachImageFallbacks(img, opts.fileId, 'w2400');
    img.addEventListener('click', function (e) { e.stopPropagation(); });

    var downloadBtn = el('button', {
      class: 'img-viewer-download',
      type: 'button',
      text: '下載'
    });
    downloadBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (downloadBtn.disabled) return;
      downloadBtn.disabled = true;
      downloadBtn.textContent = '下載中…';
      PATS.toast('下載中…');

      var done = function () {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '下載';
      };

      var run;
      if (opts.localBlobUrl) {
        run = fetchBlobFromUrl(opts.localBlobUrl).then(function (blob) {
          return saveImageBlob(blob, defaultImageFileName());
        });
      } else if (opts.conversationId && opts.messageId
          && String(opts.messageId).indexOf('pending-') !== 0) {
        run = PATS.rpc('downloadChatImage', {
          conversationId: opts.conversationId,
          messageId: opts.messageId
        }).then(function (data) {
          var blob = base64ToBlob(data.dataBase64, data.mime || 'image/jpeg');
          return saveImageBlob(blob, data.fileName || defaultImageFileName());
        });
      } else {
        run = Promise.reject(PATS.fail('NOT_FOUND'));
      }

      run.catch(function (err) {
        handleError(err);
      }).then(done);
    });

    var toolbar = el('div', {
      class: 'img-viewer-toolbar',
      onclick: function (e) { e.stopPropagation(); }
    }, [downloadBtn]);

    var backdrop = el('div', {
      class: 'img-viewer-backdrop',
      onclick: close,
      role: 'dialog',
      'aria-label': '圖片預覽'
    }, [img, toolbar]);
    root.innerHTML = '';
    root.appendChild(backdrop);
  }

  function renderImageBubble(message) {
    var meta = parseImageMeta(message);
    var bubble = el('div', { class: 'bubble is-image' });
    if (!meta || meta.expired) {
      bubble.appendChild(el('div', {
        class: 'msg-image-expired',
        text: '圖片已過期（保存 20 天）'
      }));
      return bubble;
    }
    var src = meta.previewUrl || driveImageUrl(meta.fileId, 'w640');
    if (!src) {
      bubble.appendChild(el('div', { class: 'msg-image-expired', text: '無法顯示圖片' }));
      return bubble;
    }
    var img = el('img', {
      class: 'msg-image',
      src: src,
      alt: '圖片',
      loading: 'lazy',
      referrerpolicy: 'no-referrer'
    });
    if (meta.previewUrl) img.setAttribute('data-blob', meta.previewUrl);
    if (meta.fileId) img.setAttribute('data-file-id', meta.fileId);
    if (meta.fileId && !meta.previewUrl) attachImageFallbacks(img, meta.fileId, 'w640');
    // lazy 圖片載入後才撐高；使用者原本在底部時要重新貼底
    img.addEventListener('load', function () {
      var body = $('#chat-body');
      if (!body || !body.contains(img)) return;
      if (body.getAttribute('data-stick') === '1') scrollToBottom();
      else syncJumpButton();
    });
    // 上傳完成後本地 blob 會被釋放、訊息 id 也會換成正式 id，所以點擊時讀當下的屬性
    img.addEventListener('click', function () {
      var blobUrl = img.getAttribute('data-blob') || '';
      var fileId = img.getAttribute('data-file-id') || '';
      var msgNode = img.closest('.msg');
      var messageId = (msgNode && msgNode.getAttribute('data-id')) || message.id || '';
      var full = blobUrl || driveImageUrl(fileId, 'w2400');
      openImageViewer({
        url: full || img.currentSrc || img.src,
        localBlobUrl: blobUrl,
        conversationId: state.activeId || '',
        messageId: messageId,
        fileId: fileId
      });
    });
    bubble.appendChild(img);
    return bubble;
  }

  function applyImageToPendingNode(node, message) {
    if (!node || !message) return;
    var img = node.querySelector('img.msg-image');
    if (!img) return;
    var blob = img.getAttribute('data-blob');
    if (blob) {
      try { URL.revokeObjectURL(blob); } catch (e) { /* ignore */ }
      img.removeAttribute('data-blob');
    }
    var meta = parseImageMeta(message);
    if (!meta || meta.expired) {
      var bubble = node.querySelector('.bubble');
      if (bubble) {
        bubble.innerHTML = '';
        bubble.appendChild(el('div', {
          class: 'msg-image-expired',
          text: '圖片已過期（保存 20 天）'
        }));
      }
      return;
    }
    var url = driveImageUrl(meta.fileId, 'w640');
    if (url) {
      img.setAttribute('data-file-id', meta.fileId);
      img.setAttribute('referrerpolicy', 'no-referrer');
      attachImageFallbacks(img, meta.fileId, 'w640');
      img.src = url;
    }
  }

  /** 手機相簿常給空 MIME 或 HEIC；不能只靠 file.type === image/* */
  function looksLikeImageFile(file) {
    if (!file) return false;
    var t = String(file.type || '').toLowerCase();
    if (/^image\//.test(t)) return true;
    if (t) return false;
    var n = String(file.name || '').toLowerCase();
    // 空副檔名也試（部分 Android／iOS 相簿沒檔名）
    if (!n) return true;
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/.test(n);
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(PATS.fail('IMAGE_BAD_TYPE'));
        }, 'image/jpeg', quality);
        return;
      }
      try {
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        var comma = dataUrl.indexOf(',');
        var b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
        var bin = atob(b64);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/jpeg' }));
      } catch (err) {
        reject(PATS.fail('IMAGE_BAD_TYPE'));
      }
    });
  }

  function compressImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!looksLikeImageFile(file)) {
        reject(PATS.fail('IMAGE_BAD_TYPE'));
        return;
      }
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        try {
          var w = image.naturalWidth || image.width;
          var h = image.naturalHeight || image.height;
          if (!w || !h) {
            URL.revokeObjectURL(url);
            reject(PATS.fail('IMAGE_BAD_TYPE'));
            return;
          }
          var scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h));
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0, tw, th);
          URL.revokeObjectURL(url);
          canvasToJpegBlob(canvas, IMAGE_JPEG_QUALITY).then(function (blob) {
            if (blob.size > IMAGE_MAX_BYTES) {
              reject(PATS.fail('IMAGE_TOO_LARGE'));
              return;
            }
            var reader = new FileReader();
            reader.onload = function () {
              var dataUrl = String(reader.result || '');
              var comma = dataUrl.indexOf(',');
              var b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
              resolve({
                dataBase64: b64,
                mime: 'image/jpeg',
                width: tw,
                height: th,
                previewUrl: URL.createObjectURL(blob)
              });
            };
            reader.onerror = function () { reject(PATS.fail('IMAGE_BAD_TYPE')); };
            reader.readAsDataURL(blob);
          }).catch(reject);
        } catch (err) {
          try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
          reject(PATS.fail('IMAGE_BAD_TYPE'));
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(PATS.fail('IMAGE_BAD_TYPE'));
      };
      image.src = url;
    });
  }

  /** prepend 為 true 時是往上翻頁補舊訊息：不接手送出中的暫顯氣泡。 */
  function renderMessages(container, messages, appending, prepend) {
    var lastDay = appending ? thread.day : '';
    var previousSender = appending ? thread.sender : '';

    messages.forEach(function (message) {
      if (messageNode(message.id)) return;
      if (!prepend && message.mine && adoptPending(message)) {
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
        container.appendChild(el('div', {
          class: 'msg-system', text: message.body,
          'data-id': message.id, 'data-at': message.createdAt
        }));
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
      var content = isImageMessage(message) ? renderImageBubble(message) : bubbleNode(message.body);

      container.appendChild(el('div', {
        class: 'msg' + (message.mine ? ' is-mine' : '') + (isTail ? ' is-tail' : '') +
          (message.pending ? ' is-pending' : '') +
          (isImageMessage(message) ? ' is-image-msg' : ''),
        'data-id': message.id,
        'data-at': message.createdAt,
        'data-sender': message.senderId || '',
        'data-kind': isImageMessage(message) ? 'image' : (message.kind || 'text')
      }, [
        isTail ? el('div', { class: 'avatar', style: 'visibility:hidden' })
               : PATS.avatarNode(message.senderName, message.senderAvatar),
        el('div', { class: 'stack' }, [
          showSender ? el('div', { class: 'sender', text: message.senderName }) : null,
          content,
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
      'data-at': message.createdAt,
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
      var node = nodes[i];
      var bubble = node.querySelector('.bubble');
      if (!bubble) continue;
      var pendingImage = node.getAttribute('data-kind') === 'image';
      if (isImageMessage(message)) {
        if (!pendingImage) continue;
      } else if (bubble.textContent !== message.body) {
        continue;
      }
      node.setAttribute('data-id', message.id);
      node.setAttribute('data-at', message.createdAt);
      node.classList.remove('is-pending');
      var time = node.querySelector('.time');
      if (time) time.textContent = PATS.formatTime(message.createdAt);
      if (isImageMessage(message)) applyImageToPendingNode(node, message);
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
    // 手機（尤其 iOS）對 display:none 的 input + 程式 click() 常打不開相簿；
    // 改成透明 input 覆蓋按鈕，讓使用者直接點到 file input。
    var fileInput = el('input', {
      type: 'file',
      accept: 'image/*,image/heic,image/heif,.heic,.heif',
      class: 'composer-file-input',
      'aria-label': '傳送圖片'
    });
    var imageButton = el('button', {
      class: 'composer-attach', type: 'button',
      title: '傳送圖片', 'aria-label': '傳送圖片',
      tabIndex: '-1'
    }, [icon('image')]);
    var attachWrap = el('div', { class: 'composer-attach-wrap' }, [imageButton, fileInput]);
    var sendButton = el('button', {
      class: 'send', type: 'submit', 'aria-label': '傳送', disabled: 'disabled'
    }, [icon('send')]);

    function syncSend() {
      sendButton.disabled = !textarea.value.trim();
    }

    textarea.addEventListener('input', function () {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
      syncSend();
    });
    textarea.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      sendChatImage(file, attachWrap);
    });

    var form = el('form', { class: 'composer' }, [attachWrap, textarea, sendButton]);
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

  function isNearBottom(body) {
    if (!body) return true;
    return body.scrollHeight - body.scrollTop - body.clientHeight <= NEAR_BOTTOM_PX;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function scrollToBottom(opts) {
    var body = $('#chat-body');
    if (!body) return;
    if (opts && opts.smooth && !prefersReducedMotion() && typeof body.scrollTo === 'function') {
      body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    } else {
      body.scrollTop = body.scrollHeight;
    }
    body.setAttribute('data-stick', '1');
    scrollState.unseen = 0;
    syncJumpButton();
  }

  function syncJumpButton() {
    var btn = $('#chat-jump');
    var body = $('#chat-body');
    if (!btn || !body) return;
    var near = isNearBottom(body);
    if (near) scrollState.unseen = 0;
    btn.classList.toggle('is-visible', !near);
    var badge = btn.querySelector('.chat-jump-badge');
    var n = scrollState.unseen;
    if (badge) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.classList.toggle('hidden', n <= 0);
    }
    btn.setAttribute('aria-label', n > 0 ? ('滑到最新訊息（' + n + ' 則新訊息）') : '滑到最新訊息');
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
    if (window.PatsCache && loadedScope === 'dm' && state.view === 'dm') PatsCache.saveList('dm', inbox);

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

  /**
   * 開對話：本機有快取就先畫，再向伺服器要最近 50 則（同一次請求順便標已讀）。
   * 舊版後端回應沒有 ver，代表不認得 markRead 參數，改成另外呼叫一次。
   */
  function openConversation(conversationId) {
    resetThreadState_(conversationId);
    publishList();
    PatsMain.setMobilePane('chat');

    var cached = window.PatsCache ? PatsCache.getThread(conversationId) : null;
    if (cached) applyThread(cached, { fromCache: true });
    else if (!isRendered_(conversationId)) renderThreadLoading_();

    return PATS.rpc('listMessages', { conversationId: conversationId, limit: PAGE_SIZE, markRead: true })
      .then(function (data) {
        if (state.activeId !== conversationId) return;
        applyThread(data);
        if (data.ver === undefined) return PATS.rpc('markRead', { conversationId: conversationId });
      })
      .then(function () { refreshBadgesOnly(); })
      .catch(handleError);
  }

  /** 換到別的對話才清掉游標；重點同一個對話時保留畫面，之後用合併的方式更新。 */
  function resetThreadState_(conversationId) {
    var same = isRendered_(conversationId);
    state.activeId = conversationId;
    if (window.PatsCache) PatsCache.setActive(state.view === 'dm' ? conversationId : null);
    if (same) return;
    state.lastMessageAt = null;
    state.msgVer = null;
    state.messages = [];
    thread = { day: '', sender: '' };
    older = { hasMore: false, loading: false };
    currentConv = null;
  }

  function isRendered_(conversationId) {
    var body = $('#chat-body');
    return !!(body && body.getAttribute('data-conv') === conversationId);
  }

  function renderThreadLoading_() {
    var pane = $('#chat-pane');
    pane.innerHTML = '';
    pane.appendChild(el('div', { class: 'chat-loading', text: '載入對話中…' }));
  }

  /**
   * 把一份對話資料（快取或伺服器）放上畫面。
   * 畫面已是同一個對話且內容銜接得上時，只補新的訊息，不重畫，
   * 這樣先畫快取、再收到伺服器資料時不會閃一下、捲動位置與輸入框也不會被清掉。
   */
  function applyThread(data, options) {
    options = options || {};
    var conv = data.conversation;
    var messages = data.messages || [];
    state.activeType = conv.type;

    var body = $('#chat-body');
    var rendered = isRendered_(conv.id);
    if (rendered && canMerge_(body, messages)) {
      currentConv = conv;
      appendMessages(messages);
      older.hasMore = older.hasMore || !!data.hasMore;
    } else {
      var input = rendered ? $('#composer-input') : null;
      var draft = input ? input.value : '';
      renderConversation(data);
      state.messages = messages.slice();
      state.lastMessageAt = messages.length ? messages[messages.length - 1].createdAt : null;
      older = { hasMore: !!data.hasMore, loading: false };
      if (draft) {
        var fresh = $('#composer-input');
        fresh.value = draft;
        fresh.dispatchEvent(new Event('input'));
      }
    }

    if (!options.fromCache) {
      state.msgVer = data.ver || null;
      persistThread_();
    }
    upsertInboxFromConversation_(data);
    fillIfShort_();
  }

  /** 已畫出的訊息跟新資料有重疊、且重疊區間內沒有被刪掉的訊息，才能直接補。 */
  function canMerge_(body, messages) {
    if (!messages.length) return false;
    var nodes = body.querySelectorAll('[data-at]');
    if (!nodes.length) return false;
    var firstAt = Date.parse(messages[0].createdAt);
    var lastShown = Date.parse(nodes[nodes.length - 1].getAttribute('data-at'));
    if (lastShown < firstAt) return false;
    var ids = {};
    messages.forEach(function (m) { ids[m.id] = true; });
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].getAttribute('data-id') || '';
      if (id.indexOf('pending-') === 0) continue;
      if (Date.parse(nodes[i].getAttribute('data-at')) >= firstAt && !ids[id]) return false;
    }
    return true;
  }

  function persistThread_() {
    if (!window.PatsCache || !currentConv || currentConv.id !== state.activeId) return;
    PatsCache.saveThread(currentConv, state.messages, older.hasMore);
  }

  /** 訊息太少撐不出捲軸時，使用者沒辦法往上捲，直接先補一頁。 */
  function fillIfShort_() {
    requestAnimationFrame(function () {
      var body = $('#chat-body');
      if (body && older.hasMore && body.scrollHeight <= body.clientHeight + OLDER_TRIGGER_PX) loadOlder();
    });
  }

  /** 捲到頂端時載入更早的 50 則，插在最上面並維持目前看到的位置。 */
  function loadOlder() {
    var body = $('#chat-body');
    var conversationId = state.activeId;
    if (!body || !conversationId || older.loading || !older.hasMore) return;
    var oldest = body.querySelector('[data-at]');
    if (!oldest) return;

    older.loading = true;
    var hint = el('div', { class: 'msg-older', text: '載入更早的訊息…' });
    body.insertBefore(hint, body.firstChild);

    PATS.rpc('listMessages', {
      conversationId: conversationId,
      limit: PAGE_SIZE,
      before: oldest.getAttribute('data-at')
    })
      .then(function (data) {
        if (state.activeId !== conversationId || $('#chat-body') !== body) return;
        var list = (data && data.messages) || [];
        // 舊版後端不認得 before，會回傳整段對話；交給 prependMessages 去重後就不用再翻
        older.hasMore = !!data && data.ver !== undefined && !!data.hasMore && list.length > 0;
        prependMessages(body, list);
        state.messages = list.concat(state.messages);
        persistThread_();
      })
      .catch(function () { /* 下次捲到頂端再試 */ })
      .then(function () {
        hint.remove();
        older.loading = false;
        if ($('#chat-body') === body) fillIfShort_();
      });
  }

  function prependMessages(body, messages) {
    var fresh = messages.filter(function (m) { return !messageNode(m.id); });
    if (!fresh.length) return;

    var saved = thread;
    thread = { day: '', sender: '' };
    var holder = document.createElement('div');
    renderMessages(holder, fresh, false, true);
    var lastDay = thread.day;
    thread = saved;

    // 新補進來的最後一天跟原本最上面的日期相同時，拿掉重複的日期分隔
    var first = body.firstElementChild;
    while (first && first.classList.contains('msg-older')) first = first.nextElementSibling;
    if (first && first.classList.contains('msg-day') && first.textContent === lastDay) first.remove();

    var prevHeight = body.scrollHeight;
    var prevTop = body.scrollTop;
    var anchor = body.firstChild;
    while (anchor && anchor.classList && anchor.classList.contains('msg-older')) anchor = anchor.nextSibling;
    while (holder.firstChild) body.insertBefore(holder.firstChild, anchor);
    body.scrollTop = prevTop + (body.scrollHeight - prevHeight);
  }

  /**
   * 開網頁時用快取或 bootstrap 的資料直接畫列表與對話，不另外打 listConversations。
   * data: { list, thread, fromCache, missingId }
   */
  function hydrate(data) {
    data = data || {};
    loadedScope = 'dm';
    var keptActive = findInboxRow_(state.activeId);
    inbox = (data.list || []).slice();

    var t = data.thread;
    if (t && t.conversation && (!state.activeId || state.activeId === t.conversation.id)) {
      if (state.activeId !== t.conversation.id) {
        resetThreadState_(t.conversation.id);
        PatsMain.setMobilePane('chat');
      }
      listSignature = '';
      applyThread(t, { fromCache: data.fromCache });
      if (!data.fromCache) refreshBadgesOnly();
      return;
    }

    if (data.missingId && state.activeId === data.missingId) {
      state.activeId = null;
      renderPlaceholder();
      PatsMain.setMobilePane('list');
    } else if (keptActive && !findInboxRow_(keptActive.id)) {
      inbox.unshift(keptActive);
    }
    listSignature = '';
    return publishList({ autoSelect: !data.fromCache });
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
      var lastText = isImageMessage(last) ? '傳送了圖片' : last.body;
      preview = last.kind === 'system'
        ? last.body
        : ((last.mine ? '你' : (last.senderName || '')) + (lastText ? '：' + lastText : ''));
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

  function setAttachBusy(attachWrap, busy) {
    if (!attachWrap) return;
    attachWrap.classList.toggle('is-busy', !!busy);
    var input = attachWrap.querySelector('.composer-file-input');
    if (input) input.disabled = !!busy;
    var btn = attachWrap.querySelector('.composer-attach');
    if (btn) btn.disabled = !!busy;
  }

  function sendChatImage(file, attachWrap) {
    var conversationId = state.activeId;
    if (!conversationId) return;
    var user = state.user || {};
    setAttachBusy(attachWrap, true);
    PATS.toast('傳送圖片中…');

    compressImageFile(file).then(function (packed) {
      var tempId = 'pending-' + Date.now();
      var createdAt = new Date().toISOString();
      appendMessages([{
        id: tempId,
        body: '',
        kind: 'image',
        localPreview: packed.previewUrl,
        width: packed.width,
        height: packed.height,
        createdAt: createdAt,
        mine: true,
        pending: true,
        senderId: user.id,
        senderName: user.displayName || user.username || '',
        senderAvatar: user.avatarUrl || ''
      }], { optimistic: true });
      touchInboxPreview(conversationId, '傳送了圖片', createdAt);

      return PATS.rpc('sendChatImage', {
        conversationId: conversationId,
        dataBase64: packed.dataBase64,
        mime: packed.mime,
        width: packed.width,
        height: packed.height
      }).then(function (message) {
        if (state.activeId !== conversationId) {
          try { URL.revokeObjectURL(packed.previewUrl); } catch (e) { /* ignore */ }
          return;
        }
        settlePending(tempId, message);
        return refreshList();
      }).catch(function (err) {
        var node = messageNode(tempId);
        if (node) {
          var img = node.querySelector('img.msg-image');
          var blob = img && img.getAttribute('data-blob');
          if (blob) {
            try { URL.revokeObjectURL(blob); } catch (e) { /* ignore */ }
          }
          removeMessageNode(tempId);
        } else {
          try { URL.revokeObjectURL(packed.previewUrl); } catch (e) { /* ignore */ }
        }
        handleError(err);
      });
    }).catch(function (err) {
      handleError(err);
    }).then(function () {
      setAttachBusy(attachWrap, false);
    });
  }

  function settlePending(tempId, message) {
    var pending = messageNode(tempId);
    var existing = messageNode(message.id);
    if (existing) {
      if (pending) {
        var img = pending.querySelector('img.msg-image');
        var blob = img && img.getAttribute('data-blob');
        if (blob) {
          try { URL.revokeObjectURL(blob); } catch (e) { /* ignore */ }
        }
        removeMessageNode(tempId);
      }
    } else if (pending) {
      pending.setAttribute('data-id', message.id);
      pending.classList.remove('is-pending');
      var time = pending.querySelector('.time');
      if (time) time.textContent = PATS.formatTime(message.createdAt);
      if (isImageMessage(message)) applyImageToPendingNode(pending, message);
      pending.setAttribute('data-at', message.createdAt);
      syncThreadCursor();
      state.messages = (state.messages || []).concat([message]);
      persistThread_();
    } else {
      appendMessages([message]);
    }
    state.lastMessageAt = message.createdAt;
  }

  function removeMessageNode(id) {
    var node = messageNode(id);
    if (!node) return;
    var img = node.querySelector('img.msg-image');
    var blob = img && img.getAttribute('data-blob');
    if (blob) {
      try { URL.revokeObjectURL(blob); } catch (e) { /* ignore */ }
    }
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
    options = options || {};
    var wasNear = isNearBottom(body);
    var hasMine = false;
    var othersCount = 0;
    for (var j = 0; j < fresh.length; j++) {
      if (fresh[j].mine) hasMine = true;
      else othersCount += 1;
    }
    renderMessages(body, fresh, true);
    if (!options.optimistic) {
      state.lastMessageAt = fresh[fresh.length - 1].createdAt;
      state.messages = (state.messages || []).concat(fresh);
      persistThread_();
    }
    if (wasNear || hasMine || options.forceScroll || options.optimistic) {
      scrollToBottom();
    } else {
      scrollState.unseen += othersCount;
      syncJumpButton();
    }
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
    // 電腦版縮到系統匣時也要繼續抓，才能跳新訊息通知
    if ((document.hidden && !PATS.isDesktopApp) || !state.user || !isChatView(state.view)) {
      schedulePoll(POLL_INTERVAL_MS);
      return;
    }

    pollRunning = true;
    pollTick += 1;
    var jobs = [];
    var conversationId = state.activeId;

    // 對話還在載入（畫面不是這個對話）時先不輪詢訊息，避免塞進別的對話畫面
    if (conversationId && isRendered_(conversationId)) {
      // 帶上次的 ver：伺服器那邊訊息沒變就直接回空，不必讀試算表
      var payload = { conversationId: conversationId, markRead: true };
      if (state.lastMessageAt) payload.since = state.lastMessageAt;
      if (state.lastMessageAt && state.msgVer) payload.ver = state.msgVer;
      jobs.push(
        PATS.rpc('listMessages', payload)
          .then(function (data) {
            if (state.activeId !== conversationId || !data) return;
            if (data.ver) state.msgVer = data.ver;
            if (!data.messages || !data.messages.length || !isRendered_(conversationId)) return;
            appendMessages(data.messages);
            if (data.ver === undefined) return PATS.rpc('markRead', { conversationId: conversationId });
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

  /** options.immediate：畫面上的資料可能是舊的（例如只有快取），馬上抓一次。 */
  function startPolling(options) {
    stopPolling();
    polling = true;
    pollTick = 0;
    schedulePoll(options && options.immediate ? 0 : POLL_INTERVAL_MS);
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
    hydrate: hydrate,
    startPolling: startPolling,
    stopPolling: stopPolling,
    handleError: handleError
  };
})();
