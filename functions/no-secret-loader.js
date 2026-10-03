// Production loader for deployments where SMS/Twilio is intentionally disabled.
// Some legacy modules still declare Twilio secrets while they are imported.
// Firebase inspects those declarations during deployment even though the no-SMS
// entrypoint overrides the SMS handlers. This loader removes secret bindings
// before loading the application so Secret Manager is not required at all.

const https = require('firebase-functions/v2/https');
const params = require('firebase-functions/params');

const realOnCall = https.onCall;

function onCallWithoutSecrets(optionsOrHandler, maybeHandler) {
  if (typeof optionsOrHandler === 'function') {
    return realOnCall(optionsOrHandler);
  }

  const options = { ...(optionsOrHandler || {}) };
  delete options.secrets;
  return realOnCall(options, maybeHandler);
}

// CommonJS exports are normally writable, but define them explicitly so the
// override also works if the package exposes them through accessors.
try {
  Object.defineProperty(https, 'onCall', {
    value: onCallWithoutSecrets,
    writable: true,
    configurable: true
  });
} catch (_) {
  https.onCall = onCallWithoutSecrets;
}

const disabledSecret = name => ({
  name,
  value() {
    throw new Error(`Secret ${name} is disabled because SMS is not configured.`);
  }
});

try {
  Object.defineProperty(params, 'defineSecret', {
    value: disabledSecret,
    writable: true,
    configurable: true
  });
} catch (_) {
  params.defineSecret = disabledSecret;
}

const app = require('./no-sms-index');
const admin = require('firebase-admin');
const crypto = require('crypto');
const db = admin.firestore();

const originalAdminLogin = app.adminLogin;
const originalFacilitatorLogin = app.facilitatorLogin;

const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
};

function passwordIsStrong(value) {
  const p = String(value || '');
  return p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
}

function facilitatorPinIsValid(value) {
  return /^[0-9]{4}$/.test(String(value || ''));
}

// The facilitator-facing credential remains a simple 4-digit PIN. Internally
// it is expanded before being passed to the existing scrypt password verifier,
// so the stored record is still salted and hashed instead of storing the PIN.
function facilitatorSecretFromPin(pin) {
  return `SkyDream-Facilitator-${String(pin)}-Aa9!`;
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { passwordHash: hash, passwordSalt: salt, passwordVersion: 1 };
}

async function assertBoundMembership(request, kind) {
  const auth = request.auth;
  const token = auth && auth.token;
  const isAdmin = kind === 'admin';
  const expectedRole = isAdmin ? 'admin' : 'facilitator';

  if (!auth || !auth.uid || !token || token.role !== expectedRole || !token.username) {
    throw new https.HttpsError('permission-denied', isAdmin ? 'Administrator access is required.' : 'Facilitator access is required.');
  }

  const key = isAdmin ? 'sdta_admins' : 'sdta_facilitators';
  const snap = await db.collection('sdta_storage').doc(key).get();
  const list = snap.exists ? parseJson(snap.data().value, []) : [];
  const username = String(token.username).toLowerCase();
  const account = list.find(item => String(item.username || '').toLowerCase() === username);

  if (!account || !account.id) {
    throw new https.HttpsError('permission-denied', isAdmin ? 'This administrator account is no longer active.' : 'This facilitator account is no longer active.');
  }

  const expectedUid = (isAdmin ? 'admin-' : 'fac-') + account.id;
  if (auth.uid !== expectedUid) {
    throw new https.HttpsError('permission-denied', 'This session is no longer valid. Please sign in again.');
  }

  return account;
}

function wrapBound(callable, kind) {
  return realOnCall({ enforceAppCheck: true }, async request => {
    await assertBoundMembership(request, kind);
    if (!callable || typeof callable.run !== 'function') {
      throw new https.HttpsError('internal', 'Server handler is unavailable.');
    }
    return callable.run(request);
  });
}

