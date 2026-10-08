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
const RECOVERY_COLLECTION = 'sdta_admin_recovery_codes';
const RECOVERY_CODE_COUNT = 10;

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

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { passwordHash: hash, passwordSalt: salt, passwordVersion: 1 };
}

function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function recoveryHash(salt, code) {
  return crypto.createHash('sha256').update(String(salt) + '|' + normalizeRecoveryCode(code)).digest('hex');
}

function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let body = '';
  for (let i = 0; i < 16; i++) body += alphabet[crypto.randomInt(0, alphabet.length)];
  return 'SKY-' + body.slice(0, 4) + '-' + body.slice(4, 8) + '-' + body.slice(8, 12) + '-' + body.slice(12, 16);
}

async function ownerAccountFromRequest(request) {
  const { account } = await requireStrongAdminSession(request);
  if ((account.role || 'staff') !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the main administrator can manage recovery codes.');
  }
  return account;
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

// Secure owner recovery. Recovery codes are generated only from an authenticated
// owner session, stored only as salted hashes, and each code can be used once.
app.adminGetRecoveryCodeStatus = onCall({ enforceAppCheck: true }, async request => {
  const account = await ownerAccountFromRequest(request);
  const snap = await db.collection(RECOVERY_COLLECTION).doc(account.id).get();
  if (!snap.exists) return { configured: false, remaining: 0, generatedAt: '', lastUsedAt: '' };
  const d = snap.data() || {};
  const hashes = Array.isArray(d.hashes) ? d.hashes : [];
  return {
    configured: hashes.length > 0,
    remaining: hashes.length,
    generatedAt: clean(d.generatedAt, 80),
    lastUsedAt: clean(d.lastUsedAt, 80)
  };
});

app.adminGenerateRecoveryCodes = onCall({ enforceAppCheck: true }, async request => {
  const account = await ownerAccountFromRequest(request);
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const salt = crypto.randomBytes(16).toString('hex');
  const hashes = codes.map(code => recoveryHash(salt, code));
  await db.collection(RECOVERY_COLLECTION).doc(account.id).set({
    username: account.username,
    salt,
    hashes,
    generatedAt: new Date().toISOString(),
    lastUsedAt: ''
  });
  return { codes, remaining: codes.length, generatedAt: new Date().toISOString() };
});

app.adminRecoverWithCode = onCall({ enforceAppCheck: true }, async request => {
  const username = clean(request.data && request.data.username, 80);
  const code = normalizeRecoveryCode(request.data && request.data.recoveryCode);
  const newPassword = String(request.data && request.data.newPassword || '');

  await enforceRateLimit(request, 'admin-recovery-user', username || 'blank', 5, 30 * 60 * 1000);
  await enforceRateLimit(request, 'admin-recovery-ip', 'all-admin-recovery', 15, 30 * 60 * 1000);

  if (!username || code.length < 12 || !strongAdminPassword(newPassword)) {
    throw new HttpsError(
      'failed-precondition',
      'Enter your owner username, a valid recovery code, and a new password of at least 12 characters with uppercase, lowercase and a number.'
    );
  }

  const adminsRef = db.collection(STORAGE_COLLECTION).doc('sdta_admins');
  const sessionsRef = db.collection(STORAGE_COLLECTION).doc('sdta_admin_sessions');
  let recoveredAccount = null;

  await db.runTransaction(async tx => {
    const adminsSnap = await tx.get(adminsRef);
    const admins = adminsSnap.exists ? parseJson(adminsSnap.data().value, []) : [];
    const account = Array.isArray(admins)
      ? admins.find(a => String(a.username || '').toLowerCase() === username.toLowerCase() && (a.role || 'staff') === 'owner')
      : null;

    // Use one generic failure path to avoid revealing whether an owner username exists.
    if (!account || !account.id) throw new HttpsError('permission-denied', 'Recovery details are not valid.');

    const recoveryRef = db.collection(RECOVERY_COLLECTION).doc(account.id);
    const auditRef = db.collection(STORAGE_COLLECTION).doc('sdta_activity_log');
    const [recoverySnap, sessionsSnap, auditSnap] = await Promise.all([
      tx.get(recoveryRef),
      tx.get(sessionsRef),
      tx.get(auditRef)
    ]);
    const recovery = recoverySnap.exists ? recoverySnap.data() : null;
    const hashes = recovery && Array.isArray(recovery.hashes) ? recovery.hashes : [];
    const candidate = recovery ? recoveryHash(recovery.salt, code) : '';
    const index = hashes.findIndex(h => h === candidate);
    if (!recovery || index < 0) throw new HttpsError('permission-denied', 'Recovery details are not valid.');

    const nextHashes = hashes.slice();
    nextHashes.splice(index, 1);
    Object.assign(account, makePasswordRecord(newPassword));
    delete account.pinHash;
    delete account.recoveryHash;
    delete account.lockedUntil;
    account.failedLogins = 0;
    account.passwordRecoveredAt = new Date().toISOString();

    const sessions = sessionsSnap.exists ? parseJson(sessionsSnap.data().value, []) : [];
    if (Array.isArray(sessions)) {
      sessions.forEach(s => {
        if (String(s.username || '').toLowerCase() === username.toLowerCase() && !s.revoked) {
          s.revoked = true;
          s.revokedAt = new Date().toISOString();
          s.revokedBy = 'recovery';
        }
      });
    }

    let audit = auditSnap.exists ? parseJson(auditSnap.data().value, []) : [];
    if (!Array.isArray(audit)) audit = [];
    audit.push({
      id: 'audit_' + crypto.randomUUID(),
      date: new Date().toISOString(),
      admin: account.username,
      role: 'owner',
      action: 'Recovered owner password with one-time code',
      target: account.username,
      detail: 'All existing admin sessions were revoked.'
    });
    if (audit.length > 1000) audit = audit.slice(-1000);

    tx.set(adminsRef, { value: JSON.stringify(admins) });
    tx.set(recoveryRef, {
      ...recovery,
      hashes: nextHashes,
      lastUsedAt: new Date().toISOString()
    });
    tx.set(sessionsRef, { value: JSON.stringify(Array.isArray(sessions) ? sessions : []) });
    tx.set(auditRef, { value: JSON.stringify(audit) });

    recoveredAccount = { id: account.id, username: account.username, remaining: nextHashes.length };
  });

  if (recoveredAccount) {
    try { await admin.auth().revokeRefreshTokens('admin-' + recoveredAccount.id); } catch (_) {}
  }

  return { ok: true, remainingCodes: recoveredAccount ? recoveredAccount.remaining : 0 };
});

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
const PRE_AUTH_ADMIN_CALLS = new Set(['adminLogin', 'adminVerifyTwoFactorLogin', 'adminRecoverWithCode']);
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
