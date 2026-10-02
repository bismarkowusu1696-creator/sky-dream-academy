// Production entrypoint. It loads the main API and replaces sensitive handlers
// with versions that enforce account membership, persistent lockouts, active-
// intake attendance rules, safe account deletion, and intake rollover.
const existing = require('./index');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_FROM_NUMBER = defineSecret('TWILIO_FROM_NUMBER');

const db = admin.firestore();
const STORAGE_COLLECTION = 'sdta_storage';
const KEYS = {
  students: 'sdta_students',
  admins: 'sdta_admins',
  legacyAdmin: 'sdta_admin',
  capacities: 'sdta_capacities',
  facilitators: 'sdta_facilitators',
  attendance: 'sdta_attendance',
  intake: 'sdta_intake',
  intakeHistory: 'sdta_intake_history',
  contacts: 'sdta_contact_messages',
  broadcasts: 'sdta_broadcasts',
  waitlist: 'sdta_waitlist'
};
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const DEFAULT_INTAKE = {
  startDate: '2026-10-03',
  label: 'October 2026 Intake',
  classesStartDate: '2026-10-04',
  breakStartDate: '2026-12-14',
  resumeDate: '2027-01-09',
  endDate: '2027-02-27',
  thanksgivingDate: '2027-02-28'
};
const COURSE_NAMES = {
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
};
const COURSE_CODES = {
  'household-chemicals': 'HC', 'hair-dressing': 'HD', cosmetology: 'CO', electricals: 'EE',
  'floral-decor': 'FD', 'fashion-design': 'FS', beading: 'BE', french: 'FL', korean: 'KL',
  pastries: 'PA', 'graphic-design': 'GD', barbering: 'BA', accounting: 'AC'
};

const refFor = key => db.collection(STORAGE_COLLECTION).doc(key);
const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
};
const cleanString = (value, max = 160) => String(value == null ? '' : value).trim().slice(0, max);
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3);
  return digits;
};
const normalizeGhanaCard = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const currentIntakeOr = value => value && value.startDate ? value : DEFAULT_INTAKE;

async function readValue(key, fallback) {
  const snap = await refFor(key).get();
  return snap.exists ? parseJson(snap.data().value, fallback) : fallback;
}

function passwordIsStrong(value) {
  const p = String(value || '');
  return p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { passwordHash: hash, passwordSalt: salt, passwordVersion: 1 };
}

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

function safeAdmin(account) {
  return { id: account.id, name: account.name, username: account.username, role: account.role || 'staff' };
}

function safeFacilitator(account) {
  return {
    id: account.id,
    name: account.name,
    username: account.username,
    phone: account.phone || '',
    courses: Array.isArray(account.courses) ? account.courses : []
  };
}

function safeStudentForFacilitator(student) {
  return {
    id: student.id,
    regNumber: student.regNumber,
    fullName: student.fullName,
    course: student.course,
    status: student.status,
    intakeStart: student.intakeStart || ''
  };
}

