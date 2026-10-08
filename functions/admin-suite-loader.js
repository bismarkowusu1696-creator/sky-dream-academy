// Advanced administration extension for SkyDream.
// Adds student profiles/report data, attendance analytics, facilitator management,
// role controls, bulk student actions, audit logs, registration settings and
// scheduled announcements while preserving the existing production backend.
const app = require('./announcement-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STUDENT_MESSAGE_COLLECTION = 'sdta_student_messages';
const STORAGE_COLLECTION = 'sdta_storage';
const KEYS = {
  students: 'sdta_students',
  admins: 'sdta_admins',
  capacities: 'sdta_capacities',
  facilitators: 'sdta_facilitators',
  attendance: 'sdta_attendance',
  intake: 'sdta_intake',
  broadcasts: 'sdta_broadcasts',
  settings: 'sdta_admin_settings',
  audit: 'sdta_activity_log'
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

const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: ['registrations'],
  staff: ['registrations'],
  registration: ['registrations'],
  finance: ['registrations'],
  viewer: ['registrations']
};

const DEFAULT_SETTINGS = {
  registrationEnabled: true,
  registrationFee: 50,
  hiddenCourses: []
};

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}
function cleanString(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function refFor(key) { return db.collection(STORAGE_COLLECTION).doc(key); }
async function readValue(key, fallback) {
  const snap = await refFor(key).get();
  return snap.exists ? parseJson(snap.data().value, fallback) : fallback;
}
async function writeValue(key, value) {
  await refFor(key).set({ value: JSON.stringify(value) });
}
function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.staff;
}
async function adminAccountFor(request) {
  const auth = request.auth;
  const token = auth && auth.token;
  if (!auth || !auth.uid || !token || token.role !== 'admin' || !token.username) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  const admins = await readValue(KEYS.admins, []);
  const username = String(token.username).toLowerCase();
  const account = admins.find(item => String(item.username || '').toLowerCase() === username);
  if (!account || !account.id || auth.uid !== 'admin-' + account.id) {
    throw new HttpsError('permission-denied', 'This administrator session is no longer valid.');
  }
  return account;
}
async function requireAdminPermission(request, permission, ownerOnly = false) {
  const account = await adminAccountFor(request);
  const role = account.role || 'staff';
  const permissions = permissionsFor(role);
  if (ownerOnly && role !== 'owner') {
    throw new HttpsError('permission-denied', 'Main administrator access is required.');
  }
  if (!ownerOnly && !permissions.includes('*') && !permissions.includes(permission)) {
    throw new HttpsError('permission-denied', 'Your administrator role does not allow this action.');
  }
  return account;
}
async function appendAudit(account, action, detail = '', target = '') {
  try {
    const ref = refFor(KEYS.audit);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      let list = snap.exists ? parseJson(snap.data().value, []) : [];
      if (!Array.isArray(list)) list = [];
      list.push({
        id: 'audit_' + crypto.randomUUID(),
        date: new Date().toISOString(),
        admin: account ? account.username : 'system',
        role: account ? (account.role || 'staff') : 'system',
        action: cleanString(action, 100),
        target: cleanString(target, 140),
        detail: cleanString(detail, 300)
      });
      if (list.length > 500) list = list.slice(-500);
      tx.set(ref, { value: JSON.stringify(list) });
    });
  } catch (_) {}
}
function validCourse(id) { return !!COURSE_NAMES[id]; }
function validDate(value) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function validDateTime(value) {
  if (!value) return true;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

// Apply granular permissions and activity logging to important existing admin actions.
function wrapAdminAction(name, permission, action, ownerOnly = false) {
  const base = app[name];
  if (!base || typeof base.run !== 'function') return;
  app[name] = onCall({ enforceAppCheck: true }, async request => {
    const account = await requireAdminPermission(request, permission, ownerOnly);
    const result = await base.run(request);
    const d = request.data || {};
    const target = cleanString(d.id || d.regNumber || d.course || d.username || '', 120);
    await appendAudit(account, action, '', target);
    return result;
  });
}

wrapAdminAction('adminUpdateStudent', 'students', 'Updated student');
wrapAdminAction('adminAddPayment', 'students', 'Recorded student payment');
wrapAdminAction('adminDeleteStudent', 'students', 'Deleted student', true);
wrapAdminAction('adminSetCapacity', 'settings', 'Changed program capacity');
wrapAdminAction('adminCreateFacilitator', 'facilitators', 'Created facilitator');
wrapAdminAction('adminDeleteFacilitator', 'facilitators', 'Deleted facilitator');
wrapAdminAction('adminSetFacilitatorPin', 'facilitators', 'Reset facilitator PIN');
wrapAdminAction('adminCreateAdmin', 'settings', 'Created administrator', true);
wrapAdminAction('adminDeleteAdmin', 'settings', 'Deleted administrator', true);
wrapAdminAction('adminStartNextIntake', 'settings', 'Started next intake', true);

// One consolidated snapshot powers analytics, profiles, reports and management tools.
app.adminGetSuiteSnapshot = onCall({ enforceAppCheck: true }, async request => {
  const account = await adminAccountFor(request);
  const [students, admins, capacities, facilitators, attendance, intake, broadcasts, settings, audit, messageSnap] = await Promise.all([
    readValue(KEYS.students, []),
    readValue(KEYS.admins, []),
    readValue(KEYS.capacities, {}),
    readValue(KEYS.facilitators, []),
    readValue(KEYS.attendance, []),
    readValue(KEYS.intake, {}),
    readValue(KEYS.broadcasts, []),
    readValue(KEYS.settings, DEFAULT_SETTINGS),
    readValue(KEYS.audit, []),
    db.collection(STUDENT_MESSAGE_COLLECTION).limit(5000).get()
  ]);
  const messageDocs = messageSnap.docs.map(doc => doc.data() || {});
  const messageStats = {
    total: messageDocs.length,
    unread: messageDocs.filter(m => !m.readAt).length,
    read: messageDocs.filter(m => !!m.readAt).length
  };
  return {
    account: { id: account.id, username: account.username, name: account.name || '', role: account.role || 'staff' },
    permissions: permissionsFor(account.role || 'staff'),
    students,
    admins: admins.map(a => ({ id: a.id, username: a.username, name: a.name || '', role: a.role || 'staff' })),
    capacities,
    facilitators: facilitators.map(f => ({ id: f.id, name: f.name, username: f.username, phone: f.phone || '', courses: Array.isArray(f.courses) ? f.courses : [], active: f.active !== false })),
    attendance,
    intake,
    broadcasts,
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    audit: Array.isArray(audit) ? audit.slice(-250).reverse() : [],
    messageStats,
    courses: COURSE_NAMES,
    roles: Object.keys(ROLE_PERMISSIONS)
  };
});

app.adminBulkUpdateStudents = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'students');
  const ids = Array.isArray(request.data && request.data.ids) ? request.data.ids.map(String).slice(0, 100) : [];
  const status = cleanString(request.data && request.data.status, 30);
  const course = cleanString(request.data && request.data.course, 60);
  const validStatuses = ['Registered', 'Active', 'Completed', 'Deferred', 'Cancelled'];
  if (!ids.length) throw new HttpsError('invalid-argument', 'Select at least one student.');
  if (status && !validStatuses.includes(status)) throw new HttpsError('invalid-argument', 'Invalid student status.');
  if (course && !validCourse(course)) throw new HttpsError('invalid-argument', 'Invalid program.');
  if (!status && !course) throw new HttpsError('invalid-argument', 'Choose a status or program to update.');

  const ref = refFor(KEYS.students);
  let changed = 0;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    list.forEach(student => {
      if (!ids.includes(String(student.id))) return;
      if (status) student.status = status;
      if (course) student.course = course;
      changed++;
    });
    tx.set(ref, { value: JSON.stringify(list) });
  });
  await appendAudit(account, 'Bulk updated students', `${changed} student record(s) changed`, ids.slice(0, 5).join(', '));
  return { ok: true, changed };
});

