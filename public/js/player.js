/* global YT */

const ITVPlayer = (() => {
  let ytPlayer = null;
  let ready = false;
  let currentVideoId = null;
  let lastSyncSignature = null;
  let lastSyncPayload = null;
  let onEndedCallback = null;
  let isCurrentDj = false;
  let volumeLevel = 80;
  let volumeMuted = false;
  let pendingSyncPayload = null;
  let clockOffsetMs = 0;
  let volumeAppliedForTrack = false;
  let unblockTimer = null;
  const queue = [];

  const YT_STATE_NAMES = {
    [-1]: 'UNSTARTED',
    0: 'ENDED',
    1: 'PLAYING',
    2: 'PAUSED',
    3: 'BUFFERING',
    5: 'CUED',
  };

  const TRACK_END_MIN_RATIO = 0.8;

  function logPlayer(level, msg, data) {
    if (typeof ITVLog === 'undefined') return;
    ITVLog.log(level, 'player', msg, data);
  }

  function updateClockOffset(payload) {
    if (payload?.serverTime != null && Number.isFinite(Number(payload.serverTime))) {
      clockOffsetMs = Date.now() - Number(payload.serverTime);
    }
  }

  function serverNowMs() {
    return Date.now() - clockOffsetMs;
  }

  function syncSignature(payload) {
    if (!payload?.videoId) return 'idle';
    const bootPrefix = payload.bootId ? `${payload.bootId}:` : '';
    if (payload.playbackSessionId) {
      return `${bootPrefix}${payload.videoId}:${payload.playbackSessionId}`;
    }
    return `${bootPrefix}${payload.videoId}:${payload.startedAt || 0}`;
  }

  function computeSeekSec(payload) {
    if (!payload?.startedAt) return 0;
    return Math.max(0, Math.floor((serverNowMs() - payload.startedAt) / 1000));
  }

  function clampSeekSec(seekSec, payload) {
    let sec = Math.max(0, Math.floor(seekSec));
    const metaDur = Number(payload?.durationSec);
    if (Number.isFinite(metaDur) && metaDur > 0) {
      sec = Math.min(sec, Math.max(0, Math.floor(metaDur) - 1));
    }
    if (ytPlayer?.getDuration) {
      const ytDur = ytPlayer.getDuration();
      if (Number.isFinite(ytDur) && ytDur > 1) {
        sec = Math.min(sec, Math.max(0, Math.floor(ytDur) - 1));
      }
    }
    return sec;
  }

  function resolveSeekSec(payload) {
    if (!payload?.startedAt) return 0;
    return clampSeekSec(computeSeekSec(payload), payload);
  }

  function getServerSeekSec() {
    if (!lastSyncPayload?.startedAt) return 0;
    return resolveSeekSec(lastSyncPayload);
  }

  function shouldBePlaying() {
    return !!lastSyncPayload?.videoId && lastSyncPayload.isPlaying !== false;
  }

  function clearUnblockTimer() {
    if (unblockTimer) {
      clearTimeout(unblockTimer);
      unblockTimer = null;
    }
  }

  function showUnblockOverlay() {
    const el = document.getElementById('player-unblock');
    if (el) el.classList.remove('hidden');
  }

  function hideUnblockOverlay() {
    const el = document.getElementById('player-unblock');
    if (el) el.classList.add('hidden');
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

  function applyVolumeOnce() {
    if (volumeAppliedForTrack) return;
    volumeAppliedForTrack = true;
    applyVolume();
  }

  function scheduleUnblockCheck() {
    clearUnblockTimer();
    unblockTimer = setTimeout(() => {
      unblockTimer = null;
      if (!shouldBePlaying() || !ytPlayer?.getPlayerState) return;
      if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
        showUnblockOverlay();
      }
    }, 3000);
  }

  /** One shot: load at offset and let YT autoplay (iframe starts muted). No retries or re-sync. */
  function startTrack(videoId, seekSec, reason) {
    if (!ytPlayer?.loadVideoById) return false;

    logPlayer('info', reason, { videoId, seekSec });
    currentVideoId = videoId;
    volumeAppliedForTrack = false;
    hideUnblockOverlay();
    clearUnblockTimer();

    ytPlayer.loadVideoById({
      videoId,
      startSeconds: seekSec,
    });

    scheduleUnblockCheck();
    return true;
  }

  function shouldEmitEnded() {
    if (!lastSyncPayload?.videoId) return false;
    const currentTime = ytPlayer?.getCurrentTime?.() ?? 0;
    const durationSec = Number(lastSyncPayload.durationSec);
    if (Number.isFinite(durationSec) && durationSec > 0) {
      return currentTime >= durationSec * TRACK_END_MIN_RATIO;
    }
    return true;
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
            clearUnblockTimer();
            hideUnblockOverlay();
            applyVolumeOnce();
          }

          if (event.data === YT.PlayerState.ENDED && onEndedCallback && isCurrentDj) {
            if (!shouldEmitEnded()) {
              logPlayer('warn', 'Ignoring premature YT ENDED', {
                videoId: currentVideoId,
                currentTime: ytPlayer?.getCurrentTime?.() ?? null,
              });
              return;
            }
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
      if (payload?.videoId) {
        updateClockOffset(payload);
        lastSyncPayload = payload;
      }
      whenReady(() => ensurePlayer());
      return;
    }

    updateClockOffset(payload);
    const signature = syncSignature(payload);
    const seekSec = payload?.videoId ? resolveSeekSec(payload) : 0;

    if (signature === lastSyncSignature) {
      if (payload?.videoId) {
        updateClockOffset(payload);
        lastSyncPayload = { ...lastSyncPayload, ...payload };
      }
      return;
    }

    lastSyncSignature = signature;
    volumeAppliedForTrack = false;
    clearUnblockTimer();
    hideUnblockOverlay();

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
      clearUnblockTimer();
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
        startTrack(payload.videoId, seekSec, 'Loading new video');
      };

      apply();
    });
  }

  function userPlay() {
    whenReady(() => {
      ensurePlayer();
      if (!ytPlayer?.playVideo) return;
      hideUnblockOverlay();
      clearUnblockTimer();
      applyVolume();
      ytPlayer.playVideo();
    });
  }

  function setOnEnded(fn) {
    onEndedCallback = fn;
  }

  function setIsCurrentDj(value) {
    isCurrentDj = !!value;
  }

  function getEndedPayload() {
    return {
      playbackSessionId: lastSyncPayload?.playbackSessionId ?? null,
      playSessionId: lastSyncPayload?.playSessionId ?? null,
      currentTime: ytPlayer?.getCurrentTime?.() ?? 0,
      reportedDurationSec: lastSyncPayload?.durationSec ?? null,
    };
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
    setIsCurrentDj,
    whenReady,
    getCurrentTime,
    getServerSeekSec,
    getCurrentVideoId,
    getEndedPayload,
    setVolume,
    getVolume,
    userPlay,
    initUnblock,
  };
})();
