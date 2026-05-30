const { isDbConnected } = require('../config/db');
const RoomSnapshot = require('../models/RoomSnapshot');
const { isTestUsersEnabled, setTestUsersEnabled } = require('./testUsers');

const SNAPSHOT_KEY = 'live';
const SAVE_DEBOUNCE_MS = 400;

let saveTimer = null;
let saveInFlight = null;

function collectPersistSocketIds(room) {
  const ids = new Set();
  if (room.nowPlaying?.socketId) ids.add(room.nowPlaying.socketId);
  for (const entry of room.globalQueue) {
    if (entry?.socketId) ids.add(entry.socketId);
  }
  return ids;
}

function roomToSnapshot(room) {
  const persistSocketIds = collectPersistSocketIds(room);
  const users = [];
  const playlists = {};

  for (const socketId of persistSocketIds) {
    const user = room.users.get(socketId);
    if (user) {
      users.push({
        socketId: user.socketId,
        userId: user.userId ?? null,
        displayName: user.displayName,
        level: user.level ?? 1,
        staffRole: user.staffRole ?? null,
        emailVerified: user.emailVerified === true,
        avatarUrl: user.avatarUrl ?? null,
        customSaying: user.customSaying ?? '',
        badges: Array.isArray(user.badges) ? [...user.badges] : [],
        role: user.role ?? 'user',
        inQueue: user.inQueue === true,
        connectedAt: user.connectedAt ?? null,
      });
    }

    const pl = room.playlists.get(socketId);
    if (pl?.length) {
      playlists[socketId] = pl.map((item) => ({ ...item }));
    }
  }

  return {
    singleton: SNAPSHOT_KEY,
    nowPlaying: room.nowPlaying ? { ...room.nowPlaying } : null,
    globalQueue: room.globalQueue.map((entry) => ({ ...entry })),
    users,
    playlists,
    testUsersEnabled: isTestUsersEnabled(),
    queueId: room._queueId,
    chatId: room._chatId,
    lastFinishedAt: room._lastFinishedAt,
    chat: [...room.chat],
  };
}

async function saveRoomState(room) {
  if (!isDbConnected()) return;

  const snapshot = roomToSnapshot(room);
  await RoomSnapshot.findOneAndUpdate(
    { singleton: SNAPSHOT_KEY },
    { $set: snapshot },
    { upsert: true, new: true }
  );
}

function scheduleRoomSave(room) {
  if (!isDbConnected()) return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveInFlight = saveRoomState(room).catch((err) => {
      console.error('[room] persist failed:', err.message);
    });
  }, SAVE_DEBOUNCE_MS);
}

async function flushRoomSave(room) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveInFlight) {
    await saveInFlight.catch(() => {});
  }
  if (!isDbConnected()) return;
  await saveRoomState(room);
}

async function loadRoomState() {
  if (!isDbConnected()) return null;
  const row = await RoomSnapshot.findOne({ singleton: SNAPSHOT_KEY }).lean();
  if (!row) return null;

  return {
    nowPlaying: row.nowPlaying ?? null,
    globalQueue: row.globalQueue ?? [],
    users: row.users ?? [],
    playlists: row.playlists ?? {},
    testUsersEnabled: row.testUsersEnabled === true,
    queueId: row.queueId ?? 0,
    chatId: row.chatId ?? 0,
    lastFinishedAt: row.lastFinishedAt ?? null,
    chat: row.chat ?? [],
  };
}

async function hydrateRoom(room) {
  const snapshot = await loadRoomState();
  if (!snapshot) return false;

  room.hydrateFromSnapshot(snapshot);
  setTestUsersEnabled(snapshot.testUsersEnabled);
  room.recoverExpiredTrack();

  const np = room.nowPlaying;
  console.log(
    `[room] Restored snapshot — nowPlaying: ${np ? np.title || np.videoId : 'idle'}, queue: ${room.globalQueue.length}, testUsers: ${snapshot.testUsersEnabled}`
  );
  return true;
}

module.exports = {
  scheduleRoomSave,
  flushRoomSave,
  hydrateRoom,
  roomToSnapshot,
};
