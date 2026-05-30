const { Server } = require('socket.io');

const { Room } = require('../services/room');

const { resolveSocketAuth } = require('../services/socketAuth');

const { saveUserPlaylist, loadUserPlaylist } = require('../services/playlistStore');

const { scheduleRoomSave, flushRoomSave, hydrateRoom } = require('../services/roomStore');

const { isDbConnected } = require('../config/db');

const { getBootMeta } = require('../services/serverBoot');
const {

  toggleTestUsers,

  isTestUsersEnabled,

  notifyTrackStarted,

  skipCurrentTestUserTrack,

} = require('../services/testUsers');



const room = new Room();

const chatLastSent = new Map();

/** @type {Map<string, string>} userId → active socketId */

const activeUserSockets = new Map();

const CHAT_COOLDOWN_MS = 800;

const PLAYER_TICK_MS = 15000;

let ioRef = null;

let playerTickTimer = null;



function withBootMeta(payload = {}) {

  return { ...payload, ...getBootMeta() };

}



function getPlayerSyncPayload() {

  return withBootMeta(room.getPlayerSync());

}



function getPlayerTickPayload() {

  const tick = room.getPlayerTick();

  if (!tick) return null;

  return withBootMeta(tick);

}



function getRoomStatePayload() {

  return withBootMeta(room.getRoomState());

}



function resolveUserId(userIdOrSocketId) {

  if (!userIdOrSocketId) return null;

  const key = String(userIdOrSocketId);

  if (room.membersByUserId?.has(key)) return key;

  return room.getUserId(key) || null;

}



function syncPlaylistFor(io, userIdOrSocketId) {

  const userId = resolveUserId(userIdOrSocketId);

  if (!userId) return;

  const socketId = room._liveSocketForUserId(userId);

  if (!socketId) return;

  const playlist = room.getPlaylistForUserId(userId);

  const target = io.sockets.sockets.get(socketId);

  if (target) {

    target.emit('playlist:sync', playlist);

  }

}



function emitPlayerSyncTo(socket) {

  if (!socket) return;

  socket.emit('player:sync', getPlayerSyncPayload());

}



function stopPlayerTick() {

  if (playerTickTimer) {

    clearInterval(playerTickTimer);

    playerTickTimer = null;

  }

}



function startPlayerTick(io) {

  stopPlayerTick();

  if (!room.nowPlaying) return;



  playerTickTimer = setInterval(() => {

    if (!room.nowPlaying) {

      stopPlayerTick();

      return;

    }

    const payload = getPlayerTickPayload();

    if (payload) io.emit('player:tick', payload);

  }, PLAYER_TICK_MS);

}



function broadcast(io) {

  broadcastRoom(io);

}



async function cacheSongDuration(videoId, title, durationSec) {

  if (!isDbConnected() || !videoId || !durationSec) return;

  try {

    const Song = require('../models/Song');

    await Song.findOneAndUpdate(

      { youtubeId: videoId },

      {

        $set: {

          durationSec,

          title: title || 'Untitled',

        },

        $setOnInsert: { youtubeId: videoId },

      },

      { upsert: true }

    );

  } catch (err) {

    console.warn('[song] duration cache failed:', err.message);

  }

}



async function lookupCachedSongDuration(videoId) {

  if (!isDbConnected() || !videoId) return null;

  try {

    const Song = require('../models/Song');

    const row = await Song.findOne({ youtubeId: videoId }).select('durationSec').lean();

    return row?.durationSec > 0 ? Math.floor(row.durationSec) : null;

  } catch {

    return null;

  }

}



async function createPlaySessionForNowPlaying() {

  if (!room.nowPlaying || !isDbConnected()) return;

  if (room.nowPlaying.playSessionId) return;



  try {

    const PlaySession = require('../models/PlaySession');

    const np = room.nowPlaying;

    const session = await PlaySession.create({

      youtubeId: np.videoId,

      title: np.title,

      playedByUserId: np.userId,

      playedBySocketId: np.socketId,

      djName: np.djName,

      startedAt: new Date(np.startedAt),

      durationSec: np.durationSec,

    });

    np.playSessionId = String(session._id);

  } catch (err) {

    console.warn('[playSession] create failed:', err.message);

  }

}



