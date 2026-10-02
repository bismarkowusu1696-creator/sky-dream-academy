// Production entrypoint for installations without an SMS provider.
// All secure handlers from secure-index remain active. Registration is
// overridden so it never depends on Twilio secrets, and custom SMS returns a
// clear configuration error until an SMS provider is added.
const existing = require('./secure-index');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE_COLLECTION = 'sdta_storage';
const KEYS = {
  students: 'sdta_students',
  capacities: 'sdta_capacities',
  intake: 'sdta_intake',
  waitlist: 'sdta_waitlist',
  admins: 'sdta_admins'
};

const DEFAULT_CAPACITY = 25;
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
const cleanString = (value, max = 200) => String(value == null ? '' : value).trim().slice(0, max);
const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3);
  return digits;
};
const normalizeGhanaCard = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const currentIntakeOr = value => value && value.startDate ? value : DEFAULT_INTAKE;
const todayIso = () => new Date().toISOString().slice(0, 10);

function nextRegNumber(courseId, list, intakeStartISO) {
  const code = COURSE_CODES[courseId] || String(courseId || '').slice(0, 2).toUpperCase();
  const prefix = 'SD' + code;
  const used = new Set((list || []).filter(s => s.course === courseId).map(s => {
    const m = s.regNumber && String(s.regNumber).match(new RegExp('^' + prefix + '(\\d{3})/'));
    return m ? parseInt(m[1], 10) : null;
  }).filter(n => n !== null));
  let idx = 1;
  while (used.has(idx)) idx += 1;
  const d = new Date((intakeStartISO || DEFAULT_INTAKE.startDate) + 'T00:00:00Z');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return prefix + String(idx).padStart(3, '0') + '/' + month + '/' + d.getUTCFullYear();
}

const registerStudent = onCall({ enforceAppCheck: true }, async request => {
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(new Date(dob + 'T00:00:00Z').getTime())) {
    throw new HttpsError('invalid-argument', 'Please enter a valid date of birth.');
  }
  if (dob > todayIso()) {
    throw new HttpsError('invalid-argument', 'Date of birth cannot be in the future.');
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

    const duplicate = students.find(s => s.status !== 'Cancelled' &&
      (s.intakeStart || '2026-09-26') === intake.startDate &&
      (normalizePhone(s.mobile) === mobile || (ghanaNorm && normalizeGhanaCard(s.ghanaCard) === ghanaNorm)));
    if (duplicate) {
      throw new HttpsError('already-exists', 'This mobile number or Ghana Card is already registered for the current intake.');
    }

    const capacity = Number(capacities[course]) > 0 ? Number(capacities[course]) : DEFAULT_CAPACITY;
    const taken = students.filter(s => s.course === course && s.status !== 'Cancelled' &&
      (s.intakeStart || '2026-09-26') === intake.startDate).length;

    if (taken >= capacity) {
      if (!waitlist.some(w => normalizePhone(w.mobile) === mobile && w.course === course)) {
        waitlist.push({
          id: 'wait_' + crypto.randomUUID(), fullName, mobile, whatsapp, email, course,
          date: new Date().toISOString()
        });
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
  return {
    waitlisted: false,
    regNumber: createdStudent.regNumber,
    fullName: createdStudent.fullName,
    courseName: COURSE_NAMES[course],
    smsSent: false
  };
});

const sendCustomSms = onCall({ enforceAppCheck: true }, async request => {
  const token = request.auth && request.auth.token;
  if (!token || token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  const adminsSnap = await refFor(KEYS.admins).get();
  const admins = adminsSnap.exists ? parseJson(adminsSnap.data().value, []) : [];
  const active = admins.some(a => String(a.username || '').toLowerCase() === String(token.username || '').toLowerCase());
  if (!active) throw new HttpsError('permission-denied', 'This administrator account is no longer active.');
  throw new HttpsError('failed-precondition', 'SMS is not configured yet. Registration and all other website features remain available.');
});

module.exports = {
  ...existing,
  registerStudent,
  sendCustomSms
};
