(function () {
  const voteSlider = document.getElementById('vote-slider');
  const voteValue = document.getElementById('vote-value');

  if (voteSlider && voteValue) {
    voteSlider.addEventListener('input', () => {
      voteValue.textContent = voteSlider.value;
    });
  }

  const tabs = document.querySelectorAll('.chat-tab');
  const panes = document.querySelectorAll('.chat-pane');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panes.forEach((p) => p.classList.toggle('active', p.dataset.pane === target));
    });
  });

  fetch('/health')
    .then((r) => r.json())
    .then((data) => {
      const el = document.getElementById('server-status');
      if (el) el.textContent = data.ok ? 'Server online' : 'Server issue';
    })
    .catch(() => {
      const el = document.getElementById('server-status');
      if (el) el.textContent = 'Server offline';
    });
})();
