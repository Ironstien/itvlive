const mongoose = require('mongoose');
const { PlaylistItem } = require('../models');
const { youtubeThumbnailUrl } = require('./youtube');

function toRoomItem(row) {
  return {
    id: String(row._id),
    videoId: row.videoId,
    title: row.title || 'Untitled',
    thumbnail: row.thumbnail || youtubeThumbnailUrl(row.videoId),
    channel: row.channel || null,
    duration: row.durationSec ?? null,
  };
}

async function loadUserPlaylist(userId) {
  if (!userId) return [];
  const rows = await PlaylistItem.find({ userId }).sort({ sortOrder: 1 }).lean();
  return rows.map(toRoomItem);
}

async function saveUserPlaylist(userId, items) {
  if (!userId) return;
  const oid = new mongoose.Types.ObjectId(userId);
  await PlaylistItem.deleteMany({ userId: oid });
  if (!items?.length) return;

  const docs = items.map((item, index) => ({
    userId: oid,
    videoId: item.videoId,
    title: item.title || 'Untitled',
    thumbnail: item.thumbnail || youtubeThumbnailUrl(item.videoId),
    channel: item.channel || null,
    durationSec:
      item.duration != null && Number.isFinite(Number(item.duration))
        ? Math.floor(Number(item.duration))
        : null,
    sortOrder: index,
  }));

  await PlaylistItem.insertMany(docs);
}

module.exports = { loadUserPlaylist, saveUserPlaylist };
