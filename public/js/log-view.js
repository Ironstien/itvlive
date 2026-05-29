(function () {
  const STORAGE_KEY = ITVLog.STORAGE_KEY;
  const CHANNEL_NAME = ITVLog.CHANNEL_NAME;

  const output = document.getElementById('log-output');
  const meta = document.getElementById('log-meta');
  const status = document.getElementById('log-status');
  const copyBtn = document.getElementById('log-copy');
  const clearBtn = document.getElementById('log-clear');
  const filterSel = document.getElementById('log-filter');
  const autoscrollChk = document.getElementById('log-autoscroll');

  const lines = [];
  let filterCat = '';

  function loadInitial() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      parsed.forEach((entry) => appendEntry(entry, false));
    } catch {
      /* ignore */
    }
  }

  function renderMeta() {
    const headers = ITVLog.getHeaderLines().filter((l) => l.startsWith('#'));
    meta.textContent = headers.join('\n').replace(/^# /gm, '');
  }

  function shouldShow(entry) {
    return !filterCat || entry.cat === filterCat;
  }

  function appendEntry(entry, scroll) {
    lines.push(entry);
    if (!shouldShow(entry)) return;

    const span = document.createElement('span');
    span.className = `log-line log-line--${entry.level}`;
    span.dataset.cat = entry.cat;
    span.textContent = `${ITVLog.formatEntry(entry)}\n`;
    output.appendChild(span);

    if (scroll !== false && autoscrollChk?.checked) {
      output.scrollTop = output.scrollHeight;
    }
    updateStatus();
  }

  function rebuildView() {
    output.innerHTML = '';
    lines.forEach((entry) => {
      if (!shouldShow(entry)) return;
      const span = document.createElement('span');
      span.className = `log-line log-line--${entry.level}`;
      span.dataset.cat = entry.cat;
      span.textContent = `${ITVLog.formatEntry(entry)}\n`;
      output.appendChild(span);
    });
    if (autoscrollChk?.checked) output.scrollTop = output.scrollHeight;
    updateStatus();
  }

  function updateStatus() {
    const visible = filterCat ? lines.filter((e) => e.cat === filterCat).length : lines.length;
    status.textContent = `${visible} event${visible === 1 ? '' : 's'} · ${lines.length} total in session`;
  }

  function getVisibleText() {
    const filtered = filterCat ? lines.filter((e) => e.cat === filterCat) : lines;
    return [...ITVLog.getHeaderLines(), ...filtered.map(ITVLog.formatEntry)].join('\n');
  }

  copyBtn?.addEventListener('click', async () => {
    const text = getVisibleText();
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = `Copied ${filterCat ? 'filtered ' : ''}log to clipboard`;
      setTimeout(updateStatus, 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      status.textContent = 'Copied log to clipboard';
      setTimeout(updateStatus, 2000);
    }
  });

  clearBtn?.addEventListener('click', () => {
    lines.length = 0;
    output.innerHTML = '';
    sessionStorage.setItem(STORAGE_KEY, '[]');
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(CHANNEL_NAME).postMessage({ type: 'clear' });
    }
    status.textContent = 'Log cleared';
  });

  filterSel?.addEventListener('change', () => {
    filterCat = filterSel.value;
    rebuildView();
  });

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      const msg = event.data;
      if (msg?.type === 'entry' && msg.entry) {
        appendEntry(msg.entry);
      } else if (msg?.type === 'clear') {
        lines.length = 0;
        output.innerHTML = '';
        updateStatus();
      }
    };
  }

  renderMeta();
  loadInitial();
  if (lines.length) rebuildView();
  else updateStatus();
})();
