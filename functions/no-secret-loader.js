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

// Legacy PIN migration uses the exact same login verifier that just accepted
// the PIN. This avoids a second, conflicting legacy-PIN verification path.
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

    // If another request already completed the migration, the normal login
    // handler can return a final token; let the user continue safely.
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

app.upgradeAdminPassword = wrapLegacyUpgrade(originalAdminLogin, 'admin');
app.upgradeFacilitatorPassword = wrapLegacyUpgrade(originalFacilitatorLogin, 'facilitator');
app.adminStartNextIntake = wrapNextIntake(app.adminStartNextIntake);

['getFacilitatorDashboard', 'markFacilitatorAttendance'].forEach(name => {
  app[name] = wrapBound(app[name], 'facilitator');
});

module.exports = app;
