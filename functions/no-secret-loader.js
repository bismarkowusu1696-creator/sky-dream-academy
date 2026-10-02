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
const db = admin.firestore();

const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
};

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
  'adminStartNextIntake',
  'sendCustomSms'
].forEach(name => {
  app[name] = wrapBound(app[name], 'admin');
});

['getFacilitatorDashboard', 'markFacilitatorAttendance'].forEach(name => {
  app[name] = wrapBound(app[name], 'facilitator');
});

module.exports = app;
