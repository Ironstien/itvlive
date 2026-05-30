require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB, isDbConnected } = require('./config/db');
const { registerRoutes } = require('./routes');
const { registerSockets, initRoomFromStore, flushPersistedRoom, getBootMeta } = require('./sockets');
const { parseYoutubeId, fetchStoryboard, youtubeThumbnailUrl } = require('./services/youtube');

require('./models');

const YTIMG_HOST_RE = /^https:\/\/i\.ytimg\.com\//;

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
  res.json({
    ok: true,
    name: 'INTO THE VOID',
    phase: isDbConnected() ? 2 : 1,
    db: isDbConnected(),
    ...getBootMeta(),
  });
});

app.get('/api/youtube/:videoId/storyboard', async (req, res) => {
  const videoId = parseYoutubeId(req.params.videoId);
  if (!videoId) {
    res.status(400).json({ ok: false, error: 'Invalid video ID' });
    return;
  }

  try {
    const spec = await fetchStoryboard(videoId);
    res.json({
      ok: !!spec,
      spec,
      fallback: youtubeThumbnailUrl(videoId),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Failed to load storyboard',
      fallback: youtubeThumbnailUrl(videoId),
    });
  }
});

app.get('/api/youtube/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string' || !YTIMG_HOST_RE.test(url)) {
    res.status(400).send('Invalid image URL');
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!upstream.ok) {
      res.status(upstream.status).send('Image fetch failed');
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  } catch (err) {
    res.status(500).send(err.message || 'Image proxy failed');
  }
});

registerRoutes(app);

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

  try {
    await initRoomFromStore();
  } catch (err) {
    console.error('[room] Restore failed:', err.message);
  }

  httpServer.listen(PORT, () => {
    console.log('');
    console.log(`  INTO THE VOID — Phase ${isDbConnected() ? 2 : 1}`);
    console.log(`  Main Stage: http://localhost:${PORT}/index.html`);
    console.log(`  Health:     http://localhost:${PORT}/health`);
    console.log(`  Database:   ${isDbConnected() ? 'connected' : 'skipped (guest mode)'}`);
    console.log(`  Boot ID:    ${getBootMeta().bootId}`);
    console.log('');
    console.log('  Tip: open two browser tabs to test chat and queue.');
    console.log('');
  });
}

async function shutdown(signal) {
  console.log(`\n[server] ${signal} — saving room state…`);
  try {
    await flushPersistedRoom();
  } catch (err) {
    console.error('[room] Shutdown save failed:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

start();
