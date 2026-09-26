// Delivery & returns FAQ: answers are fetched when a question is opened.
(() => {
  const { dw } = window.__store;
  document.querySelectorAll('.faq-q').forEach(q => q.addEventListener('click', async () => {
    const next = q.nextElementSibling;
    if (next && next.classList.contains('faq-a')) { next.remove(); return; }
    const html = await fetch(`${dw}/Page-Include?cid=${q.dataset.cid}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(r => r.text());
    q.insertAdjacentHTML('afterend', `<div class="faq-a">${html}</div>`);
  }));
})();
