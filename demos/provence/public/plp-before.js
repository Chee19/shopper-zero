// Category grids are loaded client-side from Search-UpdateGrid, then priced.
(() => {
  const { dw } = window.__store;
  const grid = document.querySelector('[data-grid-cgid]');
  if (!grid) return;
  fetch(`${dw}/Search-UpdateGrid?cgid=${grid.dataset.gridCgid}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.text())
    .then(html => {
      grid.innerHTML = html;
      const s = document.createElement('script');
      s.src = '/static/prices-before.js';
      document.body.appendChild(s);
    });
})();
