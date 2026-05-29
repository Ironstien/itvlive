const ITVPlayerEffects = (() => {
  const STORAGE_KEY = 'itv-player-effect';
  const VALID = new Set(['1', '2', '3', '4', '5']);

  const stackEl = () => document.getElementById('player-stack');
  const selectEl = () => document.getElementById('player-effect-select');

  function normalize(value) {
    const next = String(value || '1');
    return VALID.has(next) ? next : '1';
  }

  function apply(effectId) {
    const id = normalize(effectId);
    stackEl()?.setAttribute('data-effect', id);
    const select = selectEl();
    if (select && select.value !== id) select.value = id;
    return id;
  }

  function init() {
    const select = selectEl();
    if (!select) return;

    const stored = normalize(localStorage.getItem(STORAGE_KEY));
    apply(stored);

    select.addEventListener('change', () => {
      const id = apply(select.value);
      localStorage.setItem(STORAGE_KEY, id);
    });
  }

  return { init, apply, normalize };
})();
