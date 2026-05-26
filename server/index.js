require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const { registerSockets } = require('./sockets');

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`;

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'INTO THE VOID', phase: 1 });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const httpServer = http.createServer(app);
registerSockets(httpServer);

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error('[db] Connection failed:', err.message);
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log('');
    console.log('  INTO THE VOID — Phase 1');
    console.log(`  Main Stage: http://localhost:${PORT}/index.html`);
    console.log(`  Health:     http://localhost:${PORT}/health`);
    console.log('');
    console.log('  Tip: open two browser tabs to test chat and queue.');
    console.log('');
  });
}

start();
