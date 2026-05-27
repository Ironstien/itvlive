const { User } = require('../models');
const { isDbConnected } = require('../config/db');
const { verifyToken } = require('./auth');
const { loadUserPlaylist } = require('./playlistStore');

/**
 * Resolve socket handshake auth into room account + optional persisted playlist.
 * Invalid/expired JWT → guest (display name from handshake if provided).
 */
async function resolveSocketAuth(handshakeAuth = {}) {
  const auth = handshakeAuth && typeof handshakeAuth === 'object' ? handshakeAuth : {};
  const guestName = auth.displayName || null;
  let playlist = null;

  const token = auth.token;
  if (!token || !isDbConnected()) {
    return {
      isAuthenticated: false,
      displayName: guestName,
      account: {},
      playlist,
    };
  }

  const payload = verifyToken(token);
  if (!payload?.userId) {
    return {
      isAuthenticated: false,
      displayName: guestName,
      account: {},
      playlist,
    };
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    return {
      isAuthenticated: false,
      displayName: guestName,
      account: {},
      playlist,
    };
  }

  playlist = await loadUserPlaylist(user._id);

  return {
    isAuthenticated: true,
    displayName: user.username,
    account: {
      userId: String(user._id),
      username: user.username,
      level: user.level,
      staffRole: user.staffRole ?? null,
      emailVerified: user.emailVerified === true,
      avatarUrl: user.avatarUrl || null,
      customSaying: user.customSaying || '',
    },
    playlist,
  };
}

module.exports = { resolveSocketAuth };
