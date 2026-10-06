'use strict';

// Final security boundary for production Cloud Functions.
//
// This layer intentionally leaves the public checkStudentStatus flow unchanged,
// while hardening administrator authentication, stale recovery/setup paths,
// session validation, and login abuse controls.
const app = require('./facilitator-auth-fix-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE_COLLECTION = 'sdta_storage';
const RATE_LIMIT_COLLECTION = 'sdta_security_rate_limits';
const ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
};
const clean = (value, max = 160) => String(value == null ? '' : value).trim().slice(0, max);

async function readStorage(key, fallback) {
  const snap = await db.collection(STORAGE_COLLECTION).doc(key).get();
  return snap.exists ? parseJson(snap.data().value, fallback) : fallback;
}

function requestIp(request) {
  const raw = request && request.rawRequest;
  if (!raw) return 'unknown';
  if (raw.ip) return clean(raw.ip, 120);
  const forwarded = raw.headers && raw.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length) return clean(forwarded[0], 120).split(',')[0].trim();
  if (forwarded) return clean(forwarded, 120).split(',')[0].trim();
  return clean(raw.socket && raw.socket.remoteAddress, 120) || 'unknown';
}

async function enforceRateLimit(request, kind, subject, maxRequests, windowMs) {
  const ip = requestIp(request);
  const key = `${kind}|${clean(subject, 160).toLowerCase()}|${ip}`;
  const id = crypto.createHash('sha256').update(key).digest('hex');
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(id);
  const now = Date.now();

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : {};
    let windowStart = Number(current.windowStart) || now;
    let count = Number(current.count) || 0;
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (count >= maxRequests) {
      throw new HttpsError('resource-exhausted', 'Too many attempts. Please wait and try again.');
    }
    tx.set(ref, {
      kind,
      windowStart,
      count: count + 1,
      expiresAt: admin.firestore.Timestamp.fromMillis(windowStart + (windowMs * 2))
    }, { merge: true });
  });
}

function strongAdminPassword(value) {
  const password = String(value || '');
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

async function resolveAdminAuth(request) {
  const direct = request && request.auth;
  if (direct && direct.uid && direct.token && direct.token.role === 'admin') return direct;

  const explicit = clean(request && request.data && request.data.adminIdToken, 5000);
  if (!explicit) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(explicit);
    if (!decoded.uid || decoded.role !== 'admin') return null;
    return { uid: decoded.uid, token: decoded };
  } catch (_) {
    return null;
  }
}

async function requireStrongAdminSession(request) {
  const auth = await resolveAdminAuth(request);
  const token = auth && auth.token;
  if (!auth || !token || token.role !== 'admin' || !token.username || !token.sessionId) {
    throw new HttpsError('permission-denied', 'A protected administrator session is required. Please sign in again.');
  }

  const [admins, sessions] = await Promise.all([
    readStorage('sdta_admins', []),
    readStorage('sdta_admin_sessions', [])
  ]);
  const username = String(token.username).toLowerCase();
  const account = Array.isArray(admins)
    ? admins.find(a => String(a.username || '').toLowerCase() === username)
    : null;
  if (!account || auth.uid !== 'admin-' + account.id) {
    throw new HttpsError('permission-denied', 'This administrator account is no longer active.');
  }

  const session = Array.isArray(sessions)
    ? sessions.find(s => s.id === token.sessionId && String(s.username || '').toLowerCase() === username)
    : null;
  if (!session || session.revoked) {
    throw new HttpsError('permission-denied', 'This administrator session has been signed out. Please log in again.');
  }

  const created = new Date(session.createdAt || 0).getTime();
  if (!Number.isFinite(created) || created <= 0 || Date.now() - created > ADMIN_SESSION_MAX_AGE_MS) {
    throw new HttpsError('permission-denied', 'This administrator session expired. Please sign in again.');
  }

  return { account, auth };
}

function delegatedRequest(request, auth) {
  const data = { ...(request.data || {}) };
  delete data.adminIdToken;
  return {
    data,
    auth,
    app: request.app,
    rawRequest: request.rawRequest,
    instanceIdToken: request.instanceIdToken
  };
}

async function removeLegacyRecoveryMaterial() {
  const adminsRef = db.collection(STORAGE_COLLECTION).doc('sdta_admins');
  const legacyRef = db.collection(STORAGE_COLLECTION).doc('sdta_admin');
  await db.runTransaction(async tx => {
    const snap = await tx.get(adminsRef);
    if (!snap.exists) return;
    const list = parseJson(snap.data().value, []);
    if (!Array.isArray(list) || !list.length) return;

    let changed = false;
    for (const account of list) {
      if (Object.prototype.hasOwnProperty.call(account, 'recoveryHash')) {
        delete account.recoveryHash;
        changed = true;
      }
      // Once an account has a modern scrypt password record, any old PIN hash
      // is obsolete and should not remain as an alternate credential.
      if (account.passwordHash && account.pinHash) {
        delete account.pinHash;
        changed = true;
      }
    }
    if (changed) tx.set(adminsRef, { value: JSON.stringify(list) });

    const modernOwnerExists = list.some(a => (a.role || 'staff') === 'owner' && a.passwordHash && a.passwordSalt);
    if (modernOwnerExists) tx.delete(legacyRef);
  });
}

