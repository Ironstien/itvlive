(function () {
  const STORAGE_NAME = 'itv-displayName';

  const $ = (sel) => document.querySelector(sel);
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  function setServerStatus(text, isError) {
    const el = $('#server-status');
    if (!el) return;
    el.textContent = text;
    el.style.borderColor = isError ? 'var(--danger)' : '';
    el.style.color = isError ? 'var(--danger)' : '';
  }

  function requireSocket() {
    if (typeof io === 'undefined') {
      setServerStatus('Socket.io missing — restart server (npm.cmd start)', true);
      toast('Live features need the Phase 1 server. Stop the old server (Ctrl+C), then start again.', true);
      return false;
    }
    if (!socket?.connected) {
      setServerStatus('Not connected — refresh or pick a name', true);
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
      setServerStatus('Socket.io missing — restart server', true);
      return;
    }

    if (socket?.connected) socket.disconnect();

    socket = io({
      auth: { displayName },
    });

    socket.on('connect', () => {
      mySocketId = socket.id;
      setServerStatus('Live · connected', false);
      $('#nav-display-name').textContent = displayName;
      socket.emit('user:setName', { name: displayName });
    });

    socket.on('connect_error', (err) => {
      setServerStatus('Connection failed — restart server', true);
      toast(err.message || 'Could not connect to live server', true);
    });

    socket.on('disconnect', () => {
      setServerStatus('Disconnected — refresh page', true);
    });

    socket.on('room:state', (state) => {
      roomState = state;
      renderRoom(state);
    });

    socket.on('player:sync', (payload) => {
      ITVPlayer.sync(payload);
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

    const queueEl = $('#global-queue-list');
    if (queueEl) {
      queueEl.innerHTML = '';
      if (state.nowPlaying) {
        const li = document.createElement('li');
        li.className = 'queue-now';
        li.textContent = `▶ Now: ${state.nowPlaying.title} — ${state.nowPlaying.djName}`;
        queueEl.appendChild(li);
      }
      (state.globalQueue || []).forEach((e, i) => {
        const li = document.createElement('li');
        li.textContent = `${i + 1}. ${e.title} — ${e.djName}`;
        queueEl.appendChild(li);
      });
      if (!state.nowPlaying && (!state.globalQueue || state.globalQueue.length === 0)) {
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
  }

  function renderPlaylist(list) {
    const ul = $('#playlist-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="muted">No songs yet — paste a YouTube link above.</li>';
      return;
    }
    list.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'playlist-item';
      li.dataset.id = item.id;
      li.innerHTML = `
        <span class="pl-order">${index + 1}</span>
        <span class="pl-title">${escapeHtml(item.title)}</span>
        <span class="pl-actions">
          <button type="button" class="btn-icon" data-up title="Move up">↑</button>
          <button type="button" class="btn-icon" data-down title="Move down">↓</button>
          <button type="button" class="btn-icon" data-remove title="Remove">×</button>
        </span>
      `;
      li.querySelector('[data-remove]').addEventListener('click', () => {
        socket.emit('playlist:remove', { itemId: item.id }, (res) => {
          if (res?.error) toast(res.error, true);
        });
      });
      li.querySelector('[data-up]').addEventListener('click', () => moveItem(index, -1));
      li.querySelector('[data-down]').addEventListener('click', () => moveItem(index, 1));
      ul.appendChild(li);
    });
  }

  function moveItem(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= myPlaylist.length) return;
    const ids = myPlaylist.map((s) => s.id);
    const t = ids[index];
    ids[index] = ids[next];
    ids[next] = t;
    socket.emit('playlist:reorder', { orderedIds: ids }, (res) => {
      if (res?.error) toast(res.error, true);
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
    const errEl = $('#playlist-error');
    show(errEl, false);
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const res = await emitAck('playlist:add', { url });
      if (res.error) {
        errEl.textContent = res.error;
        show(errEl, true);
      } else {
        $('#playlist-url').value = '';
        toast('Song added');
      }
    } catch (err) {
      errEl.textContent = err.message;
      show(errEl, true);
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

  $('#btn-join-queue')?.addEventListener('click', () => {
    socket.emit('queue:join', {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast('Joined the DJ queue');
    });
  });

  $('#btn-leave-queue')?.addEventListener('click', () => {
    socket.emit('queue:leave', {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast('Left the queue');
    });
  });

  $('#btn-skip-current')?.addEventListener('click', () => {
    socket.emit('queue:skip-current', {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast('Skipped to next track');
    });
  });

  $('#btn-skip-mine')?.addEventListener('click', () => {
    socket.emit('queue:skip-mine', {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast('Removed your song from queue');
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
        setServerStatus('Server issue', true);
        return;
      }
      if (data.phase !== 1) {
        setServerStatus('Wrong server version — restart (Ctrl+C, npm.cmd start)', true);
        toast('Stop the old server with Ctrl+C, then run npm.cmd start again for live chat.', true);
        return;
      }
      if (typeof io === 'undefined') {
        setServerStatus('Socket.io script missing — restart server', true);
      }
    })
    .catch(() => {
      setServerStatus('Server offline — run npm.cmd start', true);
    });

  const existing = getDisplayName();
  if (existing.length >= 2) {
    connectSocket(existing);
  } else {
    showNameModal();
  }
})();