function nextRegNumber(courseId, list, intakeStartISO) {
  const code = COURSE_CODES[courseId] || String(courseId || '').slice(0, 2).toUpperCase();
  const prefix = 'SD' + code;
  const used = new Set((list || []).map(s => {
    const match = s.regNumber && String(s.regNumber).match(new RegExp('^' + prefix + '(\\d{3})/'));
    return match ? parseInt(match[1], 10) : null;
  }).filter(n => n !== null));
  let idx = 1;
  while (used.has(idx)) idx += 1;
  const d = new Date((intakeStartISO || DEFAULT_INTAKE.startDate) + 'T00:00:00Z');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return prefix + String(idx).padStart(3, '0') + '/' + month + '/' + d.getUTCFullYear();
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function attendanceDateAllowed(date, intake) {
  if (!validIsoDate(date)) return false;
  const current = currentIntakeOr(intake);
  const first = current.classesStartDate || current.startDate;
  const last = current.endDate;
  if (!validIsoDate(first) || !validIsoDate(last) || date < first || date > last) return false;
  if (current.breakStartDate && current.resumeDate && date >= current.breakStartDate && date < current.resumeDate) return false;
  const d = new Date(date + 'T00:00:00Z');
  const day = d.getUTCDay();
  if (day !== 0 && day !== 6) return false;
  const today = new Date().toISOString().slice(0, 10);
  return date <= today;
}

async function migrateLegacyAdminIfNeeded() {
  const adminsRef = refFor(KEYS.admins);
  const adminsSnap = await adminsRef.get();
  const admins = adminsSnap.exists ? parseJson(adminsSnap.data().value, []) : [];
  if (admins.length) return;
  const legacySnap = await refFor(KEYS.legacyAdmin).get();
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

async function assertAdminMembership(request, ownerOnly = false) {
  const token = request.auth && request.auth.token;
  if (!token || token.role !== 'admin' || !token.username) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  const admins = await readValue(KEYS.admins, []);
  const account = admins.find(a => String(a.username || '').toLowerCase() === String(token.username).toLowerCase());
  if (!account) throw new HttpsError('permission-denied', 'This administrator account is no longer active.');
  if (ownerOnly && account.role !== 'owner') throw new HttpsError('permission-denied', 'Main administrator access is required.');
  return account;
}

async function assertFacilitatorMembership(request) {
  const token = request.auth && request.auth.token;
  if (!token || token.role !== 'facilitator' || !token.username) {
    throw new HttpsError('permission-denied', 'Facilitator access is required.');
  }
  const facilitators = await readValue(KEYS.facilitators, []);
  const account = facilitators.find(f => String(f.username || '').toLowerCase() === String(token.username).toLowerCase());
  if (!account) throw new HttpsError('permission-denied', 'This facilitator account is no longer active.');
  return account;
}

async function secureLogin({ username, secret, key, kind }) {
  const ref = refFor(key);
  let outcome = { type: 'invalid' };
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (kind === 'admin' && list.length && !list.some(a => a.role === 'owner')) list[0].role = 'owner';
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account) return;
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
      account: kind === 'admin' ? safeAdmin(account) : safeFacilitator(account)
    };
  });
  if (outcome.type === 'locked') {
    throw new HttpsError('resource-exhausted', `Account temporarily locked. Try again in about ${outcome.minutes} minute(s).`);
  }
  if (outcome.type !== 'ok') throw new HttpsError('permission-denied', 'Invalid username or password.');
  return outcome;
}

async function secureUpgrade({ username, currentPin, newPassword, key, kind }) {
  const ref = refFor(key);
  let outcome = { type: 'invalid' };
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account || !account.pinHash || account.passwordHash) return;
    const locked = minutesLocked(account);
    if (locked) {
      outcome = { type: 'locked', minutes: locked };
      return;
    }
    if (!verifyLegacyPin(currentPin, account)) {
      failAccount(account);
      tx.set(ref, { value: JSON.stringify(list) });
      const nowLocked = minutesLocked(account);
      outcome = nowLocked ? { type: 'locked', minutes: nowLocked } : { type: 'invalid' };
      return;
    }
    Object.assign(account, makePasswordRecord(newPassword));
    delete account.pinHash;
    clearAccountFailure(account);
    tx.set(ref, { value: JSON.stringify(list) });
    outcome = { type: 'ok', account: kind === 'admin' ? safeAdmin(account) : safeFacilitator(account) };
  });
  if (outcome.type === 'locked') {
    throw new HttpsError('resource-exhausted', `Account temporarily locked. Try again in about ${outcome.minutes} minute(s).`);
  }
  if (outcome.type !== 'ok') throw new HttpsError('permission-denied', 'Current PIN verification failed.');
  return outcome.account;
}

const adminLogin = onCall({ enforceAppCheck: true }, async request => {
  const username = cleanString(request.data && request.data.username, 80);
  const secret = String((request.data && request.data.password) || '');
  if (!username || !secret) throw new HttpsError('invalid-argument', 'Username and password are required.');
  await migrateLegacyAdminIfNeeded();
  const result = await secureLogin({ username, secret, key: KEYS.admins, kind: 'admin' });
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
  const result = await secureLogin({ username, secret, key: KEYS.facilitators, kind: 'facilitator' });
  if (result.upgradeRequired) return { account: result.account, upgradeRequired: true };
  const token = await admin.auth().createCustomToken('fac-' + result.account.id, {
    role: 'facilitator', username: result.account.username
  });
  return { account: result.account, upgradeRequired: false, token };
});

