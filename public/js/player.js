/* global YT */



const ITVPlayer = (() => {

  let ytPlayer = null;

  let ready = false;

  let currentVideoId = null;

  let lastSyncSignature = null;

  let lastSyncPayload = null;

  let onEndedCallback = null;

  let onResyncRequestCallback = null;

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

  let clockOffsetMs = 0;

  let driftLoopTimer = null;

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

  const SEEK_DRIFT_SEC = 1.5;

  const DRIFT_LOOP_MS = 10000;

  const RESYNC_DRIFT_SEC = 8;

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

    // Always use the live server clock estimate. payload.serverTime is a snapshot

    // from the last sync/tick; using it here freezes seekSec and causes ~10s false

    // drift (then periodic seek/resync skips). Clock offset is set via updateClockOffset.

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



  function stopDriftLoop() {

    if (driftLoopTimer) {

      clearInterval(driftLoopTimer);

      driftLoopTimer = null;

    }

  }



  function startDriftLoop() {

    stopDriftLoop();

    driftLoopTimer = setInterval(() => {

      if (!shouldBePlaying() || !lastSyncPayload) return;

      if (!ytPlayer?.getCurrentTime) return;



      const seekSec = resolveSeekSec(lastSyncPayload);

      const ytTime = ytPlayer.getCurrentTime();

      const drift = Math.abs(ytTime - seekSec);

      if (drift > RESYNC_DRIFT_SEC) {

        logPlayer('warn', 'Drift exceeds resync threshold', { drift, seekSec, ytTime });

        // Stale server clock: do not hammer seekTo far ahead of actual playback.

        if (seekSec <= ytTime + RESYNC_DRIFT_SEC + 30) {

          seekIfNeeded(seekSec);

        }

        if (Math.abs(ytPlayer.getCurrentTime() - seekSec) > RESYNC_DRIFT_SEC) {

          onResyncRequestCallback?.();

        }

        return;

      }

      seekIfNeeded(seekSec);

    }, DRIFT_LOOP_MS);

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

    const target = clampSeekSec(seekSec, lastSyncPayload);

    const drift = Math.abs(ytPlayer.getCurrentTime() - target);

    if (drift > SEEK_DRIFT_SEC) {

      ytPlayer.seekTo(target, true);

    }

  }



  function ensurePlaying(seekSec, reason) {

    if (!shouldBePlaying() || !ytPlayer?.playVideo) return;



    if (isAlreadyPlaying()) {

      seekIfNeeded(seekSec);

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



  function applyPlaybackHeartbeat(payload) {

    if (!payload?.videoId) return;

    updateClockOffset(payload);

    lastSyncPayload = { ...lastSyncPayload, ...payload, isPlaying: true };



    const seekSec = resolveSeekSec(payload);

    whenReady(() => {

      ensurePlayer();

      if (!ytPlayer) return;



      if (currentVideoId !== payload.videoId) {

        loadAndPlay(payload.videoId, seekSec, 'heartbeat-load');

        return;

      }



      seekIfNeeded(seekSec);

      if (!isAlreadyPlaying()) {

        ensurePlaying(seekSec, 'heartbeat');

      }

    });

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

            expectPlaying = false;

            clearPlayRetry();

            hideUnblockOverlay();

            if (autoplayMuteTrick) {

              autoplayMuteTrick = false;

              if (!volumeMuted && volumeLevel > 0) {

                releaseAutoplayMuteLock();

              } else {

                autoplayLockedMuted = true;

                ytPlayer.mute?.();

              }

            } else {

              applyVolume();

            }

          }



          if (event.data === YT.PlayerState.ENDED && onEndedCallback) {

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

      if (payload?.videoId && payload.isPlaying !== false) {
        updateClockOffset(payload);
        lastSyncPayload = { ...lastSyncPayload, ...payload };
        const freshSeekSec = resolveSeekSec(payload);
        seekIfNeeded(freshSeekSec);
        if (!isAlreadyPlaying()) {
          ensurePlaying(freshSeekSec, 'duplicate-sync');
        }
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

      stopDriftLoop();

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

    startDriftLoop();

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

    const seekSec = lastSyncPayload ? resolveSeekSec(lastSyncPayload) : 0;

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



  function setOnResyncRequest(fn) {

    onResyncRequestCallback = fn;

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

    applyPlaybackHeartbeat,

    setOnEnded,

    setOnResyncRequest,

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


