const { parseYoutubeId, fetchYoutubeMeta, youtubeThumbnailUrl } = require('./youtube');

const MAX_CHAT = 80;
const MAX_MESSAGE_LEN = 280;

class Room {
  constructor() {
    this.users = new Map();
    this.playlists = new Map();
    this.globalQueue = [];
    this.nowPlaying = null;
    this.chat = [];
    this._queueId = 0;
    this._chatId = 0;
    this._lastFinishedAt = null;
  }

  addUser(socketId, displayName) {
    const odName = (displayName || `Guest-${socketId.slice(0, 4)}`).slice(0, 24);
    this.users.set(socketId, {
      socketId,
      displayName: odName,
      role: 'user',
      inQueue: false,
    });
    if (!this.playlists.has(socketId)) {
      this.playlists.set(socketId, []);
    }
    return this.users.get(socketId);
  }

  removeUser(socketId) {
    const { playlistSyncFor = null } = this.leaveQueue(socketId);
    this.globalQueue = this.globalQueue.filter((e) => e.socketId !== socketId);
    this.users.delete(socketId);
    this.playlists.delete(socketId);
    return { playlistSyncFor };
  }

  setDisplayName(socketId, name) {
    const user = this.users.get(socketId);
    if (!user) return { error: 'Not connected' };
    const trimmed = String(name || '').trim().slice(0, 24);
    if (trimmed.length < 2) return { error: 'Name must be at least 2 characters' };
    user.displayName = trimmed;
    this.globalQueue.forEach((entry) => {
      if (entry.socketId === socketId) entry.djName = trimmed;
    });
    if (this.nowPlaying?.socketId === socketId) {
      this.nowPlaying.djName = trimmed;
    }
    return { ok: true };
  }

  getPlaylist(socketId) {
    return [...(this.playlists.get(socketId) || [])];
  }

  async addToPlaylist(socketId, url) {
    const videoId = parseYoutubeId(url);
    if (!videoId) return { error: 'Invalid YouTube URL or video ID' };

    const pl = this.playlists.get(socketId) || [];
    if (pl.some((s) => s.videoId === videoId)) {
      return { error: 'That song is already in your playlist' };
    }

    let meta;
    try {
      meta = await fetchYoutubeMeta(videoId);
    } catch (err) {
      return { error: err.message || 'Failed to load video' };
    }

    const item = {
      id: `${socketId}-${Date.now()}`,
      videoId: meta.videoId,
      title: meta.title,
      thumbnail: meta.thumbnail,
      channel: meta.channel,
      duration: meta.duration,
    };
    pl.push(item);
    this.playlists.set(socketId, pl);
    return { ok: true, playlist: this.getPlaylist(socketId) };
  }

  removeFromPlaylist(socketId, itemId) {
    const pl = this.playlists.get(socketId) || [];
    const next = pl.filter((s) => s.id !== itemId);
    this.playlists.set(socketId, next);
    return { ok: true, playlist: next };
  }

  reorderPlaylist(socketId, orderedIds) {
    const pl = this.playlists.get(socketId) || [];
    const map = new Map(pl.map((s) => [s.id, s]));
    const next = orderedIds.map((id) => map.get(id)).filter(Boolean);
    if (next.length !== pl.length) return { error: 'Invalid order' };
    this.playlists.set(socketId, next);
    return { ok: true, playlist: next };
  }

  ripCurrentSong(socketId) {
    if (!this.nowPlaying) return { error: 'Nothing is playing' };
    const pl = this.playlists.get(socketId) || [];
    if (pl.some((s) => s.videoId === this.nowPlaying.videoId)) {
      return { error: 'Song already in your playlist' };
    }
    const item = {
      id: `${socketId}-${Date.now()}`,
      videoId: this.nowPlaying.videoId,
      title: this.nowPlaying.title,
      thumbnail: youtubeThumbnailUrl(this.nowPlaying.videoId),
      channel: null,
      duration: null,
    };
    pl.push(item);
    this.playlists.set(socketId, pl);
    return { ok: true, playlist: pl };
  }

  joinQueue(socketId) {
    const user = this.users.get(socketId);
    if (!user) return { error: 'Not connected' };
    const pl = this.playlists.get(socketId) || [];
    if (pl.length === 0) return { error: 'Add at least one song to your playlist first' };
    if (user.inQueue) return { error: 'You are already in the DJ queue' };
    if (this.globalQueue.some((e) => e.socketId === socketId)) {
      return { error: 'You are already in the DJ queue' };
    }
    if (this.nowPlaying?.socketId === socketId) {
      return { error: 'You are already playing' };
    }

    this._queueId += 1;
    this.globalQueue.push({
      id: this._queueId,
      socketId,
      djName: user.displayName,
    });
    user.inQueue = true;

    if (this.nowPlaying) {
      this._moveQueueUserToBottom(this.nowPlaying.socketId);
    } else {
      const playlistSyncFor = this._tryStartNext();
      return { ok: true, playlistSyncFor };
    }
    return { ok: true, playlistSyncFor: null };
  }

