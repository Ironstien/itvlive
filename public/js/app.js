(function () {
  const STORAGE_NAME = 'itv-displayName';
  const STORAGE_VOLUME = 'itv-volume';
  const STORAGE_MUTED = 'itv-muted';
  const STORAGE_BOOT_ID = 'itv-serverBootId';
  const IDLE_RESYNC_MS = 45000;

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
        if (res?.error) {
          ITVLog.warn('socket', `ack ${event} error`, {
            error: res.error,
            payload: ITVLog.summarizePayload(payload),
          });
        } else {
          ITVLog.debug('socket', `ack ${event} ok`, ITVLog.summarizePayload(res));
        }
        resolve(res || {});
      });
    });
  }

  const toast = (msg, isError) => {
    const el = $('#control-toast');
    if (el) {
      el.textContent = msg;
      el.classList.toggle('error', !!isError);
      show(el, true);
      clearTimeout(toast._t);
      toast._t = setTimeout(() => show(el, false), 4000);
    }
    ITVLog.log(isError ? 'warn' : 'info', 'user', `Toast: ${msg}`, { isError: !!isError });
  };

  let socket = null;
  let mySocketId = null;
  let roomState = null;
  let myPlaylist = [];
  let loggedInUser = null;
  let hadConnectedOnce = false;
  let disconnectedAt = null;
  let pendingIdleResync = false;
  let lastKnownBootId = sessionStorage.getItem(STORAGE_BOOT_ID) || null;

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

  function navState(extra = {}) {
    return {
      onChangeName: showNameModal,
      onOpenProfile: () => ITVOverlays.open('profile'),
      onLogout: () => {
        if (socket?.connected) socket.disconnect();
        loggedInUser = null;
        window.location.href = '/login.html';
      },
      ...extra,
    };
  }

  function renderNavUser(state = {}) {
    ITVAuth.renderNav($('#nav-user'), navState(state));
  }

  function getDisplayName() {
    return localStorage.getItem(STORAGE_NAME) || '';
  }

  function saveDisplayName(name) {
    localStorage.setItem(STORAGE_NAME, name);
  }

  function instrumentSocket(sock) {
    const rawEmit = sock.emit.bind(sock);
    sock.emit = function (event, payload, ack) {
      ITVLog.debug('socket', `emit ${event}`, ITVLog.summarizePayload(payload));
      return rawEmit(event, payload, ack);
    };
  }

  function applyPlaylistSync(list, source) {
    const prev = myPlaylist;
    const prevCount = prev.length;
    const next = list || [];
    const newCount = next.length;
    const data = {
      source,
      prevCount,
      newCount,
      delta: newCount - prevCount,
      prevVideoIds: prev.map((i) => i.videoId),
      nextVideoIds: next.map((i) => i.videoId),
    };

    if (newCount === 0 && prevCount > 0) {
      ITVLog.warn('playlist', 'Playlist emptied', data);
    } else if (newCount < prevCount) {
      ITVLog.warn('playlist', 'Playlist shrunk', data);
    } else {
      ITVLog.info('playlist', 'playlist:sync', data);
    }

    myPlaylist = next;
    renderPlaylist(myPlaylist);
  }

  function rememberBootId(bootId) {
    if (!bootId) return;
    if (lastKnownBootId && lastKnownBootId !== bootId) {
      ITVLog.info('system', 'Server boot changed', {
        from: lastKnownBootId,
        to: bootId,
      });
    }
    lastKnownBootId = bootId;
    sessionStorage.setItem(STORAGE_BOOT_ID, bootId);
  }

  function handlePlayerSync(payload) {
    if (payload?.bootId) rememberBootId(payload.bootId);

    const localVideoId = ITVPlayer.getCurrentVideoId?.() || null;
    const withinResyncWindow =
      disconnectedAt != null && Date.now() - disconnectedAt < IDLE_RESYNC_MS;

    if (!payload?.videoId && localVideoId && withinResyncWindow && socket?.connected) {
      if (!pendingIdleResync) {
        pendingIdleResync = true;
        ITVLog.warn('player', 'Ignoring idle sync — requesting resync', {
          localVideoId,
          disconnectedMs: Date.now() - disconnectedAt,
        });
        socket.emit('room:requestSync');
        setTimeout(() => {
          pendingIdleResync = false;
        }, 2500);
        return;
      }
    }

    pendingIdleResync = false;
    disconnectedAt = null;

    ITVLog.info('player', 'player:sync received', {
      videoId: payload?.videoId || null,
      title: payload?.title || null,
      djName: payload?.djName || null,
      startedAt: payload?.startedAt || null,
      bootId: payload?.bootId || null,
    });
    ITVPlayer.sync(payload);
    ITVAmbient.sync(payload, () => ITVPlayer.getCurrentTime());
    updateDjBanner(payload);
  }

  function connectSocket(opts) {
    const displayName = typeof opts === 'string' ? opts : opts?.displayName;
    const token = typeof opts === 'object' && opts ? opts.token : null;
    const profile = typeof opts === 'object' && opts ? opts.profile : null;

    if (typeof io === 'undefined') {
      toast('Socket.io missing — restart server (npm.cmd start)', true);
      return;
    }

    if (socket?.connected) socket.disconnect();

    loggedInUser = profile || null;
    const auth = token ? { token } : { displayName };
    socket = io({
      auth,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 15000,
    });
    instrumentSocket(socket);

    ITVLog.info('socket', 'Connecting', {
      authenticated: !!token,
      displayName: displayName || loggedInUser?.username || null,
    });

    socket.on('connect', () => {
      const reconnected = hadConnectedOnce;
      mySocketId = socket.id;
      pendingIdleResync = false;
      hadConnectedOnce = true;

      ITVLog.info('socket', reconnected ? 'Reconnected' : 'Connected', {
        socketId: mySocketId,
        reconnected,
        disconnectedMs: disconnectedAt != null ? Date.now() - disconnectedAt : null,
      });

      if (reconnected) {
        toast('Reconnected — syncing room', false);
        socket.emit('room:requestSync');
      }

      if (loggedInUser) {
        renderNavUser({ user: loggedInUser });
      } else {
        renderNavUser({
          guestName: displayName,
        });
        socket.emit('user:setName', { name: displayName });
      }
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      ITVLog.debug('socket', 'Reconnect attempt', { attempt });
    });

    socket.on('connect_error', (err) => {
      ITVLog.error('socket', 'connect_error', { message: err.message || String(err) });
      toast(err.message || 'Could not connect to live server', true);
    });

    socket.on('disconnect', (reason) => {
      disconnectedAt = Date.now();
      ITVLog.warn('socket', 'Disconnected', { reason: reason || 'unknown' });
      toast('Connection lost — reconnecting…', true);
    });

    socket.on('room:state', (state) => {
      if (state?.bootId) rememberBootId(state.bootId);
      const prevVideoId = roomState?.nowPlaying?.videoId ?? null;
      const nextVideoId = state?.nowPlaying?.videoId ?? null;
      if (prevVideoId !== nextVideoId) {
        ITVLog.info('room', 'nowPlaying changed', {
          fromVideoId: prevVideoId,
          toVideoId: nextVideoId,
          djName: state?.nowPlaying?.djName || null,
          title: state?.nowPlaying?.title || null,
        });
      }
      const prevQueueLen = roomState?.globalQueue?.length ?? 0;
      const nextQueueLen = state?.globalQueue?.length ?? 0;
      if (prevQueueLen !== nextQueueLen) {
        ITVLog.debug('queue', 'Queue length changed', {
          from: prevQueueLen,
          to: nextQueueLen,
        });
      }
      roomState = state;
      renderRoom(state);
    });

    socket.on('player:sync', (payload) => {
      handlePlayerSync(payload);
    });

    socket.on('playlist:sync', (list) => {
      applyPlaylistSync(list, 'server');
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

  function updateTestUsersButton(state) {
    const btn = $('#btn-test-users');
    if (!btn) return;
    const on = !!state?.testUsersEnabled;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    updateSkipTestTrackButton(state);
  }

  function isTestUserSocketId(socketId) {
    return typeof socketId === 'string' && socketId.startsWith('test:');
  }

  function updateSkipTestTrackButton(state) {
    const btn = $('#btn-skip-test-track');
    if (!btn) return;
    const testUsersOn = !!state?.testUsersEnabled;
    const canSkip =
      testUsersOn &&
      !!state?.nowPlaying &&
      isTestUserSocketId(state.nowPlaying.socketId);
    show(btn, testUsersOn);
    btn.disabled = !canSkip;
    btn.title = canSkip
      ? "Skip the current test user's song (dev)"
      : 'Available when a test user is DJ';
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
        const av = m.avatarUrl
          ? `<img class="chat-avatar" src="${escapeHtml(m.avatarUrl)}" alt="" loading="lazy" />`
          : '';
        div.innerHTML = `${av}<span><strong>${escapeHtml(m.displayName)}</strong> ${escapeHtml(m.text)}</span>`;
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

    renderCurrentDj(state);
    renderVinylPit(state);

    updateQueueButton(state);
    updateAirSign(state);
    updateTestUsersButton(state);
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

  function youtubeWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  function updatePlaylistExportButton(list) {
    const btn = $('#btn-playlist-export');
    if (btn) btn.disabled = !list?.length;
  }

  function exportPlaylist() {
    if (!myPlaylist.length) {
      toast('Nothing to export — add songs first', true);
      return;
    }

    ITVLog.info('user', 'playlist export', { count: myPlaylist.length });
    const date = new Date().toISOString().slice(0, 10);
    const header = [
      `# ITV Playlist — exported ${date}`,
      '# Format: Title https://www.youtube.com/watch?v=...',
      '',
    ];
    const songs = myPlaylist.map(
      (item) => `${item.title || 'Untitled'} ${youtubeWatchUrl(item.videoId)}`
    );
    const content = [...header, ...songs].join('\n') + '\n';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `itv-playlist-${date}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${songs.length} song${songs.length === 1 ? '' : 's'}`);
  }

  function parsePlaylistImportText(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }

  async function importPlaylistFromFile(file) {
    if (!file) return;
    if (!requireSocket()) return;

    let text;
    try {
      text = await file.text();
    } catch {
      toast('Could not read that file', true);
      return;
    }

    const urls = parsePlaylistImportText(text);
    if (!urls.length) {
      toast('No songs found in file', true);
      return;
    }

    ITVLog.info('user', 'playlist import started', { lineCount: urls.length, fileName: file.name });
    const importBtn = $('#btn-playlist-import');
    const exportBtn = $('#btn-playlist-export');
    if (importBtn) importBtn.disabled = true;
    if (exportBtn) exportBtn.disabled = true;
    toast(`Importing ${urls.length} URL${urls.length === 1 ? '' : 's'}…`);

    try {
      const res = await emitAck('playlist:import', { urls }, 120000);
      if (res.error) {
        toast(res.error, true);
        return;
      }

      const parts = [];
      if (res.added) parts.push(`${res.added} added`);
      if (res.skipped) parts.push(`${res.skipped} skipped`);
      if (res.failed) parts.push(`${res.failed} failed`);
      toast(parts.length ? `Import complete — ${parts.join(', ')}` : 'Import complete');
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (importBtn) importBtn.disabled = false;
      updatePlaylistExportButton(myPlaylist);
    }
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
      ITVLog.info('user', 'playlist:reorder', { orderedIds });
      socket.emit('playlist:reorder', { orderedIds }, (res) => {
        if (res?.error) toast(res.error, true);
      });
    });
  }

  function renderPlaylist(list) {
    const ul = $('#playlist-list');
    if (!ul) return;
    ul.innerHTML = '';
    updatePlaylistExportButton(list);
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
        ITVLog.info('user', 'playlist:remove clicked', {
          itemId: item.id,
          videoId: item.videoId,
          title: item.title,
        });
        socket.emit('playlist:remove', { itemId: item.id }, (res) => {
          if (res?.error) toast(res.error, true);
        });
      });
      ul.appendChild(li);
    });
  }

  const VINYL_LEVEL_NAMES = {
    1: 'Newcomer',
    2: 'Member',
    3: 'Regular',
    4: 'Veteran',
    5: 'Elite',
  };

  const STAFF_ROLE_LABELS = {
    resident: 'Resident DJ',
    host: 'Host',
    mod: 'Moderator',
    admin: 'Admin',
  };

  function vinylLevelName(level) {
    const n = Math.min(5, Math.max(1, Math.floor(Number(level) || 1)));
    return VINYL_LEVEL_NAMES[n] || VINYL_LEVEL_NAMES[1];
  }

  function buildVinylRankLine(u) {
    const level = u.level ?? 1;
    const parts = [`Level ${level}`, vinylLevelName(level)];
    if (u.staffRole && STAFF_ROLE_LABELS[u.staffRole]) {
      parts.push(STAFF_ROLE_LABELS[u.staffRole]);
    }
    return parts.join(' · ');
  }

  function createVinylUserEl(u, { isOnAir = false, inQueue = false, isCurrentDj = false } = {}) {
    const disc = document.createElement('div');
    disc.className = 'vinyl-user';
    if (isCurrentDj) disc.classList.add('vinyl-user--current-dj');
    else if (inQueue) disc.classList.add('vinyl-user--queued');
    if (!isCurrentDj) disc.tabIndex = 0;
    disc.innerHTML =
      buildVinylRecord(u, isOnAir) + (isCurrentDj ? '' : buildVinylTooltip(u, { inQueue }));
    return disc;
  }

  function renderVinylRow(container, users, { inQueue = false } = {}) {
    if (!container) return;
    container.innerHTML = '';
    if (!users.length) {
      container.innerHTML = '<p class="panel-placeholder vinyl-pit-empty">—</p>';
      return;
    }
    users.forEach((u) => {
      container.appendChild(createVinylUserEl(u, { isOnAir: false, inQueue }));
    });
  }

  function renderVinylPit(state) {
    const queueRow = $('#vinyl-pit-queue');
    const listenersRow = $('#vinyl-pit-listeners');
    if (!queueRow || !listenersRow) return;

    const activeDjId = state.nowPlaying?.socketId || null;
    const userMap = new Map((state.users || []).map((u) => [u.socketId, u]));

    const queuedUsers = (state.globalQueue || [])
      .filter((e) => e.socketId !== activeDjId)
      .map((e) => userMap.get(e.socketId))
      .filter(Boolean);

    const listeners = (state.users || [])
      .filter((u) => u.socketId !== activeDjId && !u.inQueue)
      .sort((a, b) => (a.connectedAt || 0) - (b.connectedAt || 0) || a.displayName.localeCompare(b.displayName));

    renderVinylRow(queueRow, queuedUsers, { inQueue: true });
    renderVinylRow(listenersRow, listeners, { inQueue: false });
  }

  function buildCurrentDjStats(u, nowPlaying) {
    const saying = u.customSaying
      ? `<p class="current-dj-stats__saying">"${escapeHtml(u.customSaying)}"</p>`
      : '';
    const badges = (u.badges || []).length
      ? `<p class="current-dj-stats__badges">${(u.badges || []).map((b) => escapeHtml(b)).join(' · ')}</p>`
      : '';
    const track = nowPlaying?.title
      ? `<p class="current-dj-stats__track"><strong>Now:</strong> ${escapeHtml(nowPlaying.title)}</p>`
      : '';
    return `
      <div class="current-dj-panel current-dj-panel--stats">
        <h3 class="current-dj-stats__name">${escapeHtml(u.displayName)}</h3>
        <p class="current-dj-stats__rank">${escapeHtml(buildVinylRankLine(u))}</p>
        ${saying}
        ${badges}
        ${track}
      </div>
    `;
  }

  function renderCurrentDj(state) {
    const avatarEl = $('#current-dj-avatar');
    const statsEl = $('#current-dj-stats');
    if (!avatarEl || !statsEl) return;

    const activeDjId = state.nowPlaying?.socketId || null;
    const dj = activeDjId ? (state.users || []).find((u) => u.socketId === activeDjId) : null;

    if (!dj || !state.nowPlaying) {
      avatarEl.innerHTML =
        '<div class="current-dj-panel current-dj-panel--avatar"><p class="current-dj__empty muted">No DJ</p></div>';
      statsEl.innerHTML =
        '<div class="current-dj-panel current-dj-panel--stats"><p class="current-dj__empty muted">—</p></div>';
      return;
    }

    avatarEl.innerHTML = '';
    const avatarPanel = document.createElement('div');
    avatarPanel.className = 'current-dj-panel current-dj-panel--avatar';
    avatarPanel.appendChild(createVinylUserEl(dj, { isOnAir: true, isCurrentDj: true }));
    avatarEl.appendChild(avatarPanel);
    statsEl.innerHTML = buildCurrentDjStats(dj, state.nowPlaying);
  }

  function buildVinylRecord(u, isOnAir = false) {
    const spinClass = isOnAir ? ' vinyl-record--spinning vinyl-record--on-air' : '';
    const labelContent = u.avatarUrl
      ? `<img class="vinyl-record__avatar" src="${escapeHtml(u.avatarUrl)}" alt="" loading="lazy" />`
      : `<span class="vinyl-record__initial" aria-hidden="true">${escapeHtml((u.displayName || '?').charAt(0).toUpperCase())}</span>`;
    return `
      <div class="vinyl-record${spinClass}" aria-label="${escapeHtml(u.displayName)}">
        <div class="vinyl-record__label">
          ${labelContent}
        </div>
      </div>
    `;
  }

  function buildVinylTooltip(u, { inQueue = false } = {}) {
    const saying = u.customSaying
      ? `<p class="vinyl-tooltip__saying">${escapeHtml(u.customSaying)}</p>`
      : '';
    const badges = (u.badges || []).length
      ? `<p class="vinyl-tooltip__badges">${(u.badges || []).map((b) => escapeHtml(b)).join(' · ')}</p>`
      : '';
    const queueHint = inQueue ? '<p class="vinyl-tooltip__queue">In DJ queue</p>' : '';
    return `
      <div class="vinyl-tooltip" role="tooltip">
        <p class="vinyl-tooltip__name">${escapeHtml(u.displayName)}</p>
        <p class="vinyl-tooltip__rank">${escapeHtml(buildVinylRankLine(u))}</p>
        ${saying}
        ${badges}
        ${queueHint}
      </div>
    `;
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
    ITVLog.info('user', 'Guest join', { displayName: trimmed });
    saveDisplayName(trimmed);
    hideNameModal();
    connectSocket({ displayName: trimmed });
  }

  $('#name-save')?.addEventListener('click', () => startWithName($('#name-input').value));
  $('#name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startWithName($('#name-input').value);
  });

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

  $('#btn-playlist-export')?.addEventListener('click', exportPlaylist);

  const playlistImportInput = $('#playlist-import-input');
  $('#btn-playlist-import')?.addEventListener('click', () => {
    playlistImportInput?.click();
  });
  playlistImportInput?.addEventListener('change', async () => {
    const file = playlistImportInput.files?.[0];
    playlistImportInput.value = '';
    await importPlaylistFromFile(file);
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
    ITVLog.info('user', `queue action: ${mode}`, { event: action.event });
    socket.emit(action.event, {}, (res) => {
      if (res?.error) toast(res.error, true);
      else toast(action.ok);
    });
  });

  $('#btn-test-users')?.addEventListener('click', () => {
    if (!requireSocket()) return;
    const btn = $('#btn-test-users');
    if (btn) btn.disabled = true;
    socket.emit('dev:testUsers:toggle', {}, (res) => {
      if (btn) btn.disabled = false;
      if (res?.error) {
        toast(res.error, true);
        return;
      }
      toast(res.enabled ? 'Test users enabled' : 'Test users removed');
    });
  });

  $('#btn-skip-test-track')?.addEventListener('click', () => {
    if (!requireSocket()) return;
    const btn = $('#btn-skip-test-track');
    if (btn) btn.disabled = true;
    socket.emit('dev:testUsers:skip', {}, (res) => {
      if (btn) btn.disabled = false;
      if (res?.error) toast(res.error, true);
      else toast('Skipped test user track');
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

  function initVolumeControl() {
    const slider = $('#volume-slider');
    const muteBtn = $('#btn-volume-mute');
    if (!slider || !muteBtn) return;

    let storedVol = parseInt(localStorage.getItem(STORAGE_VOLUME), 10);
    if (Number.isNaN(storedVol)) storedVol = 80;
    let muted = localStorage.getItem(STORAGE_MUTED) === '1';

    slider.value = storedVol;
    ITVPlayer.setVolume(storedVol, muted);
    updateVolumeUi(muted);

    function persist(vol, isMuted) {
      localStorage.setItem(STORAGE_VOLUME, String(vol));
      localStorage.setItem(STORAGE_MUTED, isMuted ? '1' : '0');
    }

    function updateVolumeUi(isMuted) {
      muteBtn.classList.toggle('is-muted', isMuted);
      muteBtn.setAttribute('aria-pressed', String(isMuted));
      muteBtn.title = isMuted ? 'Unmute' : 'Mute';
      muteBtn.setAttribute('aria-label', muteBtn.title);
    }

    slider.addEventListener('input', () => {
      const vol = parseInt(slider.value, 10);
      const isMuted = vol === 0;
      storedVol = isMuted ? storedVol || 80 : vol;
      ITVPlayer.setVolume(vol, isMuted);
      persist(isMuted ? storedVol : vol, isMuted);
      updateVolumeUi(isMuted);
    });

    muteBtn.addEventListener('click', () => {
      const current = ITVPlayer.getVolume();
      if (current.muted) {
        const restore = storedVol > 0 ? storedVol : 80;
        ITVPlayer.setVolume(restore, false);
        slider.value = restore;
        storedVol = restore;
        persist(restore, false);
        updateVolumeUi(false);
        return;
      }

      storedVol = current.volume > 0 ? current.volume : storedVol;
      ITVPlayer.setVolume(storedVol, true);
      persist(storedVol, true);
      updateVolumeUi(true);
    });
  }

  ITVPlayer.setOnEnded(() => {
    ITVLog.info('player', 'player:ended emit', { socketConnected: !!socket?.connected });
    if (socket?.connected) socket.emit('player:ended');
  });

  $('#btn-open-log')?.addEventListener('click', () => {
    ITVLog.openPopup();
  });

  fetch('/health')
    .then((r) => r.json())
    .then((data) => {
      ITVLog.info('system', 'Health check ok', data);
      if (data.bootId) rememberBootId(data.bootId);
      if (!data.ok) {
        ITVLog.warn('system', 'Health check failed', data);
        toast('Server issue — run npm.cmd start', true);
        return;
      }
      if (!data.db && data.phase >= 2) {
        ITVLog.warn('system', 'Database not connected', data);
        toast('Database not connected — check MONGODB_URI in .env', true);
      }
      if (typeof io === 'undefined') {
        ITVLog.error('system', 'Socket.io script missing');
        toast('Socket.io script missing — restart server', true);
      }
    })
    .catch((err) => {
      ITVLog.error('system', 'Health check request failed', { message: err?.message || String(err) });
      toast('Server offline — run npm.cmd start', true);
    });

  function initOverlays() {
    ITVOverlays.init({
      onUserUpdate: (user) => {
        loggedInUser = user;
        renderNavUser({ user });
      },
      onLogout: () => {
        if (socket?.connected) socket.disconnect();
        loggedInUser = null;
        window.location.href = '/login.html';
      },
    });
  }

  async function init() {
    ITVLog.initCapture();
    initPlaylistDragDrop();
    initVolumeControl();
    ITVPlayerEffects.init();
    initOverlays();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      ITVLog.debug('system', 'Document visibility: visible');
      if (socket && !socket.connected) {
        ITVLog.info('socket', 'Tab visible — reconnecting socket');
        socket.connect();
      }
    });

    const user = await ITVAuth.fetchMe();
    if (user) {
      connectSocket({ token: ITVAuth.getToken(), profile: user });
      return;
    }

    const existing = getDisplayName();
    renderNavUser({
      guestName: existing || 'Guest',
    });
    if (existing.length >= 2) {
      connectSocket({ displayName: existing });
    } else {
      showNameModal();
    }
  }

  init();
})();
