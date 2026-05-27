const mongoose = require('mongoose');

const playlistItemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    videoId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 11,
    },
    title: {
      type: String,
      default: 'Untitled',
    },
    thumbnail: {
      type: String,
      default: null,
    },
    channel: {
      type: String,
      default: null,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 0,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

playlistItemSchema.index({ userId: 1, sortOrder: 1 });
playlistItemSchema.index({ userId: 1, videoId: 1 }, { unique: true });

module.exports =
  mongoose.models.PlaylistItem || mongoose.model('PlaylistItem', playlistItemSchema);
