const jwt = require('jsonwebtoken');

const JWT_EXPIRES_IN = '7d';

function getJwtSecret() {
  return process.env.JWT_SECRET || '';
}

function signToken(user) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign(
    {
      userId: String(user._id),
      username: user.username,
      level: user.level,
      staffRole: user.staffRole ?? null,
    },
    secret,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  const secret = getJwtSecret();
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.userId) return null;
    return payload;
  } catch {
    return null;
  }
}

function toPublicProfile(user) {
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    level: user.level,
    staffRole: user.staffRole ?? null,
    emailVerified: user.emailVerified === true,
    avatarUrl: user.avatarUrl || null,
    customSaying: user.customSaying || '',
    badges: user.badges || [],
    tokenBalance: user.tokenBalance ?? 0,
    createdAt: user.createdAt,
  };
}

function extractBearer(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

module.exports = {
  signToken,
  verifyToken,
  toPublicProfile,
  extractBearer,
  JWT_EXPIRES_IN,
};
