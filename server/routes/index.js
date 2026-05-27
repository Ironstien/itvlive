const { authRouter } = require('./auth');

/**
 * REST route registration.
 * @param {import('express').Express} app
 */
function registerRoutes(app) {
  app.use('/api/auth', authRouter);
}

module.exports = { registerRoutes };
