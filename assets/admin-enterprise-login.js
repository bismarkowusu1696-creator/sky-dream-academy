(() => {
  let authReady = null;
  let adminSnapshotInFlight = null;

  function prepareAuth() {
    if (authReady) return authReady;
    authReady = (async () => {
      const auth = window.SkyDreamFirebase && window.SkyDreamFirebase.auth;
      if (auth && window.firebase && firebase.auth && firebase.auth.Auth) {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      }
      try {
        if (window.SkyDreamFirebase && window.SkyDreamFirebase.ensureAppCheckToken) {
          await window.SkyDreamFirebase.ensureAppCheckToken();
        }
      } catch (_) {
        // The normal callable request will show the real security error if App
        // Check still cannot initialize. This warm-up just makes first login faster.
      }
    })().catch(err => {
      authReady = null;
      throw err;
    });
    return authReady;
  }

  function setLoginBusy(busy) {
    const btn = document.querySelector('#adminLoginForm button[type="submit"]');
    if (!btn) return;
    if (!btn.dataset.normalText) btn.dataset.normalText = btn.textContent || 'Sign in';
    btn.disabled = busy;
    btn.textContent = busy ? 'Signing in…' : btn.dataset.normalText;
  }

  function patch() {
    if (!window.SkyDreamFirebase || window.SkyDreamFirebase.__enterpriseLoginPatched) return false;
    const original = window.SkyDreamFirebase.call.bind(window.SkyDreamFirebase);

    // Prepare Firebase Auth + App Check before the user presses Sign in.
    prepareAuth().catch(() => {});

    window.SkyDreamFirebase.call = async function(name, data) {
      let payload = data || {};
      const isAdminLogin = name === 'adminLogin';

      if (name.startsWith('admin') || name === 'getAdminSnapshot') {
        await prepareAuth();
      }

      // The direct sign-in path and auth-state observer can both ask for the
      // first dashboard snapshot at the same moment. Share one request instead
      // of racing two protected calls during the authentication transition.
      if (name === 'getAdminSnapshot' && adminSnapshotInFlight) {
        return adminSnapshotInFlight;
      }

      if (isAdminLogin) setLoginBusy(true);

      try {
        // Attach the current Firebase ID token as a verified fallback for the
        // facilitator-management actions that require owner authentication.
        if (name === 'adminCreateFacilitator' || name === 'adminSetFacilitatorPin') {
          const user = window.SkyDreamFirebase.auth && window.SkyDreamFirebase.auth.currentUser;
          if (!user) throw new Error('Your administrator session is not active. Sign out and sign in again.');
          const adminIdToken = await user.getIdToken(true);
          payload = { ...payload, adminIdToken };
        }

        let requestPromise = original(name, payload);
        if (name === 'getAdminSnapshot') {
          adminSnapshotInFlight = requestPromise.finally(() => {
            adminSnapshotInFlight = null;
          });
          requestPromise = adminSnapshotInFlight;
        }

        const result = await requestPromise;
        if (name === 'adminLogin' && result && result.twoFactorRequired) {
          const code = prompt('Enter the 6-digit code from your authenticator app:');
          if (code === null) throw new Error('Two-step verification was cancelled.');
          return original('adminVerifyTwoFactorLogin', { challengeId: result.challengeId, code: String(code).trim() });
        }
        return result;
      } finally {
        if (isAdminLogin) setLoginBusy(false);
      }
    };

    window.SkyDreamFirebase.__enterpriseLoginPatched = true;
    return true;
  }

  if (!patch()) {
    const timer = setInterval(() => { if (patch()) clearInterval(timer); }, 20);
    setTimeout(() => clearInterval(timer), 5000);
  }
})();
