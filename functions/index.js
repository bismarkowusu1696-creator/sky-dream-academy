const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const twilio = require('twilio');

admin.initializeApp();

const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_FROM_NUMBER = defineSecret('TWILIO_FROM_NUMBER');

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

const DEFAULT_CAPACITY = 25;
const REGISTRATION_FEE = 50;
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

const db = admin.firestore();
const refFor = (key) => db.collection(STORAGE_COLLECTION).doc(key);

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

async function readValue(key, fallback) {
  const snap = await refFor(key).get();
  if (!snap.exists) return fallback;
  return parseJson(snap.data().value, fallback);
}

async function writeValue(key, value) {
  await refFor(key).set({ value: JSON.stringify(value) });
}

function cleanString(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3);
  return digits;
}

function toE164Ghana(value) {
  const local = normalizePhone(value);
  if (/^0\d{9}$/.test(local)) return '+233' + local.slice(1);
  return '';
}

function normalizeGhanaCard(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
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

function isLocked(account) {
  if (!account || !account.lockedUntil) return 0;
  const ms = new Date(account.lockedUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

function recordFailedLogin(account) {
  account.failedLogins = (Number(account.failedLogins) || 0) + 1;
  if (account.failedLogins >= LOGIN_LOCKOUT_THRESHOLD) {
    account.lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60000).toISOString();
    account.failedLogins = 0;
  }
}

function clearFailedLogin(account) {
  account.failedLogins = 0;
  delete account.lockedUntil;
}

function requireAdmin(request, ownerOnly = false) {
  const token = request.auth && request.auth.token;
  if (!token || token.role !== 'admin') throw new HttpsError('permission-denied', 'Administrator access is required.');
  if (ownerOnly && token.adminRole !== 'owner') throw new HttpsError('permission-denied', 'Main administrator access is required.');
  return token;
}

function requireFacilitator(request) {
  const token = request.auth && request.auth.token;
  if (!token || token.role !== 'facilitator') throw new HttpsError('permission-denied', 'Facilitator access is required.');
  return token;
}

function safeAdmin(account) {
  if (!account) return null;
  return { id: account.id, name: account.name, username: account.username, role: account.role || 'staff' };
}

function safeFacilitator(account) {
  if (!account) return null;
  return { id: account.id, name: account.name, username: account.username, phone: account.phone || '', courses: Array.isArray(account.courses) ? account.courses : [] };
}

function safeStudentForFacilitator(student) {
  return { id: student.id, regNumber: student.regNumber, fullName: student.fullName, course: student.course, status: student.status, intakeStart: student.intakeStart || '' };
}

function currentIntakeOr(value) {
  return value && value.startDate ? value : DEFAULT_INTAKE;
}

function nextRegNumber(courseId, list, intakeStartISO) {
  const code = COURSE_CODES[courseId] || String(courseId || '').slice(0, 2).toUpperCase();
  const prefix = 'SD' + code;
  const used = new Set((list || []).filter(s => s.course === courseId).map(s => {
    const m = s.regNumber && s.regNumber.match(new RegExp('^' + prefix + '(\\d{3})/'));
    return m ? parseInt(m[1], 10) : null;
  }).filter(n => n !== null));
  let idx = 1;
  while (used.has(idx)) idx++;
  const d = new Date((intakeStartISO || DEFAULT_INTAKE.startDate) + 'T00:00:00Z');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return prefix + String(idx).padStart(3, '0') + '/' + month + '/' + d.getUTCFullYear();
}

async function sendWelcomeSms(student) {
  const to = toE164Ghana(student.mobile);
  if (!to) return { sent: false, reason: 'no-number' };
  const facilitators = await readValue(KEYS.facilitators, []);
  const facilitator = facilitators.find(f => Array.isArray(f.courses) && f.courses.includes(student.course) && f.phone);
  const courseName = COURSE_NAMES[student.course] || student.course;
  let message = `Thank you for registering with SkyDream Skills Training Academy, ${student.fullName}! Your registration number for ${courseName} is ${student.regNumber}.`;
  if (facilitator) message += ` Your facilitator is ${facilitator.name} — contact: ${facilitator.phone}.`;
  const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
  await client.messages.create({ body: message, from: TWILIO_FROM_NUMBER.value(), to });
  return { sent: true, facilitatorName: facilitator ? facilitator.name : null };
}

exports.publicCatalog = onCall({ enforceAppCheck: true }, async () => {
  const [students, capacities, intake, broadcasts] = await Promise.all([
    readValue(KEYS.students, []),
    readValue(KEYS.capacities, {}),
    readValue(KEYS.intake, DEFAULT_INTAKE),
    readValue(KEYS.broadcasts, [])
  ]);
  const current = currentIntakeOr(intake);
  const programs = Object.keys(COURSE_NAMES).map(id => {
    const capacity = Number(capacities[id]) > 0 ? Number(capacities[id]) : DEFAULT_CAPACITY;
    const taken = students.filter(s => s.course === id && s.status !== 'Cancelled' && (s.intakeStart || '2026-09-26') === current.startDate).length;
    return { id, name: COURSE_NAMES[id], capacity, taken, available: Math.max(0, capacity - taken), full: taken >= capacity };
  });
  const notices = broadcasts.filter(b => b && b.active !== false).slice(-5).map(b => ({ id: b.id, message: cleanString(b.message, 500), date: b.date || '' }));
  return { intake: current, programs, registrationFee: REGISTRATION_FEE, notices };
});

exports.registerStudent = onCall(
  { enforceAppCheck: true, secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER] },
  async (request) => {
    const d = request.data || {};
    if (d.website) throw new HttpsError('invalid-argument', 'Invalid submission.');
    const fullName = cleanString(d.fullName, 120);
    const dob = cleanString(d.dob, 10);
    const gender = cleanString(d.gender, 30);
    const ghanaCard = cleanString(d.ghanaCard, 30);
    const gpsAddress = cleanString(d.gpsAddress, 80);
    const address = cleanString(d.address, 200);
    const mobile = normalizePhone(d.mobile);
    const whatsapp = normalizePhone(d.whatsapp);
    const email = cleanString(d.email, 160).toLowerCase();
    const emName = cleanString(d.emName, 120);
    const emRel = cleanString(d.emRel, 60);
    const emPhone = normalizePhone(d.emPhone);
    const course = cleanString(d.course, 60);
    const consent = d.consent === true;

    if (!fullName || !dob || !address || !mobile || !whatsapp || !emName || !emRel || !emPhone || !COURSE_NAMES[course] || !consent) {
      throw new HttpsError('invalid-argument', 'Please complete all required registration fields and accept the privacy notice.');
    }
    if (!/^0\d{9}$/.test(mobile) || !/^0\d{9}$/.test(whatsapp) || !/^0\d{9}$/.test(emPhone)) {
      throw new HttpsError('invalid-argument', 'Please enter valid 10-digit Ghana phone numbers.');
    }
    if (ghanaCard && !/^GHA-?\d{9}-?\d$/i.test(ghanaCard.replace(/\s/g, ''))) {
      throw new HttpsError('invalid-argument', 'The Ghana Card number format is invalid.');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'The email address is invalid.');
    }

    const studentsRef = refFor(KEYS.students);
    const waitlistRef = refFor(KEYS.waitlist);
    const capacitiesRef = refFor(KEYS.capacities);
    const intakeRef = refFor(KEYS.intake);
    let createdStudent = null;
    let waitlisted = false;

    await db.runTransaction(async tx => {
      const [studentsSnap, waitlistSnap, capacitiesSnap, intakeSnap] = await Promise.all([
        tx.get(studentsRef), tx.get(waitlistRef), tx.get(capacitiesRef), tx.get(intakeRef)
      ]);
      const students = studentsSnap.exists ? parseJson(studentsSnap.data().value, []) : [];
      const waitlist = waitlistSnap.exists ? parseJson(waitlistSnap.data().value, []) : [];
      const capacities = capacitiesSnap.exists ? parseJson(capacitiesSnap.data().value, {}) : {};
      const intake = currentIntakeOr(intakeSnap.exists ? parseJson(intakeSnap.data().value, DEFAULT_INTAKE) : DEFAULT_INTAKE);
      const ghanaNorm = normalizeGhanaCard(ghanaCard);
      const duplicate = students.find(s => s.status !== 'Cancelled' && (s.intakeStart || '2026-09-26') === intake.startDate &&
        (normalizePhone(s.mobile) === mobile || (ghanaNorm && normalizeGhanaCard(s.ghanaCard) === ghanaNorm)));
      if (duplicate) throw new HttpsError('already-exists', 'This mobile number or Ghana Card is already registered for the current intake.');
      const capacity = Number(capacities[course]) > 0 ? Number(capacities[course]) : DEFAULT_CAPACITY;
      const taken = students.filter(s => s.course === course && s.status !== 'Cancelled' && (s.intakeStart || '2026-09-26') === intake.startDate).length;
      if (taken >= capacity) {
        if (!waitlist.some(w => normalizePhone(w.mobile) === mobile && w.course === course)) {
          waitlist.push({ id: 'wait_' + crypto.randomUUID(), fullName, mobile, whatsapp, email, course, date: new Date().toISOString() });
          tx.set(waitlistRef, { value: JSON.stringify(waitlist) });
        }
        waitlisted = true;
        return;
      }
      createdStudent = {
        id: 'stu_' + crypto.randomUUID(),
        regNumber: nextRegNumber(course, students, intake.startDate),
        regDate: new Date().toISOString(),
        fullName, dob, gender, religion: '', ghanaCard, photo: null, gpsAddress, address,
        mobile, whatsapp, email, emName, emRel, emPhone, course,
        status: 'Registered', feePaid: 0, payments: [], intakeStart: intake.startDate
      };
      students.push(createdStudent);
      tx.set(studentsRef, { value: JSON.stringify(students) });
    });

    if (waitlisted) return { waitlisted: true, courseName: COURSE_NAMES[course] };

    try {
      const sms = await sendWelcomeSms(createdStudent);
      return { waitlisted: false, regNumber: createdStudent.regNumber, fullName: createdStudent.fullName, courseName: COURSE_NAMES[course], smsSent: sms.sent };
    } catch (err) {
      logger.error('Registration saved but welcome SMS failed', err);
      return { waitlisted: false, regNumber: createdStudent.regNumber, fullName: createdStudent.fullName, courseName: COURSE_NAMES[course], smsSent: false };
    }
  }
);

