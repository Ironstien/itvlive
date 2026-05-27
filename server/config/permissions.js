/**
 * ITV permission checks — single source of truth for level + staffRole rules.
 *
 * User shape (Mongo User or live room session):
 *   { level: 1-5, staffRole: null|'resident'|'host'|'mod'|'admin', emailVerified?: boolean }
 *
 * Legacy Phase 1 room users may still have `role: 'user'|'admin'` — normalizePrincipal handles that.
 */

const STAFF_ROLES = Object.freeze(['resident', 'host', 'mod', 'admin']);

const ACTIONS = Object.freeze({
  CHAT: 'chat',
  JOIN_QUEUE: 'joinQueue',
  LEAVE_QUEUE: 'leaveQueue',
  RIP_SONG: 'ripSong',
  PLAYLIST_ADD: 'playlistAdd',
  PLAYLIST_EDIT: 'playlistEdit',
  VOTE: 'vote',
  SKIP_OWN_NOW_PLAYING: 'skipOwnNowPlaying',
  SKIP_ANY_NOW_PLAYING: 'skipAnyNowPlaying',
  SKIP_OWN_QUEUE_SLOT: 'skipOwnQueueSlot',
  PRIORITY_QUEUE_ADD: 'priorityQueueAdd',
  LIVE_MIC_TOGGLE: 'liveMicToggle',
  MOD_TIMEOUT: 'modTimeout',
  MOD_KICK: 'modKick',
  MOD_CLEAR_CHAT: 'modClearChat',
  ASSIGN_STAFF_ROLES: 'assignStaffRoles',
  ADMIN_PANEL: 'adminPanel',
  ADJUST_TOKENS: 'adjustTokens',
  SHOP_PURCHASE: 'shopPurchase',
});

/** Minimum member level (1–5) required when staff role alone is not enough. */
const MIN_LEVEL = Object.freeze({
  [ACTIONS.CHAT]: 1,
  [ACTIONS.JOIN_QUEUE]: 1,
  [ACTIONS.LEAVE_QUEUE]: 1,
  [ACTIONS.RIP_SONG]: 1,
  [ACTIONS.PLAYLIST_ADD]: 1,
  [ACTIONS.PLAYLIST_EDIT]: 1,
  [ACTIONS.VOTE]: 2,
  [ACTIONS.SKIP_OWN_NOW_PLAYING]: 1,
  [ACTIONS.SKIP_OWN_QUEUE_SLOT]: 1,
  [ACTIONS.SHOP_PURCHASE]: 1,
  [ACTIONS.PRIORITY_QUEUE_ADD]: 1,
  [ACTIONS.LIVE_MIC_TOGGLE]: 1,
  [ACTIONS.MOD_TIMEOUT]: 1,
  [ACTIONS.MOD_KICK]: 1,
  [ACTIONS.MOD_CLEAR_CHAT]: 1,
  [ACTIONS.SKIP_ANY_NOW_PLAYING]: 1,
  [ACTIONS.ASSIGN_STAFF_ROLES]: 1,
  [ACTIONS.ADMIN_PANEL]: 1,
  [ACTIONS.ADJUST_TOKENS]: 1,
});

/** Actions granted by staff role (admin inherits mod + host powers). */
const STAFF_GRANTS = Object.freeze({
  host: new Set([ACTIONS.PRIORITY_QUEUE_ADD, ACTIONS.LIVE_MIC_TOGGLE]),
  mod: new Set([
    ACTIONS.MOD_TIMEOUT,
    ACTIONS.MOD_KICK,
    ACTIONS.MOD_CLEAR_CHAT,
    ACTIONS.SKIP_ANY_NOW_PLAYING,
  ]),
  admin: new Set([
    ACTIONS.PRIORITY_QUEUE_ADD,
    ACTIONS.LIVE_MIC_TOGGLE,
    ACTIONS.MOD_TIMEOUT,
    ACTIONS.MOD_KICK,
    ACTIONS.MOD_CLEAR_CHAT,
    ACTIONS.SKIP_ANY_NOW_PLAYING,
    ACTIONS.ASSIGN_STAFF_ROLES,
    ACTIONS.ADMIN_PANEL,
    ACTIONS.ADJUST_TOKENS,
  ]),
  resident: new Set(),
});

const LEVEL_NAMES = Object.freeze({
  1: 'Newcomer',
  2: 'Member',
  3: 'Regular',
  4: 'Veteran',
  5: 'Elite',
});

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.floor(n)));
}

