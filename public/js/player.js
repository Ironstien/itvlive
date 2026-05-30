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

  const SEEK_DRIFT_SEC = 5;

  function computeSeekSec(payload) {
    if (!payload?.startedAt) return 0;
    const refTime =
      payload.serverTime != null && Number.isFinite(Number(payload.serverTime))
        ? Number(payload.serverTime)
        : Date.now();
    return Math.max(0, Math.floor((refTime - payload.startedAt) / 1000));
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

  function beginAutoplayMuteTrick() {
    autoplayMuteTrick = !volumeMuted && volumeLevel > 0;
    if (autoplayMuteTrick && ytPlayer?.mute) {
      ytPlayer.mute();
    }
  }

  function restoreVolumeAfterAutoplay() {
    if (!autoplayMuteTrick) return;
    autoplayMuteTrick = false;
    applyVolume();
  }

  function schedulePlayRetry(reason, seekSec = null) {
    if (!shouldBePlaying() && !expectPlaying) return;
    if (shouldBePlaying() && !expectPlaying) expectPlaying = true;
    clearPlayRetry();
    playRetryTimer = setTimeout(() => {
      playRetryTimer = null;
      if ((!shouldBePlaying() && !expectPlaying) || !ytPlayer?.playVideo) return;
      const state = ytPlayer.getPlayerState?.();

      if (seekSec != null && typeof ytPlayer.getCurrentTime === 'function' && ytPlayer.seekTo) {
        const drift = Math.abs(ytPlayer.getCurrentTime() - seekSec);
        if (drift > SEEK_DRIFT_SEC) {
          ytPlayer.seekTo(seekSec, true);
        }
      }

      if (state === YT.PlayerState.PLAYING) {
        hideUnblockOverlay();
        return;
      }

      logPlayer('warn', 'Play retry', { reason, videoId: currentVideoId, stateCode: state });
      beginAutoplayMuteTrick();
      try {
        ytPlayer.playVideo();
      } catch (err) {
        logPlayer('warn', 'playVideo failed', { message: err?.message || String(err) });
      }

      if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
        showUnblockOverlay();
      }
    }, 400);
  }

  function markExpectPlaying(seekSec = null) {
    expectPlaying = true;
    schedulePlayRetry('mark', seekSec);
    setTimeout(() => {
      if (expectPlaying) schedulePlayRetry('mark-delayed', seekSec);
    }, 1200);
    setTimeout(() => {
      if (expectPlaying && shouldBePlaying()) schedulePlayRetry('mark-late', seekSec);
    }, 2800);
  }

  function ensurePlaying(seekSec, reason) {
    if (!shouldBePlaying() || !ytPlayer?.playVideo) return;

    seekIfNeeded(seekSec);

    if (isAlreadyPlaying()) {
      expectPlaying = false;
      clearPlayRetry();
      hideUnblockOverlay();
      return;
    }

    logPlayer('warn', 'ensurePlaying', { reason, videoId: currentVideoId, seekSec });
    beginAutoplayMuteTrick();
    markExpectPlaying(seekSec);
    try {
      ytPlayer.playVideo();
    } catch (err) {
      logPlayer('warn', 'playVideo failed', { message: err?.message || String(err) });
    }

    setTimeout(() => {
      if (shouldBePlaying() && !isAlreadyPlaying()) {
        showUnblockOverlay();
      }
    }, 700);
  }

  function schedulePostLoadPlay(videoId, seekSec) {
    [150, 500, 1200, 2500].forEach((delay) => {
      setTimeout(() => {
        if (!shouldBePlaying() || currentVideoId !== videoId) return;
        ensurePlaying(seekSec, `post-load-${delay}ms`);
      }, delay);
    });
  }

  function seekIfNeeded(seekSec) {
    if (!ytPlayer?.seekTo || !ytPlayer?.getCurrentTime) return;
    const drift = Math.abs(ytPlayer.getCurrentTime() - seekSec);
    if (drift > SEEK_DRIFT_SEC) {
      ytPlayer.seekTo(seekSec, true);
    }
  }

  function loadAndPlay(videoId, seekSec, reason) {
    if (!ytPlayer?.loadVideoById) return false;

    logPlayer('info', reason, {
      videoId,
      seekSec,
    });

    currentVideoId = videoId;
    beginAutoplayMuteTrick();
    markExpectPlaying(seekSec);

    ytPlayer.loadVideoById({
      videoId,
      startSeconds: seekSec,
    });

    schedulePostLoadPlay(videoId, seekSec);

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
          if (lastSyncPayload?.videoId && lastSyncPayload?.isPlaying !== false) {
            beginAutoplayMuteTrick();
          } else {
            applyVolume();
          }
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

          if (event.data === YT.PlayerState.PLAYING) {
            expectPlaying = false;
            clearPlayRetry();
            hideUnblockOverlay();
            restoreVolumeAfterAutoplay();
            applyVolume();
          }

          if (
            event.data === YT.PlayerState.CUED &&
            shouldBePlaying() &&
            !isAlreadyPlaying()
          ) {
            const seekSec = lastSyncPayload ? computeSeekSec(lastSyncPayload) : 0;
            ensurePlaying(seekSec, 'cued');
          }

          if (
            shouldBePlaying() &&
            !isAlreadyPlaying() &&
            (event.data === YT.PlayerState.PAUSED ||
              event.data === YT.PlayerState.CUED ||
              event.data === -1)
          ) {
            const seekSec = lastSyncPayload ? computeSeekSec(lastSyncPayload) : null;
            schedulePlayRetry('state-change', seekSec);
            showUnblockOverlay();
          }

          if (event.data === YT.PlayerState.PAUSED && !shouldBePlaying() && !expectPlaying) {
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

  function shouldBePlaying() {
    return lastSyncPayload?.isPlaying === true && !!lastSyncPayload?.videoId;
  }

  function applyVolume() {
    if (!ytPlayer?.setVolume) return;
    if (volumeMuted || volumeLevel === 0) {
      ytPlayer.mute?.();
      return;
    }
    if (autoplayMuteTrick || (shouldBePlaying() && !isAlreadyPlaying())) {
      if (shouldBePlaying() && !isAlreadyPlaying()) {
        autoplayMuteTrick = true;
      }
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

  function isStalledAtStart(seekSec) {
    if (!ytPlayer?.getPlayerState || !ytPlayer?.getCurrentTime) return false;
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
      return false;
    }
    if (seekSec <= 0) return state === YT.PlayerState.CUED || state === -1;
    return ytPlayer.getCurrentTime() < Math.max(1, seekSec - 3);
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
      if (payload?.videoId && payload.isPlaying !== false) {
        seekIfNeeded(seekSec);
        if (!isAlreadyPlaying()) {
          nudgePlayback(payload);
        }
      }
      return;
    }
    lastSyncSignature = signature;

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

    if (payload.isPlaying !== false) {
      setTimeout(() => {
        if (shouldBePlaying() && !isAlreadyPlaying()) {
          showUnblockOverlay();
        }
      }, 900);
    }

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
      autoplayMuteTrick = false;
      seekIfNeeded(seekSec);
      markExpectPlaying(seekSec);
      ytPlayer.playVideo();
      applyVolume();
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

    const stack = document.getElementById('player-stack');
    if (!stack || stack.dataset.unblockInit) return;
    stack.dataset.unblockInit = '1';
    stack.addEventListener(
      'pointerdown',
      () => {
        if (shouldBePlaying() && !isAlreadyPlaying()) {
          userPlay();
        }
      },
      { capture: true }
    );
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
