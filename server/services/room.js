const crypto = require('crypto');
const {
  parseYoutubeId,
  extractPlaylistLineUrl,
  fetchYoutubeMeta,
  youtubeThumbnailUrl,
} = require('./youtube');
const { can, ACTIONS } = require('../config/permissions');
const { isTestUsersEnabled } = require('./testUsers');

const MAX_CHAT = 80;
const MAX_MESSAGE_LEN = 280;
/** Legacy fallback — unknown durations no longer auto-advance on a timer. */
const DEFAULT_TRACK_DURATION_SEC = 600;
const TRACK_END_MIN_ELAPSED_RATIO = 0.8;

class Room {
  constructor() {
    /** @type {Map<string, object>} socketId → connected session */
    this.users = new Map();
    /** @type {Map<string, object>} userId → member profile + queue state */
    this.membersByUserId = new Map();
    /** @type {Map<string, object[]>} userId → playlist items */
    this.playlistsByUserId = new Map();
    this.globalQueue = [];
    this.nowPlaying = null;
    this.chat = [];
    this._queueId = 0;
    this._chatId = 0;
    this._lastFinishedAt = null;
    this._trackEndTimer = null;
    this._onTrackEnd = null;
    this._onTrackStart = null;
    this._onBeforeTrackEnd = null;
    /** @type {Map<string, Map<string, number>>} playSessionId → userId → score */
    this._pendingVotes = new Map();
    /** @type {Map<string, number>} userId → chat blocked until timestamp */
    this._chatTimeouts = new Map();
  }

  setBeforeTrackEndHandler(fn) {
    this._onBeforeTrackEnd = typeof fn === 'function' ? fn : null;
  }

  setTrackEndHandler(fn) {
    this._onTrackEnd = typeof fn === 'function' ? fn : null;
  }

  setTrackStartHandler(fn) {
    this._onTrackStart = typeof fn === 'function' ? fn : null;
  }

