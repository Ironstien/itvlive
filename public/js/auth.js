(function (global) {
  const STORAGE_TOKEN = 'itv-token';

  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN);
  }

  function setToken(token) {
    if (token) localStorage.setItem(STORAGE_TOKEN, token);
    else localStorage.removeItem(STORAGE_TOKEN);
  }

  function clearAuth() {
    localStorage.removeItem(STORAGE_TOKEN);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  async function api(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(path, { ...options, headers });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  }

  async function fetchMe() {
    if (!getToken()) return null;
    const { ok, data } = await api('/api/auth/me');
    if (!ok) {
      clearAuth();
      return null;
    }
    return data.user || null;
  }

  function avatarImg(user, className, size) {
    if (!user?.avatarUrl) return '';
    const px = size || 28;
    return `<img class="${className}" src="${escapeAttr(user.avatarUrl)}" alt="" width="${px}" height="${px}" loading="lazy" />`;
  }

  /**
   * @param {HTMLElement|null} container
   * @param {{ user?: object, guestName?: string, onChangeName?: () => void }} state
   */
  function renderNav(container, state = {}) {
    if (!container) return;

    if (state.user) {
      const av = avatarImg(state.user, 'nav-avatar', 26);
      container.innerHTML = `
        <span class="nav-user-inner">
          ${av}
          <button type="button" class="link-btn nav-username" id="nav-open-profile">${escapeHtml(state.user.username)}</button>
          · <button type="button" class="link-btn" id="nav-open-settings">Settings</button>
          · <a href="#" id="nav-logout" class="nav-logout">Log out</a>
        </span>
      `;
      const openProfile = (e) => {
        e.preventDefault();
        state.onOpenProfile?.();
      };
      container.querySelector('#nav-open-profile')?.addEventListener('click', openProfile);
      container.querySelector('#nav-open-settings')?.addEventListener('click', openProfile);
      container.querySelector('#nav-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearAuth();
        state.onLogout?.();
        if (!state.onLogout) window.location.href = '/login.html';
      });
      return;
    }

    const name = state.guestName || 'Guest';
    container.innerHTML = `
      <span class="nav-user-inner">
        <span>${escapeHtml(name)}</span>
        · <button type="button" class="link-btn" id="btn-change-name">Change name</button>
        · <a href="/login.html">Log in</a>
      </span>
    `;
    container.querySelector('#btn-change-name')?.addEventListener('click', (e) => {
      e.preventDefault();
      state.onChangeName?.();
    });
  }

  global.ITVAuth = {
    STORAGE_TOKEN,
    getToken,
    setToken,
    clearAuth,
    api,
    fetchMe,
    renderNav,
    avatarImg,
    escapeHtml,
  };
})(window);
