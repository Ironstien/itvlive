const crypto = require('crypto');

const bootId = crypto.randomUUID();
const bootedAt = Date.now();

function getBootMeta() {
  return { bootId, bootedAt };
}

module.exports = { getBootMeta };
