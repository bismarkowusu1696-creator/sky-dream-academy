(() => {
  function patch() {
    if (!window.SkyDreamFirebase || window.SkyDreamFirebase.__enterpriseLoginPatched) return false;
    const original = window.SkyDreamFirebase.call.bind(window.SkyDreamFirebase);
    window.SkyDreamFirebase.call = async function(name, data) {
      const result = await original(name, data);
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
