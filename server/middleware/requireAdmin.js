const { User } = require('../models');
const { isDbConnected } = require('../config/db');
const { verifyToken, extractBearer } = require('../services/auth');
const { isAdmin } = require('../config/permissions');

async function requireAdmin(req, res, next) {
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

  if (!isAdmin(user)) {
    res.status(403).json({ error: 'Admin permissions required' });
    return;
  }

  req.user = user;
  req.auth = payload;
  next();
}

module.exports = { requireAdmin };
