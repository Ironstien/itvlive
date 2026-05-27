const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema(
  {
    playSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlaySession',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },
    votedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

voteSchema.index({ playSessionId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.Vote || mongoose.model('Vote', voteSchema);
