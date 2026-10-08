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


// Staff PINs are still stored with salted scrypt records. This purpose-
// specific input prevents a 4-digit PIN from being interpreted as an owner's
// password, but it does not increase the PIN's 10,000 possible combinations.
// Persistent lockouts and rate limits therefore remain mandatory.
const STAFF_PIN_VERSION = 'staff-pin-v1';
const validStaffPin = value => /^[0-9]{4}$/.test(String(value || ''));
const staffPinSecret = pin => 'SkyDream-Registration-Staff-' + String(pin) + '-Aa9!';
async function appendCredentialAudit(username, action, target, role = 'owner') {
  const ref = db.collection(STORAGE_COLLECTION).doc('sdta_activity_log');
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const raw = snap.exists ? parseJson(snap.data().value, []) : [];
      const records = Array.isArray(raw) ? raw : [];
      records.push({
        id: 'audit_' + crypto.randomUUID(),
        date: new Date().toISOString(),
        admin: clean(username, 80),
        role: clean(role, 40),
        action: clean(action, 100),
        target: clean(target, 100),
        detail: 'Credential changed; no PIN recorded.'
      });
      tx.set(ref, { value: JSON.stringify(records.slice(-1000)) });
    });
  } catch (err) { console.warn('Admin credential audit failed.', err); }
}

async function revokeAccountSessions(username, id) {
  const ref = db.collection(STORAGE_COLLECTION).doc('sdta_admin_sessions');
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list)) return;
    const now = new Date().toISOString();
    let changed = false;
    for (const s of list) {
      if (String(s.username || '').toLowerCase() === String(username).toLowerCase() && !s.revoked) {
        s.revoked = true; s.revokedAt = now; s.revokedBy = 'staff-pin-change'; changed = true;
      }
    }
    if (changed) tx.set(ref, { value: JSON.stringify(list) });
  });
  try { await admin.auth().revokeRefreshTokens('admin-' + id); }
  catch (err) { console.warn('Could not revoke Firebase refresh tokens.', err); }
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

