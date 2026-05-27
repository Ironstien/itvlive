/**
 * Earned member levels (1–5). Edit thresholds here without touching game logic elsewhere.
 */

const LEVEL_NAMES = Object.freeze({
  1: 'Newcomer',
  2: 'Member',
  3: 'Regular',
  4: 'Veteran',
  5: 'Elite',
});

/** Requirements to reach each level (Level 1 is default on signup). */
const LEVEL_THRESHOLDS = Object.freeze({
  2: {
    emailVerified: true,
    votesGivenCount: 5,
  },
  3: {
    accountAgeDays: 30,
    votesGivenCount: 50,
    chatMessageCount: 20,
  },
  4: {
    accountAgeDays: 90,
    totalListens: 200,
    totalPlays: 10,
  },
  5: {
    manual: true,
  },
});

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.floor(n)));
}

function getLevelName(level) {
  return LEVEL_NAMES[clampLevel(level)] || LEVEL_NAMES[1];
}

function accountAgeDays(user) {
  const created = user?.createdAt ? new Date(user.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return 0;
  return Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Return the highest level the user qualifies for, or null if unchanged.
 * @param {object} user — Mongo User document or plain stats object
 * @returns {number|null}
 */
function computeEligibleLevel(user) {
  if (!user) return 1;

  let eligible = 1;

  const t2 = LEVEL_THRESHOLDS[2];
  if (user.emailVerified === true && (user.votesGivenCount || 0) >= t2.votesGivenCount) {
    eligible = 2;
  } else {
    return clampLevel(user.level || 1) === eligible ? null : Math.max(clampLevel(user.level || 1), eligible);
  }

  const t3 = LEVEL_THRESHOLDS[3];
  if (
    accountAgeDays(user) >= t3.accountAgeDays &&
    (user.votesGivenCount || 0) >= t3.votesGivenCount &&
    (user.chatMessageCount || 0) >= t3.chatMessageCount
  ) {
    eligible = 3;
  } else {
    return clampLevel(user.level || 1) >= eligible ? null : eligible;
  }

  const t4 = LEVEL_THRESHOLDS[4];
  if (
    accountAgeDays(user) >= t4.accountAgeDays &&
    (user.totalListens || 0) >= t4.totalListens &&
    (user.totalPlays || 0) >= t4.totalPlays
  ) {
    eligible = 4;
  }

  const current = clampLevel(user.level || 1);
  return eligible > current ? eligible : null;
}

module.exports = {
  LEVEL_NAMES,
  LEVEL_THRESHOLDS,
  getLevelName,
  computeEligibleLevel,
  accountAgeDays,
};
