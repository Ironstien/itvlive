const { Server } = require('socket.io');
const { Room } = require('../services/room');
const { resolveSocketAuth } = require('../services/socketAuth');
const { saveUserPlaylist } = require('../services/playlistStore');
const { toggleTestUsers, isTestUsersEnabled } = require('../services/testUsers');

const room = new Room();
const chatLastSent = new Map();
const CHAT_COOLDOWN_MS = 800;

function syncPlaylistFor(io, socketId) {
  if (!socketId) return;
  const playlist = room.getPlaylist(socketId);
  const target = io.sockets.sockets.get(socketId);
  if (target) {
    target.emit('playlist:sync', playlist);
    return;
  }
  io.to(socketId).emit('playlist:sync', playlist);
}

function broadcast(io) {
  broadcastRoom(io);
}

function emitPlayerSync(io) {
  io.emit('player:sync', room.getPlayerSync());
}

async function handleTrackEnded(io, playlistSyncFor) {
  if (playlistSyncFor) {
    await persistPlaylist(playlistSyncFor);
  }
  syncPlaylistFor(io, playlistSyncFor);
  broadcast(io);
  emitPlayerSync(io);
}

/** Room updates (chat, online users, queue) — does not touch the YouTube player */
function broadcastRoom(io) {
  io.emit('room:state', room.getRoomState());
}

function parseSocketAccount(auth = {}) {
  if (!auth || typeof auth !== 'object') return {};
  const account = {};
  if (auth.userId) account.userId = String(auth.userId);
  if (auth.level != null) account.level = Number(auth.level);
  if (auth.staffRole) account.staffRole = auth.staffRole;
  if (auth.emailVerified != null) account.emailVerified = auth.emailVerified === true;
  if (auth.username) account.username = auth.username;
  if (auth.avatarUrl !== undefined) account.avatarUrl = auth.avatarUrl || null;
  if (auth.customSaying !== undefined) account.customSaying = auth.customSaying;
  if (auth.badges !== undefined) account.badges = auth.badges;
  return account;
}

async function persistPlaylist(socketId) {
  const userId = room.getUserId(socketId);
  if (!userId) return;
  try {
    await saveUserPlaylist(userId, room.getPlaylist(socketId));
  } catch (err) {
    console.error('[playlist] persist failed:', err.message);
  }
}

function registerSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  room.setTrackEndHandler((playlistSyncFor) => {
    void handleTrackEnded(io, playlistSyncFor);
  });

  io.on('connection', async (socket) => {
    try {
      const resolved = await resolveSocketAuth(socket.handshake.auth || {});
      const displayName =
        resolved.displayName || `Guest-${socket.id.slice(0, 4)}`;

      room.addUser(socket.id, displayName, resolved.account);
      if (resolved.playlist?.length) {
        room.setPlaylist(socket.id, resolved.playlist);
      }

      socket.data.authenticated = resolved.isAuthenticated;

      socket.emit('playlist:sync', room.getPlaylist(socket.id));
      socket.emit('room:state', room.getRoomState());
      socket.emit('player:sync', room.getPlayerSync());
      broadcast(io);
    } catch (err) {
      console.error('[socket] connection setup failed:', err.message);
      socket.disconnect(true);
      return;
    }

    socket.on('user:setName', ({ name }, ack) => {
      const user = room.users.get(socket.id);
      if (user?.userId) {
        if (typeof ack === 'function') {
          ack({ error: 'Logged-in users use their account username' });
        }
        return;
      }
      const result = room.setDisplayName(socket.id, name);
      if (typeof ack === 'function') ack(result);
      if (result.ok) broadcast(io);
    });

    socket.on('user:attachAccount', (payload, ack) => {
      const result = room.attachUserAccount(socket.id, parseSocketAccount(payload));
      if (typeof ack === 'function') ack(result);
      if (result.ok) broadcast(io);
    });

    socket.on('playlist:add', async (payload, ack) => {
      try {
        const result = await room.addToPlaylist(socket.id, payload?.url);
        if (typeof ack === 'function') ack(result);
        if (result.ok) {
          await persistPlaylist(socket.id);
          socket.emit('playlist:sync', result.playlist);
        }
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message || 'Server error' });
      }
    });

    socket.on('playlist:remove', async ({ itemId }, ack) => {
      const result = room.removeFromPlaylist(socket.id, itemId);
      if (typeof ack === 'function') ack(result);
      if (result.ok) {
        await persistPlaylist(socket.id);
        socket.emit('playlist:sync', result.playlist);
      }
    });

    socket.on('playlist:reorder', async ({ orderedIds }, ack) => {
      const result = room.reorderPlaylist(socket.id, orderedIds);
      if (typeof ack === 'function') ack(result);
      if (result.ok) {
        await persistPlaylist(socket.id);
        socket.emit('playlist:sync', result.playlist);
      }
    });

    socket.on('playlist:rip', async (_payload, ack) => {
      const result = room.ripCurrentSong(socket.id);
      if (typeof ack === 'function') ack(result);
      if (result.ok) {
        await persistPlaylist(socket.id);
        socket.emit('playlist:sync', result.playlist);
      }
    });

    socket.on('playlist:import', async (payload, ack) => {
      try {
        const result = await room.importToPlaylist(socket.id, payload?.urls);
        if (typeof ack === 'function') ack(result);
        if (result.ok) {
          await persistPlaylist(socket.id);
          socket.emit('playlist:sync', result.playlist);
        }
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message || 'Server error' });
      }
    });

    socket.on('queue:join', async (_payload, ack) => {
      const result = room.joinQueue(socket.id);
      if (typeof ack === 'function') ack(result);
      if (result.ok) {
        if (result.playlistSyncFor) {
          await persistPlaylist(result.playlistSyncFor);
          syncPlaylistFor(io, result.playlistSyncFor);
        }
        broadcast(io);
        emitPlayerSync(io);
      }
    });

    socket.on('queue:leave', (_payload, ack) => {
      const result = room.leaveQueue(socket.id);
      if (typeof ack === 'function') ack(result);
      if (result.ok) {
        syncPlaylistFor(io, result.playlistSyncFor);
        broadcast(io);
        if (result.playlistSyncFor) emitPlayerSync(io);
      }
    });

    socket.on('queue:skip-mine', (_payload, ack) => {
      const result = room.skipMine(socket.id);
      if (typeof ack === 'function') ack(result);
      if (result.ok) broadcast(io);
    });

    socket.on('queue:skip-current', (_payload, ack) => {
      const result = room.skipCurrent(socket.id);
      if (typeof ack === 'function') ack(result);
      if (result.ok) {
        syncPlaylistFor(io, result.playlistSyncFor);
        broadcast(io);
        emitPlayerSync(io);
      }
    });

    socket.on('dev:testUsers:toggle', (_payload, ack) => {
      try {
        const result = toggleTestUsers(room);
        if (typeof ack === 'function') {
          ack({ ok: true, enabled: isTestUsersEnabled() });
        }
        if (result.playlistSyncFor) {
          syncPlaylistFor(io, result.playlistSyncFor);
        }
        broadcast(io);
        emitPlayerSync(io);
      } catch (err) {
        if (typeof ack === 'function') {
          ack({ error: err.message || 'Failed to toggle test users' });
        }
      }
    });

    socket.on('chat:send', (payload, ack) => {
      try {
        const now = Date.now();
        const last = chatLastSent.get(socket.id) || 0;
        if (now - last < CHAT_COOLDOWN_MS) {
          if (typeof ack === 'function') ack({ error: 'Slow down — wait a moment' });
          return;
        }
        chatLastSent.set(socket.id, now);

        const result = room.addChat(socket.id, payload?.text);
        if (typeof ack === 'function') ack(result);
        if (result.ok) broadcast(io);
      } catch (err) {
        if (typeof ack === 'function') ack({ error: err.message || 'Server error' });
      }
    });

    socket.on('player:ended', () => {
      if (!room.nowPlaying) return;
      const playlistSyncFor = room.onTrackEnded();
      if (playlistSyncFor === null) return;
      void handleTrackEnded(io, playlistSyncFor);
    });

    socket.on('disconnect', async () => {
      chatLastSent.delete(socket.id);
      const userId = room.getUserId(socket.id);
      if (userId) {
        await persistPlaylist(socket.id);
      }
      const hadNowPlaying = !!room.nowPlaying;
      const wasDj = room.nowPlaying?.socketId === socket.id;
      const { playlistSyncFor = null } = room.removeUser(socket.id);
      syncPlaylistFor(io, playlistSyncFor);
      broadcast(io);
      if (hadNowPlaying && (wasDj || !room.nowPlaying)) emitPlayerSync(io);
    });
  });

  return io;
}

module.exports = { registerSockets, room };
