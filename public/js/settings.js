(function () {
  const $ = (sel) => document.querySelector(sel);
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  const errEl = $('#settings-error');
  const okEl = $('#settings-ok');
  const form = $('#form-profile');
  const previewWrap = $('#avatar-preview');
  const previewImg = $('#avatar-preview-img');
  const avatarInput = form?.querySelector('[name="avatarUrl"]');

  let currentUser = null;

  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg;
    show(errEl, !!msg);
    if (msg) show(okEl, false);
  }

  function showOk(msg) {
    if (!okEl) return;
    okEl.textContent = msg;
    show(okEl, !!msg);
    if (msg) show(errEl, false);
  }

  function updatePreview(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      show(previewWrap, false);
      return;
    }
    previewImg.src = trimmed;
    show(previewWrap, true);
  }

  avatarInput?.addEventListener('input', () => updatePreview(avatarInput.value));

  $('#settings-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    ITVAuth.clearAuth();
    window.location.href = '/login.html';
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
      ITVAuth.renderNav($('#nav-user'), { user: currentUser });
      $('#settings-greeting').textContent = `Signed in as ${currentUser.username} (Level ${currentUser.level})`;
      showOk('Profile saved.');
      updatePreview(currentUser.avatarUrl);
    } catch {
      showError('Could not reach server');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  async function init() {
    const user = await ITVAuth.fetchMe();
    if (!user) {
      window.location.href = '/login.html';
      return;
    }
    currentUser = user;
    ITVAuth.renderNav($('#nav-user'), { user });
    $('#settings-greeting').textContent = `Signed in as ${user.username} (Level ${user.level})`;
    form.querySelector('[name="avatarUrl"]').value = user.avatarUrl || '';
    form.querySelector('[name="customSaying"]').value = user.customSaying || '';
    updatePreview(user.avatarUrl);
  }

  init();
})();
