const express = require('express');
const { isDbConnected } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { loadUserPlaylist } = require('../services/playlistStore');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }

  try {
    const playlist = await loadUserPlaylist(req.user._id);
    res.json({ ok: true, playlist });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load playlist' });
  }
});

module.exports = { playlistRouter: router };