async function onTrackStarted(djUserId) {

  if (!room.nowPlaying) return;



  if (djUserId) {

    await persistPlaylist(djUserId);

  }



  if (!room.nowPlaying.durationSec) {

    const cached = await lookupCachedSongDuration(room.nowPlaying.videoId);

    if (cached) {

      room.updateNowPlayingDuration(cached, 'meta');

    } else {

      void room.refreshNowPlayingDuration().then((updated) => {

        if (updated && room.nowPlaying) {

          void cacheSongDuration(

            room.nowPlaying.videoId,

            room.nowPlaying.title,

            room.nowPlaying.durationSec

          );

          if (ioRef) emitPlayerSync(ioRef);

        }

      });

    }

  } else {

    void cacheSongDuration(

      room.nowPlaying.videoId,

      room.nowPlaying.title,

      room.nowPlaying.durationSec

    );

  }



  await createPlaySessionForNowPlaying();

}



function emitPlayerSync(io) {

  const payload = getPlayerSyncPayload();

  io.emit('player:sync', payload);

  notifyTrackStarted(room, () => broadcastRoom(io));

  scheduleRoomSave(room);

  if (room.nowPlaying) {
    startPlayerTick(io);
  } else {
    stopPlayerTick();
  }

}



async function handleTrackEnded(io, playlistSyncFor) {

  stopPlayerTick();

  if (playlistSyncFor) {

    await persistPlaylist(playlistSyncFor);

  }

  syncPlaylistFor(io, playlistSyncFor);

  broadcast(io);

  emitPlayerSync(io);

}



/** Room updates (chat, online users, queue) — does not touch the YouTube player */

