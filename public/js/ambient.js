const ITVAmbient = (() => {
  const FRAME_COUNT = 4;
  const FRAME_INTERVAL_SEC = 12;

  let pollTimer = null;
  let activeVideoId = null;
  let getTime = () => 0;

  const ambientEl = () => document.getElementById('player-ambient');
  const imgEl = () => document.getElementById('player-ambient-img');

  function frameUrl(videoId, timeSec) {
    const index = Math.floor(Math.max(0, timeSec) / FRAME_INTERVAL_SEC) % FRAME_COUNT;
    return `https://i.ytimg.com/vi/${videoId}/${index}.jpg`;
  }

  function fallbackUrl(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  }

  function updateFrame() {
    const img = imgEl();
    if (!img || !activeVideoId) return;

    const src = frameUrl(activeVideoId, getTime());
    if (img.dataset.current === src) return;

    img.dataset.current = src;
    img.onerror = () => {
      img.onerror = null;
      const fb = fallbackUrl(activeVideoId);
      img.dataset.current = fb;
      img.src = fb;
    };
    img.src = src;
  }

  function startPolling() {
    stopPolling();
    updateFrame();
    pollTimer = setInterval(updateFrame, 1000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function sync(payload, timeFn) {
    getTime = timeFn || (() => 0);

    if (!payload?.videoId) {
      stop();
      return;
    }

    if (payload.videoId !== activeVideoId) {
      activeVideoId = payload.videoId;
      const img = imgEl();
      if (img) {
        delete img.dataset.current;
        img.src = fallbackUrl(activeVideoId);
      }
    }

    ambientEl()?.classList.add('is-active');
    startPolling();
  }

  function stop() {
    activeVideoId = null;
    stopPolling();
    ambientEl()?.classList.remove('is-active');
    const img = imgEl();
    if (img) {
      delete img.dataset.current;
      img.removeAttribute('src');
    }
  }

  return { sync, stop };
})();
