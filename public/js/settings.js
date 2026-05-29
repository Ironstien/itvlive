(function (global) {
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  let root = null;
  let currentUser = null;
  let onUserUpdate = null;
  let onLogout = null;
  let wired = false;

  function qs(sel) {
    return root?.querySelector(sel);
  }

  function showError(msg) {
    const errEl = qs('#settings-error');
    const okEl = qs('#settings-ok');
    if (!errEl) return;
    errEl.textContent = msg;
    show(errEl, !!msg);
    if (msg) show(okEl, false);
  }

  function showOk(msg) {
    const okEl = qs('#settings-ok');
    const errEl = qs('#settings-error');
    if (!okEl) return;
    okEl.textContent = msg;
    show(okEl, !!msg);
    if (msg) show(errEl, false);
  }

  function updatePreview(url) {
    const previewWrap = qs('#avatar-preview');
    const previewImg = qs('#avatar-preview-img');
    const trimmed = String(url || '').trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      show(previewWrap, false);
      return;
    }
    previewImg.src = trimmed;
    show(previewWrap, true);
  }

  function fillForm(user) {
    const form = qs('#form-profile');
    const greeting = qs('#settings-greeting');
    const guestBlock = qs('#profile-guest');
    const formBlock = qs('#profile-form-block');

    if (!user) {
      if (greeting) greeting.textContent = 'Sign in to edit your profile.';
      show(guestBlock, true);
      show(formBlock, false);
      return;
    }

    show(guestBlock, false);
    show(formBlock, true);
    if (greeting) {
      greeting.textContent = `Signed in as ${user.username} (Level ${user.level})`;
    }
    if (form) {
      form.querySelector('[name="avatarUrl"]').value = user.avatarUrl || '';
      form.querySelector('[name="customSaying"]').value = user.customSaying || '';
    }
    updatePreview(user.avatarUrl);
  }

  function wireEvents() {
    if (wired || !root) return;
    wired = true;

    const form = qs('#form-profile');
    const avatarInput = form?.querySelector('[name="avatarUrl"]');

    avatarInput?.addEventListener('input', () => updatePreview(avatarInput.value));

    qs('#settings-logout')?.addEventListener('click', (e) => {
      e.preventDefault();
      ITVAuth.clearAuth();
      onLogout?.();
      if (!onLogout) window.location.href = '/login.html';
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      showOk('');
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        const fd = new FormData(form);
        const { ok, data } = await ITVAuth.api('/api/auth/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            avatarUrl: fd.get('avatarUrl'),
            customSaying: fd.get('customSaying'),
          }),
        });
        if (!ok) {
          showError(data.error || 'Could not save profile');
          return;
        }
        currentUser = data.user;
        onUserUpdate?.(currentUser);
        fillForm(currentUser);
        showOk('Profile saved.');
      } catch {
        showError('Could not reach server');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function mount(container, options = {}) {
    root = container;
    onUserUpdate = options.onUserUpdate || null;
    onLogout = options.onLogout || null;
    wireEvents();
  }

  async function refresh() {
    if (!root) return;
    showError('');
    showOk('');
    const user = await ITVAuth.fetchMe();
    currentUser = user;
    fillForm(user);
  }

  global.ITVProfile = { mount, refresh };

  if (document.getElementById('form-profile') && !document.getElementById('site-overlay')) {
    window.location.replace('/index.html?overlay=profile');
  }
})(window);
