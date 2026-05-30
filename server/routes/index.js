const { authRouter } = require('./auth');
const { playlistRouter } = require('./playlist');

/**
 * REST route registration.
 * @param {import('express').Express} app
 */
function registerRoutes(app) {
  app.use('/api/auth', authRouter);
  app.use('/api/playlist', playlistRouter);
}

module.exports = { registerRoutes };