app.adminUpdateFacilitator = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'facilitators');
  const data = request.data || {};
  const id = cleanString(data.id, 120);
  const name = cleanString(data.name, 120);
  const phone = cleanString(data.phone, 30).replace(/\D/g, '');
  const courses = Array.isArray(data.courses) ? data.courses.filter(validCourse) : [];
  const active = data.active !== false;
  if (!id || !name || !/^0\d{9}$/.test(phone)) throw new HttpsError('invalid-argument', 'Name and a valid Ghana phone number are required.');

  const ref = refFor(KEYS.facilitators);
  let facilitator = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    facilitator = list.find(f => f.id === id);
    if (!facilitator) throw new HttpsError('not-found', 'Facilitator not found.');
    facilitator.name = name;
    facilitator.phone = phone;
    facilitator.courses = courses;
    facilitator.active = active;
    tx.set(ref, { value: JSON.stringify(list) });
  });
  try { await admin.auth().revokeRefreshTokens('fac-' + id); } catch (_) {}
  await appendAudit(account, 'Updated facilitator', active ? 'Account active' : 'Account disabled', facilitator.username || id);
  return { ok: true };
});

app.adminSetAdminRole = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'settings', true);
  const id = cleanString(request.data && request.data.id, 120);
  const role = cleanString(request.data && request.data.role, 30);
  if (!id || !ROLE_PERMISSIONS[role] || role === 'owner') throw new HttpsError('invalid-argument', 'Choose a valid staff role.');

  const ref = refFor(KEYS.admins);
  let target = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    target = list.find(a => a.id === id);
    if (!target) throw new HttpsError('not-found', 'Administrator not found.');
    if ((target.role || 'staff') === 'owner') throw new HttpsError('failed-precondition', 'The main administrator role cannot be changed.');
    target.role = role;
    tx.set(ref, { value: JSON.stringify(list) });
  });
  try { await admin.auth().revokeRefreshTokens('admin-' + id); } catch (_) {}
  await appendAudit(account, 'Changed administrator role', `Role changed to ${role}`, target.username || id);
  return { ok: true };
});