// Administrator sign-in now requires the modern password format. Old numeric
// PIN authentication is deliberately disabled instead of remaining as a weak
// fallback credential.
const baseAdminLogin = app.adminLogin;
app.adminLogin = onCall({ enforceAppCheck: true }, async request => {
  const username = clean(request.data && request.data.username, 80);
  const password = String(request.data && request.data.password || '');
  await enforceRateLimit(request, 'admin-login-user', username || 'blank', 12, 15 * 60 * 1000);
  await enforceRateLimit(request, 'admin-login-ip', 'all-admin-users', 50, 15 * 60 * 1000);

  if (!username || !strongAdminPassword(password)) {
    throw new HttpsError(
      'failed-precondition',
      'Administrator PIN sign-in has been disabled. Use your strong administrator password (at least 12 characters with uppercase, lowercase and a number).'
    );
  }
  if (!baseAdminLogin || typeof baseAdminLogin.run !== 'function') {
    throw new HttpsError('internal', 'Administrator login is unavailable.');
  }

  const result = await baseAdminLogin.run(request);
  if (result && result.upgradeRequired) {
    throw new HttpsError('failed-precondition', 'Legacy administrator PIN accounts are disabled. A modern password must be provisioned by an authenticated owner.');
  }
  if (result && result.account) {
    await removeLegacyRecoveryMaterial();
  }
  return result;
});

// The former PIN-migration endpoint is no longer an anonymous recovery path.
app.upgradeAdminPassword = onCall({ enforceAppCheck: true }, async () => {
  throw new HttpsError(
    'failed-precondition',
    'Legacy administrator PIN migration has been disabled. Sign in with your administrator password or have the authenticated owner create/reset the account securely.'
  );
});

// Rate-limit the unauthenticated second factor step. The underlying handler
// still verifies the short-lived challenge and TOTP before issuing a session.
const baseVerifyTwoFactor = app.adminVerifyTwoFactorLogin;
if (baseVerifyTwoFactor && typeof baseVerifyTwoFactor.run === 'function') {
  app.adminVerifyTwoFactorLogin = onCall({ enforceAppCheck: true }, async request => {
    const challengeId = clean(request.data && request.data.challengeId, 160);
    await enforceRateLimit(request, 'admin-2fa', challengeId || 'blank', 8, 10 * 60 * 1000);
    return baseVerifyTwoFactor.run(request);
  });
}

// Facilitators intentionally keep their 4-digit PIN UX. Add an outer abuse
// limit so attackers cannot spray PIN guesses across many usernames.
const baseFacilitatorLogin = app.facilitatorLogin;
if (baseFacilitatorLogin && typeof baseFacilitatorLogin.run === 'function') {
  app.facilitatorLogin = onCall({ enforceAppCheck: true }, async request => {
    const username = clean(request.data && request.data.username, 80);
    await enforceRateLimit(request, 'facilitator-login-user', username || 'blank', 8, 15 * 60 * 1000);
    await enforceRateLimit(request, 'facilitator-login-ip', 'all-facilitators', 40, 15 * 60 * 1000);
    return baseFacilitatorLogin.run(request);
  });
}

// Apply one final session check to every exported administrator callable, even
// if a future feature forgets to add its own authorization wrapper.
const PRE_AUTH_ADMIN_CALLS = new Set(['adminLogin', 'adminVerifyTwoFactorLogin']);
for (const name of Object.keys(app)) {
  const isAdminCallable = name === 'getAdminSnapshot' || name === 'sendCustomSms' || name.startsWith('admin');
  if (!isAdminCallable || PRE_AUTH_ADMIN_CALLS.has(name)) continue;
  const base = app[name];
  if (!base || typeof base.run !== 'function') continue;

  app[name] = onCall({ enforceAppCheck: true }, async request => {
    const { auth } = await requireStrongAdminSession(request);
    return base.run(delegatedRequest(request, auth));
  });
}

// Current production no longer exposes first-admin creation or anonymous
// account reset. Keep explicit blockers for legacy callable names so an old
// deployment cannot accidentally reintroduce those flows during a rollback.
for (const legacyName of [
  'setupAdmin',
  'createFirstAdmin',
  'bootstrapAdmin',
  'resetAdmin',
  'recoverAdmin',
  'resetAdminAccount'
]) {
  app[legacyName] = onCall({ enforceAppCheck: true }, async () => {
    throw new HttpsError('permission-denied', 'Legacy administrator setup and recovery are disabled.');
  });
}

// checkStudentStatus is intentionally not wrapped or changed here, per the
// requested compatibility requirement.
module.exports = app;
