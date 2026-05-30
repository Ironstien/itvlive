/**
 * One-off: set staffRole for a user by email.
 * Usage: node scripts/set-staff-role.js <email> <role>
 * Example: node scripts/set-staff-role.js ptvanw@gmail.com admin
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../server/models');

const email = (process.argv[2] || '').trim().toLowerCase();
const role = (process.argv[3] || '').trim();

const VALID = ['resident', 'host', 'mod', 'admin'];

async function main() {
  if (!email || !VALID.includes(role)) {
    console.error('Usage: node scripts/set-staff-role.js <email> <role>');
    console.error('Roles:', VALID.join(', '));
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const user = await User.findOne({ email });
  if (!user) {
    console.error('No user found for email:', email);
    await mongoose.disconnect();
    process.exit(1);
  }

  user.staffRole = role;
  if (role === 'admin') user.emailVerified = true;
  await user.save();

  console.log('OK', {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    staffRole: user.staffRole,
  });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