exports.checkStudentStatus = onCall({ enforceAppCheck: true }, async (request) => {
  const regNumber = cleanString(request.data && request.data.regNumber, 60).toUpperCase();
  const mobile = normalizePhone(request.data && request.data.mobile);
  if (!regNumber || !/^0\d{9}$/.test(mobile)) throw new HttpsError('invalid-argument', 'Registration number and mobile number are required.');
  const [students, attendance, intake] = await Promise.all([
    readValue(KEYS.students, []), readValue(KEYS.attendance, []), readValue(KEYS.intake, DEFAULT_INTAKE)
  ]);
  const student = students.find(s => String(s.regNumber || '').toUpperCase() === regNumber && normalizePhone(s.mobile) === mobile);
  if (!student) throw new HttpsError('not-found', 'No matching registration was found.');
  const records = attendance.filter(r => r.studentId === student.id);
  const present = records.filter(r => r.status === 'Present').length;
  const absent = records.filter(r => r.status === 'Absent').length;
  const paid = Math.max(0, Number(student.feePaid) || 0);
  const balance = Math.max(0, REGISTRATION_FEE - paid);
  return {
    regNumber: student.regNumber,
    fullName: student.fullName,
    course: COURSE_NAMES[student.course] || student.course,
    status: student.status || 'Registered',
    intakeStart: student.intakeStart || currentIntakeOr(intake).startDate,
    fee: REGISTRATION_FEE,
    paid,
    balance,
    paymentStatus: paid >= REGISTRATION_FEE ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid'),
    attendance: { present, absent }
  };
});

