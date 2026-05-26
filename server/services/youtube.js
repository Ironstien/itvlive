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

async function fetchYoutubeMeta(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  const res = await fetch(oembedUrl);

  if (!res.ok) {
    throw new Error('Could not load video info. Check the URL and try again.');
  }

  const data = await res.json();
  return {
    videoId,
    title: data.title || 'Untitled',
    thumbnail: data.thumbnail_url || null,
  };
}

module.exports = { parseYoutubeId, fetchYoutubeMeta };
