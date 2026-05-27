const mongoose = require('mongoose');

const playSessionSchema = new mongoose.Schema(
  {
    songId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Song',
      default: null,
    },
    youtubeId: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      default: null,
    },
    playedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    playedBySocketId: {
      type: String,
      default: null,
    },
    djName: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 0,
    },
    averageScore: {
      type: Number,
      default: null,
    },
    scoreHigh: {
      type: Number,
      default: null,
    },
    scoreLow: {
      type: Number,
      default: null,
    },
    voteCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    listenerCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

playSessionSchema.index({ startedAt: -1 });
playSessionSchema.index({ playedByUserId: 1, startedAt: -1 });

module.exports =
  mongoose.models.PlaySession || mongoose.model('PlaySession', playSessionSchema);
