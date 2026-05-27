(function () {
  const $ = (sel) => document.querySelector(sel);
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  const errEl = $('#auth-error');
  const loginForm = $('#form-login');
  const registerForm = $('#form-register');

  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg;
    show(errEl, !!msg);
  }

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach((t) => {
        t.classList.toggle('active', t === tab);
      });
      show(loginForm, target === 'login');
      show(registerForm, target === 'register');
      showError('');
    });
  });

  async function afterAuth(token, user) {
    ITVAuth.setToken(token);
    window.location.href = '/index.html';
  }

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const fd = new FormData(loginForm);
      const { ok, data } = await ITVAuth.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: fd.get('email'),
          password: fd.get('password'),
        }),
      });
      if (!ok) {
        showError(data.error || 'Login failed');
        return;
      }
      await afterAuth(data.token, data.user);
    } catch {
      showError('Could not reach server — run npm.cmd start');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = registerForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const fd = new FormData(registerForm);
      const { ok, data } = await ITVAuth.api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: fd.get('email'),
          username: fd.get('username'),
          password: fd.get('password'),
        }),
      });
      if (!ok) {
        showError(data.error || 'Registration failed');
        return;
      }
      await afterAuth(data.token, data.user);
    } catch {
      showError('Could not reach server — run npm.cmd start');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Default tab: login only (register form hidden via .hidden in auth.css)
  show(loginForm, true);
  show(registerForm, false);

  fetch('/health')
    .then((r) => r.json())
    .then((data) => {
      if (!data.db) {
        showError(
          'Database not connected — save MONGODB_URI in .env, then stop the server (Ctrl+C) and run npm.cmd start again.'
        );
      }
    })
    .catch(() => {
      showError('Server offline — run npm.cmd start in the ITVLIVE folder.');
    });

  ITVAuth.fetchMe().then((user) => {
    if (user) {
      window.location.href = '/index.html';
      return;
    }
    ITVAuth.renderNav($('#nav-user'), { guestName: 'Guest' });
  });
})();
