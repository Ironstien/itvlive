const { TEST_USERS, CHAT_SNIPPETS, SAMPLE_TRACKS } = require('../data/testUsers');
const { youtubeThumbnailUrl } = require('./youtube');

const TEST_SOCKET_PREFIX = 'test:';

let enabled = false;
let chatTimers = [];
let lastChatTrackKey = null;

function isTestSocketId(socketId) {
  return typeof socketId === 'string' && socketId.startsWith(TEST_SOCKET_PREFIX);
}

function botSocketId(userId) {
  return `${TEST_SOCKET_PREFIX}${userId}`;
}

function isTestUsersEnabled() {
  return enabled;
}

function setTestUsersEnabled(value) {
  enabled = !!value;
  if (!enabled) {
    clearChatTimers();
    lastChatTrackKey = null;
  }
}

function clearChatTimers() {
  for (const timer of chatTimers) {
    clearTimeout(timer);
  }
  chatTimers = [];
}

function buildBotAccount(profile) {
  return {
    userId: null,
    displayName: profile.displayName,
    level: profile.level ?? 1,
    staffRole: profile.staffRole ?? null,
    emailVerified: false,
    avatarUrl: profile.avatarUrl ?? null,
    customSaying: profile.customSaying ?? '',
    badges: Array.isArray(profile.badges) ? [...profile.badges] : [],
  };
}

function buildBotPlaylist(botId, tracks) {
  return (tracks || []).map((track, index) => ({
    id: `${botId}-${index}`,
    videoId: track.videoId,
    title: track.title,
    thumbnail: track.thumbnail || youtubeThumbnailUrl(track.videoId),
    channel: track.channel || null,
    duration: track.duration ?? null,
  }));
}

function formatChatLine(template, track) {
  return template
    .replace(/\{title\}/g, track?.title || 'this track')
    .replace(/\{channel\}/g, track?.channel || 'this band');
}

function pickRandomChatters(min = 4, max = 5) {
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...TEST_USERS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, TEST_USERS.length));
}

function pickChatLine(track) {
  const line = CHAT_SNIPPETS[Math.floor(Math.random() * CHAT_SNIPPETS.length)];
  return formatChatLine(line, track);
}

function trackMetaFromNowPlaying(nowPlaying) {
  const found = SAMPLE_TRACKS.find((t) => t.videoId === nowPlaying?.videoId);
  return found
    ? { title: found.title, channel: found.channel || null }
    : { title: nowPlaying?.title || 'this track', channel: null };
}

function scheduleTestUserChat(room, broadcast, nowPlaying) {
  clearChatTimers();

  if (!enabled || !nowPlaying) return;

  const track = trackMetaFromNowPlaying(nowPlaying);
  const chatters = pickRandomChatters(4, 5);

  chatters.forEach((profile, index) => {
    const delayMs = 2000 + index * 3500 + Math.floor(Math.random() * 4000);
    const socketId = botSocketId(profile.id);
    const text = pickChatLine(track);

    const timer = setTimeout(() => {
      if (!enabled || !room.nowPlaying) return;

      const trackKey = `${room.nowPlaying.socketId}:${room.nowPlaying.startedAt}`;
      if (trackKey !== `${nowPlaying.socketId}:${nowPlaying.startedAt}`) return;

      const result = room.addChat(socketId, text);
      if (result.ok && typeof broadcast === 'function') {
        broadcast();
      }
    }, delayMs);

    chatTimers.push(timer);
  });
}

function notifyTrackStarted(room, broadcast) {
  if (!enabled) return;

  const np = room.nowPlaying;
  if (!np) {
    lastChatTrackKey = null;
    return;
  }

  const trackKey = `${np.socketId}:${np.startedAt}`;
  if (trackKey === lastChatTrackKey) return;

  lastChatTrackKey = trackKey;
  scheduleTestUserChat(room, broadcast, np);
}

function enableTestUsers(room) {
  if (enabled) return { ok: true, enabled: true, playlistSyncFor: null };

  let playlistSyncFor = null;

  for (const profile of TEST_USERS) {
    const socketId = botSocketId(profile.id);
    const account = buildBotAccount(profile);
    const playlist = buildBotPlaylist(socketId, profile.playlist);

    room.addBotUser(socketId, account, playlist);

    const joinResult = room.joinQueue(socketId);
    if (joinResult?.playlistSyncFor) {
      playlistSyncFor = joinResult.playlistSyncFor;
    }
  }

  enabled = true;
  return { ok: true, enabled: true, playlistSyncFor };
}

function disableTestUsers(room) {
  if (!enabled) return { ok: true, enabled: false, playlistSyncFor: null };

  clearChatTimers();
  lastChatTrackKey = null;

  let playlistSyncFor = null;
  const botIds = [...room.users.keys()].filter(isTestSocketId);

  for (const socketId of botIds) {
    const result = room.removeUser(socketId);
    if (result.playlistSyncFor) {
      playlistSyncFor = result.playlistSyncFor;
    }
  }

  enabled = false;
  return { ok: true, enabled: false, playlistSyncFor };
}

function toggleTestUsers(room) {
  return enabled ? disableTestUsers(room) : enableTestUsers(room);
}

function skipCurrentTestUserTrack(room) {
  if (!enabled) return { error: 'Test users are not enabled' };
  if (!room.nowPlaying) return { error: 'Nothing is playing' };
  if (!isTestSocketId(room.nowPlaying.socketId)) {
    return { error: 'Current DJ is not a test user' };
  }

  const result = room.skipCurrent(room.nowPlaying.socketId);
  if (result.error) return result;

  return { ok: true, playlistSyncFor: result.playlistSyncFor ?? null };
}

module.exports = {
  TEST_SOCKET_PREFIX,
  isTestSocketId,
  botSocketId,
  isTestUsersEnabled,
  setTestUsersEnabled,
  enableTestUsers,
  disableTestUsers,
  toggleTestUsers,
  notifyTrackStarted,
  skipCurrentTestUserTrack,
};
