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

  if (!window.firebase) {
    console.error('Firebase SDK did not load.');
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);

  try {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    if (firebase.appCheck) {
      const appCheck = firebase.appCheck();
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

  function friendlyError(err) {
    const raw = err && err.message ? String(err.message) : 'Something went wrong. Please try again.';
    return raw.replace(/^Firebase:\s*/i, '').replace(/^functions\/[a-z-]+\s*/i, '').trim();
  }

  async function call(name, data = {}) {
    const callable = functions.httpsCallable(name);
    const result = await callable(data);
    return result.data;
  }

  window.SkyDreamFirebase = { functions, auth, call, friendlyError };
})();
