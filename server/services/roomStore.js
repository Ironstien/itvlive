const { isDbConnected } = require('../config/db');
const RoomSnapshot = require('../models/RoomSnapshot');
const { isTestUsersEnabled, setTestUsersEnabled } = require('./testUsers');
const { getBootMeta } = require('./serverBoot');

const SNAPSHOT_KEY = 'live';
const SAVE_DEBOUNCE_MS = 400;

let saveTimer = null;
let saveInFlight = null;

function collectPersistUserIds(room) {
  const ids = new Set();
  if (room.nowPlaying?.userId) ids.add(String(room.nowPlaying.userId));
  for (const entry of room.globalQueue) {
    if (entry?.userId) ids.add(String(entry.userId));
  }
  return ids;
}

function roomToSnapshot(room) {
  const persistUserIds = collectPersistUserIds(room);
  const users = [];
  const playlists = {};

  for (const userId of persistUserIds) {
    const member = room.membersByUserId?.get(userId);
    if (member) {
      users.push({
        userId: member.userId,
        socketId: member.socketId ?? null,
        displayName: member.displayName,
        level: member.level ?? 1,
        staffRole: member.staffRole ?? null,
        emailVerified: member.emailVerified === true,
        avatarUrl: member.avatarUrl ?? null,
        customSaying: member.customSaying ?? '',
        badges: Array.isArray(member.badges) ? [...member.badges] : [],
        role: member.role ?? 'user',
        inQueue: member.inQueue === true,
        connectedAt: member.connectedAt ?? null,
      });
    }

    const pl = room.playlistsByUserId?.get(userId);
    if (pl?.length) {
      playlists[userId] = pl.map((item) => ({ ...item }));
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
  const { bootedAt } = getBootMeta();
  if (room.reconcilePlaybackAfterBoot(bootedAt)) {
    console.log('[room] Playback clock reconciled after server boot');
  }

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
