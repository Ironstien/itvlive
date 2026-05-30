const { User } = require('../models');
const { isDbConnected } = require('../config/db');
const { toPublicProfile } = require('../services/auth');
const { STAFF_ROLES } = require('../config/permissions');
const { isProtectedAdminUser } = require('../services/bootstrapAdmin');
const { logModAction, grantEliteLevel } = require('../services/stats');
const { requireAdmin } = require('../middleware/requireAdmin');
const { pushUserProfileUpdate } = require('../sockets');

const router = require('express').Router();

function dbRequired(_req, res, next) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }
  next();
}

function toAdminUserRow(user) {
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    level: user.level,
    staffRole: user.staffRole ?? null,
    tokenBalance: user.tokenBalance ?? 0,
    votesGivenCount: user.votesGivenCount ?? 0,
    chatMessageCount: user.chatMessageCount ?? 0,
    totalListens: user.totalListens ?? 0,
    totalPlays: user.totalPlays ?? 0,
    createdAt: user.createdAt,
    protected: isProtectedAdminUser(user),
  };
}

router.use(dbRequired, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const filter = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ username: re }, { email: re }];
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({
      ok: true,
      users: users.map((u) => toAdminUserRow(u)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list users' });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updates = {};
    const auditDetails = {};

    if (req.body?.staffRole !== undefined) {
      const role = req.body.staffRole;
      if (role !== null && role !== '' && !STAFF_ROLES.includes(role)) {
        res.status(400).json({ error: 'Invalid staff role' });
        return;
      }
      if (isProtectedAdminUser(target) && role !== 'admin') {
        res.status(403).json({ error: 'This account cannot be demoted from admin' });
        return;
      }
      updates.staffRole = role || null;
      auditDetails.staffRole = updates.staffRole;
    }

    if (req.body?.tokenBalance !== undefined) {
      const bal = Math.max(0, Math.floor(Number(req.body.tokenBalance)));
      if (!Number.isFinite(bal)) {
        res.status(400).json({ error: 'Invalid token balance' });
        return;
      }
      updates.tokenBalance = bal;
      auditDetails.tokenBalance = bal;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    Object.assign(target, updates);
    await target.save();

    await logModAction(String(req.user._id), String(target._id), 'admin:updateUser', auditDetails);

    pushUserProfileUpdate(String(target._id), toPublicProfile(target));

    res.json({
      ok: true,
      user: toAdminUserRow(target),
      profile: toPublicProfile(target),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Update failed' });
  }
});

router.post('/users/:id/grant-elite', async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const result = await grantEliteLevel(String(target._id));
    if (!result) {
      res.status(400).json({ error: 'User is already Elite or not found' });
      return;
    }

    await logModAction(String(req.user._id), String(target._id), 'admin:grantElite', {
      level: 5,
    });

    const refreshed = await User.findById(target._id);
    pushUserProfileUpdate(String(target._id), toPublicProfile(refreshed));

    res.json({
      ok: true,
      levelUp: result,
      user: toAdminUserRow(refreshed),
      profile: toPublicProfile(refreshed),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Grant Elite failed' });
  }
});

router.get('/audit', async (req, res) => {
  try {
    const ModAction = require('../models/ModAction');
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const rows = await ModAction.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actorUserId', 'username')
      .populate('targetUserId', 'username')
      .lean();

    res.json({
      ok: true,
      actions: rows.map((row) => ({
        id: String(row._id),
        action: row.action,
        details: row.details,
        createdAt: row.createdAt,
        actor: row.actorUserId?.username || null,
        target: row.targetUserId?.username || null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load audit log' });
  }
});

module.exports = { adminRouter: router };
