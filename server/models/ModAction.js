const mongoose = require('mongoose');

const modActionSchema = new mongoose.Schema(
  {
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

modActionSchema.index({ createdAt: -1 });
modActionSchema.index({ actorUserId: 1, createdAt: -1 });

module.exports =
  mongoose.models.ModAction || mongoose.model('ModAction', modActionSchema);