const upgradeAdminPassword = onCall({ enforceAppCheck: true }, async request => {
  const username = cleanString(request.data && request.data.username, 80);
  const currentPin = String((request.data && request.data.currentPin) || '');
  const newPassword = String((request.data && request.data.newPassword) || '');
  if (!username || !passwordIsStrong(newPassword)) {
    throw new HttpsError('invalid-argument', 'Use at least 12 characters with uppercase, lowercase and a number.');
  }
  await migrateLegacyAdminIfNeeded();
  const account = await secureUpgrade({ username, currentPin, newPassword, key: KEYS.admins, kind: 'admin' });
  const token = await admin.auth().createCustomToken('admin-' + account.id, {
    role: 'admin', adminRole: account.role || 'staff', username: account.username
  });
  return { token, account };
});

const upgradeFacilitatorPassword = onCall({ enforceAppCheck: true }, async request => {
  const username = cleanString(request.data && request.data.username, 80);
  const currentPin = String((request.data && request.data.currentPin) || '');
  const newPassword = String((request.data && request.data.newPassword) || '');
  if (!username || !passwordIsStrong(newPassword)) {
    throw new HttpsError('invalid-argument', 'Use at least 12 characters with uppercase, lowercase and a number.');
  }
  const account = await secureUpgrade({ username, currentPin, newPassword, key: KEYS.facilitators, kind: 'facilitator' });
  const token = await admin.auth().createCustomToken('fac-' + account.id, {
    role: 'facilitator', username: account.username
  });
  return { token, account };
});

function wrapAdmin(existingFunction, ownerOnly = false, secrets = []) {
  return onCall({ enforceAppCheck: true, ...(secrets.length ? { secrets } : {}) }, async request => {
    await assertAdminMembership(request, ownerOnly);
    if (!existingFunction || typeof existingFunction.run !== 'function') {
      throw new HttpsError('internal', 'Server handler is unavailable.');
    }
    return existingFunction.run(request);
  });
}

const adminUpdateStudent = onCall({ enforceAppCheck: true }, async request => {
  await assertAdminMembership(request);
  const id = cleanString(request.data && request.data.id, 100);
  const patch = request.data && request.data.patch || {};
  const allowed = ['fullName','dob','gender','ghanaCard','gpsAddress','address','mobile','whatsapp','email','emName','emRel','emPhone','course','status'];
  const validStatuses = new Set(['Registered','Active','Completed','Deferred','Cancelled']);
  const ref = refFor(KEYS.students);

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const student = list.find(s => s.id === id);
    if (!student) throw new HttpsError('not-found', 'Student was not found.');
    const oldCourse = student.course;

    for (const key of allowed) {
      if (!(key in patch)) continue;
      if (key === 'course') {
        const course = cleanString(patch[key], 60);
        if (!COURSE_NAMES[course]) throw new HttpsError('invalid-argument', 'Invalid program.');
        student.course = course;
      } else if (key === 'status') {
        const status = cleanString(patch[key], 30);
        if (!validStatuses.has(status)) throw new HttpsError('invalid-argument', 'Invalid student status.');
        student.status = status;
      } else if (['mobile','whatsapp','emPhone'].includes(key)) {
        const p = normalizePhone(patch[key]);
        if (p && !/^0\d{9}$/.test(p)) throw new HttpsError('invalid-argument', 'Invalid phone number.');
        student[key] = p;
      } else if (key === 'email') {
        const email = cleanString(patch[key], 160).toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Invalid email address.');
        student.email = email;
      } else {
        student[key] = cleanString(patch[key], key === 'address' ? 200 : 160);
      }
    }

    if (student.course !== oldCourse) {
      const withoutStudent = list.filter(s => s.id !== student.id);
      student.regNumber = nextRegNumber(student.course, withoutStudent, student.intakeStart || DEFAULT_INTAKE.startDate);
    }

    if (student.status !== 'Cancelled') {
      const phone = normalizePhone(student.mobile);
      const card = normalizeGhanaCard(student.ghanaCard);
      const duplicate = list.find(s => s.id !== student.id && s.status !== 'Cancelled' &&
        (s.intakeStart || '') === (student.intakeStart || '') &&
        ((phone && normalizePhone(s.mobile) === phone) || (card && normalizeGhanaCard(s.ghanaCard) === card)));
      if (duplicate) throw new HttpsError('already-exists', 'Another student in this intake already uses that mobile number or Ghana Card.');
    }

    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

const adminDeleteAdmin = onCall({ enforceAppCheck: true }, async request => {
  const caller = await assertAdminMembership(request, true);
  const id = cleanString(request.data && request.data.id, 100);
  const ref = refFor(KEYS.admins);
  let removed = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const target = list.find(a => a.id === id);
    if (!target) throw new HttpsError('not-found', 'Administrator was not found.');
    if (target.role === 'owner') throw new HttpsError('failed-precondition', 'The main administrator cannot be removed.');
    if (String(target.username).toLowerCase() === String(caller.username).toLowerCase()) {
      throw new HttpsError('failed-precondition', 'You cannot remove your current account.');
    }
    removed = target;
    tx.set(ref, { value: JSON.stringify(list.filter(a => a.id !== id)) });
  });
  const uid = 'admin-' + removed.id;
  try {
    await admin.auth().revokeRefreshTokens(uid);
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if (!err || err.code !== 'auth/user-not-found') console.error('Could not remove administrator Auth user', err);
  }
  return { ok: true };
});

