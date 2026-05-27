const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { isDbConnected } = require('../config/db');
const { signToken, toPublicProfile } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const MAX_AVATAR_URL = 512;
const MAX_SAYING = 120;

function dbRequired(_req, res, next) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'Database unavailable — set MONGODB_URI and restart' });
    return;
  }
  next();
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

router.post('/register', dbRequired, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({
        error: 'Username must be 2–24 characters (letters, numbers, _ or -)',
      });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      email,
      username,
      passwordHash,
      level: 1,
      emailVerified: false,
    });

    const token = signToken(user);
    res.status(201).json({
      ok: true,
      token,
      user: toPublicProfile(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({ error: `${field} is already in use` });
      return;
    }
    if (err.message?.includes('JWT_SECRET')) {
      res.status(500).json({ error: 'Server auth is not configured (JWT_SECRET)' });
      return;
    }
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

router.post('/login', dbRequired, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(user);
    res.json({
      ok: true,
      token,
      user: toPublicProfile(user),
    });
  } catch (err) {
    if (err.message?.includes('JWT_SECRET')) {
      res.status(500).json({ error: 'Server auth is not configured (JWT_SECRET)' });
      return;
    }
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: toPublicProfile(req.user) });
});

router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const updates = {};
    if (req.body?.avatarUrl !== undefined) {
      const url = String(req.body.avatarUrl || '').trim();
      if (url.length > MAX_AVATAR_URL) {
        res.status(400).json({ error: 'Avatar URL is too long' });
        return;
      }
      if (url && !/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: 'Avatar URL must start with http:// or https://' });
        return;
      }
      updates.avatarUrl = url || null;
    }
    if (req.body?.customSaying !== undefined) {
      updates.customSaying = String(req.body.customSaying || '').trim().slice(0, MAX_SAYING);
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    Object.assign(req.user, updates);
    await req.user.save();

    res.json({ ok: true, user: toPublicProfile(req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Profile update failed' });
  }
});

module.exports = { authRouter: router };
