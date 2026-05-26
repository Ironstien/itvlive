const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[db] MONGODB_URI not set — skipping database (OK until Phase 2)');
    return false;
  }

  await mongoose.connect(uri);
  console.log('[db] Connected to MongoDB');
  return true;
}

module.exports = { connectDB };