function normalizeStaffRole(staffRole, legacyRole) {
  if (staffRole && STAFF_ROLES.includes(staffRole)) return staffRole;
  if (legacyRole === 'admin') return 'admin';
  if (legacyRole === 'mod') return 'mod';
  if (legacyRole === 'host') return 'host';
  if (legacyRole === 'resident') return 'resident';
  return null;
}

/**
 * Normalize any user/session object into a consistent principal for checks.
 * @param {object|null|undefined} user
 * @returns {{ level: number, staffRole: string|null, emailVerified: boolean, isGuest: boolean, displayName?: string, userId?: string, socketId?: string }}
 */
function normalizePrincipal(user) {
  if (!user) {
    return { level: 1, staffRole: null, emailVerified: false, isGuest: true };
  }

  const level = clampLevel(user.level);
  const staffRole = normalizeStaffRole(user.staffRole, user.role);
  const emailVerified = staffRole === 'admin' || user.emailVerified === true;

  return {
    level,
    staffRole,
    emailVerified,
    isGuest: !user.userId && !user._id,
    displayName: user.displayName || user.username,
    userId: user.userId || (user._id && String(user._id)) || null,
    socketId: user.socketId || null,
  };
}

function staffCan(staffRole, action) {
  if (!staffRole) return false;
  if (staffRole === 'admin') return STAFF_GRANTS.admin.has(action);
  if (STAFF_GRANTS.mod.has(action)) {
    return staffRole === 'mod' || staffRole === 'admin';
  }
  if (STAFF_GRANTS.host.has(action)) {
    return staffRole === 'host' || staffRole === 'admin';
  }
  return false;
}

/**
 * @param {object|null|undefined} user
 * @param {string} action — one of ACTIONS
 * @param {object} [context]
 * @param {boolean} [context.isCurrentDj] — for skip-own-now-playing
 * @returns {boolean}
 */
function can(user, action, context = {}) {
  if (!Object.values(ACTIONS).includes(action)) return false;

  const principal = normalizePrincipal(user);

  if (action === ACTIONS.VOTE) {
    if (principal.level < MIN_LEVEL[ACTIONS.VOTE]) return false;
    if (!principal.emailVerified) return false;
    return true;
  }

  if (action === ACTIONS.SKIP_OWN_NOW_PLAYING) {
    if (principal.level < MIN_LEVEL[action]) return false;
    return context.isCurrentDj === true;
  }

  if (action === ACTIONS.SKIP_ANY_NOW_PLAYING) {
    return staffCan(principal.staffRole, action);
  }

  if (staffCan(principal.staffRole, action)) return true;

  const minLevel = MIN_LEVEL[action];
  if (minLevel == null) return false;
  return principal.level >= minLevel;
}

/**
 * Same as can() but returns { ok: true } or { error: string } for socket acks.
 */
function check(user, action, context = {}) {
  if (can(user, action, context)) return { ok: true };

  const principal = normalizePrincipal(user);

  if (action === ACTIONS.VOTE) {
    if (principal.level < MIN_LEVEL[ACTIONS.VOTE]) {
      return { error: 'Voting requires Member rank (Level 2) or higher' };
    }
    if (!principal.emailVerified) {
      return { error: 'Verify your email before voting' };
    }
  }

  if (action === ACTIONS.SKIP_OWN_NOW_PLAYING && !context.isCurrentDj) {
    return { error: 'Only the current DJ can skip this song' };
  }

  if (action === ACTIONS.SKIP_ANY_NOW_PLAYING) {
    return { error: 'Moderator permissions required to skip this song' };
  }

  const staffOnly = [
    ACTIONS.PRIORITY_QUEUE_ADD,
    ACTIONS.LIVE_MIC_TOGGLE,
    ACTIONS.MOD_TIMEOUT,
    ACTIONS.MOD_KICK,
    ACTIONS.MOD_CLEAR_CHAT,
    ACTIONS.ASSIGN_STAFF_ROLES,
    ACTIONS.ADMIN_PANEL,
    ACTIONS.ADJUST_TOKENS,
  ];

  if (staffOnly.includes(action)) {
    return { error: 'You do not have permission for that action' };
  }

  return { error: 'You do not have permission for that action' };
}

function levelName(level) {
  return LEVEL_NAMES[clampLevel(level)] || LEVEL_NAMES[1];
}

function isStaff(user) {
  return Boolean(normalizePrincipal(user).staffRole);
}

function isAdmin(user) {
  return normalizePrincipal(user).staffRole === 'admin';
}

module.exports = {
  ACTIONS,
  STAFF_ROLES,
  MIN_LEVEL,
  STAFF_GRANTS,
  LEVEL_NAMES,
  normalizePrincipal,
  can,
  check,
  levelName,
  isStaff,
  isAdmin,
};
