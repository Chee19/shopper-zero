// Shared storefront behaviour: consent UI, newsletter pop-up, bag counter.
(() => {
  const { mode } = window.__store;
  const root = document.getElementById('consent-root');
  const hasConsent = () => document.cookie.includes('consent=');
  const setConsent = v => { document.cookie = `consent=${v}; Path=/; Max-Age=31536000; SameSite=Lax`; };

  window.setBagCount = n => document.querySelectorAll('[data-bag-count]').forEach(el => { el.textContent = n; });

  if (!hasConsent()) {
    if (mode === 'before') {
      // Full-screen consent wall: nothing on the page is clickable until it is answered.
      root.innerHTML = `<div class="overlay" data-consent-wall><div class="modal" role="dialog" aria-modal="true" aria-labelledby="cw-h">
        <h2 id="cw-h">We value your privacy</h2>
        <p>We and our 214 partners use cookies to personalise content, measure performance and show you relevant offers. Choose "Accept all" to continue shopping.</p>
        <div class="row"><button class="btn" data-consent="all">Accept all</button><button class="btn ghost" data-consent="necessary">Necessary only</button></div>
      </div></div>`;
    } else {
      root.innerHTML = `<div class="consent-bar" role="region" aria-label="Cookie preferences">
        <span>We use essential cookies to run the store. Optional analytics are off unless you allow them.</span>
        <span><button class="btn" data-consent="all">Allow analytics</button> <button class="linklike" data-consent="necessary">No thanks</button></span></div>`;
    }
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-consent]');
      if (!b) return;
      setConsent(b.dataset.consent);
      root.innerHTML = '';
      maybeNewsletter();
    });
  } else {
    maybeNewsletter();
  }

  function maybeNewsletter() {
    if (mode !== 'before' || document.cookie.includes('nl_seen=1')) return;
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'overlay';
      el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="nl-h">
        <button class="modal-close" aria-label="Close" data-close>×</button>
        <h2 id="nl-h">15% off your first order</h2>
        <p>Join Letters from Provence for seasonal rituals, early access and a welcome gift.</p>
        <form class="row" data-nl><input type="email" placeholder="Email address" required style="flex:1;padding:12px;border:1px solid #e4dccb;font:inherit"><button class="btn">Sign up</button></form>
      </div>`;
      document.body.appendChild(el);
      const close = () => { document.cookie = 'nl_seen=1; Path=/; Max-Age=86400'; el.remove(); };
      el.querySelector('[data-close]').addEventListener('click', close);
      el.querySelector('[data-nl]').addEventListener('submit', e => { e.preventDefault(); close(); });
    }, 2500);
  }
})();
