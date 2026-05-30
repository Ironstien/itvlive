const { User } = require('../models');
const { isDbConnected } = require('../config/db');

const PROTECTED_ADMIN_EMAIL = (
  process.env.BOOTSTRAP_ADMIN_EMAIL || 'ptvanw@gmail.com'
)
  .trim()
  .toLowerCase();

function getProtectedAdminEmail() {
  return PROTECTED_ADMIN_EMAIL;
}

function isProtectedAdminUser(user) {
  if (!user?.email) return false;
  return String(user.email).trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;
}

/**
 * Promote bootstrap admin on every server start when MongoDB is connected.
 */
async function bootstrapAdminUser() {
  if (!isDbConnected() || !PROTECTED_ADMIN_EMAIL) return null;

  const user = await User.findOne({ email: PROTECTED_ADMIN_EMAIL });
  if (!user) {
    console.warn(
      `[bootstrap] No user found for ${PROTECTED_ADMIN_EMAIL} — register that account first`
    );
    return null;
  }

  let changed = false;
  if (user.staffRole !== 'admin') {
    user.staffRole = 'admin';
    changed = true;
  }
  if (!user.emailVerified) {
    user.emailVerified = true;
    changed = true;
  }
  if (changed) {
    await user.save();
    console.log(`[bootstrap] Promoted ${user.username} (${PROTECTED_ADMIN_EMAIL}) to admin`);
  }

  return user;
}

module.exports = {
  bootstrapAdminUser,
  getProtectedAdminEmail,
  isProtectedAdminUser,
};
