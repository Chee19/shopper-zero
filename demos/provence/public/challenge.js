// Edge interstitial: grants clearance to real browsers, stalls automated ones.
setTimeout(() => {
  const automated = navigator.webdriver || !navigator.languages || navigator.languages.length === 0;
  if (automated) {
    document.querySelector('h1').textContent = 'Verification failed';
    document.querySelector('p').textContent = 'We could not verify that you are human. Please try again later.';
    return;
  }
  document.cookie = '__edge_clearance=ok; Path=/; Max-Age=1800; SameSite=Lax';
  location.reload();
}, 1500);