// Administrator PIN sign-in has been disabled for the main owner account.
// The owner must use a strong password; only restricted staff can use the
// 4-digit PIN format provisioned by the owner.
const baseAdminLogin = app.adminLogin;
app.adminLogin = onCall({ enforceAppCheck: true }, async request => {
  const username = clean(request.data && request.data.username, 80);
  const entered = String(request.data && request.data.password || '');
  await enforceRateLimit(request, 'admin-login-user', username || 'blank', 5, 15 * 60 * 1000);
  await enforceRateLimit(request, 'admin-login-ip', 'all-admin-users', 50, 15 * 60 * 1000);
  if (!username || !baseAdminLogin || typeof baseAdminLogin.run !== 'function') {
    throw new HttpsError('permission-denied', 'Invalid username or credential.');
  }
  const admins = await readStorage('sdta_admins', []);
  const account = Array.isArray(admins)
    ? admins.find(a => String(a.username || '').toLowerCase() === username.toLowerCase())
    : null;
  if (!account) throw new HttpsError('permission-denied', 'Invalid username or credential.');

  let credential = entered;
  if ((account.role || 'staff') === 'owner') {
    if (!strongAdminPassword(entered)) {
      throw new HttpsError('permission-denied', 'Invalid username or credential.');
    }
  } else {
    if (!validStaffPin(entered) || account.credentialType !== STAFF_PIN_VERSION) {
      throw new HttpsError('permission-denied', 'Invalid username or PIN. Ask the owner to set a staff PIN if this account is not yet configured.');
    }
    credential = staffPinSecret(entered);
  }
  const result = await baseAdminLogin.run({
    ...request,
    data: { ...(request.data || {}), password: credential }
  });
  if (result && result.upgradeRequired) {
    throw new HttpsError('failed-precondition', 'An authenticated owner must set a modern account credential.');
  }
  if (result && result.account) await removeLegacyRecoveryMaterial();
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


const REGISTRATION_COURSES = Object.freeze({
  'household-chemicals': 'Household Chemicals Production',
  'hair-dressing': 'Hair Dressing',
  cosmetology: 'Cosmetology',
  electricals: 'Electricals',
  'floral-decor': 'Floral Decor',
  'fashion-design': 'Fashion Design',
  beading: 'Beading',
  french: 'French Language',
  korean: 'Korean Language',
  pastries: 'Pastries & Baking',
  'graphic-design': 'Graphic Design',
  barbering: 'Barbering',
  accounting: 'Accounting'
});
const REGISTRATION_COURSE_CODES = Object.freeze({
  'household-chemicals':'HC','hair-dressing':'HD',cosmetology:'CO',
  electricals:'EE','floral-decor':'FD','fashion-design':'FS',beading:'BE',
  french:'FL',korean:'KL',pastries:'PA','graphic-design':'GD',
  barbering:'BA',accounting:'AC'
});
const REGISTRATION_EDIT_FIELDS = Object.freeze(['fullName','mobile','whatsapp','email','address','course','status']);
const registrationVersion = student => crypto.createHash('sha256')
  .update(JSON.stringify(REGISTRATION_EDIT_FIELDS.map(key => String(student[key] == null ? '' : student[key]))))
  .digest('hex');
function normalizeGhanaPhone(value) {
  const digits = String(value || '').replace(/\D/g,'');
  return digits.startsWith('233') && digits.length === 12 ? '0' + digits.slice(3) : digits;
}
function normalizeIdentityCard(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function registrationNumberFor(course, list, intakeStart) {
  const prefix = 'SD' + REGISTRATION_COURSE_CODES[course];
  const used = new Set((list || []).filter(s=>s.course===course).map(s=>{
    const match = String(s.regNumber || '').match(new RegExp('^'+prefix+'(\\d{3})/'));
    return match ? Number(match[1]) : null;
  }).filter(Number.isInteger));
  let index = 1;while (used.has(index)) index++;
  const date = new Date((intakeStart || '2026-10-03')+'T00:00:00Z');
  if (Number.isNaN(date.getTime())) throw new HttpsError('failed-precondition','The intake date is invalid.');
  return prefix+String(index).padStart(3,'0')+'/'+String(date.getUTCMonth()+1).padStart(2,'0')+'/'+date.getUTCFullYear();
}

// Registration-only workspaces are the sole operational privilege of every
// non-owner administrator, regardless of historical role name. Access is
// evaluated against the stored account on every request, never token role.
app.adminGetRegistrationWorkspace = onCall({ enforceAppCheck: true }, async request => {
  const { account } = await requireStrongAdminSession(request);
  const [rawStudents, intake] = await Promise.all([
    readStorage('sdta_students', []),
    readStorage('sdta_intake', {})
  ]);
  const students = (Array.isArray(rawStudents) ? rawStudents : []).map(s => ({
    id: clean(s.id, 120),
    regNumber: clean(s.regNumber, 80),
    fullName: clean(s.fullName, 160),
    mobile: clean(s.mobile, 30),
    whatsapp: clean(s.whatsapp, 30),
    email: clean(s.email, 160),
    address: clean(s.address, 200),
    course: clean(s.course, 80),
    status: clean(s.status || 'Registered', 30),
    intakeStart: clean(s.intakeStart, 30),
    regDate: clean(s.regDate, 50),
    registrationVersion: registrationVersion(s)
  }));
  return {
    account: { username: account.username, role: account.role || 'staff' },
    intakeStart: clean(intake && intake.startDate, 30),
    courses: REGISTRATION_COURSES,
    students
  };
});

app.adminSetRegistrationStatus = onCall({ enforceAppCheck: true }, async request => {
  const { account } = await requireStrongAdminSession(request);
  const id = clean(request.data && request.data.id, 120);
  const status = clean(request.data && request.data.status, 30);
  if (!id || !['Registered', 'Cancelled'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Only Registered or Cancelled can be selected.');
  }
  const studentsRef = db.collection(STORAGE_COLLECTION).doc('sdta_students');
  const auditRef = db.collection(STORAGE_COLLECTION).doc('sdta_activity_log');
  let result = null;
  await db.runTransaction(async tx => {
    const [studentSnap, auditSnap] = await Promise.all([tx.get(studentsRef), tx.get(auditRef)]);
    const list = studentSnap.exists ? parseJson(studentSnap.data().value, []) : [];
    if (!Array.isArray(list)) throw new HttpsError('internal', 'Registration records are unavailable.');
    const student = list.find(s => s.id === id);
    if (!student) throw new HttpsError('not-found', 'The registration was not found.');
    if (status === 'Registered' && student.status === 'Cancelled') {
      // Preserve the existing no-duplicate rule when reactivating a cancellation.
      const phone = String(student.mobile || '').replace(/\D/g, '').slice(-10);
      const card = String(student.ghanaCard || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const conflict = list.find(s => s.id !== id && s.status !== 'Cancelled' &&
        String(s.intakeStart || '') === String(student.intakeStart || '') &&
        ((phone && String(s.mobile || '').replace(/\D/g, '').slice(-10) === phone) ||
         (card && String(s.ghanaCard || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === card)));
      if (conflict) throw new HttpsError('already-exists', 'Another active registration in this intake has the same phone number or Ghana Card.');
    }
    const oldStatus = student.status || 'Registered';
    if (oldStatus === status) {
      result = { ok: true, changed: false, status };
      return;
    }
    student.status = status;
    const audit = auditSnap.exists ? parseJson(auditSnap.data().value, []) : [];
    const history = Array.isArray(audit) ? audit : [];
    history.push({
      id: 'audit_' + crypto.randomUUID(),
      date: new Date().toISOString(),
      admin: account.username,
      role: account.role || 'staff',
      action: 'Changed registration status',
      detail: oldStatus + ' → ' + status,
      target: clean(student.regNumber || id, 120)
    });
    tx.set(studentsRef, { value: JSON.stringify(list) });
    tx.set(auditRef, { value: JSON.stringify(history.slice(-500)) });
    result = { ok: true, changed: true, status };
  });
  return result;
});

// A restricted, audited registration editor. Staff can only change this
// explicit allowlist; never accept payments, IDs, intake, fees, account roles
// or other administrative record fields as part of a patch.
app.adminEditRegistration = onCall({ enforceAppCheck: true }, async request => {
  const { account } = await requireStrongAdminSession(request);
  const data = request.data || {};
  const id = clean(data.id, 120);
  const patch = data.patch;
  const version = clean(data.registrationVersion, 64);
  if (!id || !version || !/^[a-f0-9]{64}$/.test(version) ||
      !patch || Array.isArray(patch) || typeof patch !== 'object') {
    throw new HttpsError('invalid-argument', 'Choose a registration and enter its details.');
  }
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(key => !REGISTRATION_EDIT_FIELDS.includes(key))) {
    throw new HttpsError('permission-denied', 'Only approved registration fields may be edited.');
  }
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(patch,'fullName')) {
    const name = clean(patch.fullName, 120);
    if (name.length < 2 || String(patch.fullName || '').trim().length > 120) {
      throw new HttpsError('invalid-argument','Enter a valid student name (2–120 characters).');
    }
    changes.fullName = name;
  }
  if (Object.prototype.hasOwnProperty.call(patch,'mobile')) {
    const phone = normalizeGhanaPhone(patch.mobile);
    if (!/^0\d{9}$/.test(phone)) {
      throw new HttpsError('invalid-argument','Enter a valid 10-digit Ghana mobile number.');
    }
    changes.mobile = phone;
  }
  if (Object.prototype.hasOwnProperty.call(patch,'whatsapp')) {
    const phone = normalizeGhanaPhone(patch.whatsapp);
    if (phone && !/^0\d{9}$/.test(phone)) {
      throw new HttpsError('invalid-argument','Enter a valid WhatsApp number.');
    }
    changes.whatsapp = phone;
  }
  if (Object.prototype.hasOwnProperty.call(patch,'email')) {
    const email = clean(patch.email, 160).toLowerCase();
    if (String(patch.email || '').trim().length > 160 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new HttpsError('invalid-argument','Enter a valid email address.');
    }
    changes.email = email;
  }
  if (Object.prototype.hasOwnProperty.call(patch,'address')) {
    if (String(patch.address || '').trim().length > 200) {
      throw new HttpsError('invalid-argument','Address must be 200 characters or fewer.');
    }
    changes.address = clean(patch.address, 200);
  }
  if (Object.prototype.hasOwnProperty.call(patch,'course')) {
    const course = clean(patch.course, 80);
    if (!Object.prototype.hasOwnProperty.call(REGISTRATION_COURSES,course)) {
      throw new HttpsError('invalid-argument','Choose a valid program.');
    }
    changes.course = course;
  }
  if (Object.prototype.hasOwnProperty.call(patch,'status')) {
    const status = clean(patch.status, 30);
    if (!['Registered','Cancelled'].includes(status)) {
      throw new HttpsError('invalid-argument','Staff can select only Registered or Cancelled.');
    }
    changes.status = status;
  }
  const studentsRef = db.collection(STORAGE_COLLECTION).doc('sdta_students');
  const auditRef = db.collection(STORAGE_COLLECTION).doc('sdta_activity_log');
  const capacityRef = db.collection(STORAGE_COLLECTION).doc('sdta_capacities');
  let result;
  await db.runTransaction(async tx => {
    const [studentSnap,auditSnap,capacitySnap] = await Promise.all([
      tx.get(studentsRef),tx.get(auditRef),tx.get(capacityRef)
    ]);
    const list = studentSnap.exists ? parseJson(studentSnap.data().value,[]) : [];
    if (!Array.isArray(list)) throw new HttpsError('internal','Registration records unavailable.');
    const student = list.find(s=>s.id===id);
    if (!student) throw new HttpsError('not-found','Student registration no longer exists.');
    if (registrationVersion(student)!==version) {
      throw new HttpsError('aborted','This registration has changed. Refresh before editing again.');
    }
    const oldReg = clean(student.regNumber, 80);
    const oldCourse = student.course;
    const oldStatus = student.status || 'Registered';
    if (!['Registered','Cancelled'].includes(oldStatus) && changes.status &&
        changes.status !== oldStatus) {
      throw new HttpsError('failed-precondition','Only the owner can change an Active, Completed or Deferred status.');
    }
    const changedFields = [];
    for (const [key,value] of Object.entries(changes)) {
      if (String(student[key] == null ? '' : student[key]) !== String(value)) {
        student[key]=value;
        changedFields.push(key);
      }
    }
    if (student.course !== oldCourse) {
      student.regNumber = registrationNumberFor(student.course,list.filter(s=>s.id!==id),student.intakeStart);
      if (student.status !== 'Cancelled') {
        const capacityMap = capacitySnap.exists ? parseJson(capacitySnap.data().value,{}) : {};
        const rawCapacity = Number(capacityMap[student.course]);
        const capacity = rawCapacity > 0 ? rawCapacity : 25;
        const assigned = list.filter(s=>s.id!==id && s.course===student.course &&
          s.status !== 'Cancelled' && (s.intakeStart || '') === (student.intakeStart || '')).length;
        if (assigned >= capacity) {
          throw new HttpsError('failed-precondition','The selected program is full for this intake.');
        }
      }
    }
    if (student.status !== 'Cancelled') {
      const phone = normalizeGhanaPhone(student.mobile);
      const card = normalizeIdentityCard(student.ghanaCard);
      const conflict = list.some(s=>s.id!==id && s.status !== 'Cancelled' &&
        (s.intakeStart || '') === (student.intakeStart || '') &&
        ((phone && normalizeGhanaPhone(s.mobile)===phone) ||
         (card && normalizeIdentityCard(s.ghanaCard)===card)));
      if (conflict) throw new HttpsError('already-exists','Another registration in this intake uses that mobile number or Ghana Card.');
    }
    if (!changedFields.length) {
      result = {ok:true,changed:false,regNumber:oldReg};
      return;
    }
    const history = auditSnap.exists ? parseJson(auditSnap.data().value,[]) : [];
    if (!Array.isArray(history)) throw new HttpsError('internal','Audit log unavailable.');
    history.push({
      id:'audit_'+crypto.randomUUID(),
      date:new Date().toISOString(),
      admin:account.username,
      role:account.role || 'staff',
      action:'Edited student registration',
      target:oldReg,
      detail:changedFields.join(', ') + (oldReg !== student.regNumber ?
        ' · Registration number reissued to '+student.regNumber : '')
    });
    tx.set(studentsRef,{value:JSON.stringify(list)});
    tx.set(auditRef,{value:JSON.stringify(history.slice(-1000))});
    result={ok:true,changed:true,regNumber:student.regNumber,
      registrationNumberChanged:oldReg!==student.regNumber};
  });
  return result;
});

// Apply one final session check to every exported administrator callable, even
// if a future feature forgets to add its own authorization wrapper.
const PRE_AUTH_ADMIN_CALLS = new Set(['adminLogin', 'adminVerifyTwoFactorLogin', 'adminRecoverWithCode']);
for (const name of Object.keys(app)) {
  const isAdminCallable = name === 'getAdminSnapshot' || name === 'sendCustomSms' || name.startsWith('admin');
  if (!isAdminCallable || PRE_AUTH_ADMIN_CALLS.has(name)) continue;
  const base = app[name];
  if (!base || typeof base.run !== 'function') continue;

  app[name] = onCall({ enforceAppCheck: true }, async request => {
    const { account, auth } = await requireStrongAdminSession(request);
    // Deny by default for all subordinate admins, including existing manager,
    // staff, registration, finance, and viewer accounts.
    if ((account.role || 'staff') !== 'owner' &&
        !new Set(['adminGetRegistrationWorkspace', 'adminSetRegistrationStatus', 'adminEditRegistration']).has(name)) {
      throw new HttpsError('permission-denied', 'Staff administrators can only view, export or edit approved registration fields.');
    }
    return base.run(delegatedRequest(request, auth));
  });
}


// Explicit restricted staff credential management. Owner creation/reset is
// enforced against the stored role, not an ID token claim.
app.adminCreateAdmin = onCall({ enforceAppCheck: true }, async request => {
  const { account: owner } = await requireStrongAdminSession(request);
  if ((owner.role || 'staff') !== 'owner') throw new HttpsError('permission-denied', 'Main administrator only.');
  const d = request.data || {};
  const name = clean(d.name, 120);
  const username = clean(d.username, 80);
  const pin = String(d.pin == null ? d.password || '' : d.pin);
  if (!name || !/^[a-zA-Z0-9._-]{3,80}$/.test(username) || !validStaffPin(pin)) {
    throw new HttpsError('invalid-argument', 'Enter a name, a username and exactly 4 PIN digits.');
  }
  const ref = db.collection(STORAGE_COLLECTION).doc('sdta_admins');
  const id = 'adm_' + crypto.randomUUID();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list)) throw new HttpsError('internal', 'Administrator records unavailable.');
    if (list.some(a => String(a.username || '').toLowerCase() === username.toLowerCase()))
      throw new HttpsError('already-exists', 'This administrator username is already used.');
    list.push({
      id, name, username, role: 'staff',
      credentialType: STAFF_PIN_VERSION,
      ...makePasswordRecord(staffPinSecret(pin))
    });
    tx.set(ref, { value: JSON.stringify(list) });
  });
  await appendCredentialAudit(owner.username, 'Created staff administrator with PIN', username);
  return { ok: true };
});