exports.submitContactMessage = onCall({ enforceAppCheck: true }, async (request) => {
  const d = request.data || {};
  if (d.website) return { ok: true };
  const name = cleanString(d.name, 120);
  const email = cleanString(d.email, 160).toLowerCase();
  const message = cleanString(d.message, 1500);
  if (!name || !email || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid name, email and message.');
  await db.runTransaction(async tx => {
    const ref = refFor(KEYS.contacts);
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    list.push({ id: 'msg_' + crypto.randomUUID(), name, email, message, date: new Date().toISOString(), read: false });
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

async function migrateLegacyAdminIfNeeded() {
  const admins = await readValue(KEYS.admins, []);
  if (admins.length) return admins;
  const legacy = await readValue(KEYS.legacyAdmin, null);
  if (!legacy || !legacy.username || !legacy.pinHash) return [];
  const migrated = [{ id: 'adm_' + crypto.randomUUID(), name: legacy.name || legacy.username, username: legacy.username, pinHash: legacy.pinHash, recoveryHash: legacy.recoveryHash || '', role: 'owner' }];
  await writeValue(KEYS.admins, migrated);
  return migrated;
}

exports.adminLogin = onCall({ enforceAppCheck: true }, async (request) => {
  const username = cleanString(request.data && request.data.username, 80);
  const secret = String((request.data && request.data.password) || '');
  if (!username || !secret) throw new HttpsError('invalid-argument', 'Username and password are required.');
  await migrateLegacyAdminIfNeeded();
  const ref = refFor(KEYS.admins);
  let response = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (list.length && !list.some(a => a.role === 'owner')) list[0].role = 'owner';
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account) throw new HttpsError('permission-denied', 'Invalid username or password.');
    const minutes = isLocked(account);
    if (minutes) throw new HttpsError('resource-exhausted', `Account temporarily locked. Try again in about ${minutes} minute(s).`);
    const modernOk = verifyPassword(secret, account);
    const legacyOk = !account.passwordHash && verifyLegacyPin(secret, account);
    if (!modernOk && !legacyOk) {
      recordFailedLogin(account);
      tx.set(ref, { value: JSON.stringify(list) });
      throw new HttpsError('permission-denied', 'Invalid username or password.');
    }
    clearFailedLogin(account);
    tx.set(ref, { value: JSON.stringify(list) });
    response = { account: safeAdmin(account), upgradeRequired: legacyOk };
  });
  if (response.upgradeRequired) return response;
  const token = await admin.auth().createCustomToken('admin-' + response.account.id, { role: 'admin', adminRole: response.account.role || 'staff', username: response.account.username });
  return { ...response, token };
});

exports.upgradeAdminPassword = onCall({ enforceAppCheck: true }, async (request) => {
  const username = cleanString(request.data && request.data.username, 80);
  const currentPin = String((request.data && request.data.currentPin) || '');
  const newPassword = String((request.data && request.data.newPassword) || '');
  if (!passwordIsStrong(newPassword)) throw new HttpsError('invalid-argument', 'Use at least 12 characters with uppercase, lowercase and a number.');
  const ref = refFor(KEYS.admins);
  let accountOut = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account || !verifyLegacyPin(currentPin, account)) throw new HttpsError('permission-denied', 'Current PIN verification failed.');
    Object.assign(account, makePasswordRecord(newPassword));
    delete account.pinHash;
    clearFailedLogin(account);
    tx.set(ref, { value: JSON.stringify(list) });
    accountOut = safeAdmin(account);
  });
  const token = await admin.auth().createCustomToken('admin-' + accountOut.id, { role: 'admin', adminRole: accountOut.role || 'staff', username: accountOut.username });
  return { token, account: accountOut };
});

