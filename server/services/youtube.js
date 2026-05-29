const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseYoutubeId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  try {
    const url = trimmed.startsWith('http') ? new URL(trimmed) : new URL(`https://${trimmed}`);

    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1).split('/')[0];
      return YOUTUBE_ID_RE.test(id) ? id : null;
    }

    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && YOUTUBE_ID_RE.test(v)) return v;

      const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embed) return embed[1];

      const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shorts) return shorts[1];
    }
  } catch {
    return null;
  }

  return null;
}

/** Pull a URL from a playlist line (`Title https://…`) or return the whole line. */
function extractPlaylistLineUrl(line) {
  if (!line || typeof line !== 'string') return '';
  const trimmed = line.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  return urlMatch ? urlMatch[0] : trimmed;
}

function youtubeThumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function parseDurationSeconds(html) {
  const match =
    html.match(/"lengthSeconds":"(\d+)"/) ||
    html.match(/"lengthSeconds":(\d+)/) ||
    html.match(/"approxDurationMs":"(\d+)"/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (Number.isNaN(value)) return null;
  return match[0].includes('approxDurationMs') ? Math.round(value / 1000) : value;
}

const WATCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function decodeStoryboardSpec(raw) {
  return raw
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\\//g, '/');
}

function parseStoryboardLevel(levelSpec) {
  const fields = levelSpec.split('#');
  if (fields.length < 6) return null;

  const thumbWidth = parseInt(fields[0], 10);
  const thumbHeight = parseInt(fields[1], 10);
  const count = parseInt(fields[2], 10);
  const rows = parseInt(fields[3], 10);
  const cols = parseInt(fields[4], 10);
  const intervalMs = parseInt(fields[5], 10);

  if (!Number.isFinite(thumbWidth) || thumbWidth <= 0) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(rows) || rows <= 0) return null;
  if (!Number.isFinite(cols) || cols <= 0) return null;

  return {
    thumbWidth,
    thumbHeight,
    count,
    rows,
    cols,
    intervalMs: intervalMs > 0 ? intervalMs : 2000,
    perSheet: rows * cols,
  };
}

function parseStoryboardSpec(html) {
  const specMatch =
    html.match(/"spec":"(https:\\\/\\\/i\.ytimg\.com\\\/sb\\\/(?:\\.|[^"\\])*)"/) ||
    html.match(/"spec":"(https:\/\/i\.ytimg\.com\/sb\/[^"]+)"/);
  if (!specMatch) return null;

  const rawSpec = decodeStoryboardSpec(specMatch[1]);
  const parts = rawSpec.split('|');
  if (parts.length < 2) return null;

  const template = parts[0];
  const specIdx = html.indexOf(specMatch[0]);
  const nearby = specIdx >= 0 ? html.slice(specIdx, specIdx + 900) : html;
  const levelMatch = nearby.match(/"recommendedLevel"\s*:\s*(\d+)/);
  let level = levelMatch ? parseInt(levelMatch[1], 10) : 1;
  if (!Number.isFinite(level) || level < 0) level = 1;

  let levelSpec = parts[level + 1];
  if (!levelSpec) {
    levelSpec = parts[parts.length - 1];
    level = parts.length - 2;
  }

  const parsedLevel = parseStoryboardLevel(levelSpec);
  if (!parsedLevel) return null;

  return {
    template,
    level,
    ...parsedLevel,
  };
}

function getStoryboardFrame(spec, timeSec) {
  const frameIndex = Math.min(
    Math.max(0, spec.count - 1),
    Math.floor((Math.max(0, timeSec) * 1000) / spec.intervalMs)
  );
  const sheetIndex = Math.floor(frameIndex / spec.perSheet);
  const posInSheet = frameIndex % spec.perSheet;
  const col = posInSheet % spec.cols;
  const row = Math.floor(posInSheet / spec.cols);
  const url = spec.template
    .replace(/\$L/g, String(spec.level ?? 0))
    .replace(/\$N/g, String(sheetIndex));

  return { url, col, row, frameIndex, sheetIndex };
}
async function fetchWatchPageHtml(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(watchUrl, { headers: WATCH_HEADERS });
  if (!res.ok) return null;
  return res.text();
}

async function fetchStoryboard(videoId) {
  const html = await fetchWatchPageHtml(videoId);
  if (!html) return null;
  return parseStoryboardSpec(html);
}

async function fetchYoutubeMeta(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  const [oembedRes, pageRes] = await Promise.all([
    fetch(oembedUrl),
    fetch(watchUrl, { headers: WATCH_HEADERS }),
  ]);

  if (!oembedRes.ok) {
    throw new Error('Could not load video info. Check the URL and try again.');
  }

  const data = await oembedRes.json();
  let duration = null;
  if (pageRes.ok) {
    const html = await pageRes.text();
    duration = parseDurationSeconds(html);
  }

  return {
    videoId,
    title: data.title || 'Untitled',
    thumbnail: data.thumbnail_url || youtubeThumbnailUrl(videoId),
    channel: data.author_name || null,
    duration,
  };
}

module.exports = {
  parseYoutubeId,
  extractPlaylistLineUrl,
  fetchYoutubeMeta,
  youtubeThumbnailUrl,
  fetchStoryboard,
  getStoryboardFrame,
};
