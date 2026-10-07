(() => {
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDlj6cyl4Ul__DS6Bp-sIlC6K3cDoiYVvE',
    authDomain: 'skydream-academy.firebaseapp.com',
    projectId: 'skydream-academy',
    storageBucket: 'skydream-academy.firebasestorage.app',
    messagingSenderId: '394576038705',
    appId: '1:394576038705:web:2d055fb58a02c4b7cafe10'
  };
  const RECAPTCHA_ENTERPRISE_SITE_KEY = '6Lf0DNstAAAAAHJkirEV0aJtks5u-wAd_JEjnjOb';
  const PUBLIC_CATALOG_CACHE_KEY = 'skydream-public-catalog-v2';
  const PUBLIC_CATALOG_CACHE_MS = 2 * 60 * 1000;

  if (!window.firebase) {
    console.error('Firebase SDK did not load.');
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);

  let appCheck = null;
  try {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    if (firebase.appCheck) {
      appCheck = firebase.appCheck();
      appCheck.activate(
        new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
        true
      );
    }
  } catch (err) {
    console.warn('App Check could not initialize.', err);
  }

  const functions = firebase.functions();
  const auth = firebase.auth ? firebase.auth() : null;
  let pendingCallableRequests = 0;
  let lastActionButton = null;
  let lastActionAt = 0;

  document.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || !document.body || !document.body.classList.contains('dashboard-body')) return;
    lastActionButton = button;
    lastActionAt = Date.now();
    button.classList.add('is-pressed');
    window.setTimeout(() => {
      if (button.isConnected) button.classList.remove('is-pressed');
    }, 140);
  }, true);

  function beginActionButtonBusy() {
    const button = lastActionButton;
    if (!button || !button.isConnected || Date.now() - lastActionAt > 1500) return null;
    const count = Number(button.dataset.firebaseBusyCount || 0);
    if (count === 0) {
      button.dataset.firebaseWasDisabled = button.disabled ? '1' : '0';
      button.disabled = true;
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
    }
    button.dataset.firebaseBusyCount = String(count + 1);
    return button;
  }

  function endActionButtonBusy(button) {
    if (!button) return;
    const next = Math.max(0, Number(button.dataset.firebaseBusyCount || 1) - 1);
    if (next > 0) {
      button.dataset.firebaseBusyCount = String(next);
      return;
    }
    delete button.dataset.firebaseBusyCount;
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    const wasDisabled = button.dataset.firebaseWasDisabled === '1';
    delete button.dataset.firebaseWasDisabled;
    if (button.isConnected && !wasDisabled) button.disabled = false;
  }

  function setCallableBusy(delta) {
    pendingCallableRequests = Math.max(0, pendingCallableRequests + delta);
    if (pendingCallableRequests) document.documentElement.setAttribute('data-skydream-network-busy', 'true');
    else document.documentElement.removeAttribute('data-skydream-network-busy');
  }

  function friendlyError(err) {
    const raw = err && err.message ? String(err.message) : 'Something went wrong. Please try again.';
    return raw.replace(/^Firebase:\s*/i, '').replace(/^functions\/[a-z-]+\s*/i, '').trim();
  }

  async function ensureAppCheckToken() {
    if (!appCheck || typeof appCheck.getToken !== 'function') {
      throw new Error('Security verification is not ready. Refresh the page and try again.');
    }
    try {
      const result = await appCheck.getToken(false);
      if (!result || !result.token) throw new Error('No App Check token was returned.');
      return result.token;
    } catch (err) {
      console.warn('App Check token could not be obtained.', err);
      throw new Error('Security verification could not be completed. Refresh the page and try again.');
    }
  }

  function readCachedCatalog() {
    try {
      const raw = sessionStorage.getItem(PUBLIC_CATALOG_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || !parsed.savedAt || Date.now() - parsed.savedAt > PUBLIC_CATALOG_CACHE_MS) return null;
      return parsed.data;
    } catch (_) {
      return null;
    }
  }

  function storeCachedCatalog(data) {
    try {
      sessionStorage.setItem(PUBLIC_CATALOG_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {}
  }

  async function call(name, data = {}) {
    // Public catalogue data changes relatively slowly. Reuse it briefly while
    // a visitor moves between pages so navigation does not repeatedly wait on
    // App Check + a Cloud Function round trip.
    if (name === 'publicCatalog') {
      const cached = readCachedCatalog();
      if (cached) return cached;
    }

    const actionButton = beginActionButtonBusy();
    setCallableBusy(1);
    try {
      // Wait for a valid App Check token before every real callable request.
      await ensureAppCheckToken();
      const callable = functions.httpsCallable(name);
      const result = await callable(data);
      if (name === 'publicCatalog' && result && result.data) storeCachedCatalog(result.data);
      return result.data;
    } finally {
      setCallableBusy(-1);
      endActionButtonBusy(actionButton);
    }
  }

  window.SkyDreamFirebase = { functions, auth, call, friendlyError, ensureAppCheckToken };
})();