exports.facilitatorLogin = onCall({ enforceAppCheck: true }, async (request) => {
  const username = cleanString(request.data && request.data.username, 80);
  const secret = String((request.data && request.data.password) || '');
  if (!username || !secret) throw new HttpsError('invalid-argument', 'Username and password are required.');
  const ref = refFor(KEYS.facilitators);
  let response = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account) throw new HttpsError('permission-denied', 'Invalid username or password.');
    const minutes = isLocked(account);
    if (minutes) throw new HttpsError('resource-exhausted', `Account temporarily locked. Try again in about ${minutes} minute(s).`);
    const modernOk = verifyPassword(secret, account);
    const legacyOk = !account.passwordHash && verifyLegacyPin(secret, account);
    if (!modernOk && !legacyOk) {
      recordFailedLogin(account);
      tx.set(ref, { value: JSON.stringify(list) });
      throw new HttpsError('permission-denied', 'Invalid username or password.');
    }
    clearFailedLogin(account);
    tx.set(ref, { value: JSON.stringify(list) });
    response = { account: safeFacilitator(account), upgradeRequired: legacyOk };
  });
  if (response.upgradeRequired) return response;
  const token = await admin.auth().createCustomToken('fac-' + response.account.id, { role: 'facilitator', username: response.account.username });
  return { ...response, token };
});

