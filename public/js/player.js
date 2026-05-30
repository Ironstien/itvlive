/* global YT */

const ITVPlayer = (() => {
  let ytPlayer = null;
  let ready = false;
  let currentVideoId = null;
  let lastSyncSignature = null;
  let lastSyncPayload = null;
  let onEndedCallback = null;
  let volumeLevel = 80;
  let volumeMuted = false;
  let expectPlaying = false;
  let autoplayMuteTrick = false;
  /** Stay muted after muted autoplay until the user unmutes or taps play. */
  let autoplayLockedMuted = false;
  let playRetryTimer = null;
  let pendingSyncPayload = null;
  let lastEnsurePlayingAt = 0;
  let overlayShown = false;
  const queue = [];

  const YT_STATE_NAMES = {
    [-1]: 'UNSTARTED',
    0: 'ENDED',
    1: 'PLAYING',
    2: 'PAUSED',
    3: 'BUFFERING',
    5: 'CUED',
  };

  const ENSURE_PLAY_COOLDOWN_MS = 2000;
  const SEEK_DRIFT_SEC = 5;

  function logPlayer(level, msg, data) {
    if (typeof ITVLog === 'undefined') return;
    ITVLog.log(level, 'player', msg, data);
  }

  function syncSignature(payload) {
    if (!payload?.videoId) return 'idle';
    return `${payload.videoId}:${payload.startedAt || 0}`;
  }

  function computeSeekSec(payload) {
    if (!payload?.startedAt) return 0;
    const refTime =
      payload.serverTime != null && Number.isFinite(Number(payload.serverTime))
        ? Number(payload.serverTime)
        : Date.now();
    return Math.max(0, Math.floor((refTime - payload.startedAt) / 1000));
  }

  function shouldBePlaying() {
    return lastSyncPayload?.isPlaying === true && !!lastSyncPayload?.videoId;
  }

  function isAlreadyPlaying() {
    if (!ytPlayer?.getPlayerState) return false;
    const state = ytPlayer.getPlayerState();
    return state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING;
  }

  function showUnblockOverlay() {
    if (overlayShown) return;
    overlayShown = true;
    const el = document.getElementById('player-unblock');
    if (el) el.classList.remove('hidden');
  }

  function hideUnblockOverlay() {
    overlayShown = false;
    const el = document.getElementById('player-unblock');
    if (el) el.classList.add('hidden');
  }

  function clearPlayRetry() {
    if (playRetryTimer) {
      clearTimeout(playRetryTimer);
      playRetryTimer = null;
    }
  }

  function beginAutoplayMuteTrick() {
    autoplayMuteTrick = !volumeMuted && volumeLevel > 0;
    ytPlayer?.mute?.();
  }

  function releaseAutoplayMuteLock() {
    autoplayLockedMuted = false;
    autoplayMuteTrick = false;
    applyVolume();
  }

  function applyVolume() {
    if (!ytPlayer?.setVolume) return;
    if (volumeMuted || volumeLevel === 0) {
      ytPlayer.mute?.();
      return;
    }
    if (autoplayMuteTrick || autoplayLockedMuted) {
      ytPlayer.mute?.();
      return;
    }
    ytPlayer.unMute?.();
    ytPlayer.setVolume(volumeLevel);
  }

  function schedulePlayRetry(reason, seekSec = null) {
    if (!shouldBePlaying() || isAlreadyPlaying()) return;
    clearPlayRetry();
    playRetryTimer = setTimeout(() => {
      playRetryTimer = null;
      if (!shouldBePlaying() || isAlreadyPlaying() || !ytPlayer?.playVideo) return;

      logPlayer('warn', 'Play retry', { reason, videoId: currentVideoId });
      beginAutoplayMuteTrick();
      seekIfNeeded(seekSec);
      try {
        ytPlayer.playVideo();
      } catch (err) {
        logPlayer('warn', 'playVideo failed', { message: err?.message || String(err) });
      }
    }, 500);
  }

  function seekIfNeeded(seekSec) {
    if (!ytPlayer?.seekTo || !ytPlayer?.getCurrentTime) return;
    const drift = Math.abs(ytPlayer.getCurrentTime() - seekSec);
    if (drift > SEEK_DRIFT_SEC) {
      ytPlayer.seekTo(seekSec, true);
    }
  }

  function ensurePlaying(seekSec, reason) {
    if (!shouldBePlaying() || !ytPlayer?.playVideo) return;

    if (isAlreadyPlaying()) {
      expectPlaying = false;
      clearPlayRetry();
      return;
    }

    const now = Date.now();
    if (now - lastEnsurePlayingAt < ENSURE_PLAY_COOLDOWN_MS) return;
    lastEnsurePlayingAt = now;

    logPlayer('info', 'ensurePlaying', { reason, videoId: currentVideoId, seekSec });
    expectPlaying = true;
    beginAutoplayMuteTrick();
    seekIfNeeded(seekSec);

    try {
      ytPlayer.playVideo();
    } catch (err) {
      logPlayer('warn', 'playVideo failed', { message: err?.message || String(err) });
    }

    schedulePlayRetry(reason, seekSec);

    setTimeout(() => {
      if (shouldBePlaying() && !isAlreadyPlaying()) {
        showUnblockOverlay();
      }
    }, 1500);
  }

  function loadAndPlay(videoId, seekSec, reason) {
    if (!ytPlayer?.loadVideoById) return false;

    logPlayer('info', reason, { videoId, seekSec });
    currentVideoId = videoId;
    lastEnsurePlayingAt = 0;
    overlayShown = false;
    hideUnblockOverlay();
    beginAutoplayMuteTrick();

    ytPlayer.loadVideoById({
      videoId,
      startSeconds: seekSec,
    });

    setTimeout(() => ensurePlaying(seekSec, 'post-load'), 400);
    setTimeout(() => ensurePlaying(seekSec, 'post-load-late'), 1800);

    return true;
  }

  function nudgePlayback(payload) {
    if (!payload?.videoId) return;
    const seekSec = computeSeekSec(payload);

    whenReady(() => {
      ensurePlayer();
      if (!ytPlayer) return;

      if (currentVideoId !== payload.videoId) {
        loadAndPlay(payload.videoId, seekSec, 'Loading new video (nudge)');
        return;
      }

      ensurePlaying(seekSec, 'nudge');
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
        mute: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        enablejsapi: 1,
      },
      events: {
        onReady() {
          if (pendingSyncPayload) {
            const payload = pendingSyncPayload;
            pendingSyncPayload = null;
            sync(payload);
            return;
          }
          applyVolume();
        },
        onStateChange(event) {
          const stateName = YT_STATE_NAMES[event.data] || String(event.data);
          logPlayer('info', `YT player state: ${stateName}`, {
            videoId: currentVideoId,
            stateCode: event.data,
          });

          if (event.data === YT.PlayerState.PLAYING) {
            expectPlaying = false;
            clearPlayRetry();
            hideUnblockOverlay();
            if (autoplayMuteTrick) {
              autoplayMuteTrick = false;
              autoplayLockedMuted = true;
              ytPlayer.mute?.();
            } else {
              applyVolume();
            }
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

  function setVolume(level, muted) {
    volumeLevel = Math.max(0, Math.min(100, Math.round(level)));
    volumeMuted = !!muted || volumeLevel === 0;
    if (!volumeMuted && volumeLevel > 0) {
      releaseAutoplayMuteLock();
    }
    whenReady(() => {
      ensurePlayer();
      applyVolume();
    });
    return { volume: volumeLevel, muted: volumeMuted };
  }

  function getVolume() {
    return { volume: volumeLevel, muted: volumeMuted };
  }

  function sync(payload) {
    if (!ready || typeof YT === 'undefined') {
      pendingSyncPayload = payload;
      if (payload?.videoId) lastSyncPayload = payload;
      whenReady(() => ensurePlayer());
      return;
    }

    const signature = syncSignature(payload);
    const seekSec = payload?.videoId ? computeSeekSec(payload) : 0;

    if (signature === lastSyncSignature) {
      if (payload?.videoId && payload.isPlaying !== false && !isAlreadyPlaying()) {
        seekIfNeeded(seekSec);
        ensurePlaying(seekSec, 'duplicate-sync');
      }
      return;
    }
    lastSyncSignature = signature;
    lastEnsurePlayingAt = 0;
    overlayShown = false;

    logPlayer('debug', 'ITVPlayer.sync apply', {
      signature,
      videoId: payload?.videoId || null,
      startedAt: payload?.startedAt || null,
      seekSec,
    });

    const idleEl = document.getElementById('player-idle');
    if (!payload?.videoId) {
      logPlayer('info', 'ITVPlayer.sync idle — no video', { previousVideoId: currentVideoId });
      lastSyncPayload = null;
      expectPlaying = false;
      autoplayLockedMuted = false;
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

    lastSyncPayload = payload;
    if (idleEl) idleEl.classList.add('hidden');

    whenReady(() => {
      ensurePlayer();

      const apply = () => {
        if (!ytPlayer?.loadVideoById) {
          setTimeout(apply, 300);
          return;
        }

        if (currentVideoId !== payload.videoId) {
          loadAndPlay(payload.videoId, seekSec, 'Loading new video');
          return;
        }

        ensurePlaying(seekSec, 'sync-resume');
      };

      apply();
    });
  }

  function userPlay() {
    const seekSec = lastSyncPayload ? computeSeekSec(lastSyncPayload) : 0;
    whenReady(() => {
      ensurePlayer();
      if (!ytPlayer?.playVideo) return;
      releaseAutoplayMuteLock();
      seekIfNeeded(seekSec);
      expectPlaying = true;
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
    document.getElementById('btn-player-unblock')?.addEventListener('click', () => userPlay());
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