function broadcastRoom(io) {

  io.emit('room:state', getRoomStatePayload());

  scheduleRoomSave(room);

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



async function persistPlaylist(userIdOrSocketId) {

  const userId = resolveUserId(userIdOrSocketId);

  if (!userId) return;

  if (!isDbConnected()) {

    console.warn('[playlist] skip persist — database not connected');

    return;

  }

  try {

    const items = room.getPlaylistForUserId(userId);

    await saveUserPlaylist(userId, items);

  } catch (err) {

    console.error('[playlist] persist failed:', err.message);

  }

}



async function restoreUserPlaylist(socketId) {

  const userId = room.getUserId(socketId);

  if (!userId) return room.getPlaylist(socketId);



  if (room.isPlaylistSessionCanonical(userId)) {

    return room.getPlaylistForUserId(userId);

  }



  if (!isDbConnected()) return room.getPlaylist(socketId);

  try {

    const saved = await loadUserPlaylist(userId);

    room.setPlaylistForUserId(userId, saved);

    return saved;

  } catch (err) {

    console.error('[playlist] restore failed:', err.message);

    return room.getPlaylist(socketId);

  }

}



function registerSockets(httpServer) {

  const io = new Server(httpServer, {

    cors: {

      origin: true,

      credentials: true,

    },

    pingInterval: 20000,

    pingTimeout: 25000,

  });

  ioRef = io;



  room.setTrackEndHandler((playlistSyncFor) => {

    void handleTrackEnded(io, playlistSyncFor);

  });



  room.setTrackStartHandler((djUserId) => {

    void onTrackStarted(djUserId);

  });



  io.on('connection', async (socket) => {

    try {

      const resolved = await resolveSocketAuth(socket.handshake.auth || {});

      const displayName =

        resolved.displayName || `Guest-${socket.id.slice(0, 4)}`;



      const userId = resolved.account?.userId ? String(resolved.account.userId) : null;

      if (userId) {

        const existingSocketId = activeUserSockets.get(userId);

        if (existingSocketId && existingSocketId !== socket.id) {

          const existing = io.sockets.sockets.get(existingSocketId);

          if (existing) {

            socket.emit('room:error', {

              error: 'This account is already open in another tab. Close it first.',

            });

            socket.disconnect(true);

            return;

          }

          activeUserSockets.delete(userId);

        }

        activeUserSockets.set(userId, socket.id);

      }



      room.addUser(socket.id, displayName, resolved.account);

      if (userId && !room.isPlaylistSessionCanonical(userId)) {

        room.setPlaylistForUserId(userId, resolved.playlist ?? []);

      } else if (userId && resolved.playlist?.length) {

        const current = room.getPlaylistForUserId(userId);

        if (!current.length) {

          room.setPlaylistForUserId(userId, resolved.playlist);

        }

      }



      socket.data.authenticated = resolved.isAuthenticated;

      socket.data.userId = userId;



      socket.emit('playlist:sync', userId ? room.getPlaylistForUserId(userId) : []);

      socket.emit('room:state', getRoomStatePayload());

      emitPlayerSyncTo(socket);

      broadcast(io);

    } catch (err) {

      console.error('[socket] connection setup failed:', err.message);

      socket.disconnect(true);

      return;

    }



    socket.on('room:requestSync', async () => {

      const userId = room.getUserId(socket.id);

      const playlist = userId ? await restoreUserPlaylist(socket.id) : [];

      socket.emit('playlist:sync', playlist);

      socket.emit('room:state', getRoomStatePayload());

      emitPlayerSyncTo(socket);

    });



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



    socket.on('user:attachAccount', async (payload, ack) => {

      const result = room.attachUserAccount(socket.id, parseSocketAccount(payload));

      if (result.ok && room.getUserId(socket.id)) {

        const userId = room.getUserId(socket.id);

        activeUserSockets.set(userId, socket.id);

        const playlist = await restoreUserPlaylist(socket.id);

        await persistPlaylist(userId);

        socket.emit('playlist:sync', playlist);

      }

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

        if (result.playerChanged) {

          emitPlayerSync(io);

        } else {

          emitPlayerSyncTo(socket);

          scheduleRoomSave(room);

        }

      }

    });



    socket.on('queue:leave', (_payload, ack) => {

      const result = room.leaveQueue(socket.id);

      if (typeof ack === 'function') ack(result);

      if (result.ok) {

        broadcast(io);

        scheduleRoomSave(room);

      }

    });



    socket.on('queue:skip-mine', (_payload, ack) => {

      const result = room.skipMine(socket.id);

      if (typeof ack === 'function') ack(result);

      if (result.ok) broadcast(io);

    });



    socket.on('queue:skip-current', async (_payload, ack) => {

      const result = room.skipCurrent(socket.id);

      if (typeof ack === 'function') ack(result);

      if (result.ok) {

        if (result.playlistSyncFor) {

          await persistPlaylist(result.playlistSyncFor);

        }

        syncPlaylistFor(io, result.playlistSyncFor);

        broadcast(io);

        emitPlayerSync(io);

      }

    });



    socket.on('queue:mod-kick', ({ targetUserId }, ack) => {

      const result = room.modKickFromQueue(socket.id, targetUserId);

      if (typeof ack === 'function') ack(result);

      if (result.ok) {

        broadcast(io);

        scheduleRoomSave(room);

      }

    });



    socket.on('dev:testUsers:toggle', (_payload, ack) => {

      try {

        const result = toggleTestUsers(room);

        if (result.error) {

          if (typeof ack === 'function') ack({ error: result.error });

          return;

        }

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



    socket.on('dev:testUsers:skip', (_payload, ack) => {

      try {

        const result = skipCurrentTestUserTrack(room);

        if (typeof ack === 'function') ack(result);

        if (result.ok) {

          if (result.playlistSyncFor) {

            syncPlaylistFor(io, result.playlistSyncFor);

          }

          broadcast(io);

          emitPlayerSync(io);

        }

      } catch (err) {

        if (typeof ack === 'function') {

          ack({ error: err.message || 'Failed to skip test user track' });

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



    socket.on('player:ended', (payload = {}) => {

      if (!room.nowPlaying) return;

      const result = room.onClientTrackEnded(socket.id, payload);

      if (!result.ok || result.playlistSyncFor === null) return;

      void handleTrackEnded(io, result.playlistSyncFor);

    });



    socket.on('disconnect', async () => {

      chatLastSent.delete(socket.id);

      const userId = room.getUserId(socket.id);

      if (userId) {

        await persistPlaylist(userId);

        if (activeUserSockets.get(userId) === socket.id) {

          activeUserSockets.delete(userId);

        }

      }

      room.markUserDisconnected(socket.id);

      broadcast(io);

      scheduleRoomSave(room);

    });

  });



  return io;

}



async function initRoomFromStore() {

  const restored = await hydrateRoom(room);

  if (restored && room.nowPlaying) {

    if (!room.nowPlaying.playbackSessionId) {

      room.nowPlaying.playbackSessionId = room._newPlaybackSessionId();

    }

    notifyTrackStarted(room, ioRef ? () => broadcastRoom(ioRef) : null);

    if (ioRef) startPlayerTick(ioRef);

  }

  return restored;

}



function flushPersistedRoom() {

  return flushRoomSave(room);

}



module.exports = {

  registerSockets,

  initRoomFromStore,

  flushPersistedRoom,

  room,

  getBootMeta,

};


