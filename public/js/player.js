/* global YT */

const ITVPlayer = (() => {
  let ytPlayer = null;
  let ready = false;
  let currentVideoId = null;
  let lastSyncSignature = null;
  let onEndedCallback = null;
  let volumeLevel = 80;
  let volumeMuted = false;
  const queue = [];

  const YT_STATE_NAMES = {
    [-1]: 'UNSTARTED',
    0: 'ENDED',
    1: 'PLAYING',
    2: 'PAUSED',
    3: 'BUFFERING',
    5: 'CUED',
  };

  function logPlayer(level, msg, data) {
    if (typeof ITVLog === 'undefined') return;
    ITVLog.log(level, 'player', msg, data);
  }

  function syncSignature(payload) {
    if (!payload?.videoId) return 'idle';
    return `${payload.videoId}:${payload.startedAt || 0}`;
  }

  function onYouTubeIframeAPIReady() {
    ready = true;
    logPlayer('info', 'YouTube IFrame API ready');
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
        onReady() {
          applyVolume();
        },
        onStateChange(event) {
          const stateName = YT_STATE_NAMES[event.data] || String(event.data);
          logPlayer('info', `YT player state: ${stateName}`, {
            videoId: currentVideoId,
            stateCode: event.data,
          });
          if (event.data === YT.PlayerState.PAUSED) {
            logPlayer('warn', 'Playback paused', { videoId: currentVideoId });
          }
          if (event.data === YT.PlayerState.ENDED && onEndedCallback) {
            logPlayer('info', 'YT ENDED — firing onEnded callback', { videoId: currentVideoId });
            onEndedCallback();
          }
        },
      },
    });
  }

  function applyVolume() {
    if (!ytPlayer?.setVolume) return;
    if (volumeMuted || volumeLevel === 0) {
      ytPlayer.mute?.();
      return;
    }
    ytPlayer.unMute?.();
    ytPlayer.setVolume(volumeLevel);
  }

  function setVolume(level, muted) {
    volumeLevel = Math.max(0, Math.min(100, Math.round(level)));
    volumeMuted = !!muted || volumeLevel === 0;
    whenReady(() => {
      ensurePlayer();
      applyVolume();
    });
    return { volume: volumeLevel, muted: volumeMuted };
  }

  function getVolume() {
    return { volume: volumeLevel, muted: volumeMuted };
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

    logPlayer('debug', 'ITVPlayer.sync apply', {
      signature,
      videoId: payload?.videoId || null,
      startedAt: payload?.startedAt || null,
    });

    const idleEl = document.getElementById('player-idle');
    if (!payload?.videoId) {
      logPlayer('info', 'ITVPlayer.sync idle — no video', { previousVideoId: currentVideoId });
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
          logPlayer('info', 'Loading new video', {
            from: currentVideoId,
            to: payload.videoId,
            seekSec,
          });
          currentVideoId = payload.videoId;
          ytPlayer.loadVideoById(payload.videoId, seekSec);
          return;
        }

        // Same track already loaded — only fix large drift; do not restart playback
        if (typeof ytPlayer.getCurrentTime === 'function') {
          const drift = Math.abs(ytPlayer.getCurrentTime() - seekSec);
          if (drift > 12) {
            logPlayer('warn', 'Seeking to fix drift', {
              videoId: currentVideoId,
              driftSec: Math.round(drift),
              seekSec,
            });
            ytPlayer.seekTo(seekSec, true);
          }
        }
        if (!isAlreadyPlaying()) {
          logPlayer('warn', 'Resuming playback — player not playing', {
            videoId: currentVideoId,
            seekSec,
          });
          ytPlayer.playVideo();
        }
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

  function getCurrentVideoId() {
    return currentVideoId;
  }

  return { sync, setOnEnded, whenReady, getCurrentTime, getCurrentVideoId, setVolume, getVolume };
})();