const adminDeleteFacilitator = onCall({ enforceAppCheck: true }, async request => {
  await assertAdminMembership(request, true);
  const id = cleanString(request.data && request.data.id, 100);
  const ref = refFor(KEYS.facilitators);
  let removed = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    removed = list.find(f => f.id === id) || null;
    if (!removed) throw new HttpsError('not-found', 'Facilitator was not found.');
    tx.set(ref, { value: JSON.stringify(list.filter(f => f.id !== id)) });
  });
  const uid = 'fac-' + removed.id;
  try {
    await admin.auth().revokeRefreshTokens(uid);
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if (!err || err.code !== 'auth/user-not-found') console.error('Could not remove facilitator Auth user', err);
  }
  return { ok: true };
});

const getFacilitatorDashboard = onCall({ enforceAppCheck: true }, async request => {
  const fac = await assertFacilitatorMembership(request);
  const [students, attendance, intake] = await Promise.all([
    readValue(KEYS.students, []),
    readValue(KEYS.attendance, []),
    readValue(KEYS.intake, DEFAULT_INTAKE)
  ]);
  const current = currentIntakeOr(intake);
  const courses = Array.isArray(fac.courses) ? fac.courses : [];
  const roster = students.filter(s => courses.includes(s.course) && s.status !== 'Cancelled' &&
    (s.intakeStart || '') === current.startDate).map(safeStudentForFacilitator);
  const rosterIds = new Set(roster.map(s => s.id));
  const marks = attendance.filter(r => courses.includes(r.course) && rosterIds.has(r.studentId) && attendanceDateAllowed(r.date, current));
  return {
    account: safeFacilitator(fac),
    students: roster,
    attendance: marks,
    intake: current,
    courses: Object.fromEntries(courses.map(id => [id, COURSE_NAMES[id] || id]))
  };
});

const markFacilitatorAttendance = onCall({ enforceAppCheck: true }, async request => {
  const fac = await assertFacilitatorMembership(request);
  const d = request.data || {};
  const course = cleanString(d.course, 60);
  const date = cleanString(d.date, 10);
  const studentId = cleanString(d.studentId, 100);
  const status = cleanString(d.status, 20);
  const note = cleanString(d.note, 200);
  if (!['Present','Absent',''].includes(status)) throw new HttpsError('invalid-argument', 'Invalid attendance entry.');
  if (!Array.isArray(fac.courses) || !fac.courses.includes(course)) {
    throw new HttpsError('permission-denied', 'You are not assigned to this program.');
  }
  const [students, intake] = await Promise.all([
    readValue(KEYS.students, []),
    readValue(KEYS.intake, DEFAULT_INTAKE)
  ]);
  const current = currentIntakeOr(intake);
  if (!attendanceDateAllowed(date, current)) {
    throw new HttpsError('invalid-argument', 'Attendance can only be marked for completed Saturday/Sunday sessions in the active intake, outside the scheduled break.');
  }
  const student = students.find(s => s.id === studentId && s.course === course && s.status !== 'Cancelled' &&
    (s.intakeStart || '') === current.startDate);
  if (!student) throw new HttpsError('not-found', 'Student was not found in the active roster for this program.');

  const ref = refFor(KEYS.attendance);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const idx = list.findIndex(r => r.course === course && r.date === date && r.studentId === studentId);
    if (!status) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx] = { ...list[idx], status, note, markedBy: fac.username, updatedAt: new Date().toISOString() };
    } else {
      list.push({
        id: 'att_' + crypto.randomUUID(),
        course,
        date,
        studentId,
        status,
        note,
        markedBy: fac.username,
        updatedAt: new Date().toISOString()
      });
    }
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