app.adminSaveRegistrationSettings = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'settings');
  const data = request.data || {};
  const registrationEnabled = data.registrationEnabled !== false;
  const registrationFee = Number(data.registrationFee);
  const hiddenCourses = Array.isArray(data.hiddenCourses) ? [...new Set(data.hiddenCourses.filter(validCourse))] : [];
  const registrationOpenDate = cleanString(data.registrationOpenDate, 10);
  const registrationCloseDate = cleanString(data.registrationCloseDate, 10);
  if (!Number.isFinite(registrationFee) || registrationFee < 0 || registrationFee > 10000) throw new HttpsError('invalid-argument', 'Registration fee is invalid.');
  if (!validDate(registrationOpenDate) || !validDate(registrationCloseDate)) throw new HttpsError('invalid-argument', 'Registration dates are invalid.');
  if (registrationOpenDate && registrationCloseDate && registrationOpenDate > registrationCloseDate) throw new HttpsError('invalid-argument', 'Registration cannot open after it closes.');

  const settings = { registrationEnabled, registrationFee, hiddenCourses };
  await writeValue(KEYS.settings, settings);

  const intakeRef = refFor(KEYS.intake);
  await db.runTransaction(async tx => {
    const snap = await tx.get(intakeRef);
    const intake = snap.exists ? parseJson(snap.data().value, {}) : {};
    intake.registrationOpenDate = registrationOpenDate;
    intake.registrationCloseDate = registrationCloseDate;
    tx.set(intakeRef, { value: JSON.stringify(intake) });
  });
  await appendAudit(account, 'Changed registration settings', `Registration ${registrationEnabled ? 'enabled' : 'disabled'}; fee GHS ${registrationFee}`);
  return { ok: true };
});

// Upgrade the existing announcement functions with optional scheduling.
app.adminCreateBroadcast = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'announcements');
  const message = cleanString(request.data && request.data.message, 500);
  const startsAt = cleanString(request.data && request.data.startsAt, 40);
  const expiresAt = cleanString(request.data && request.data.expiresAt, 40);
  if (!message) throw new HttpsError('invalid-argument', 'Enter an announcement message.');
  if (!validDateTime(startsAt) || !validDateTime(expiresAt)) throw new HttpsError('invalid-argument', 'Announcement schedule is invalid.');
  if (startsAt && expiresAt && new Date(startsAt).getTime() >= new Date(expiresAt).getTime()) throw new HttpsError('invalid-argument', 'Announcement expiry must be after its start time.');

  const ref = refFor(KEYS.broadcasts);
  let notice = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    let list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list)) list = [];
    notice = {
      id: 'notice_' + crypto.randomUUID(), message, date: new Date().toISOString(), active: true,
      startsAt: startsAt || '', expiresAt: expiresAt || '', createdBy: account.username
    };
    list.push(notice);
    if (list.length > 100) list = list.slice(-100);
    tx.set(ref, { value: JSON.stringify(list) });
  });
  await appendAudit(account, 'Posted website announcement', message.slice(0, 100), notice.id);
  return { ok: true, notice };
});

