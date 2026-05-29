/**
 * INTO THE VOID — session event logger.
 * Captures client-side activity for troubleshooting; syncs to log popup via BroadcastChannel + sessionStorage.
 */
const ITVLog = (() => {
  const CHANNEL_NAME = 'itv-log';
  const STORAGE_KEY = 'itv-log-entries';
  const SESSION_KEY = 'itv-log-session';
  const MAX_ENTRIES = 2500;
  const MAX_JSON_LEN = 2400;

  const entries = [];
  let channel = null;
  let sessionId = null;
  let captureReady = false;

  function getSessionId() {
    if (sessionId) return sessionId;
    try {
      sessionId = sessionStorage.getItem(SESSION_KEY);
      if (!sessionId) {
        sessionId = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }
    } catch {
      sessionId = `sess-${Date.now()}`;
    }
    return sessionId;
  }

  function safeReplacer(_key, value) {
    if (typeof value === 'string' && value.length > 400) {
      return `${value.slice(0, 400)}…`;
    }
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  }

  function safeJson(data) {
    if (data === undefined) return '';
    try {
      const text = JSON.stringify(data, safeReplacer);
      if (text.length <= MAX_JSON_LEN) return text;
      return `${text.slice(0, MAX_JSON_LEN)}…`;
    } catch {
      return String(data);
    }
  }

  function formatEntry(entry) {
    const payload = entry.data !== undefined ? ` ${safeJson(entry.data)}` : '';
    return `${entry.ts} [${entry.level.toUpperCase()}] [${entry.cat}] ${entry.msg}${payload}`;
  }

  function loadStoredEntries() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      entries.length = 0;
      parsed.slice(-MAX_ENTRIES).forEach((e) => entries.push(e));
    } catch {
      /* ignore corrupt storage */
    }
  }

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* storage full — trim and retry */
      entries.splice(0, Math.floor(entries.length / 4));
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      } catch {
        /* give up */
      }
    }
  }

  function ensureChannel() {
    if (channel || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(CHANNEL_NAME);
  }

  function push(level, cat, msg, data) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      cat: cat || 'system',
      msg: msg || '',
      data,
      session: getSessionId(),
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    persist();
    ensureChannel();
    channel?.postMessage({ type: 'entry', entry });
    return entry;
  }

  function log(level, cat, msg, data) {
    return push(level, cat, msg, data);
  }

  function info(cat, msg, data) {
    return push('info', cat, msg, data);
  }

  function warn(cat, msg, data) {
    return push('warn', cat, msg, data);
  }

  function error(cat, msg, data) {
    return push('error', cat, msg, data);
  }

  function debug(cat, msg, data) {
    return push('debug', cat, msg, data);
  }

  function getEntries() {
    return [...entries];
  }

  function getHeaderLines() {
    const version = window.ITV_VERSION ? `v${window.ITV_VERSION}` : 'unknown';
    return [
      '# INTO THE VOID — Debug Log',
      `# Session: ${getSessionId()}`,
      `# Site version: ${version}`,
      `# Page: ${location.pathname}`,
      `# User agent: ${navigator.userAgent}`,
      `# Started logging: ${entries[0]?.ts || new Date().toISOString()}`,
      '# Format: ISO8601 [LEVEL] [category] message {json}',
      '',
    ];
  }

  function getText() {
    return [...getHeaderLines(), ...entries.map(formatEntry)].join('\n');
  }

  function clear() {
    entries.length = 0;
    persist();
    ensureChannel();
    channel?.postMessage({ type: 'clear' });
    info('system', 'Log cleared');
  }

  function summarizePayload(payload) {
    if (payload == null) return undefined;
    if (typeof payload !== 'object') return payload;
    const copy = { ...payload };
    if (Array.isArray(copy.urls) && copy.urls.length > 5) {
      copy.urls = [...copy.urls.slice(0, 5), `…+${copy.urls.length - 5} more`];
    }
    return copy;
  }

  function initCapture() {
    if (captureReady) return;
    captureReady = true;
    loadStoredEntries();
    ensureChannel();

    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === 'clear') {
          entries.length = 0;
          persist();
        }
      };
    }

    info('system', 'Logger initialized', {
      session: getSessionId(),
      version: window.ITV_VERSION || null,
    });

    window.addEventListener('error', (event) => {
      error('system', 'Uncaught error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      error('system', 'Unhandled promise rejection', {
        message: reason?.message || String(reason),
        stack: reason?.stack || null,
      });
    });

    window.addEventListener('beforeunload', () => {
      debug('system', 'Page unloading');
    });

    document.addEventListener('visibilitychange', () => {
      debug('system', `Document visibility: ${document.visibilityState}`);
    });
  }

  function openPopup() {
    const w = 760;
    const h = 580;
    const left = Math.max(0, window.screenX + window.outerWidth - w - 24);
    const top = Math.max(0, window.screenY + 72);
    const features = [
      `width=${w}`,
      `height=${h}`,
      `left=${left}`,
      `top=${top}`,
      'resizable=yes',
      'scrollbars=yes',
    ].join(',');
    const popup = window.open('/log.html', 'itv-log', features);
    if (!popup) {
      warn('system', 'Log popup blocked — allow popups for this site');
      return null;
    }
    info('system', 'Log popup opened');
    return popup;
  }

  return {
    info,
    warn,
    error,
    debug,
    log,
    clear,
    getEntries,
    getText,
    getHeaderLines,
    formatEntry,
    summarizePayload,
    initCapture,
    openPopup,
    CHANNEL_NAME,
    STORAGE_KEY,
  };
})();
