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
    }
  }

  window.SkyDreamFirebase = { functions, auth, call, friendlyError, ensureAppCheckToken };
})();