app.adminSetBroadcastActive = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'announcements');
  const id = cleanString(request.data && request.data.id, 120);
  const active = request.data && request.data.active === true;
  const ref = refFor(KEYS.broadcasts);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const item = Array.isArray(list) ? list.find(x => x && x.id === id) : null;
    if (!item) throw new HttpsError('not-found', 'Announcement not found.');
    item.active = active;
    tx.set(ref, { value: JSON.stringify(list) });
  });
  await appendAudit(account, active ? 'Activated announcement' : 'Hidden announcement', '', id);
  return { ok: true };
});

app.adminDeleteBroadcast = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminPermission(request, 'announcements');
  const id = cleanString(request.data && request.data.id, 120);
  const ref = refFor(KEYS.broadcasts);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list) || !list.some(x => x && x.id === id)) throw new HttpsError('not-found', 'Announcement not found.');
    tx.set(ref, { value: JSON.stringify(list.filter(x => x && x.id !== id)) });
  });
  await appendAudit(account, 'Deleted announcement', '', id);
  return { ok: true };
});

// Public catalog respects course visibility, registration settings and schedules.
const baseCatalog = app.publicCatalog;
app.publicCatalog = onCall({ enforceAppCheck: true }, async request => {
  const result = await baseCatalog.run(request);
  const [settings, broadcasts] = await Promise.all([
    readValue(KEYS.settings, DEFAULT_SETTINGS),
    readValue(KEYS.broadcasts, [])
  ]);
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const hidden = new Set(Array.isArray(merged.hiddenCourses) ? merged.hiddenCourses : []);
  const now = Date.now();
  const notices = (Array.isArray(broadcasts) ? broadcasts : [])
    .filter(n => {
      if (!n || n.active === false) return false;
      if (n.startsAt && new Date(n.startsAt).getTime() > now) return false;
      if (n.expiresAt && new Date(n.expiresAt).getTime() <= now) return false;
      return true;
    })
    .slice(-5)
    .map(n => ({ id: n.id, message: cleanString(n.message, 500), date: n.date || '' }));
  return {
    ...(result || {}),
    programs: Array.isArray(result && result.programs) ? result.programs.filter(p => !hidden.has(p.id)) : [],
    registrationFee: Number.isFinite(Number(merged.registrationFee)) ? Number(merged.registrationFee) : 50,
    registrationEnabled: merged.registrationEnabled !== false,
    notices
  };
});

const baseRegister = app.registerStudent;
app.registerStudent = onCall({ enforceAppCheck: true }, async request => {
  const settings = { ...DEFAULT_SETTINGS, ...(await readValue(KEYS.settings, DEFAULT_SETTINGS)) };
  const course = cleanString(request.data && request.data.course, 60);
  if (settings.registrationEnabled === false) throw new HttpsError('failed-precondition', 'Online registration is currently paused. Please contact the academy for assistance.');
  if (Array.isArray(settings.hiddenCourses) && settings.hiddenCourses.includes(course)) throw new HttpsError('failed-precondition', 'This program is not currently accepting online registrations.');
  return baseRegister.run(request);
});

// Disabled facilitator accounts cannot start or continue dashboard sessions.
const baseFacilitatorLogin = app.facilitatorLogin;
app.facilitatorLogin = onCall({ enforceAppCheck: true }, async request => {
  const username = cleanString(request.data && request.data.username, 80).toLowerCase();
  const facilitators = await readValue(KEYS.facilitators, []);
  const facilitator = facilitators.find(f => String(f.username || '').toLowerCase() === username);
  if (facilitator && facilitator.active === false) throw new HttpsError('permission-denied', 'This facilitator account is disabled. Contact the administrator.');
  return baseFacilitatorLogin.run(request);
});

const baseFacDashboard = app.getFacilitatorDashboard;
app.getFacilitatorDashboard = onCall({ enforceAppCheck: true }, async request => {
  const token = request.auth && request.auth.token;
  const username = token && token.username ? String(token.username).toLowerCase() : '';
  const facilitators = await readValue(KEYS.facilitators, []);
  const facilitator = facilitators.find(f => String(f.username || '').toLowerCase() === username);
  if (facilitator && facilitator.active === false) throw new HttpsError('permission-denied', 'This facilitator account is disabled.');
  return baseFacDashboard.run(request);
});

module.exports = app;
