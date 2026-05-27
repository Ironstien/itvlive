const mongoose = require('mongoose');

let dbConnected = false;

function isDbConnected() {
  return dbConnected && mongoose.connection.readyState === 1;
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[db] MONGODB_URI not set — skipping database (guest mode OK)');
    dbConnected = false;
    return false;
  }

  await mongoose.connect(uri);
  dbConnected = true;
  console.log('[db] Connected to MongoDB');
  return true;
}

module.exports = { connectDB, isDbConnected };