exports.upgradeFacilitatorPassword = onCall({ enforceAppCheck: true }, async (request) => {
  const username = cleanString(request.data && request.data.username, 80);
  const currentPin = String((request.data && request.data.currentPin) || '');
  const newPassword = String((request.data && request.data.newPassword) || '');
  if (!passwordIsStrong(newPassword)) throw new HttpsError('invalid-argument', 'Use at least 12 characters with uppercase, lowercase and a number.');
  const ref = refFor(KEYS.facilitators);
  let accountOut = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const account = list.find(a => String(a.username || '').toLowerCase() === username.toLowerCase());
    if (!account || !verifyLegacyPin(currentPin, account)) throw new HttpsError('permission-denied', 'Current PIN verification failed.');
    Object.assign(account, makePasswordRecord(newPassword));
    delete account.pinHash;
    clearFailedLogin(account);
    tx.set(ref, { value: JSON.stringify(list) });
    accountOut = safeFacilitator(account);
  });
  const token = await admin.auth().createCustomToken('fac-' + accountOut.id, { role: 'facilitator', username: accountOut.username });
  return { token, account: accountOut };
});

exports.getAdminSnapshot = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request);
  const [students, admins, capacities, facilitators, attendance, intake, history, contacts, broadcasts, waitlist] = await Promise.all([
    readValue(KEYS.students, []), readValue(KEYS.admins, []), readValue(KEYS.capacities, {}), readValue(KEYS.facilitators, []),
    readValue(KEYS.attendance, []), readValue(KEYS.intake, DEFAULT_INTAKE), readValue(KEYS.intakeHistory, []),
    readValue(KEYS.contacts, []), readValue(KEYS.broadcasts, []), readValue(KEYS.waitlist, [])
  ]);
  return {
    students,
    admins: admins.map(safeAdmin),
    capacities,
    facilitators: facilitators.map(safeFacilitator),
    attendance,
    intake: currentIntakeOr(intake),
    intakeHistory: history,
    contactMessages: contacts,
    broadcasts,
    waitlist,
    registrationFee: REGISTRATION_FEE,
    courses: COURSE_NAMES
  };
});

