// Prices are not in the HTML: each card asks the Product-Variation controller after load.
(() => {
  const { dw } = window.__store;
  document.querySelectorAll('[data-price-for]').forEach(async el => {
    const r = await fetch(`${dw}/Product-Variation?pid=${el.dataset.priceFor}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const { product: d } = await r.json();
    el.textContent = d.price.sales.formatted;
  });
})();
