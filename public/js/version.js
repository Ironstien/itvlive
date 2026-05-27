/**
 * Site version shown in the header (next to INTO THE VOID).
 * When bumping: add 0.01 (e.g. 0.01 → 0.02 → 0.03).
 */
window.ITV_VERSION = '0.01';

(function applySiteVersion() {
  const label = `v${window.ITV_VERSION}`;
  document.querySelectorAll('.site-version').forEach((el) => {
    el.textContent = label;
  });
})();