const adminStartNextIntake = onCall({ enforceAppCheck: true }, async request => {
  await assertAdminMembership(request, true);
  const d = request.data || {};
  const next = {
    startDate: cleanString(d.startDate, 10),
    label: cleanString(d.label, 100),
    classesStartDate: cleanString(d.classesStartDate, 10),
    breakStartDate: cleanString(d.breakStartDate, 10),
    resumeDate: cleanString(d.resumeDate, 10),
    endDate: cleanString(d.endDate, 10),
    thanksgivingDate: cleanString(d.thanksgivingDate, 10)
  };
  if (!validIsoDate(next.startDate) || !validIsoDate(next.classesStartDate) || !validIsoDate(next.endDate)) {
    throw new HttpsError('invalid-argument', 'Start date, classes start date and end date are required.');
  }
  if (next.classesStartDate < next.startDate || next.endDate < next.classesStartDate) {
    throw new HttpsError('invalid-argument', 'The intake dates are not in a valid order.');
  }
  if (!!next.breakStartDate !== !!next.resumeDate) {
    throw new HttpsError('invalid-argument', 'Provide both break and resume dates, or leave both blank.');
  }
  if (next.breakStartDate) {
    if (!validIsoDate(next.breakStartDate) || !validIsoDate(next.resumeDate) ||
        next.breakStartDate < next.classesStartDate || next.resumeDate <= next.breakStartDate || next.resumeDate > next.endDate) {
      throw new HttpsError('invalid-argument', 'The break and resume dates are not valid.');
    }
  }
  if (next.thanksgivingDate && (!validIsoDate(next.thanksgivingDate) || next.thanksgivingDate < next.endDate)) {
    throw new HttpsError('invalid-argument', 'The thanksgiving/closing date must be on or after the intake end date.');
  }
  if (!next.label) next.label = next.startDate.slice(0, 7) + ' Intake';

  const intakeRef = refFor(KEYS.intake);
  const historyRef = refFor(KEYS.intakeHistory);
  const waitlistRef = refFor(KEYS.waitlist);
  await db.runTransaction(async tx => {
    const [intakeSnap, historySnap] = await Promise.all([tx.get(intakeRef), tx.get(historyRef)]);
    const current = currentIntakeOr(intakeSnap.exists ? parseJson(intakeSnap.data().value, DEFAULT_INTAKE) : DEFAULT_INTAKE);
    if (current.startDate === next.startDate) throw new HttpsError('already-exists', 'That intake is already active.');
    const history = historySnap.exists ? parseJson(historySnap.data().value, []) : [];
    if (!history.some(i => i && i.startDate === current.startDate)) {
      history.push({ ...current, archivedAt: new Date().toISOString() });
    }
    tx.set(historyRef, { value: JSON.stringify(history) });
    tx.set(intakeRef, { value: JSON.stringify(next) });
    tx.set(waitlistRef, { value: JSON.stringify([]) });
  });
  return { ok: true, intake: next };
});

const securedGetAdminSnapshot = wrapAdmin(existing.getAdminSnapshot);
const securedAdminAddPayment = wrapAdmin(existing.adminAddPayment);
const securedAdminDeleteStudent = wrapAdmin(existing.adminDeleteStudent, true);
const securedAdminSetCapacity = wrapAdmin(existing.adminSetCapacity, true);
const securedAdminCreateFacilitator = wrapAdmin(existing.adminCreateFacilitator, true);
const securedAdminCreateAdmin = wrapAdmin(existing.adminCreateAdmin, true);
const securedAdminChangePassword = wrapAdmin(existing.adminChangePassword);
const securedSendCustomSms = wrapAdmin(existing.sendCustomSms, false, [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER]);

module.exports = {
  ...existing,
  adminLogin,
  facilitatorLogin,
  upgradeAdminPassword,
  upgradeFacilitatorPassword,
  getAdminSnapshot: securedGetAdminSnapshot,
  adminUpdateStudent,
  adminAddPayment: securedAdminAddPayment,
  adminDeleteStudent: securedAdminDeleteStudent,
  adminSetCapacity: securedAdminSetCapacity,
  adminCreateFacilitator: securedAdminCreateFacilitator,
  adminDeleteFacilitator,
  adminCreateAdmin: securedAdminCreateAdmin,
  adminDeleteAdmin,
  adminChangePassword: securedAdminChangePassword,
  getFacilitatorDashboard,
  markFacilitatorAttendance,
  sendCustomSms: securedSendCustomSms,
  adminStartNextIntake
};
