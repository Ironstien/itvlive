const mongoose = require('mongoose');

const songSchema = new mongoose.Schema(
  {
    youtubeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 11,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 0,
    },
    thumbnail: {
      type: String,
      default: null,
    },
    channel: {
      type: String,
      default: null,
    },
    lifetimePlays: {
      type: Number,
      default: 0,
      min: 0,
    },
    lifetimeListeners: {
      type: Number,
      default: 0,
      min: 0,
    },
    allTimeHigh: {
      type: Number,
      default: null,
    },
    allTimeLow: {
      type: Number,
      default: null,
    },
    allTimeAverage: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Song || mongoose.model('Song', songSchema);