app.adminSetStaffPin = onCall({ enforceAppCheck: true }, async request => {
  const { account: owner } = await requireStrongAdminSession(request);
  if ((owner.role || 'staff') !== 'owner') throw new HttpsError('permission-denied', 'Main administrator only.');
  const id = clean(request.data && request.data.id, 120);
  const pin = String(request.data && request.data.pin || '');
  if (!id || !validStaffPin(pin)) throw new HttpsError('invalid-argument', 'Select a staff administrator and enter exactly 4 digits.');
  const ref = db.collection(STORAGE_COLLECTION).doc('sdta_admins');
  let username = '';
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list)) throw new HttpsError('internal', 'Administrator records unavailable.');
    const target = list.find(a => a.id === id);
    if (!target) throw new HttpsError('not-found', 'Staff administrator not found.');
    if ((target.role || 'staff') === 'owner') throw new HttpsError('permission-denied', 'The owner password cannot be replaced by a PIN.');
    username = target.username;
    Object.assign(target, makePasswordRecord(staffPinSecret(pin)));
    target.credentialType = STAFF_PIN_VERSION;
    delete target.pinHash; delete target.recoveryHash;
    target.failedLogins = 0; delete target.lockedUntil;
    tx.set(ref, { value: JSON.stringify(list) });
  });
  await revokeAccountSessions(username, id);
  await appendCredentialAudit(owner.username, 'Reset staff administrator PIN', username);
  return { ok: true };
});

// Only the owner may change an admin login credential. Subordinate
// administrators cannot change their own PIN or any other password.
// The owner can reset staff PINs through adminSetStaffPin.
const baseAdminChangePassword = app.adminChangePassword;
app.adminChangePassword = onCall({ enforceAppCheck: true }, async request => {
  const { account, auth } = await requireStrongAdminSession(request);
  if ((account.role || 'staff') !== 'owner') {
    throw new HttpsError('permission-denied', 'Staff PINs can only be changed by the main administrator.');
  }
  return baseAdminChangePassword.run(delegatedRequest(request, auth));
});

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
