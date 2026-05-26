const { parseYoutubeId, fetchYoutubeMeta } = require('./youtube');

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
    this.leaveQueue(socketId);
    this.globalQueue = this.globalQueue.filter((e) => e.socketId !== socketId);
    this.users.delete(socketId);
    this.playlists.delete(socketId);
    if (this.nowPlaying?.socketId === socketId) {
      this.nowPlaying = null;
      this._tryStartNext();
    }
  }

  setDisplayName(socketId, name) {
    const user = this.users.get(socketId);
    if (!user) return { error: 'Not connected' };
    const trimmed = String(name || '').trim().slice(0, 24);
    if (trimmed.length < 2) return { error: 'Name must be at least 2 characters' };
    user.displayName = trimmed;
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
      thumbnail: null,
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
      user.inQueue = true;
      return { error: 'You already have a song waiting in the queue' };
    }

    const head = pl[0];
    this._queueId += 1;
    this.globalQueue.push({
      id: this._queueId,
      socketId,
      djName: user.displayName,
      videoId: head.videoId,
      title: head.title,
    });
    user.inQueue = true;

    if (!this.nowPlaying) this._tryStartNext();
    return { ok: true };
  }

  leaveQueue(socketId) {
    const user = this.users.get(socketId);
    if (user) user.inQueue = false;
    this.globalQueue = this.globalQueue.filter((e) => e.socketId !== socketId);
    return { ok: true };
  }

  skipMine(socketId) {
    const idx = this.globalQueue.findIndex((e) => e.socketId === socketId);
    if (idx === -1) return { error: 'You have no song in the queue' };
    this.globalQueue.splice(idx, 1);
    const user = this.users.get(socketId);
    if (user) user.inQueue = false;
    return { ok: true };
  }

  skipCurrent(socketId) {
    if (!this.nowPlaying) return { error: 'Nothing is playing' };
    const isOwner = this.nowPlaying.socketId === socketId;
    const user = this.users.get(socketId);
    const isAdmin = user?.role === 'admin';
    if (!isOwner && !isAdmin) {
      return { error: 'Only the current DJ can skip this song' };
    }
    this._finishCurrentTrack();
    return { ok: true };
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
    this._finishCurrentTrack();
  }

  _finishCurrentTrack() {
    const np = this.nowPlaying;
    if (np) {
      const pl = this.playlists.get(np.socketId);
      if (pl?.length && pl[0].videoId === np.videoId) {
        const first = pl.shift();
        pl.push(first);
      }
      const user = this.users.get(np.socketId);
      if (user) user.inQueue = false;
    }
    this.nowPlaying = null;
    this._tryStartNext();
  }

  _tryStartNext() {
    if (this.nowPlaying) return;

    while (this.globalQueue.length > 0) {
      const next = this.globalQueue.shift();
      const user = this.users.get(next.socketId);
      if (!user) continue;

      this.nowPlaying = {
        queueEntryId: next.id,
        socketId: next.socketId,
        djName: next.djName,
        videoId: next.videoId,
        title: next.title,
        startedAt: Date.now(),
      };
      user.inQueue = false;
      return;
    }
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
            djName: this.nowPlaying.djName,
            title: this.nowPlaying.title,
            videoId: this.nowPlaying.videoId,
            startedAt: this.nowPlaying.startedAt,
          }
        : null,
      globalQueue: this.globalQueue.map((e) => ({
        id: e.id,
        djName: e.djName,
        title: e.title,
        videoId: e.videoId,
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