// Legacy PIN migration is retained only for administrator accounts.
function wrapLegacyUpgrade(loginCallable, kind) {
  return realOnCall({ enforceAppCheck: true }, async request => {
    const data = request.data || {};
    const username = String(data.username || '').trim().slice(0, 80);
    const currentPin = String(data.currentPin || '');
    const newPassword = String(data.newPassword || '');
    const isAdmin = kind === 'admin';

    if (!username || !passwordIsStrong(newPassword)) {
      throw new https.HttpsError('invalid-argument', 'Use at least 12 characters with uppercase, lowercase and a number.');
    }
    if (!loginCallable || typeof loginCallable.run !== 'function') {
      throw new https.HttpsError('internal', 'Login verifier is unavailable.');
    }

    const verified = await loginCallable.run({
      ...request,
      data: { username, password: currentPin }
    });

    if (!verified || !verified.account) {
      throw new https.HttpsError('permission-denied', 'Current PIN verification failed.');
    }

    if (!verified.upgradeRequired) {
      if (verified.token) return { token: verified.token, account: verified.account };
      throw new https.HttpsError('failed-precondition', 'This account has already been upgraded. Sign in with the new password.');
    }

    const key = isAdmin ? 'sdta_admins' : 'sdta_facilitators';
    const ref = db.collection('sdta_storage').doc(key);
    let account = null;

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const list = snap.exists ? parseJson(snap.data().value, []) : [];
      account = list.find(item => item.id === verified.account.id &&
        String(item.username || '').toLowerCase() === username.toLowerCase());

      if (!account) {
        throw new https.HttpsError('permission-denied', 'This account is no longer active.');
      }
      if (account.passwordHash) {
        throw new https.HttpsError('failed-precondition', 'This account has already been upgraded. Sign in with the new password.');
      }
      if (!account.pinHash) {
        throw new https.HttpsError('permission-denied', 'Current PIN verification failed.');
      }

      Object.assign(account, makePasswordRecord(newPassword));
      delete account.pinHash;
      account.failedLogins = 0;
      delete account.lockedUntil;
      tx.set(ref, { value: JSON.stringify(list) });
    });

    const uid = (isAdmin ? 'admin-' : 'fac-') + account.id;
    const claims = isAdmin
      ? { role: 'admin', adminRole: account.role || 'staff', username: account.username }
      : { role: 'facilitator', username: account.username };
    const token = await admin.auth().createCustomToken(uid, claims);

    const safeAccount = isAdmin
      ? { id: account.id, name: account.name, username: account.username, role: account.role || 'staff' }
      : { id: account.id, name: account.name, username: account.username, phone: account.phone || '', courses: Array.isArray(account.courses) ? account.courses : [] };

    return { token, account: safeAccount };
  });
}

function wrapNextIntake(callable) {
  return realOnCall({ enforceAppCheck: true }, async request => {
    await assertBoundMembership(request, 'admin');
    const nextStart = String(request.data && request.data.startDate || '').trim();
    const intakeSnap = await db.collection('sdta_storage').doc('sdta_intake').get();
    const current = intakeSnap.exists ? parseJson(intakeSnap.data().value, {}) : {};
    if (current.startDate && nextStart && nextStart <= current.startDate) {
      throw new https.HttpsError('invalid-argument', 'The next intake must start after the current intake.');
    }
    if (!callable || typeof callable.run !== 'function') {
      throw new https.HttpsError('internal', 'Server handler is unavailable.');
    }
    return callable.run(request);
  });
}

[
  'getAdminSnapshot',
  'adminUpdateStudent',
  'adminAddPayment',
  'adminDeleteStudent',
  'adminSetCapacity',
  'adminCreateFacilitator',
  'adminDeleteFacilitator',
  'adminCreateAdmin',
  'adminDeleteAdmin',
  'adminChangePassword',
  'sendCustomSms'
].forEach(name => {
  app[name] = wrapBound(app[name], 'admin');
});

// New facilitator accounts are created with a 4-digit PIN. The existing
// facilitator creation handler still gets a strong internal secret so no plain
// PIN or reversible PIN value is stored in Firestore.
const securedCreateFacilitator = app.adminCreateFacilitator;
app.adminCreateFacilitator = realOnCall({ enforceAppCheck: true }, async request => {
  const data = request.data || {};
  const pin = String(data.pin || data.password || '');
  if (!facilitatorPinIsValid(pin)) {
    throw new https.HttpsError('invalid-argument', 'Facilitator PIN must be exactly 4 digits.');
  }
  return securedCreateFacilitator.run({
    ...request,
    data: { ...data, password: facilitatorSecretFromPin(pin) }
  });
});

