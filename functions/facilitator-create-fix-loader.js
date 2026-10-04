// Hotfix for facilitator creation. The older PIN wrapper rebuilt the callable
// request with object spread; Firebase callable request auth metadata is not
// guaranteed to survive that transformation. This top-level handler validates
// the real request directly and creates the facilitator with a salted scrypt
// hash of the 4-digit PIN-derived internal secret.
const app = require('./academic-portal-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE = 'sdta_storage';
const COURSE_NAMES = {
  'household-chemicals':'Household Chemicals Production','hair-dressing':'Hair Dressing',cosmetology:'Cosmetology',
  electricals:'Electricals','floral-decor':'Floral Decor','fashion-design':'Fashion Design',beading:'Beading',
  french:'French Language',korean:'Korean Language',pastries:'Pastries & Baking','graphic-design':'Graphic Design',
  barbering:'Barbering',accounting:'Accounting'
};

const parseJson = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } };
const clean = (v, max=200) => String(v == null ? '' : v).trim().slice(0, max);
const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3);
  return digits;
};
const facilitatorSecretFromPin = pin => `SkyDream-Facilitator-${String(pin)}-Aa9!`;
const makePasswordRecord = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { passwordHash: hash, passwordSalt: salt, passwordVersion: 1 };
};

async function readValue(key, fallback) {
  const snap = await db.collection(STORAGE).doc(key).get();
  return snap.exists ? parseJson(snap.data().value, fallback) : fallback;
}

async function requireOwnerSession(request) {
  const auth = request.auth;
  const token = auth && auth.token;
  if (!auth || !token || token.role !== 'admin' || !token.username) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  const admins = await readValue('sdta_admins', []);
  const account = admins.find(a => String(a.username || '').toLowerCase() === String(token.username).toLowerCase());
  if (!account || auth.uid !== 'admin-' + account.id) {
    throw new HttpsError('permission-denied', 'This administrator account is no longer active.');
  }
  if ((account.role || 'staff') !== 'owner') {
    throw new HttpsError('permission-denied', 'Main administrator access is required.');
  }
  if (!token.sessionId) {
    throw new HttpsError('permission-denied', 'Please sign out and sign in again to start a protected admin session.');
  }
  const sessions = await readValue('sdta_admin_sessions', []);
  const session = sessions.find(s => s.id === token.sessionId && s.username === account.username && !s.revoked);
  if (!session) {
    throw new HttpsError('permission-denied', 'This admin session has been signed out. Please log in again.');
  }
  return account;
}

async function appendAudit(account, detail, target) {
  try {
    const ref = db.collection(STORAGE).doc('sdta_activity_log');
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      let list = snap.exists ? parseJson(snap.data().value, []) : [];
      if (!Array.isArray(list)) list = [];
      list.push({
        id: 'audit_' + crypto.randomUUID(),
        date: new Date().toISOString(),
        admin: account.username,
        role: account.role || 'owner',
        action: 'Created facilitator',
        detail: clean(detail, 400),
        target: clean(target, 140)
      });
      if (list.length > 1000) list = list.slice(-1000);
      tx.set(ref, { value: JSON.stringify(list) });
    });
  } catch (_) {}
}

app.adminCreateFacilitator = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireOwnerSession(request);
  const d = request.data || {};
  const name = clean(d.name, 120);
  const username = clean(d.username, 80);
  const phone = normalizePhone(d.phone);
  const pin = String(d.pin || d.password || '');
  const courses = Array.isArray(d.courses) ? [...new Set(d.courses.filter(c => COURSE_NAMES[c]))] : [];

  if (!name || !username || !/^0\d{9}$/.test(phone) || !courses.length) {
    throw new HttpsError('invalid-argument', 'Provide a name, unique username, valid phone number and at least one program.');
  }
  if (!/^[0-9]{4}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'Facilitator PIN must be exactly 4 digits.');
  }

  const ref = db.collection(STORAGE).doc('sdta_facilitators');
  let created = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (list.some(f => String(f.username || '').toLowerCase() === username.toLowerCase())) {
      throw new HttpsError('already-exists', 'That facilitator username is already used.');
    }
    created = {
      id: 'fac_' + crypto.randomUUID(),
      name,
      username,
      phone,
      courses,
      active: true,
      ...makePasswordRecord(facilitatorSecretFromPin(pin))
    };
    list.push(created);
    tx.set(ref, { value: JSON.stringify(list) });
  });

  await appendAudit(account, `${name} · ${courses.join(', ')}`, created.id);
  return { ok: true, facilitator: { id: created.id, name, username, phone, courses, active: true } };
});

module.exports = app;
