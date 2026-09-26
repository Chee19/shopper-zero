// Product page, "before" build. Prices and stock arrive by XHR; the policy lives in a pop-up.
(() => {
  const { dw } = window.__store;
  const { variants } = window.pdpData;
  const priceEl = document.querySelector('[data-pdp-price]');
  const stockEl = document.querySelector('[data-pdp-stock]');
  const addBtn = document.querySelector('[data-add-to-bag]');
  const toast = document.querySelector('[data-toast]');
  const swatches = [...document.querySelectorAll('.swatch')];
  const info = {};
  let selectedIndex = 1;

  const xhr = { headers: { 'X-Requested-With': 'XMLHttpRequest' } };

  Promise.all(variants.map(v => fetch(`${dw}/Product-Variation?pid=${v.sku}`, xhr).then(r => r.json())))
    .then(list => {
      list.forEach(d => { info[d.pid] = d; });
      render(swatches[0]);
      addBtn.disabled = false;
    });

  function render(btn) {
    const d = info[btn.dataset.sku];
    priceEl.textContent = d.price.formatted;
    stockEl.textContent = d.available ? 'In stock' : 'Out of stock';
    stockEl.className = `stock ${d.available ? 'in' : 'out'}`;
  }

  swatches.forEach(btn => btn.addEventListener('click', () => {
    swatches.forEach(b => { b.classList.toggle('is-selected', b === btn); b.setAttribute('aria-pressed', b === btn); });
    selectedIndex = btn.dataset.index;
    render(btn);
  }));

  addBtn.addEventListener('click', async () => {
    // BUG (intentional, for the demo): data-index is 1-based, `variants` is 0-based.
    const variant = variants[selectedIndex] || variants[0];
    const label = swatches.find(b => b.classList.contains('is-selected')).textContent;
    addBtn.disabled = true;
    const r = await fetch(`${dw}/Cart-AddProduct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ pid: variant.sku, quantity: '1' }),
    });
    const d = await r.json();
    addBtn.disabled = false;
    if (d.error) { toast.textContent = d.message; }
    else { toast.textContent = `${label} added to your bag`; window.setBagCount(d.cart.count); }
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 3000);
  });

  document.querySelector('[data-open-policy]').addEventListener('click', async () => {
    const [ship, ret] = await Promise.all(['shipping', 'returns'].map(cid => fetch(`${dw}/Page-Include?cid=${cid}`, xhr).then(r => r.text())));
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-close" aria-label="Close">×</button>
      <h2>Delivery &amp; returns</h2><h3>Shipping</h3>${ship}<h3>Returns</h3>${ret}</div>`;
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('.modal-close')) el.remove(); });
    document.body.appendChild(el);
  });
})();