// Main administrators can reset any facilitator to a new 4-digit PIN.
app.adminSetFacilitatorPin = realOnCall({ enforceAppCheck: true }, async request => {
  const adminAccount = await assertBoundMembership(request, 'admin');
  if ((adminAccount.role || 'staff') !== 'owner') {
    throw new https.HttpsError('permission-denied', 'Main administrator access is required.');
  }

  const data = request.data || {};
  const id = String(data.id || '').trim();
  const pin = String(data.pin || '');
  if (!id || !facilitatorPinIsValid(pin)) {
    throw new https.HttpsError('invalid-argument', 'Choose a facilitator and enter exactly 4 digits.');
  }

  const ref = db.collection('sdta_storage').doc('sdta_facilitators');
  let found = false;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const account = list.find(item => item.id === id);
    if (!account) {
      throw new https.HttpsError('not-found', 'Facilitator account not found.');
    }
    Object.assign(account, makePasswordRecord(facilitatorSecretFromPin(pin)));
    delete account.pinHash;
    account.failedLogins = 0;
    delete account.lockedUntil;
    tx.set(ref, { value: JSON.stringify(list) });
    found = true;
  });

  if (found) {
    try { await admin.auth().revokeRefreshTokens('fac-' + id); } catch (_) {}
  }
  return { ok: true };
});

// Facilitators sign in with exactly four digits. Old legacy PIN accounts are
// migrated automatically the first time their PIN is successfully verified.
app.facilitatorLogin = realOnCall({ enforceAppCheck: true }, async request => {
  const data = request.data || {};
  const username = String(data.username || '').trim().slice(0, 80);
  const pin = String(data.pin || data.password || '');
  if (!username || !facilitatorPinIsValid(pin)) {
    throw new https.HttpsError('invalid-argument', 'Username and 4-digit PIN are required.');
  }

  const ref = db.collection('sdta_storage').doc('sdta_facilitators');
  const snap = await ref.get();
  const list = snap.exists ? parseJson(snap.data().value, []) : [];
  const accountBefore = list.find(item => String(item.username || '').toLowerCase() === username.toLowerCase());
  const verifierSecret = accountBefore && accountBefore.pinHash ? pin : facilitatorSecretFromPin(pin);

  const verified = await originalFacilitatorLogin.run({
    ...request,
    data: { username, password: verifierSecret }
  });

  if (!verified || !verified.account) return verified;
  if (!verified.upgradeRequired) return verified;

  let account = null;
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    const current = latest.exists ? parseJson(latest.data().value, []) : [];
    account = current.find(item => item.id === verified.account.id &&
      String(item.username || '').toLowerCase() === username.toLowerCase());
    if (!account || !account.pinHash) {
      throw new https.HttpsError('permission-denied', 'PIN verification failed.');
    }
    Object.assign(account, makePasswordRecord(facilitatorSecretFromPin(pin)));
    delete account.pinHash;
    account.failedLogins = 0;
    delete account.lockedUntil;
    tx.set(ref, { value: JSON.stringify(current) });
  });

  const token = await admin.auth().createCustomToken('fac-' + account.id, {
    role: 'facilitator',
    username: account.username
  });
  return {
    token,
    account: {
      id: account.id,
      name: account.name,
      username: account.username,
      phone: account.phone || '',
      courses: Array.isArray(account.courses) ? account.courses : []
    }
  };
});

app.upgradeAdminPassword = wrapLegacyUpgrade(originalAdminLogin, 'admin');
// Facilitator password upgrades are intentionally disabled: facilitators use 4-digit PINs.
app.upgradeFacilitatorPassword = realOnCall({ enforceAppCheck: true }, async () => {
  throw new https.HttpsError('failed-precondition', 'Facilitators now use a 4-digit PIN. Ask the main administrator to reset your PIN if needed.');
});
app.adminStartNextIntake = wrapNextIntake(app.adminStartNextIntake);

['getFacilitatorDashboard', 'markFacilitatorAttendance'].forEach(name => {
  app[name] = wrapBound(app[name], 'facilitator');
});

module.exports = app;