  leaveQueue(socketId) {
    const user = this.users.get(socketId);
    if (user) user.inQueue = false;
    this.globalQueue = this.globalQueue.filter((e) => e.socketId !== socketId);
    let playlistSyncFor = null;
    if (this.nowPlaying?.socketId === socketId) {
      playlistSyncFor = this._finishCurrentTrack(socketId);
    }
    return { ok: true, playlistSyncFor };
  }

  skipMine(socketId) {
    const user = this.users.get(socketId);
    if (!user?.inQueue) {
      return { error: 'You are not in the DJ queue' };
    }
    return this.leaveQueue(socketId);
  }

  skipCurrent(socketId) {
    if (!this.nowPlaying) return { error: 'Nothing is playing' };
    const isOwner = this.nowPlaying.socketId === socketId;
    const user = this.users.get(socketId);
    const isAdmin = user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      return { error: 'Only the current DJ can skip this song' };
    }
    const playlistSyncFor = this._finishCurrentTrack(this.nowPlaying.socketId);
    return { ok: true, playlistSyncFor };
  }

  addChat(socketId, text) {
    const user = this.users.get(socketId);
    if (!user) return { error: 'Not connected' };
    const trimmed = String(text || '').trim().slice(0, MAX_MESSAGE_LEN);
    if (!trimmed) return { error: 'Message is empty' };

    this._chatId += 1;
    const msg = {
      id: this._chatId,
      displayName: user.displayName,
      text: trimmed,
      at: Date.now(),
    };
    this.chat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return { ok: true, message: msg };
  }

  onTrackEnded() {
    if (!this.nowPlaying) return null;
    const trackKey = `${this.nowPlaying.socketId}:${this.nowPlaying.startedAt}`;
    if (this._lastFinishedAt === trackKey) return null;
    this._lastFinishedAt = trackKey;
    return this._finishCurrentTrack(this.nowPlaying.socketId);
  }

  _consumePlaylistHead(socketId) {
    const pl = this.playlists.get(socketId) || [];
    if (pl.length === 0) return null;
    const head = pl.shift();
    pl.push(head);
    return head;
  }

  _moveQueueUserToBottom(socketId) {
    const idx = this.globalQueue.findIndex((e) => e.socketId === socketId);
    if (idx === -1 || idx === this.globalQueue.length - 1) return;
    const [entry] = this.globalQueue.splice(idx, 1);
    this.globalQueue.push(entry);
  }

  _rotateQueueHeadToTail() {
    if (this.globalQueue.length === 0) return;
    const entry = this.globalQueue.shift();
    this.globalQueue.push(entry);
  }

  _finishCurrentTrack(finishedSocketId = null) {
    this.nowPlaying = null;
    if (
      finishedSocketId &&
      this.globalQueue.length > 1 &&
      this.globalQueue[0]?.socketId === finishedSocketId
    ) {
      this._moveQueueUserToBottom(finishedSocketId);
    }
    return this._tryStartNext();
  }

  _tryStartNext() {
    if (this.nowPlaying || this.globalQueue.length === 0) return null;

    const attempts = this.globalQueue.length;
    for (let i = 0; i < attempts; i += 1) {
      const next = this.globalQueue[0];
      if (!next) break;

      const user = this.users.get(next.socketId);
      if (!user?.inQueue) {
        this.globalQueue.shift();
        continue;
      }

      const head = this._consumePlaylistHead(next.socketId);
      if (!head) {
        this._rotateQueueHeadToTail();
        continue;
      }

      this.nowPlaying = {
        queueEntryId: next.id,
        socketId: next.socketId,
        djName: user.displayName,
        videoId: head.videoId,
        title: head.title,
        startedAt: Date.now(),
      };

      this._moveQueueUserToBottom(next.socketId);
      return next.socketId;
    }

    return null;
  }

  getPlayerSync() {
    if (!this.nowPlaying) {
      return { videoId: null, title: null, djName: null, startedAt: null, isPlaying: false };
    }
    return {
      videoId: this.nowPlaying.videoId,
      title: this.nowPlaying.title,
      djName: this.nowPlaying.djName,
      startedAt: this.nowPlaying.startedAt,
      isPlaying: true,
    };
  }

  getRoomState() {
    return {
      nowPlaying: this.nowPlaying
        ? {
            socketId: this.nowPlaying.socketId,
            djName: this.nowPlaying.djName,
            title: this.nowPlaying.title,
            videoId: this.nowPlaying.videoId,
            startedAt: this.nowPlaying.startedAt,
          }
        : null,
      globalQueue: this.globalQueue.map((e) => ({
        id: e.id,
        socketId: e.socketId,
        djName: e.djName,
      })),
      users: [...this.users.values()].map((u) => ({
        socketId: u.socketId,
        displayName: u.displayName,
        inQueue: u.inQueue,
      })),
      chat: [...this.chat],
    };
  }
}

module.exports = { Room };
