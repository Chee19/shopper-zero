// Product page, "after" build. The form works without JS; this only keeps price in sync
// and adds to the bag without a page load.
(() => {
  const form = document.querySelector('[data-buy-form]');
  if (!form) return;
  const priceEl = document.querySelector('[data-pdp-price]');
  const stockEl = document.querySelector('[data-pdp-stock]');
  const toast = document.querySelector('[data-toast]');

  form.addEventListener('change', e => {
    if (e.target.name !== 'pid') return;
    form.querySelectorAll('.swatch').forEach(l => l.classList.toggle('is-selected', l.contains(e.target)));
    priceEl.textContent = `$${Number(e.target.dataset.price).toFixed(2)}`;
    const ok = e.target.dataset.stock === '1';
    stockEl.textContent = ok ? 'In stock · ships within 1 business day' : 'Out of stock';
    stockEl.className = `stock ${ok ? 'in' : 'out'}`;
    const url = new URL(location.href);
    url.searchParams.set('pid', e.target.value);
    history.replaceState(null, '', url);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(new FormData(form)),
    });
    const d = await r.json();
    toast.textContent = d.message;
    toast.hidden = false;
    if (!d.error) window.setBagCount(d.cart.count);
    setTimeout(() => { toast.hidden = true; }, 3000);
  });
})();