  _newPlaybackSessionId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `ps-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** In-memory playlist wins over DB while user is queued or on air. */
  isPlaylistSessionCanonical(userId) {
    if (!userId) return false;
    const id = String(userId);
    if (this.nowPlaying?.userId === id) return true;
    const member = this._getMember(id);
    if (member?.inQueue && this.playlistsByUserId.has(id)) return true;
    return false;
  }

  /** Stop playback, clear the DJ queue, and reset queue membership flags. */
  resetServer() {
    this._clearTrackEndTimer();
    this.nowPlaying = null;
    this.globalQueue = [];

    for (const member of this.membersByUserId.values()) {
      member.inQueue = false;
    }
    for (const user of this.users.values()) {
      user.inQueue = false;
    }

    return { ok: true };
  }

  _requireUserId(user) {
    return user?.userId ? String(user.userId) : null;
  }

  _getMember(userId) {
    if (!userId) return null;
    return this.membersByUserId.get(String(userId)) || null;
  }

  _ensureMember(userId, profile = {}) {
    const id = String(userId);
    let member = this.membersByUserId.get(id);
    if (!member) {
      member = {
        userId: id,
        displayName: profile.displayName || `User-${id.slice(0, 4)}`,
        level: profile.level ?? 1,
        staffRole: profile.staffRole ?? null,
        emailVerified: profile.emailVerified === true,
        avatarUrl: profile.avatarUrl ?? null,
        customSaying: profile.customSaying ?? '',
        badges: Array.isArray(profile.badges) ? [...profile.badges] : [],
        role: profile.staffRole === 'admin' ? 'admin' : 'user',
        inQueue: false,
        connected: false,
        socketId: null,
        connectedAt: null,
      };
      this.membersByUserId.set(id, member);
    }
    return member;
  }

  _isUserConnected(userId) {
    const member = this._getMember(userId);
    if (!member?.connected || !member.socketId) return false;
    return this.users.has(member.socketId);
  }

  getConnectedLoggedInUserIds() {
    const ids = new Set();
    for (const user of this.users.values()) {
      if (user.userId) ids.add(String(user.userId));
    }
    return [...ids];
  }

  setPendingVote(userId, playSessionId, score) {
    if (!userId || !playSessionId) return { error: 'Invalid vote target' };
    const n = Math.floor(Number(score));
    if (!Number.isFinite(n) || n < 1 || n > 100) return { error: 'Score must be 1–100' };
    const sid = String(playSessionId);
    if (!this._pendingVotes.has(sid)) this._pendingVotes.set(sid, new Map());
    this._pendingVotes.get(sid).set(String(userId), n);
    return { ok: true, score: n };
  }

  getPendingVotesForSession(playSessionId) {
    if (!playSessionId) return new Map();
    return new Map(this._pendingVotes.get(String(playSessionId)) || []);
  }

  clearPendingVotesForSession(playSessionId) {
    if (playSessionId) this._pendingVotes.delete(String(playSessionId));
  }

  applyProfileToUser(userId, profile = {}) {
    const id = String(userId);
    const member = this._getMember(id);
    if (member) this._syncMemberProfile(member, profile);

    const socketId = this._liveSocketForUserId(id);
    if (socketId) {
      const user = this.users.get(socketId);
      if (user) {
        if (profile.level != null) user.level = profile.level;
        if (profile.staffRole !== undefined) {
          user.staffRole = profile.staffRole;
          user.role = profile.staffRole === 'admin' ? 'admin' : 'user';
        }
        if (profile.username) user.displayName = String(profile.username).slice(0, 24);
        if (profile.avatarUrl !== undefined) user.avatarUrl = profile.avatarUrl || null;
        if (profile.customSaying !== undefined) {
          user.customSaying = String(profile.customSaying || '').slice(0, 120);
        }
        if (profile.badges !== undefined) {
          user.badges = Array.isArray(profile.badges) ? [...profile.badges] : [];
        }
        if (profile.tokenBalance != null) user.tokenBalance = profile.tokenBalance;
      }
    }

    return { ok: true, socketId };
  }

  isChatTimedOut(userId) {
    if (!userId) return false;
    const until = this._chatTimeouts.get(String(userId));
    if (!until) return false;
    if (Date.now() >= until) {
      this._chatTimeouts.delete(String(userId));
      return false;
    }
    return true;
  }

  modTimeout(actorSocketId, targetUserId, minutes = 10) {
    const actor = this.users.get(actorSocketId);
    if (!can(actor, ACTIONS.MOD_TIMEOUT)) {
      return { error: 'Moderator permissions required' };
    }
    if (!targetUserId) return { error: 'Target user required' };
    const mins = Math.min(1440, Math.max(1, Math.floor(Number(minutes) || 10)));
    this._chatTimeouts.set(String(targetUserId), Date.now() + mins * 60 * 1000);
    return { ok: true, minutes: mins, targetUserId: String(targetUserId) };
  }

  modKickUser(actorSocketId, targetUserId) {
    const actor = this.users.get(actorSocketId);
    if (!can(actor, ACTIONS.MOD_KICK)) {
      return { error: 'Moderator permissions required' };
    }
    if (!targetUserId) return { error: 'Target user required' };
    const socketId = this._liveSocketForUserId(String(targetUserId));
    if (!socketId) return { error: 'User is not connected' };
    return { ok: true, targetUserId: String(targetUserId), socketId };
  }

  modClearChat(actorSocketId) {
    const actor = this.users.get(actorSocketId);
    if (!can(actor, ACTIONS.MOD_CLEAR_CHAT)) {
      return { error: 'Moderator permissions required' };
    }
    this.chat = [];
    return { ok: true };
  }

  modSkipCurrent(actorSocketId) {
    const actor = this.users.get(actorSocketId);
    if (!can(actor, ACTIONS.SKIP_ANY_NOW_PLAYING)) {
      return { error: 'Moderator permissions required to skip this song' };
    }
    if (!this.nowPlaying) return { error: 'Nothing is playing' };
    const playlistSyncFor = this._finishCurrentTrack(this.nowPlaying.userId);
    return { ok: true, playlistSyncFor, playerChanged: true };
  }

  _syncMemberProfile(member, account = {}) {
    if (account.displayName) member.displayName = String(account.displayName).slice(0, 24);
    if (account.username && !account.displayName) {
      member.displayName = String(account.username).slice(0, 24);
    }
    if (account.level != null) member.level = account.level;
    if (account.staffRole !== undefined) {
      member.staffRole = account.staffRole;
      member.role = account.staffRole === 'admin' ? 'admin' : 'user';
    }
    if (account.emailVerified !== undefined) member.emailVerified = account.emailVerified === true;
    if (account.avatarUrl !== undefined) member.avatarUrl = account.avatarUrl || null;
    if (account.customSaying !== undefined) {
      member.customSaying = String(account.customSaying || '').slice(0, 120);
    }
    if (account.badges !== undefined) {
      member.badges = Array.isArray(account.badges) ? [...account.badges] : [];
    }
  }

  addUser(socketId, displayName, account = {}) {
    const odName = (displayName || `Guest-${socketId.slice(0, 4)}`).slice(0, 24);
    const userId = account.userId ? String(account.userId) : null;

    const user = {
      socketId,
      userId,
      displayName: odName,
      level: account.level ?? 1,
      staffRole: account.staffRole ?? null,
      emailVerified: account.emailVerified === true,
      avatarUrl: account.avatarUrl ?? null,
      customSaying: account.customSaying ?? '',
      badges: Array.isArray(account.badges) ? [...account.badges] : [],
      role: account.staffRole === 'admin' ? 'admin' : 'user',
      inQueue: false,
      connectedAt: Date.now(),
    };

    if (userId) {
      const member = this._ensureMember(userId, user);
      this._syncMemberProfile(member, { ...account, displayName: odName });
      member.connected = true;
      member.socketId = socketId;
      member.connectedAt = Date.now();
      user.inQueue = member.inQueue === true;
      user.displayName = member.displayName;

      if (this.nowPlaying?.userId === userId) {
        this.nowPlaying.socketId = socketId;
        this.nowPlaying.djName = member.displayName;
      }

      for (const entry of this.globalQueue) {
        if (entry.userId === userId) entry.djName = member.displayName;
      }
    }

    this.users.set(socketId, user);
    return user;
  }

  addBotUser(socketId, account = {}, playlistItems = []) {
    const userId = account.userId ? String(account.userId) : socketId;
    account = { ...account, userId };

    if (this.users.has(socketId)) {
      this.setPlaylistForUserId(userId, playlistItems);
      return this.users.get(socketId);
    }

    this.addUser(socketId, account.displayName, account);
    const playlist = (playlistItems || []).map((item, index) => ({
      id: item.id || `${userId}-${index}`,
      videoId: item.videoId,
      title: item.title,
      thumbnail: item.thumbnail || youtubeThumbnailUrl(item.videoId),
      channel: item.channel ?? null,
      duration: item.duration ?? null,
    }));
    this.setPlaylistForUserId(userId, playlist);
    return this.users.get(socketId);
  }

  attachUserAccount(socketId, account = {}) {
    const user = this.users.get(socketId);
    if (!user) return { error: 'Not connected' };
    if (account.userId != null) user.userId = String(account.userId);
    if (account.level != null) user.level = account.level;
    if (account.staffRole !== undefined) {
      user.staffRole = account.staffRole;
      user.role = account.staffRole === 'admin' ? 'admin' : 'user';
    }
    if (account.emailVerified !== undefined) user.emailVerified = account.emailVerified === true;
    if (account.displayName) user.displayName = String(account.displayName).slice(0, 24);
    if (account.username && !account.displayName) {
      user.displayName = String(account.username).slice(0, 24);
    }
    if (account.avatarUrl !== undefined) user.avatarUrl = account.avatarUrl || null;
    if (account.customSaying !== undefined) {
      user.customSaying = String(account.customSaying || '').slice(0, 120);
    }
    if (account.badges !== undefined) {
      user.badges = Array.isArray(account.badges) ? [...account.badges] : [];
    }

    if (user.userId) {
      const member = this._ensureMember(user.userId, user);
      this._syncMemberProfile(member, user);
      member.connected = true;
      member.socketId = socketId;
      user.inQueue = member.inQueue === true;
    }

    return { ok: true, user };
  }

  /** @deprecated use setPlaylistForUserId */
  setPlaylist(socketId, items) {
    const userId = this.getUserId(socketId);
    if (!userId) return;
    this.setPlaylistForUserId(userId, items);
  }

  setPlaylistForUserId(userId, items) {
    if (!userId) return;
    this.playlistsByUserId.set(String(userId), Array.isArray(items) ? [...items] : []);
  }

  getUserId(socketId) {
    return this.users.get(socketId)?.userId ?? null;
  }

  getPlaylist(socketId) {
    const userId = this.getUserId(socketId);
    if (!userId) return [];
    return this.getPlaylistForUserId(userId);
  }

  getPlaylistForUserId(userId) {
    return [...(this.playlistsByUserId.get(String(userId)) || [])];
  }

  markUserDisconnected(socketId) {
    const user = this.users.get(socketId);
    if (!user) return { playlistSyncFor: null, playerChanged: false };

    const userId = user.userId;
    if (userId) {
      const member = this._getMember(userId);
      if (member) {
        member.connected = false;
        member.socketId = null;
      }
    }

    this.users.delete(socketId);
    return { playlistSyncFor: null, playerChanged: false };
  }

  purgeMember(userId) {
    const id = String(userId);
    let playlistSyncFor = null;

    if (this._isCurrentDjUserId(id)) {
      playlistSyncFor = this._finishCurrentTrack(id);
    } else {
      this._removeFromQueue(id);
    }

    for (const [socketId, user] of this.users.entries()) {
      if (user.userId === id) this.users.delete(socketId);
    }

    this.membersByUserId.delete(id);
    this.playlistsByUserId.delete(id);
    return { playlistSyncFor };
  }

  removeUser(socketId) {
    return this.markUserDisconnected(socketId);
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

  _requireLoggedIn(socketId) {
    const user = this.users.get(socketId);
    if (!user?.userId) return { error: 'Log in to use playlists and the DJ queue' };
    return { ok: true, user };
  }

  async addToPlaylist(socketId, url) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;

    const videoId = parseYoutubeId(url);
    if (!videoId) return { error: 'Invalid YouTube URL or video ID' };

    const pl = this.getPlaylistForUserId(auth.user.userId);
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
      id: `${auth.user.userId}-${Date.now()}`,
      videoId: meta.videoId,
      title: meta.title,
      thumbnail: meta.thumbnail,
      channel: meta.channel,
      duration: meta.duration,
    };
    pl.push(item);
    this.setPlaylistForUserId(auth.user.userId, pl);
    return { ok: true, playlist: this.getPlaylistForUserId(auth.user.userId) };
  }

  removeFromPlaylist(socketId, itemId) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;

    const pl = this.getPlaylistForUserId(auth.user.userId);
    const next = pl.filter((s) => s.id !== itemId);
    this.setPlaylistForUserId(auth.user.userId, next);
    return { ok: true, playlist: next };
  }

  reorderPlaylist(socketId, orderedIds) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;

    const pl = this.getPlaylistForUserId(auth.user.userId);
    const map = new Map(pl.map((s) => [s.id, s]));
    const next = orderedIds.map((id) => map.get(id)).filter(Boolean);
    if (next.length !== pl.length) return { error: 'Invalid order' };
    this.setPlaylistForUserId(auth.user.userId, next);
    return { ok: true, playlist: next };
  }

  async importToPlaylist(socketId, urls) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;

    if (!Array.isArray(urls) || urls.length === 0) {
      return { error: 'No URLs to import' };
    }

    const MAX_IMPORT = 100;
    const lines = urls
      .map((line) => String(line || '').trim())
      .filter((line) => line && !line.startsWith('#'));
    if (!lines.length) return { error: 'No valid URLs found in file' };
    if (lines.length > MAX_IMPORT) {
      return { error: `Import limited to ${MAX_IMPORT} URLs per file` };
    }

    const pl = this.getPlaylistForUserId(auth.user.userId);
    const existingIds = new Set(pl.map((s) => s.videoId));
    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const line of lines) {
      const videoId = parseYoutubeId(extractPlaylistLineUrl(line));
      if (!videoId) {
        failed += 1;
        continue;
      }
      if (existingIds.has(videoId)) {
        skipped += 1;
        continue;
      }

      let meta;
      try {
        meta = await fetchYoutubeMeta(videoId);
      } catch {
        failed += 1;
        continue;
      }

      pl.push({
        id: `${auth.user.userId}-${Date.now()}-${added}`,
        videoId: meta.videoId,
        title: meta.title,
        thumbnail: meta.thumbnail,
        channel: meta.channel,
        duration: meta.duration,
      });
      existingIds.add(meta.videoId);
      added += 1;
    }

    this.setPlaylistForUserId(auth.user.userId, pl);
    if (added === 0 && skipped === 0 && failed > 0) {
      return { error: 'Could not import any songs from that file' };
    }

    return { ok: true, playlist: this.getPlaylistForUserId(auth.user.userId), added, skipped, failed };
  }

  ripCurrentSong(socketId) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;
    if (!this.nowPlaying) return { error: 'Nothing is playing' };

    const pl = this.getPlaylistForUserId(auth.user.userId);
    if (pl.some((s) => s.videoId === this.nowPlaying.videoId)) {
      return { error: 'Song already in your playlist' };
    }
    const item = {
      id: `${auth.user.userId}-${Date.now()}`,
      videoId: this.nowPlaying.videoId,
      title: this.nowPlaying.title,
      thumbnail: youtubeThumbnailUrl(this.nowPlaying.videoId),
      channel: null,
      duration: this.nowPlaying.durationSec ?? null,
    };
    pl.push(item);
    this.setPlaylistForUserId(auth.user.userId, pl);
    return { ok: true, playlist: pl };
  }

  _removeFromQueue(userId) {
    const id = String(userId);
    const member = this._getMember(id);
    if (member) member.inQueue = false;
    this.globalQueue = this.globalQueue.filter((e) => e.userId !== id);
  }

  _isCurrentDjUserId(userId) {
    return !!userId && this.nowPlaying?.userId === String(userId);
  }

  joinQueue(socketId) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;
    const { user } = auth;
    const userId = user.userId;
    const member = this._ensureMember(userId, user);

    const pl = this.getPlaylistForUserId(userId);
    if (pl.length === 0) return { error: 'Add at least one song to your playlist first' };
    if (member.inQueue) return { error: 'You are already in the DJ queue' };
    if (this.globalQueue.some((e) => e.userId === userId)) {
      return { error: 'You are already in the DJ queue' };
    }
    if (this._isCurrentDjUserId(userId)) {
      return { error: 'You are already playing' };
    }

    this._queueId += 1;
    this.globalQueue.push({
      id: this._queueId,
      userId,
      socketId: user.socketId,
      djName: member.displayName,
    });
    member.inQueue = true;
    user.inQueue = true;

    if (this.nowPlaying) {
      return { ok: true, playlistSyncFor: null, playerChanged: false };
    }

    const playlistSyncFor = this._tryStartNext();
    return { ok: true, playlistSyncFor, playerChanged: playlistSyncFor != null };
  }

  leaveQueue(socketId) {
    const auth = this._requireLoggedIn(socketId);
    if (auth.error) return auth;
    const { user } = auth;
    const userId = user.userId;
    const member = this._getMember(userId);

    if (!member?.inQueue && !this._isCurrentDjUserId(userId)) {
      return { error: 'You are not in the DJ queue' };
    }

    member.inQueue = false;
    user.inQueue = false;
    this._removeFromQueue(userId);

    if (this._isCurrentDjUserId(userId)) {
      return { ok: true, playlistSyncFor: null, playerChanged: false };
    }

    return { ok: true, playlistSyncFor: null, playerChanged: false };
  }

  modKickFromQueue(actorSocketId, targetUserId) {
    const actor = this.users.get(actorSocketId);
    if (!can(actor, ACTIONS.MOD_KICK)) {
      return { error: 'Moderator permissions required' };
    }
    if (!targetUserId) return { error: 'Target user required' };

    const userId = String(targetUserId);
    const member = this._getMember(userId);
    if (!member?.inQueue && !this._isCurrentDjUserId(userId)) {
      return { error: 'That user is not in the DJ queue' };
    }

    member.inQueue = false;
    this._removeFromQueue(userId);

    const liveSocket = this._liveSocketForUserId(userId);
    if (liveSocket) {
      const liveUser = this.users.get(liveSocket);
      if (liveUser) liveUser.inQueue = false;
    }

    if (this._isCurrentDjUserId(userId)) {
      return { ok: true, playlistSyncFor: null, playerChanged: false };
    }

    return { ok: true, playlistSyncFor: null, playerChanged: false };
  }

  skipMine(socketId) {
    return this.leaveQueue(socketId);
  }

  skipCurrent(socketId) {
    if (!this.nowPlaying) return { error: 'Nothing is playing' };
    const user = this.users.get(socketId);
    const isCurrentDj =
      this.nowPlaying.userId === user?.userId ||
      this.nowPlaying.socketId === socketId;
    if (!can(user, ACTIONS.SKIP_OWN_NOW_PLAYING, { isCurrentDj })) {
      return { error: 'Only the current DJ can skip this song' };
    }
    const playlistSyncFor = this._finishCurrentTrack(this.nowPlaying.userId);
    return { ok: true, playlistSyncFor, playerChanged: true };
  }

  addChat(socketId, text) {
    const user = this.users.get(socketId);
    if (!user) return { error: 'Not connected' };
    if (user.userId && this.isChatTimedOut(user.userId)) {
      return { error: 'You are timed out from chat' };
    }
    const trimmed = String(text || '').trim().slice(0, MAX_MESSAGE_LEN);
    if (!trimmed) return { error: 'Message is empty' };

    this._chatId += 1;
    const msg = {
      id: this._chatId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl || null,
      text: trimmed,
      at: Date.now(),
    };
    this.chat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return { ok: true, message: msg };
  }

  onTrackEnded() {
    if (!this.nowPlaying) return null;
    const trackKey = `${this.nowPlaying.userId}:${this.nowPlaying.startedAt}`;
    if (this._lastFinishedAt === trackKey) return null;
    this._lastFinishedAt = trackKey;
    return this._finishCurrentTrack(this.nowPlaying.userId);
  }

  validateClientTrackEnd(socketId, payload = {}) {
    if (!this.nowPlaying) return { ok: false, reason: 'idle' };

    const np = this.nowPlaying;
    if (
      payload.playbackSessionId &&
      np.playbackSessionId &&
      payload.playbackSessionId !== np.playbackSessionId
    ) {
      return { ok: false, reason: 'session_mismatch' };
    }

    const userId = this.getUserId(socketId);
    const isCurrentDj = np.userId === userId || np.socketId === socketId;
    if (!isCurrentDj) {
      return { ok: false, reason: 'not_current_dj' };
    }

    const elapsedSec = (Date.now() - np.startedAt) / 1000;
    const durationSec = this._knownDurationSec(np.durationSec);

    if (durationSec != null && elapsedSec < durationSec * TRACK_END_MIN_ELAPSED_RATIO) {
      return { ok: false, reason: 'too_early' };
    }

    return { ok: true };
  }

  onClientTrackEnded(socketId, payload = {}) {
    const validation = this.validateClientTrackEnd(socketId, payload);
    if (!validation.ok) return { ok: false, reason: validation.reason, playlistSyncFor: null };
    const playlistSyncFor = this.onTrackEnded();
    if (playlistSyncFor === null) {
      return { ok: false, reason: 'deduped', playlistSyncFor: null };
    }
    return { ok: true, playlistSyncFor };
  }

  async refreshNowPlayingDuration() {
    if (!this.nowPlaying?.videoId) return false;
    try {
      const meta = await fetchYoutubeMeta(this.nowPlaying.videoId);
      const sec = this._knownDurationSec(meta.duration);
      if (!sec || !this.nowPlaying) return false;
      this.nowPlaying.durationSec = sec;
      this.nowPlaying.durationSource = 'meta';
      this._scheduleTrackEndTimer();
      return true;
    } catch {
      return false;
    }
  }

  updateNowPlayingDuration(durationSec, source = 'meta') {
    if (!this.nowPlaying) return;
    const sec = this._knownDurationSec(durationSec);
    if (!sec) return;
    this.nowPlaying.durationSec = sec;
    this.nowPlaying.durationSource = source;
    this._scheduleTrackEndTimer();
  }

  _clearTrackEndTimer() {
    if (this._trackEndTimer) {
      clearTimeout(this._trackEndTimer);
      this._trackEndTimer = null;
    }
  }

  _knownDurationSec(rawDuration) {
    const n = Number(rawDuration);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return null;
  }

  _resolveDurationSec(rawDuration) {
    return this._knownDurationSec(rawDuration);
  }

  _scheduleTrackEndTimer() {
    this._clearTrackEndTimer();
    if (!this.nowPlaying) return;

    const durationSec = this._knownDurationSec(this.nowPlaying.durationSec);
    if (!durationSec) return;

    const endAt = this.nowPlaying.startedAt + durationSec * 1000;
    const delay = Math.max(1000, endAt - Date.now());

    this._trackEndTimer = setTimeout(() => {
      this._trackEndTimer = null;
      if (!this.nowPlaying) return;
      const playlistSyncFor = this.onTrackEnded();
      if (playlistSyncFor !== null && this._onTrackEnd) {
        this._onTrackEnd(playlistSyncFor);
      }
    }, delay);
  }

  _consumePlaylistHead(userId) {
    const pl = this.playlistsByUserId.get(String(userId)) || [];
    if (pl.length === 0) return null;
    const head = pl.shift();
    pl.push(head);
    this.playlistsByUserId.set(String(userId), pl);
    return head;
  }

  _moveQueueUserToBottom(userId) {
    const id = String(userId);
    const idx = this.globalQueue.findIndex((e) => e.userId === id);
    if (idx === -1 || idx === this.globalQueue.length - 1) return;
    const [entry] = this.globalQueue.splice(idx, 1);
    this.globalQueue.push(entry);
  }

  _rotateQueueHeadToTail() {
    if (this.globalQueue.length === 0) return;
    const entry = this.globalQueue.shift();
    this.globalQueue.push(entry);
  }

  _cleanupFinishedDj(userId) {
    const id = String(userId);
    if (!this._isUserConnected(id)) {
      this._removeFromQueue(id);
    }
  }

  _finishCurrentTrack(finishedUserId = null) {
    if (this.nowPlaying && this._onBeforeTrackEnd) {
      try {
        this._onBeforeTrackEnd({ ...this.nowPlaying });
      } catch (err) {
        console.warn('[room] beforeTrackEnd handler failed:', err.message);
      }
    }
    this._clearTrackEndTimer();
    this.nowPlaying = null;

    if (finishedUserId) {
      this._cleanupFinishedDj(finishedUserId);
      if (
        this.globalQueue.length > 1 &&
        this.globalQueue[0]?.userId === String(finishedUserId)
      ) {
        this._moveQueueUserToBottom(finishedUserId);
      }
    }

    const playlistSyncFor = this._tryStartNext();
    return playlistSyncFor;
  }

  _tryStartNext() {
    if (this.nowPlaying || this.globalQueue.length === 0) return null;

    const attempts = this.globalQueue.length;
    for (let i = 0; i < attempts; i += 1) {
      const next = this.globalQueue[0];
      if (!next?.userId) break;

      const member = this._getMember(next.userId);
      if (!member?.inQueue) {
        this.globalQueue.shift();
        continue;
      }

      const head = this._consumePlaylistHead(next.userId);
      if (!head) {
        this._removeFromQueue(next.userId);
        continue;
      }

      const durationSec = this._knownDurationSec(head.duration);
      const durationSource = durationSec ? 'meta' : 'unknown';
      const liveSocket = this._liveSocketForUserId(next.userId);

      this.nowPlaying = {
        queueEntryId: next.id,
        userId: next.userId,
        socketId: liveSocket,
        djName: member.displayName,
        videoId: head.videoId,
        title: head.title,
        durationSec,
        durationSource,
        playbackSessionId: this._newPlaybackSessionId(),
        playSessionId: null,
        startedAt: Date.now(),
      };

      this._moveQueueUserToBottom(next.userId);
      this._scheduleTrackEndTimer();
      if (this._onTrackStart) {
        this._onTrackStart(next.userId);
      }
      return next.userId;
    }

    return null;
  }

  hydrateFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;

    this._clearTrackEndTimer();
    this.users.clear();
    this.membersByUserId.clear();
    this.playlistsByUserId.clear();

    for (const user of snapshot.users || []) {
      const userId = user?.userId || (user?.socketId?.startsWith('test:') ? user.socketId : null);
      if (!userId) continue;
      const member = this._ensureMember(userId, user);
      member.displayName = user.displayName || member.displayName;
      member.level = user.level ?? 1;
      member.staffRole = user.staffRole ?? null;
      member.emailVerified = user.emailVerified === true;
      member.avatarUrl = user.avatarUrl ?? null;
      member.customSaying = user.customSaying ?? '';
      member.badges = Array.isArray(user.badges) ? [...user.badges] : [];
      member.role = user.role ?? (user.staffRole === 'admin' ? 'admin' : 'user');
      member.inQueue = user.inQueue === true;
      member.connected = false;
      member.socketId = user.socketId ?? null;
      member.connectedAt = user.connectedAt ?? null;
    }

    for (const [userId, items] of Object.entries(snapshot.playlists || {})) {
      this.playlistsByUserId.set(
        String(userId),
        Array.isArray(items) ? items.map((item) => ({ ...item })) : []
      );
    }

    this.globalQueue = (snapshot.globalQueue || []).map((entry) => ({
      id: entry.id,
      userId: entry.userId || entry.socketId || null,
      socketId: entry.socketId ?? null,
      djName: entry.djName,
    }));

    if (snapshot.nowPlaying) {
      this.nowPlaying = { ...snapshot.nowPlaying };
      if (!this.nowPlaying.playbackSessionId) {
        this.nowPlaying.playbackSessionId = this._newPlaybackSessionId();
      }
      if (!this.nowPlaying.userId && this.nowPlaying.socketId) {
        this.nowPlaying.userId = this.nowPlaying.socketId;
      }
      if (this.nowPlaying.userId) {
        const member = this._getMember(this.nowPlaying.userId);
        if (member) {
          this.nowPlaying.djName = member.displayName;
          this.nowPlaying.socketId = null;
        }
      }
    } else {
      this.nowPlaying = null;
    }

    this._queueId = Number(snapshot.queueId) || 0;
    this._chatId = Number(snapshot.chatId) || 0;
    this._lastFinishedAt = snapshot.lastFinishedAt ?? null;
    this.chat = (snapshot.chat || []).map((msg) => ({ ...msg }));
  }

  recoverExpiredTrack() {
    let advanced = 0;
    while (this.nowPlaying) {
      const durationSec = this._knownDurationSec(this.nowPlaying.durationSec);
      if (!durationSec) break;

      const endAt = this.nowPlaying.startedAt + durationSec * 1000;
      if (Date.now() < endAt) break;

      const finishedUserId = this.nowPlaying.userId;
      this._lastFinishedAt = `${this.nowPlaying.userId}:${this.nowPlaying.startedAt}`;
      this._finishCurrentTrack(finishedUserId);
      advanced += 1;
    }

    if (this.nowPlaying) {
      this._scheduleTrackEndTimer();
    }

    return advanced;
  }

  /**
   * After a process restart, persisted startedAt is from before boot — clients would
   * seek hundreds of seconds ahead while the iframe stays near 0. Reset the clock.
   */
  reconcilePlaybackAfterBoot(bootedAt) {
    const advanced = this.recoverExpiredTrack();
    if (!this.nowPlaying || !Number.isFinite(bootedAt)) {
      return advanced > 0;
    }

    if (this.nowPlaying.startedAt >= bootedAt) {
      return advanced > 0;
    }

    this.nowPlaying.startedAt = Date.now();
    this.nowPlaying.playbackSessionId = this._newPlaybackSessionId();
    this.nowPlaying.playSessionId = null;
    this._scheduleTrackEndTimer();
    return true;
  }

  _playbackPayloadBase() {
    const serverTime = Date.now();
    if (!this.nowPlaying) {
      return {
        videoId: null,
        title: null,
        djName: null,
        startedAt: null,
        isPlaying: false,
        serverTime,
      };
    }
    return {
      videoId: this.nowPlaying.videoId,
      title: this.nowPlaying.title,
      djName: this.nowPlaying.djName,
      userId: this.nowPlaying.userId,
      startedAt: this.nowPlaying.startedAt,
      durationSec: this.nowPlaying.durationSec,
      durationSource: this.nowPlaying.durationSource ?? null,
      playbackSessionId: this.nowPlaying.playbackSessionId,
      playSessionId: this.nowPlaying.playSessionId ?? null,
      isPlaying: true,
      serverTime,
    };
  }

  getPlayerSync() {
    return this._playbackPayloadBase();
  }

  getPlayerTick() {
    if (!this.nowPlaying) return null;
    const base = this._playbackPayloadBase();
    return {
      playbackSessionId: base.playbackSessionId,
      playSessionId: base.playSessionId,
      videoId: base.videoId,
      startedAt: base.startedAt,
      durationSec: base.durationSec,
      serverTime: base.serverTime,
      isPlaying: true,
    };
  }

  getRoomState() {
    const connectedUsers = [...this.users.values()].map((u) => ({
      socketId: u.socketId,
      userId: u.userId ?? null,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl || null,
      customSaying: u.customSaying || '',
      level: u.level ?? 1,
      staffRole: u.staffRole ?? null,
      badges: Array.isArray(u.badges) ? u.badges : [],
      inQueue: u.inQueue,
      connectedAt: u.connectedAt ?? null,
      connected: true,
    }));

    const offlineQueued = [];
    for (const entry of this.globalQueue) {
      if (this._isUserConnected(entry.userId)) continue;
      const member = this._getMember(entry.userId);
      if (!member) continue;
      offlineQueued.push({
        socketId: member.socketId || `offline:${entry.userId}`,
        userId: entry.userId,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl || null,
        customSaying: member.customSaying || '',
        level: member.level ?? 1,
        staffRole: member.staffRole ?? null,
        badges: Array.isArray(member.badges) ? member.badges : [],
        inQueue: true,
        connectedAt: member.connectedAt ?? null,
        connected: false,
      });
    }

    const npUserId = this.nowPlaying?.userId;
    if (npUserId && !this._isUserConnected(npUserId)) {
      const member = this._getMember(npUserId);
      if (member && !offlineQueued.some((u) => u.userId === npUserId)) {
        offlineQueued.push({
          socketId: member.socketId || `offline:${npUserId}`,
          userId: npUserId,
          displayName: member.displayName,
          avatarUrl: member.avatarUrl || null,
          customSaying: member.customSaying || '',
          level: member.level ?? 1,
          staffRole: member.staffRole ?? null,
          badges: Array.isArray(member.badges) ? member.badges : [],
          inQueue: member.inQueue,
          connectedAt: member.connectedAt ?? null,
          connected: false,
        });
      }
    }

    return {
      nowPlaying: this.nowPlaying
        ? {
            userId: this.nowPlaying.userId,
            socketId: this.nowPlaying.socketId,
            djName: this.nowPlaying.djName,
            title: this.nowPlaying.title,
            videoId: this.nowPlaying.videoId,
            startedAt: this.nowPlaying.startedAt,
            durationSec: this.nowPlaying.durationSec,
            durationSource: this.nowPlaying.durationSource ?? null,
            playbackSessionId: this.nowPlaying.playbackSessionId ?? null,
            playSessionId: this.nowPlaying.playSessionId ?? null,
          }
        : null,
      globalQueue: this.globalQueue.map((e) => ({
        id: e.id,
        userId: e.userId,
        socketId: e.socketId,
        djName: e.djName,
      })),
      users: [...connectedUsers, ...offlineQueued],
      chat: [...this.chat],
      testUsersEnabled: isTestUsersEnabled(),
    };
  }
}

module.exports = { Room, DEFAULT_TRACK_DURATION_SEC };
