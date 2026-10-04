(() => {
  function patch() {
    if (!window.SkyDreamFirebase || window.SkyDreamFirebase.__enterpriseLoginPatched) return false;
    const original = window.SkyDreamFirebase.call.bind(window.SkyDreamFirebase);
    window.SkyDreamFirebase.call = async function(name, data) {
      let payload = data || {};

      // A small number of browsers occasionally omit the callable auth context
      // on facilitator-management requests. Attach the current Firebase ID token
      // as a verified fallback; the backend still validates the token, owner role
      // and protected admin session before allowing the action.
      if (name === 'adminCreateFacilitator' || name === 'adminSetFacilitatorPin') {
        const user = window.SkyDreamFirebase.auth && window.SkyDreamFirebase.auth.currentUser;
        if (!user) throw new Error('Your administrator session is not active. Sign out and sign in again.');
        const adminIdToken = await user.getIdToken(true);
        payload = { ...payload, adminIdToken };
      }

      const result = await original(name, payload);
      if (name === 'adminLogin' && result && result.twoFactorRequired) {
        const code = prompt('Enter the 6-digit code from your authenticator app:');
        if (code === null) throw new Error('Two-step verification was cancelled.');
        return original('adminVerifyTwoFactorLogin', { challengeId: result.challengeId, code: String(code).trim() });
      }
      return result;
    };
    window.SkyDreamFirebase.__enterpriseLoginPatched = true;
    return true;
  }
  if (!patch()) {
    const timer = setInterval(() => { if (patch()) clearInterval(timer); }, 20);
    setTimeout(() => clearInterval(timer), 5000);
  }
})();
