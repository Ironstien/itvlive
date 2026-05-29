(function (global) {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const show = (el, visible) => el?.classList.toggle('hidden', !visible);

  let currentPanel = null;
  let hooks = {};

  function close() {
    const overlay = $('#site-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    show(overlay, false);
    overlay.setAttribute('aria-hidden', 'true');
    overlay.querySelectorAll('.overlay-panel').forEach((p) => show(p, false));
    currentPanel = null;
    document.body.classList.remove('overlay-open');
  }

  function open(panelId) {
    const overlay = $('#site-overlay');
    const panel = $(`#overlay-${panelId}`);
    if (!overlay || !panel) return;

    if (panelId === 'profile' && global.ITVProfile) {
      global.ITVProfile.refresh();
    }

    overlay.querySelectorAll('.overlay-panel').forEach((p) => show(p, false));
    show(panel, true);
    show(overlay, true);
    overlay.setAttribute('aria-hidden', 'false');
    currentPanel = panelId;
    document.body.classList.add('overlay-open');

    const focusTarget = panel.querySelector('button, input, a, [tabindex]');
    focusTarget?.focus();
  }

  function bindTriggers(scope) {
    scope.querySelectorAll('[data-overlay]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        open(el.dataset.overlay);
      });
    });

    scope.querySelectorAll('[data-overlay-close]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        close();
      });
    });
  }

  function init(options = {}) {
    hooks = options;

    const overlay = $('#site-overlay');
    if (!overlay) return;

    bindTriggers(document);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && currentPanel) close();
    });

    if (global.ITVProfile) {
      global.ITVProfile.mount($('#overlay-profile'), {
        onUserUpdate: (user) => hooks.onUserUpdate?.(user),
        onLogout: () => {
          close();
          hooks.onLogout?.();
        },
      });
    }

    const params = new URLSearchParams(window.location.search);
    const requested = params.get('overlay');
    if (requested && overlay.querySelector(`#overlay-${requested}`)) {
      open(requested);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }

  global.ITVOverlays = { open, close, init };
})(window);
