/* global YT */

const ITVPlayer = (() => {
  let ytPlayer = null;
  let ready = false;
  let currentVideoId = null;
  let lastSyncSignature = null;
  let onEndedCallback = null;
  let volumeLevel = 80;
  let volumeMuted = false;
  let expectPlaying = false;
  let playRetryTimer = null;
  let pendingSyncPayload = null;
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

  function unblockEl() {
    return document.getElementById('player-unblock');
  }

  function showUnblockOverlay() {
    const el = unblockEl();
    if (el) el.classList.remove('hidden');
  }

  function hideUnblockOverlay() {
    const el = unblockEl();
    if (el) el.classList.add('hidden');
  }

  function clearPlayRetry() {
    if (playRetryTimer) {
      clearTimeout(playRetryTimer);
      playRetryTimer = null;
    }
  }

  function schedulePlayRetry(reason) {
    clearPlayRetry();
    playRetryTimer = setTimeout(() => {
      playRetryTimer = null;
      if (!expectPlaying || !ytPlayer?.playVideo) return;
      const state = ytPlayer.getPlayerState?.();
      if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
        hideUnblockOverlay();
        return;
      }
      logPlayer('warn', 'Play retry', { reason, videoId: currentVideoId, stateCode: state });
      try {
        ytPlayer.playVideo();
      } catch (err) {
        logPlayer('warn', 'playVideo failed', { message: err?.message || String(err) });
      }
      if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.CUED) {
        showUnblockOverlay();
      }
    }, 500);
  }

  function markExpectPlaying() {
    expectPlaying = true;
    schedulePlayRetry('mark');
    setTimeout(() => {
      if (expectPlaying) schedulePlayRetry('mark-delayed');
    }, 1500);
  }

  function nudgePlayback(payload) {
    if (!payload?.videoId) return;

    const seekSec = payload.startedAt
      ? Math.max(0, Math.floor((Date.now() - payload.startedAt) / 1000))
      : 0;

    whenReady(() => {
      ensurePlayer();
      if (!ytPlayer) return;

      if (currentVideoId !== payload.videoId && ytPlayer.loadVideoById) {
        currentVideoId = payload.videoId;
        markExpectPlaying();
        ytPlayer.loadVideoById(payload.videoId, seekSec);
        return;
      }

      if (typeof ytPlayer.getCurrentTime === 'function') {
        const drift = Math.abs(ytPlayer.getCurrentTime() - seekSec);
        if (drift > 12 && ytPlayer.seekTo) {
          ytPlayer.seekTo(seekSec, true);
        }
      }

      if (!isAlreadyPlaying()) {
        logPlayer('warn', 'Nudging playback — duplicate sync but not playing', {
          videoId: currentVideoId,
          seekSec,
        });
        markExpectPlaying();
        ytPlayer.playVideo?.();
      }
    });
  }

  function onYouTubeIframeAPIReady() {
    ready = true;
    logPlayer('info', 'YouTube IFrame API ready');
    queue.forEach((fn) => fn());
    queue.length = 0;
    if (pendingSyncPayload) {
      const payload = pendingSyncPayload;
      pendingSyncPayload = null;
      sync(payload);
    }
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
        playsinline: 1,
      },
      events: {
        onReady() {
          applyVolume();
          if (pendingSyncPayload) {
            const payload = pendingSyncPayload;
            pendingSyncPayload = null;
            sync(payload);
          }
        },
        onStateChange(event) {
          const stateName = YT_STATE_NAMES[event.data] || String(event.data);
          logPlayer('info', `YT player state: ${stateName}`, {
            videoId: currentVideoId,
            stateCode: event.data,
          });

          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
            expectPlaying = false;
            clearPlayRetry();
            hideUnblockOverlay();
          }

          if (
            expectPlaying &&
            (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.CUED)
          ) {
            schedulePlayRetry('state-change');
            showUnblockOverlay();
          }

          if (event.data === YT.PlayerState.PAUSED && !expectPlaying) {
            logPlayer('warn', 'Playback paused', { videoId: currentVideoId });
          }

          if (event.data === YT.PlayerState.ENDED && onEndedCallback) {
            logPlayer('info', 'YT ENDED — firing onEnded callback', { videoId: currentVideoId });
            onEndedCallback();
          }
        },
        onError(event) {
          logPlayer('error', 'YT player error', {
            videoId: currentVideoId,
            errorCode: event?.data,
          });
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
    if (!ready || typeof YT === 'undefined') {
      pendingSyncPayload = payload;
      whenReady(() => ensurePlayer());
      return;
    }

    const signature = syncSignature(payload);
    if (signature === lastSyncSignature) {
      if (payload?.videoId && !isAlreadyPlaying()) {
        nudgePlayback(payload);
      }
      return;
    }
    lastSyncSignature = signature;

    logPlayer('debug', 'ITVPlayer.sync apply', {
      signature,
      videoId: payload?.videoId || null,
      startedAt: payload?.startedAt || null,
    });

    const idleEl = document.getElementById('player-idle');
    if (!payload?.videoId) {
      logPlayer('info', 'ITVPlayer.sync idle — no video', { previousVideoId: currentVideoId });
      expectPlaying = false;
      clearPlayRetry();
      hideUnblockOverlay();
      currentVideoId = null;
      if (idleEl) idleEl.classList.remove('hidden');
      whenReady(() => {
        ensurePlayer();
        if (ytPlayer?.pauseVideo) ytPlayer.pauseVideo();
      });
      return;
    }

    if (idleEl) idleEl.classList.add('hidden');
    hideUnblockOverlay();

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
          markExpectPlaying();
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
          markExpectPlaying();
          ytPlayer.playVideo();
        }
      };

      apply();
    });
  }

  function userPlay() {
    whenReady(() => {
      ensurePlayer();
      if (!ytPlayer?.playVideo) return;
      markExpectPlaying();
      ytPlayer.playVideo();
      hideUnblockOverlay();
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

  function initUnblock() {
    const btn = document.getElementById('btn-player-unblock');
    btn?.addEventListener('click', () => userPlay());
  }

  return {
    sync,
    setOnEnded,
    whenReady,
    getCurrentTime,
    getCurrentVideoId,
    setVolume,
    getVolume,
    userPlay,
    initUnblock,
  };
})();
