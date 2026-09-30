// Production entrypoint. It loads the main API and replaces the two login
// handlers with versions that persist failed-attempt lockouts before returning
// an authentication error.
const existing = require('./index');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE_COLLECTION = 'sdta_storage';
const ADMINS_KEY = 'sdta_admins';
const LEGACY_ADMIN_KEY = 'sdta_admin';
const FACILITATORS_KEY = 'sdta_facilitators';
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

const refFor = key => db.collection(STORAGE_COLLECTION).doc(key);
const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
};
const cleanString = (value, max = 100) => String(value == null ? '' : value).trim().slice(0, max);
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function verifyPassword(password, account) {
  if (!account || !account.passwordHash || !account.passwordSalt) return false;
  try {
    const expected = Buffer.from(account.passwordHash, 'hex');
    const actual = crypto.scryptSync(String(password), account.passwordSalt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function verifyLegacyPin(pin, account) {
  return !!(account && account.pinHash && /^[0-9]{4,8}$/.test(String(pin || '')) && sha256(pin) === account.pinHash);
}

function minutesLocked(account) {
  if (!account || !account.lockedUntil) return 0;
  const ms = new Date(account.lockedUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

function failAccount(account) {
  account.failedLogins = (Number(account.failedLogins) || 0) + 1;
  if (account.failedLogins >= LOGIN_LOCKOUT_THRESHOLD) {
    account.failedLogins = 0;
    account.lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60000).toISOString();
  }
}

function clearAccountFailure(account) {
  account.failedLogins = 0;
  delete account.lockedUntil;
}

async function migrateLegacyAdminIfNeeded() {
  const adminsRef = refFor(ADMINS_KEY);
  const adminsSnap = await adminsRef.get();
  const admins = adminsSnap.exists ? parseJson(adminsSnap.data().value, []) : [];
  if (admins.length) return;
  const legacySnap = await refFor(LEGACY_ADMIN_KEY).get();
  const legacy = legacySnap.exists ? parseJson(legacySnap.data().value, null) : null;
  if (!legacy || !legacy.username || !legacy.pinHash) return;
  await adminsRef.set({
    value: JSON.stringify([{
      id: 'adm_' + crypto.randomUUID(),
      name: legacy.name || legacy.username,
      username: legacy.username,
      pinHash: legacy.pinHash,
      recoveryHash: legacy.recoveryHash || '',
      role: 'owner'
    }])
  });
}

async function secureLogin({ username, secret, key, kind }) {
  const ref = refFor(key);
  let outcome = { type: 'invalid' };

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (kind === 'admin' && list.length && !list.some(a => a.role === 'owner')) list[0].role = 'owner';
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account) {
      outcome = { type: 'invalid' };
      return;
    }

    const locked = minutesLocked(account);
    if (locked) {
      outcome = { type: 'locked', minutes: locked };
      return;
    }

    const modernOk = verifyPassword(secret, account);
    const legacyOk = !account.passwordHash && verifyLegacyPin(secret, account);
    if (!modernOk && !legacyOk) {
      failAccount(account);
      tx.set(ref, { value: JSON.stringify(list) });
      const nowLocked = minutesLocked(account);
      outcome = nowLocked ? { type: 'locked', minutes: nowLocked } : { type: 'invalid' };
      return;
    }

    clearAccountFailure(account);
    tx.set(ref, { value: JSON.stringify(list) });
    outcome = {
      type: 'ok',
      upgradeRequired: legacyOk,
      account: kind === 'admin'
        ? { id: account.id, name: account.name, username: account.username, role: account.role || 'staff' }
        : { id: account.id, name: account.name, username: account.username, phone: account.phone || '', courses: Array.isArray(account.courses) ? account.courses : [] }
    };
  });

  if (outcome.type === 'locked') {
    throw new HttpsError('resource-exhausted', `Account temporarily locked. Try again in about ${outcome.minutes} minute(s).`);
  }
  if (outcome.type !== 'ok') {
    throw new HttpsError('permission-denied', 'Invalid username or password.');
  }
  return outcome;
}

const adminLogin = onCall({ enforceAppCheck: true }, async request => {
  const username = cleanString(request.data && request.data.username, 80);
  const secret = String((request.data && request.data.password) || '');
  if (!username || !secret) throw new HttpsError('invalid-argument', 'Username and password are required.');
  await migrateLegacyAdminIfNeeded();
  const result = await secureLogin({ username, secret, key: ADMINS_KEY, kind: 'admin' });
  if (result.upgradeRequired) return { account: result.account, upgradeRequired: true };
  const token = await admin.auth().createCustomToken('admin-' + result.account.id, {
    role: 'admin', adminRole: result.account.role || 'staff', username: result.account.username
  });
  return { account: result.account, upgradeRequired: false, token };
});

const facilitatorLogin = onCall({ enforceAppCheck: true }, async request => {
  const username = cleanString(request.data && request.data.username, 80);
  const secret = String((request.data && request.data.password) || '');
  if (!username || !secret) throw new HttpsError('invalid-argument', 'Username and password are required.');
  const result = await secureLogin({ username, secret, key: FACILITATORS_KEY, kind: 'facilitator' });
  if (result.upgradeRequired) return { account: result.account, upgradeRequired: true };
  const token = await admin.auth().createCustomToken('fac-' + result.account.id, {
    role: 'facilitator', username: result.account.username
  });
  return { account: result.account, upgradeRequired: false, token };
});

module.exports = {
  ...existing,
  adminLogin,
  facilitatorLogin
};
