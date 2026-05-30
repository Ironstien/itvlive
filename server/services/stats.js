const { User, Vote, PlaySession, Song, ModAction } = require('../models');
const { isDbConnected } = require('../config/db');
const { computeEligibleLevel, getLevelName } = require('../config/levels');

/**
 * @param {string} actorUserId
 * @param {string|null} targetUserId
 * @param {string} action
 * @param {object} [details]
 */
async function logModAction(actorUserId, targetUserId, action, details = null) {
  if (!isDbConnected()) return;
  try {
    await ModAction.create({
      actorUserId: actorUserId || null,
      targetUserId: targetUserId || null,
      action,
      details,
    });
  } catch (err) {
    console.warn('[audit] log failed:', err.message);
  }
}

/**
 * @param {string} userId
 * @returns {Promise<{ userId: string, level: number, levelName: string }|null>}
 */
async function checkAndApplyLevelUp(userId) {
  if (!isDbConnected() || !userId) return null;

  const user = await User.findById(userId);
  if (!user) return null;

  const eligible = computeEligibleLevel(user);
  if (!eligible || eligible <= user.level) return null;

  user.level = eligible;
  await user.save();

  return {
    userId: String(user._id),
    level: user.level,
    levelName: getLevelName(user.level),
    username: user.username,
  };
}

/**
 * @param {string} userId
 */
async function incrementChatMessageCount(userId) {
  if (!isDbConnected() || !userId) return null;

  await User.findByIdAndUpdate(userId, { $inc: { chatMessageCount: 1 } });
  return checkAndApplyLevelUp(userId);
}

/**
 * Grant Elite (L5) — admin-only action, not part of auto thresholds.
 * @param {string} userId
 */
async function grantEliteLevel(userId) {
  if (!isDbConnected() || !userId) return null;

  const user = await User.findById(userId);
  if (!user) return null;
  if (user.level >= 5) return null;

  user.level = 5;
  await user.save();

  return {
    userId: String(user._id),
    level: 5,
    levelName: getLevelName(5),
    username: user.username,
  };
}

/**
 * @param {object} nowPlaying snapshot
 * @param {string[]} connectedUserIds — logged-in users connected at track end
 * @param {Map<string, number>} pendingVotes — userId → score
 */
async function finalizePlaySession(nowPlaying, connectedUserIds = [], pendingVotes = new Map()) {
  if (!isDbConnected() || !nowPlaying) return { voteResults: null, levelUps: [] };

  const playSessionId = nowPlaying.playSessionId;
  const djUserId = nowPlaying.userId ? String(nowPlaying.userId) : null;
  const endedAt = new Date();
  const levelUps = [];

  const voteEntries = [...pendingVotes.entries()].filter(
    ([userId, score]) => userId && score >= 1 && score <= 100
  );

  if (playSessionId) {
    try {
      const session = await PlaySession.findById(playSessionId);
      if (session && !session.endedAt) {
        session.endedAt = endedAt;
        session.listenerCount = connectedUserIds.length;

        const scores = voteEntries.map(([, score]) => score);
        if (scores.length) {
          session.voteCount = scores.length;
          session.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          session.scoreHigh = Math.max(...scores);
          session.scoreLow = Math.min(...scores);
        }

        await session.save();

        for (const [voterId, score] of voteEntries) {
          try {
            const existing = await Vote.findOne({ playSessionId, userId: voterId });
            if (existing) {
              existing.score = score;
              existing.votedAt = endedAt;
              await existing.save();
            } else {
              await Vote.create({
                playSessionId,
                userId: voterId,
                score,
                votedAt: endedAt,
              });
              await User.findByIdAndUpdate(voterId, { $inc: { votesGivenCount: 1 } });
              const up = await checkAndApplyLevelUp(voterId);
              if (up) levelUps.push(up);
            }
          } catch (err) {
            console.warn('[vote] persist failed:', err.message);
          }
        }

        if (nowPlaying.videoId) {
          const songUpdate = {
            $inc: { lifetimePlays: 1, lifetimeListeners: connectedUserIds.length },
          };
          if (scores.length) {
            songUpdate.$set = {
              allTimeHigh: session.scoreHigh,
              allTimeLow: session.scoreLow,
              allTimeAverage: session.averageScore,
            };
          }
          await Song.findOneAndUpdate({ youtubeId: nowPlaying.videoId }, songUpdate, {
            upsert: false,
          });
        }
      }
    } catch (err) {
      console.warn('[playSession] finalize failed:', err.message);
    }
  }

  if (djUserId) {
    await User.findByIdAndUpdate(djUserId, { $inc: { totalPlays: 1 } });
    const up = await checkAndApplyLevelUp(djUserId);
    if (up) levelUps.push(up);
  }

  for (const listenerId of connectedUserIds) {
    if (!listenerId || listenerId === djUserId) continue;
    await User.findByIdAndUpdate(listenerId, { $inc: { totalListens: 1 } });
    const up = await checkAndApplyLevelUp(listenerId);
    if (up) levelUps.push(up);
  }

  const voteResults =
    voteEntries.length && playSessionId
      ? {
          playSessionId,
          voteCount: voteEntries.length,
          averageScore:
            voteEntries.reduce((sum, [, s]) => sum + s, 0) / voteEntries.length,
          scoreHigh: Math.max(...voteEntries.map(([, s]) => s)),
          scoreLow: Math.min(...voteEntries.map(([, s]) => s)),
        }
      : null;

  return { voteResults, levelUps };
}

module.exports = {
  logModAction,
  checkAndApplyLevelUp,
  incrementChatMessageCount,
  grantEliteLevel,
  finalizePlaySession,
};
