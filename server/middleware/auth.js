const { User } = require('../models');
const { isDbConnected } = require('../config/db');
const { verifyToken, extractBearer } = require('../services/auth');

async function requireAuth(req, res, next) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }

  const token = extractBearer(req);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  req.user = user;
  req.auth = payload;
  next();
}

module.exports = { requireAuth };
