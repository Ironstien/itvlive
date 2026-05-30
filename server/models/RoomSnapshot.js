const mongoose = require('mongoose');

const roomSnapshotSchema = new mongoose.Schema(
  {
    singleton: {
      type: String,
      default: 'live',
      unique: true,
      index: true,
    },
    nowPlaying: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    globalQueue: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    users: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    playlists: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    testUsersEnabled: {
      type: Boolean,
      default: false,
    },
    queueId: {
      type: Number,
      default: 0,
    },
    chatId: {
      type: Number,
      default: 0,
    },
    lastFinishedAt: {
      type: String,
      default: null,
    },
    chat: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.RoomSnapshot || mongoose.model('RoomSnapshot', roomSnapshotSchema);