exports.adminUpdateStudent = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request);
  const id = cleanString(request.data && request.data.id, 100);
  const patch = request.data && request.data.patch || {};
  const allowed = ['fullName','dob','gender','ghanaCard','gpsAddress','address','mobile','whatsapp','email','emName','emRel','emPhone','course','status'];
  const ref = refFor(KEYS.students);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const student = list.find(s => s.id === id);
    if (!student) throw new HttpsError('not-found', 'Student was not found.');
    for (const key of allowed) {
      if (!(key in patch)) continue;
      if (key === 'course' && !COURSE_NAMES[patch[key]]) throw new HttpsError('invalid-argument', 'Invalid program.');
      if (['mobile','whatsapp','emPhone'].includes(key)) {
        const p = normalizePhone(patch[key]);
        if (p && !/^0\d{9}$/.test(p)) throw new HttpsError('invalid-argument', 'Invalid phone number.');
        student[key] = p;
      } else student[key] = cleanString(patch[key], key === 'address' ? 200 : 160);
    }
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.adminAddPayment = onCall({ enforceAppCheck: true }, async request => {
  const token = requireAdmin(request);
  const id = cleanString(request.data && request.data.id, 100);
  const amount = Number(request.data && request.data.amount);
  const note = cleanString(request.data && request.data.note, 200);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new HttpsError('invalid-argument', 'Enter a valid payment amount.');
  const ref = refFor(KEYS.students);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const student = list.find(s => s.id === id);
    if (!student) throw new HttpsError('not-found', 'Student was not found.');
    if (!Array.isArray(student.payments)) student.payments = [];
    student.payments.push({ amount, date: new Date().toISOString(), note, recordedBy: token.username || '' });
    student.feePaid = student.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.adminDeleteStudent = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request, true);
  const id = cleanString(request.data && request.data.id, 100);
  const ref = refFor(KEYS.students);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) throw new HttpsError('not-found', 'Student was not found.');
    list.splice(idx, 1);
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.adminSetCapacity = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request, true);
  const course = cleanString(request.data && request.data.course, 60);
  const capacity = Number(request.data && request.data.capacity);
  if (!COURSE_NAMES[course] || !Number.isInteger(capacity) || capacity < 1 || capacity > 500) throw new HttpsError('invalid-argument', 'Invalid program capacity.');
  const ref = refFor(KEYS.capacities);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const map = snap.exists ? parseJson(snap.data().value, {}) : {};
    map[course] = capacity;
    tx.set(ref, { value: JSON.stringify(map) });
  });
  return { ok: true };
});

exports.adminCreateFacilitator = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request, true);
  const d = request.data || {};
  const name = cleanString(d.name, 120);
  const username = cleanString(d.username, 80);
  const phone = normalizePhone(d.phone);
  const password = String(d.password || '');
  const courses = Array.isArray(d.courses) ? d.courses.filter(c => COURSE_NAMES[c]) : [];
  if (!name || !username || !/^0\d{9}$/.test(phone) || !courses.length || !passwordIsStrong(password)) throw new HttpsError('invalid-argument', 'Provide a name, unique username, valid phone, program assignment and a strong password.');
  const ref = refFor(KEYS.facilitators);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (list.some(f => String(f.username || '').toLowerCase() === username.toLowerCase())) throw new HttpsError('already-exists', 'That facilitator username is already used.');
    list.push({ id: 'fac_' + crypto.randomUUID(), name, username, phone, courses, ...makePasswordRecord(password) });
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.adminDeleteFacilitator = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request, true);
  const id = cleanString(request.data && request.data.id, 100);
  const ref = refFor(KEYS.facilitators);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const idx = list.findIndex(f => f.id === id);
    if (idx < 0) throw new HttpsError('not-found', 'Facilitator was not found.');
    list.splice(idx, 1);
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.adminCreateAdmin = onCall({ enforceAppCheck: true }, async request => {
  requireAdmin(request, true);
  const d = request.data || {};
  const name = cleanString(d.name, 120);
  const username = cleanString(d.username, 80);
  const password = String(d.password || '');
  if (!name || !username || !passwordIsStrong(password)) throw new HttpsError('invalid-argument', 'Provide a name, unique username and a strong password.');
  const ref = refFor(KEYS.admins);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (list.some(a => String(a.username || '').toLowerCase() === username.toLowerCase())) throw new HttpsError('already-exists', 'That administrator username is already used.');
    list.push({ id: 'adm_' + crypto.randomUUID(), name, username, role: 'staff', ...makePasswordRecord(password) });
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.adminDeleteAdmin = onCall({ enforceAppCheck: true }, async request => {
  const token = requireAdmin(request, true);
  const id = cleanString(request.data && request.data.id, 100);
  const ref = refFor(KEYS.admins);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const target = list.find(a => a.id === id);
    if (!target) throw new HttpsError('not-found', 'Administrator was not found.');
    if (target.role === 'owner') throw new HttpsError('failed-precondition', 'The main administrator cannot be removed.');
    if (target.username === token.username) throw new HttpsError('failed-precondition', 'You cannot remove your current account.');
    const next = list.filter(a => a.id !== id);
    tx.set(ref, { value: JSON.stringify(next) });
  });
  return { ok: true };
});

