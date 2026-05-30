/**
 * Earned member levels (1–5). Edit thresholds here without touching game logic elsewhere.
 * Suggestion A — casual progression (OR rules for L2 and L5).
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
    anyOf: [
      { votesGivenCount: 3 },
      { chatMessageCount: 10 },
      { accountAgeDays: 3 },
    ],
  },
  3: {
    allOf: [
      { accountAgeDays: 14 },
      { votesGivenCount: 25 },
      { chatMessageCount: 15 },
    ],
  },
  4: {
    allOf: [
      { accountAgeDays: 60 },
      { totalListens: 75 },
      { totalPlays: 5 },
    ],
  },
  5: {
    anyOf: [
      { accountAgeDays: 180 },
      { totalListens: 500 },
      { totalPlays: 50 },
    ],
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

function statValue(user, key) {
  if (key === 'accountAgeDays') return accountAgeDays(user);
  return user?.[key] || 0;
}

function meetsRequirement(user, req) {
  const [[key, min]] = Object.entries(req);
  return statValue(user, key) >= min;
}

function meetsAnyOf(user, requirements) {
  return requirements.some((req) => meetsRequirement(user, req));
}

function meetsAllOf(user, requirements) {
  return requirements.every((req) => meetsRequirement(user, req));
}

function qualifiesForLevel(user, level) {
  const t = LEVEL_THRESHOLDS[level];
  if (!t) return false;
  if (t.anyOf) return meetsAnyOf(user, t.anyOf);
  if (t.allOf) return meetsAllOf(user, t.allOf);
  return false;
}

/**
 * Return the highest level the user qualifies for, or null if unchanged.
 * @param {object} user — Mongo User document or plain stats object
 * @returns {number|null}
 */
function computeEligibleLevel(user) {
  if (!user) return null;

  const current = clampLevel(user.level || 1);
  let eligible = 1;

  for (let level = 2; level <= 5; level += 1) {
    if (qualifiesForLevel(user, level)) {
      eligible = level;
    }
  }

  return eligible > current ? eligible : null;
}

module.exports = {
  LEVEL_NAMES,
  LEVEL_THRESHOLDS,
  getLevelName,
  computeEligibleLevel,
  accountAgeDays,
  qualifiesForLevel,
};
