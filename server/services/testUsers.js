const { TEST_USERS } = require('../data/testUsers');
const { youtubeThumbnailUrl } = require('./youtube');

const TEST_SOCKET_PREFIX = 'test:';

let enabled = false;

function isTestSocketId(socketId) {
  return typeof socketId === 'string' && socketId.startsWith(TEST_SOCKET_PREFIX);
}

function botSocketId(userId) {
  return `${TEST_SOCKET_PREFIX}${userId}`;
}

function isTestUsersEnabled() {
  return enabled;
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

module.exports = {
  TEST_SOCKET_PREFIX,
  isTestSocketId,
  botSocketId,
  isTestUsersEnabled,
  enableTestUsers,
  disableTestUsers,
  toggleTestUsers,
};
