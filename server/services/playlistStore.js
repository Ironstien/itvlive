const mongoose = require('mongoose');
const { PlaylistItem } = require('../models');
const { isDbConnected } = require('../config/db');
const { youtubeThumbnailUrl } = require('./youtube');

function normalizeUserId(userId) {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  const str = String(userId);
  if (!mongoose.Types.ObjectId.isValid(str)) return null;
  return new mongoose.Types.ObjectId(str);
}

function dedupePlaylistItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items || []) {
    const videoId = item?.videoId ? String(item.videoId).trim() : '';
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    deduped.push(item);
  }
  return deduped;
}

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

function toPlaylistDoc(userId, item, sortOrder) {
  return {
    userId,
    videoId: item.videoId,
    title: item.title || 'Untitled',
    thumbnail: item.thumbnail || youtubeThumbnailUrl(item.videoId),
    channel: item.channel || null,
    durationSec:
      item.duration != null && Number.isFinite(Number(item.duration))
        ? Math.floor(Number(item.duration))
        : null,
    sortOrder,
  };
}

async function loadUserPlaylist(userId) {
  if (!isDbConnected()) return [];
  const oid = normalizeUserId(userId);
  if (!oid) return [];
  const rows = await PlaylistItem.find({ userId: oid }).sort({ sortOrder: 1 }).lean();
  return rows.map(toRoomItem);
}

async function saveUserPlaylist(userId, items) {
  if (!isDbConnected()) return;
  const oid = normalizeUserId(userId);
  if (!oid) return;

  const deduped = dedupePlaylistItems(items);

  if (deduped.length === 0) {
    await PlaylistItem.deleteMany({ userId: oid });
    return;
  }

  const docs = deduped.map((item, index) => toPlaylistDoc(oid, item, index));
  for (const doc of docs) {
    if (!doc.videoId || doc.videoId.length > 11) {
      throw new Error(`Invalid playlist videoId: ${doc.videoId || '(empty)'}`);
    }
  }

  const existing = await PlaylistItem.find({ userId: oid }, '_id videoId').lean();
  const existingByVideo = new Map(existing.map((row) => [row.videoId, row._id]));
  const keepIds = new Set();
  const ops = [];

  for (const doc of docs) {
    const existingId = existingByVideo.get(doc.videoId);
    if (existingId) {
      keepIds.add(String(existingId));
      ops.push({
        updateOne: {
          filter: { _id: existingId },
          update: { $set: doc },
        },
      });
    } else {
      ops.push({ insertOne: { document: doc } });
    }
  }

  const removeIds = existing
    .filter((row) => !keepIds.has(String(row._id)))
    .map((row) => row._id);
  if (removeIds.length) {
    ops.push({ deleteMany: { filter: { _id: { $in: removeIds } } } });
  }

  if (ops.length) {
    await PlaylistItem.bulkWrite(ops, { ordered: false });
  }
}

module.exports = { loadUserPlaylist, saveUserPlaylist };
