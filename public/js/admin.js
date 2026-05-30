(function () {
  const $ = (sel) => document.querySelector(sel);

  function show(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  function setError(msg) {
    const errEl = $('#admin-error');
    const okEl = $('#admin-ok');
    show(okEl, false);
    if (!msg) {
      show(errEl, false);
      return;
    }
    errEl.textContent = msg;
    show(errEl, true);
  }

  function setOk(msg) {
    const okEl = $('#admin-ok');
    const errEl = $('#admin-error');
    show(errEl, false);
    if (!msg) {
      show(okEl, false);
      return;
    }
    okEl.textContent = msg;
    show(okEl, true);
  }

  const STAFF_OPTIONS = [
    { value: '', label: 'None' },
    { value: 'resident', label: 'Resident DJ' },
    { value: 'host', label: 'Host' },
    { value: 'mod', label: 'Moderator' },
    { value: 'admin', label: 'Admin' },
  ];

  function renderUsers(users) {
    const container = $('#admin-users');
    if (!container) return;
    if (!users.length) {
      container.innerHTML = '<p class="muted">No users found.</p>';
      return;
    }

    container.innerHTML = users
      .map((u) => {
        const roleOpts = STAFF_OPTIONS.map(
          (o) =>
            `<option value="${o.value}"${u.staffRole === o.value || (!u.staffRole && !o.value) ? ' selected' : ''}>${ITVAuth.escapeHtml(o.label)}</option>`
        ).join('');
        const protectedNote = u.protected ? ' · protected admin' : '';
        return `
          <article class="admin-user-row" data-user-id="${ITVAuth.escapeHtml(u.id)}">
            <div class="admin-user-row__head">
              <strong>${ITVAuth.escapeHtml(u.username)}</strong>
              <span class="muted">${ITVAuth.escapeHtml(u.email)}</span>
            </div>
            <div class="admin-user-row__meta muted">
              Level ${u.level} · votes ${u.votesGivenCount} · chat ${u.chatMessageCount} · listens ${u.totalListens} · DJ ${u.totalPlays}${protectedNote}
            </div>
            <div class="admin-user-row__controls">
              <label>
                Staff role
                <select class="admin-role-select"${u.protected ? ' disabled title="Protected account"' : ''}>${roleOpts}</select>
              </label>
              <label>
                Tokens
                <input type="number" class="admin-token-input" min="0" step="1" value="${u.tokenBalance}" />
              </label>
              <button type="button" class="btn-primary btn-sm admin-save-btn">Save</button>
              <button type="button" class="btn-ghost btn-sm admin-elite-btn"${u.level >= 5 ? ' disabled' : ''}>Grant Elite</button>
            </div>
          </article>
        `;
      })
      .join('');

    container.querySelectorAll('.admin-save-btn').forEach((btn) => {
      btn.addEventListener('click', () => saveUserRow(btn.closest('.admin-user-row')));
    });
    container.querySelectorAll('.admin-elite-btn').forEach((btn) => {
      btn.addEventListener('click', () => grantElite(btn.closest('.admin-user-row')));
    });
  }

  async function saveUserRow(row) {
    if (!row) return;
    const id = row.dataset.userId;
    const staffRole = row.querySelector('.admin-role-select')?.value ?? '';
    const tokenBalance = row.querySelector('.admin-token-input')?.value;
    setError('');
    const { ok, data } = await ITVAuth.api(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        staffRole: staffRole || null,
        tokenBalance: Number(tokenBalance),
      }),
    });
    if (!ok) {
      setError(data.error || 'Save failed');
      return;
    }
    setOk(`Updated ${data.user.username}`);
    await loadAudit();
  }

  async function grantElite(row) {
    if (!row) return;
    const id = row.dataset.userId;
    setError('');
    const { ok, data } = await ITVAuth.api(`/api/admin/users/${id}/grant-elite`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!ok) {
      setError(data.error || 'Grant Elite failed');
      return;
    }
    setOk(`${data.user.username} is now Elite (Level 5)`);
    await loadUsers($('#admin-search')?.value?.trim() || '');
    await loadAudit();
  }

  async function loadUsers(q = '') {
    const qs = q ? `?q=${encodeURIComponent(q)}&limit=50` : '?limit=50';
    const { ok, data } = await ITVAuth.api(`/api/admin/users${qs}`);
    if (!ok) {
      setError(data.error || 'Failed to load users');
      return;
    }
    renderUsers(data.users || []);
  }

  async function loadAudit() {
    const list = $('#admin-audit-list');
    if (!list) return;
    const { ok, data } = await ITVAuth.api('/api/admin/audit?limit=30');
    if (!ok) {
      list.innerHTML = '<li class="muted">Could not load audit log.</li>';
      return;
    }
    const rows = data.actions || [];
    if (!rows.length) {
      list.innerHTML = '<li class="muted">No actions yet.</li>';
      return;
    }
    list.innerHTML = rows
      .map((row) => {
        const when = new Date(row.createdAt).toLocaleString();
        const actor = row.actor ? ITVAuth.escapeHtml(row.actor) : 'system';
        const target = row.target ? ` → ${ITVAuth.escapeHtml(row.target)}` : '';
        return `<li><span class="muted">${when}</span> · ${ITVAuth.escapeHtml(row.action)} · ${actor}${target}</li>`;
      })
      .join('');
  }

  async function init() {
    const user = await ITVAuth.fetchMe();
    if (!user) {
      window.location.href = '/login.html';
      return;
    }
    if (user.staffRole !== 'admin') {
      setError('Admin permissions required');
      return;
    }

    ITVAuth.renderNav($('#nav-user'), { user });

    $('#admin-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void loadUsers($('#admin-search')?.value?.trim() || '');
    });

    await loadUsers();
    await loadAudit();
  }

  init();
})();
