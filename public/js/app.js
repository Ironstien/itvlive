(function () {
  const STORAGE_NAME = 'itv-displayName';

  const $ = (sel) => document.querySelector(sel);
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  function requireSocket() {
    if (typeof io === 'undefined') {
      toast('Live features need the Phase 1 server. Stop the old server (Ctrl+C), then start again.', true);
      return false;
    }
    if (!socket?.connected) {
      toast('Not connected yet. Wait a moment or refresh the page.', true);
      return false;
    }
    return true;
  }

  function emitAck(event, payload, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!requireSocket()) {
        reject(new Error('Not connected'));
        return;
      }
      const timer = setTimeout(() => reject(new Error('Request timed out — is the server running?')), timeoutMs);
      socket.emit(event, payload, (res) => {
        clearTimeout(timer);
        resolve(res || {});
      });
    });
  }

  const toast = (msg, isError) => {
    const el = $('#control-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    show(el, true);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => show(el, false), 4000);
  };

  let socket = null;
  let mySocketId = null;
  let roomState = null;
  let myPlaylist = [];

  // —— Tabs ——
  document.querySelectorAll('.chat-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.chat-tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.chat-pane').forEach((p) => {
        p.classList.toggle('active', p.dataset.pane === target);
      });
    });
  });

  // —— Vote slider preview (disabled until Phase 2) ——
  const voteSlider = $('#vote-slider');
  const voteValue = $('#vote-value');
  if (voteSlider && voteValue) {
    voteSlider.addEventListener('input', () => {
      voteValue.textContent = voteSlider.value;
    });
  }

  function getDisplayName() {
    return localStorage.getItem(STORAGE_NAME) || '';
  }

  function saveDisplayName(name) {
    localStorage.setItem(STORAGE_NAME, name);
  }

  function connectSocket(displayName) {
    if (typeof io === 'undefined') {
      toast('Socket.io missing — restart server (npm.cmd start)', true);
      return;
    }

    if (socket?.connected) socket.disconnect();

    socket = io({
      auth: { displayName },
    });

    socket.on('connect', () => {
      mySocketId = socket.id;
      $('#nav-display-name').textContent = displayName;
      socket.emit('user:setName', { name: displayName });
    });

    socket.on('connect_error', (err) => {
      toast(err.message || 'Could not connect to live server', true);
    });

    socket.on('disconnect', () => {
      toast('Disconnected — refresh page', true);
    });

    socket.on('room:state', (state) => {
      roomState = state;
      renderRoom(state);
    });

    socket.on('player:sync', (payload) => {
      ITVPlayer.sync(payload);
      ITVAmbient.sync(payload, () => ITVPlayer.getCurrentTime());
      updateDjBanner(payload);
    });

    socket.on('playlist:sync', (list) => {
      myPlaylist = list || [];
      renderPlaylist(myPlaylist);
    });
  }

  function updateDjBanner(player) {
    const dj = $('#dj-name');
    const title = $('#now-title');
    if (!player?.videoId) {
      if (dj) dj.textContent = '—';
      if (title) title.textContent = '—';
      return;
    }
    if (dj) dj.textContent = player.djName || '—';
    if (title) title.textContent = player.title || '—';
  }

  function getAirSignMode(state) {
    if (!mySocketId || !state) return 'listening';

    if (state.nowPlaying?.socketId === mySocketId) return 'on-air';

    const me = (state.users || []).find((u) => u.socketId === mySocketId);
    if (me?.inQueue) return 'off-air';

    return 'listening';
  }

  function updateAirSign(state) {
    const el = $('#air-sign');
    if (!el) return;
    const mode = getAirSignMode(state);
    const labels = {
      'on-air': 'ON AIR',
      'off-air': 'OFF AIR',
      listening: 'Listening',
    };
    el.className = `air-sign air-sign--${mode}`;
    const textEl = el.querySelector('.air-sign__text');
    if (textEl) textEl.textContent = labels[mode];
  }

  function getQueueButtonMode(state) {
    if (!mySocketId || !state) return 'join';

    if (state.nowPlaying?.socketId === mySocketId) return 'skip';

    const me = (state.users || []).find((u) => u.socketId === mySocketId);
    if (me?.inQueue) return 'leave';

    return 'join';
  }

  function updateQueueButton(state) {
    const btn = $('#btn-queue-action');
    if (!btn) return;
    const mode = getQueueButtonMode(state);
    const labels = {
      join: 'Join Queue',
      leave: 'Leave Queue',
      skip: 'Skip Song',
    };
    btn.dataset.mode = mode;
    btn.textContent = labels[mode];
    btn.title = labels[mode];
  }

  function renderRoom(state) {
    if (!state) return;

    // DJ banner only — never touch the YouTube player here (chat/queue updates)
    if (state.nowPlaying) {
      updateDjBanner({
        videoId: state.nowPlaying.videoId,
        djName: state.nowPlaying.djName,
        title: state.nowPlaying.title,
      });
    } else {
      updateDjBanner({ videoId: null });
    }

    const chatEl = $('#chat-messages');
    if (chatEl) {
      chatEl.innerHTML = '';
      (state.chat || []).forEach((m) => {
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<strong>${escapeHtml(m.displayName)}</strong> ${escapeHtml(m.text)}`;
        chatEl.appendChild(div);
      });
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    const onlineEl = $('#online-list');
    if (onlineEl) {
      onlineEl.innerHTML = '';
      (state.users || []).forEach((u) => {
        const li = document.createElement('li');
        const you = u.socketId === mySocketId ? ' (you)' : '';
        const q = u.inQueue ? ' · in queue' : '';
        li.textContent = `${u.displayName}${you}${q}`;
        onlineEl.appendChild(li);
      });
    }

    const nowPlayingEl = $('#queue-now-playing');
    const nowDjEl = $('#queue-now-dj');
    if (nowPlayingEl && nowDjEl) {
      if (state.nowPlaying) {
        nowDjEl.textContent = state.nowPlaying.djName;
        show(nowPlayingEl, true);
      } else {
        show(nowPlayingEl, false);
      }
    }

    const queueEl = $('#global-queue-list');
    if (queueEl) {
      queueEl.innerHTML = '';
      const playingId = state.nowPlaying?.socketId;
      const waiting = (state.globalQueue || []).filter((e) => e.socketId !== playingId);
      waiting.forEach((e) => {
        const li = document.createElement('li');
        li.textContent = e.djName;
        queueEl.appendChild(li);
      });
      if (!state.nowPlaying && waiting.length === 0) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'Queue is empty';
        queueEl.appendChild(li);
      }
    }

    const pit = $('#vinyl-pit');
    if (pit) {
      pit.innerHTML = '';
      (state.users || []).forEach((u) => {
        const disc = document.createElement('div');
        disc.className = 'vinyl-user';
        disc.title = u.displayName;
        disc.innerHTML = `<div class="vinyl-disc-small"></div><span>${escapeHtml(u.displayName)}</span>`;
        pit.appendChild(disc);
      });
      if ((state.users || []).length === 0) {
        pit.innerHTML = '<p class="panel-placeholder">Waiting for listeners…</p>';
      }
    }

    updateQueueButton(state);
    updateAirSign(state);
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function playlistThumbnail(item) {
    return item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`;
  }

  function playlistMeta(item) {
    const parts = [];
    if (item.channel) parts.push(item.channel);
    const dur = formatDuration(item.duration);
    if (dur) parts.push(dur);
    return parts.join(' • ');
  }

  function reorderPlaylistIds(dragId, targetId, insertBefore) {
    const ids = myPlaylist.map((s) => s.id);
    const from = ids.indexOf(dragId);
    let to = ids.indexOf(targetId);
    if (from === -1 || to === -1 || from === to) return null;

    if (insertBefore) {
      if (from < to) to -= 1;
    } else if (from > to) {
      to += 1;
    }

    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    return ids;
  }

  function clearPlaylistDragState(ul) {
    ul.querySelectorAll('.playlist-item').forEach((el) => {
      el.classList.remove('is-dragging', 'drag-over-above', 'drag-over-below');
    });
  }

  function initPlaylistDragDrop() {
    const ul = $('#playlist-list');
    if (!ul || ul.dataset.dndInit) return;
    ul.dataset.dndInit = '1';

    let dragId = null;

    ul.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.playlist-item');
      if (!item || e.target.closest('[data-remove]')) {
        e.preventDefault();
        return;
      }
      dragId = item.dataset.id;
      item.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });

    ul.addEventListener('dragend', () => {
      dragId = null;
      clearPlaylistDragState(ul);
    });

    ul.addEventListener('dragover', (e) => {
      const item = e.target.closest('.playlist-item');
      if (!item || !dragId || item.dataset.id === dragId) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      ul.querySelectorAll('.playlist-item').forEach((el) => {
        el.classList.remove('drag-over-above', 'drag-over-below');
      });

      const rect = item.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      item.classList.add(insertBefore ? 'drag-over-above' : 'drag-over-below');
    });

    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = e.target.closest('.playlist-item');
      if (!target || !dragId || target.dataset.id === dragId) {
        clearPlaylistDragState(ul);
        return;
      }

      const rect = target.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      const orderedIds = reorderPlaylistIds(dragId, target.dataset.id, insertBefore);

      clearPlaylistDragState(ul);
      dragId = null;

      if (!orderedIds) return;
      socket.emit('playlist:reorder', { orderedIds }, (res) => {
        if (res?.error) toast(res.error, true);
      });
    });
  }

  function renderPlaylist(list) {
    const ul = $('#playlist-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="muted">No songs yet — paste a YouTube link above.</li>';
      return;
    }
    list.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'playlist-item';
      li.dataset.id = item.id;
      li.draggable = true;
      li.title = 'Drag to reorder';
      const meta = playlistMeta(item);
      li.innerHTML = `
        <img class="pl-thumb" src="${escapeHtml(playlistThumbnail(item))}" alt="" loading="lazy" draggable="false" />
        <div class="pl-info">
          <span class="pl-title">${escapeHtml(item.title)}</span>
          ${meta ? `<span class="pl-meta">${escapeHtml(meta)}</span>` : ''}
        </div>
        <span class="pl-actions">
          <button type="button" class="btn-icon" data-remove title="Remove" draggable="false">×</button>
        </span>
      `;
      li.querySelector('[data-remove]').addEventListener('click', () => {
        socket.emit('playlist:remove', { itemId: item.id }, (res) => {
          if (res?.error) toast(res.error, true);
        });
      });
      ul.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showNameModal() {
    const modal = $('#name-modal');
    const input = $('#name-input');
    show(modal, true);
    input.value = getDisplayName();
    input.focus();
  }

  function hideNameModal() {
    show($('#name-modal'), false);
  }

  function startWithName(name) {
    const trimmed = name.trim().slice(0, 24);
    if (trimmed.length < 2) {
      toast('Name must be at least 2 characters', true);
      return;
    }
    saveDisplayName(trimmed);
    hideNameModal();
    connectSocket(trimmed);
  }

  $('#name-save')?.addEventListener('click', () => startWithName($('#name-input').value));
  $('#name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startWithName($('#name-input').value);
  });
  $('#btn-change-name')?.addEventListener('click', showNameModal);

  $('#playlist-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#playlist-url').value;
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const res = await emitAck('playlist:add', { url });
      if (res.error) {
        toast(res.error, true);
      } else {
        $('#playlist-url').value = '';
        toast('Song added');
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#btn-rip')?.addEventListener('click', () => {
    socket.emit('playlist:rip', {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast('Ripped to your playlist');
    });
  });

  $('#btn-queue-action')?.addEventListener('click', () => {
    const mode = $('#btn-queue-action')?.dataset.mode || 'join';
    const actions = {
      join: { event: 'queue:join', ok: 'Joined the DJ queue' },
      leave: { event: 'queue:leave', ok: 'Left the queue' },
      skip: { event: 'queue:skip-current', ok: 'Skipped to next track' },
    };
    const action = actions[mode];
    if (!action) return;
    socket.emit(action.event, {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast(action.ok);
    });
  });

  $('#chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await emitAck('chat:send', { text });
      if (res.error) toast(res.error, true);
      else input.value = '';
    } catch (err) {
      toast(err.message, true);
    }
  });

  ITVPlayer.setOnEnded(() => {
    if (socket?.connected) socket.emit('player:ended');
  });

  fetch('/health')
    .then((r) => r.json())
    .then((data) => {
      if (!data.ok) {
        toast('Server issue — run npm.cmd start', true);
        return;
      }
      if (data.phase !== 1) {
        toast('Stop the old server with Ctrl+C, then run npm.cmd start again for live chat.', true);
        return;
      }
      if (typeof io === 'undefined') {
        toast('Socket.io script missing — restart server', true);
      }
    })
    .catch(() => {
      toast('Server offline — run npm.cmd start', true);
    });

  const existing = getDisplayName();
  initPlaylistDragDrop();
  if (existing.length >= 2) {
    connectSocket(existing);
  } else {
    showNameModal();
  }
})();
