const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 24,
    },
    level: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
    },
    staffRole: {
      type: String,
      enum: ['resident', 'host', 'mod', 'admin'],
      default: null,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    customSaying: {
      type: String,
      default: '',
      maxlength: 120,
    },
    badges: {
      type: [String],
      default: [],
    },
    tokenBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    vinylBorder: {
      type: String,
      default: null,
    },
    usernameColor: {
      type: String,
      default: null,
    },
    totalPlays: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalListens: {
      type: Number,
      default: 0,
      min: 0,
    },
    votesGivenCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    chatMessageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    avgScoreReceivedAsDj: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
