(function (global) {
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  let root = null;
  let wired = false;

  function qs(sel) {
    return root?.querySelector(sel);
  }

  function setError(msg) {
    const errEl = qs('#admin-error');
    const okEl = qs('#admin-ok');
    show(okEl, false);
    if (!msg) {
      show(errEl, false);
      return;
    }
    errEl.textContent = msg;
    show(errEl, true);
  }

  function setOk(msg) {
    const okEl = qs('#admin-ok');
    const errEl = qs('#admin-error');
    show(errEl, false);
    if (!msg) {
      show(okEl, false);
      return;
    }
    okEl.textContent = msg;
    show(okEl, true);
  }

  function isStaffRole(role) {
    return role === 'mod' || role === 'admin';
  }

  const STAFF_OPTIONS = [
    { value: '', label: 'None' },
    { value: 'resident', label: 'Resident DJ' },
    { value: 'host', label: 'Host' },
    { value: 'mod', label: 'Moderator' },
    { value: 'admin', label: 'Admin' },
  ];

  function renderUsers(users) {
    const container = qs('#admin-users');
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
    await loadUsers(qs('#admin-search')?.value?.trim() || '');
    await loadAudit();
  }

  async function loadUsers(q = '') {
    const qsParam = q ? `?q=${encodeURIComponent(q)}&limit=50` : '?limit=50';
    const { ok, data } = await ITVAuth.api(`/api/admin/users${qsParam}`);
    if (!ok) {
      setError(data.error || 'Failed to load users');
      return;
    }
    renderUsers(data.users || []);
  }

  async function loadAudit() {
    const list = qs('#admin-audit-list');
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

  function applyAccess(user) {
    const title = qs('#overlay-admin-title');
    const lead = qs('#admin-overlay-lead');
    const denied = qs('#admin-overlay-denied');
    const staffSection = qs('#admin-staff-section');
    const mgmtSection = qs('#admin-mgmt-section');

    setError('');
    setOk('');
    show(denied, false);

    if (!user || !isStaffRole(user.staffRole)) {
      if (title) title.textContent = 'Admin';
      if (lead) lead.textContent = 'Staff permissions required.';
      show(staffSection, false);
      show(mgmtSection, false);
      show(denied, true);
      return;
    }

    const isAdmin = user.staffRole === 'admin';
    if (title) title.textContent = isAdmin ? 'Admin' : 'Staff';
    if (lead) {
      lead.textContent = isAdmin
        ? 'Room controls, user management, and audit log.'
        : 'Room controls and moderation tools.';
    }
    show(staffSection, true);
    show(mgmtSection, isAdmin);
  }

  function wireEvents() {
    if (wired || !root) return;
    wired = true;

    qs('#admin-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void loadUsers(qs('#admin-search')?.value?.trim() || '');
    });
  }

  function mount(container) {
    root = container;
    wireEvents();
  }

  async function refresh() {
    if (!root) return;
    const user = await ITVAuth.fetchMe();
    applyAccess(user);
    if (user?.staffRole === 'admin') {
      await loadUsers();
      await loadAudit();
    }
  }

  global.ITVAdmin = { mount, refresh };

  if (document.getElementById('admin-users') && !document.getElementById('site-overlay')) {
    window.location.replace('/index.html?overlay=admin');
  }
})(window);
