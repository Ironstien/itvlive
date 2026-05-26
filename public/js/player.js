/* global YT */

const ITVPlayer = (() => {
  let ytPlayer = null;
  let ready = false;
  let currentVideoId = null;
  let lastSyncSignature = null;
  let onEndedCallback = null;
  const queue = [];

  function syncSignature(payload) {
    if (!payload?.videoId) return 'idle';
    return `${payload.videoId}:${payload.startedAt || 0}`;
  }

  function onYouTubeIframeAPIReady() {
    ready = true;
    queue.forEach((fn) => fn());
    queue.length = 0;
  }

  window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

  function whenReady(fn) {
    if (ready && typeof YT !== 'undefined') fn();
    else queue.push(fn);
  }

  function ensurePlayer() {
    if (ytPlayer) return;
    ytPlayer = new YT.Player('yt-player', {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onStateChange(event) {
          if (event.data === YT.PlayerState.ENDED && onEndedCallback) {
            onEndedCallback();
          }
        },
      },
    });
  }

  function isAlreadyPlaying() {
    if (!ytPlayer?.getPlayerState) return false;
    const state = ytPlayer.getPlayerState();
    return state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING;
  }

  function sync(payload) {
    const signature = syncSignature(payload);
    if (signature === lastSyncSignature) return;
    lastSyncSignature = signature;

    const idleEl = document.getElementById('player-idle');
    if (!payload?.videoId) {
      currentVideoId = null;
      if (idleEl) idleEl.classList.remove('hidden');
      whenReady(() => {
        ensurePlayer();
        if (ytPlayer?.pauseVideo) ytPlayer.pauseVideo();
      });
      return;
    }

    if (idleEl) idleEl.classList.add('hidden');

    const seekSec = payload.startedAt
      ? Math.max(0, Math.floor((Date.now() - payload.startedAt) / 1000))
      : 0;

    whenReady(() => {
      ensurePlayer();

      const apply = () => {
        if (!ytPlayer?.loadVideoById) {
          setTimeout(apply, 300);
          return;
        }

        if (currentVideoId !== payload.videoId) {
          currentVideoId = payload.videoId;
          ytPlayer.loadVideoById(payload.videoId, seekSec);
          return;
        }

        // Same track already loaded — only fix large drift; do not restart playback
        if (typeof ytPlayer.getCurrentTime === 'function') {
          const drift = Math.abs(ytPlayer.getCurrentTime() - seekSec);
          if (drift > 12) ytPlayer.seekTo(seekSec, true);
        }
        if (!isAlreadyPlaying()) ytPlayer.playVideo();
      };

      apply();
    });
  }

  function setOnEnded(fn) {
    onEndedCallback = fn;
  }

  function getCurrentTime() {
    if (!ytPlayer?.getCurrentTime) return 0;
    return ytPlayer.getCurrentTime() || 0;
  }

  return { sync, setOnEnded, whenReady, getCurrentTime };
})();