exports.adminChangePassword = onCall({ enforceAppCheck: true }, async request => {
  const token = requireAdmin(request);
  const currentPassword = String(request.data && request.data.currentPassword || '');
  const newPassword = String(request.data && request.data.newPassword || '');
  if (!passwordIsStrong(newPassword)) throw new HttpsError('invalid-argument', 'Use at least 12 characters with uppercase, lowercase and a number.');
  const ref = refFor(KEYS.admins);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const account = list.find(a => a.username === token.username);
    if (!account || !verifyPassword(currentPassword, account)) throw new HttpsError('permission-denied', 'Current password is incorrect.');
    Object.assign(account, makePasswordRecord(newPassword));
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.getFacilitatorDashboard = onCall({ enforceAppCheck: true }, async request => {
  const token = requireFacilitator(request);
  const [facilitators, students, attendance, intake] = await Promise.all([
    readValue(KEYS.facilitators, []), readValue(KEYS.students, []), readValue(KEYS.attendance, []), readValue(KEYS.intake, DEFAULT_INTAKE)
  ]);
  const fac = facilitators.find(f => f.username === token.username);
  if (!fac) throw new HttpsError('permission-denied', 'Facilitator account no longer exists.');
  const courses = Array.isArray(fac.courses) ? fac.courses : [];
  const current = currentIntakeOr(intake);
  const roster = students.filter(s => courses.includes(s.course) && s.status !== 'Cancelled' && (s.intakeStart || '2026-09-26') === current.startDate).map(safeStudentForFacilitator);
  const marks = attendance.filter(r => courses.includes(r.course));
  return { account: safeFacilitator(fac), students: roster, attendance: marks, intake: current, courses: Object.fromEntries(courses.map(id => [id, COURSE_NAMES[id] || id])) };
});

exports.markFacilitatorAttendance = onCall({ enforceAppCheck: true }, async request => {
  const token = requireFacilitator(request);
  const d = request.data || {};
  const course = cleanString(d.course, 60);
  const date = cleanString(d.date, 10);
  const studentId = cleanString(d.studentId, 100);
  const status = cleanString(d.status, 20);
  const note = cleanString(d.note, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['Present','Absent',''].includes(status)) throw new HttpsError('invalid-argument', 'Invalid attendance entry.');
  const facilitators = await readValue(KEYS.facilitators, []);
  const fac = facilitators.find(f => f.username === token.username);
  if (!fac || !Array.isArray(fac.courses) || !fac.courses.includes(course)) throw new HttpsError('permission-denied', 'You are not assigned to this program.');
  const students = await readValue(KEYS.students, []);
  const student = students.find(s => s.id === studentId && s.course === course);
  if (!student) throw new HttpsError('not-found', 'Student was not found in this program.');
  const ref = refFor(KEYS.attendance);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const idx = list.findIndex(r => r.course === course && r.date === date && r.studentId === studentId);
    if (!status) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx] = { ...list[idx], status, note, markedBy: token.username, updatedAt: new Date().toISOString() };
    } else {
      list.push({ id: 'att_' + crypto.randomUUID(), course, date, studentId, status, note, markedBy: token.username, updatedAt: new Date().toISOString() });
    }
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

exports.sendCustomSms = onCall(
  { enforceAppCheck: true, secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER] },
  async request => {
    requireAdmin(request);
    const regNumber = cleanString(request.data && request.data.regNumber, 60);
    const message = cleanString(request.data && request.data.message, 480);
    if (!regNumber || !message) throw new HttpsError('invalid-argument', 'Registration number and message are required.');
    const students = await readValue(KEYS.students, []);
    const student = students.find(s => s.regNumber === regNumber);
    if (!student) throw new HttpsError('not-found', 'Student was not found.');
    const to = toE164Ghana(student.mobile);
    if (!to) throw new HttpsError('failed-precondition', 'Student does not have a valid mobile number.');
    try {
      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      await client.messages.create({ body: message, from: TWILIO_FROM_NUMBER.value(), to });
      return { sent: true };
    } catch (err) {
      logger.error('Twilio custom SMS failed', err);
      throw new HttpsError('internal', 'Could not send the SMS.');
    }
  }
);
