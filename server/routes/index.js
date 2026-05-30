const { authRouter } = require('./auth');
const { playlistRouter } = require('./playlist');
const { adminRouter } = require('./admin');

/**
 * REST route registration.
 * @param {import('express').Express} app
 */
function registerRoutes(app) {
  app.use('/api/auth', authRouter);
  app.use('/api/playlist', playlistRouter);
  app.use('/api/admin', adminRouter);
}

module.exports = { registerRoutes };
