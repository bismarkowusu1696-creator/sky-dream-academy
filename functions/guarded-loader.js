// Final production wrapper. Keeps the hardened no-SMS backend intact while
// adding public abuse controls and registration-window enforcement.
const app = require('./no-secret-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE_COLLECTION = 'sdta_storage';
const RATE_LIMIT_COLLECTION = 'sdta_rate_limits';

const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
};

const cleanDate = value => String(value || '').trim().slice(0, 10);
const validIsoDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

function friendlyDate(value) {
  if (!validIsoDate(value)) return value || '';
  return new Date(value + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

async function readStorageJson(key, fallback) {
  const snap = await db.collection(STORAGE_COLLECTION).doc(key).get();
  return snap.exists ? parseJson(snap.data().value, fallback) : fallback;
}

function requestIp(request) {
  const raw = request && request.rawRequest;
  if (!raw) return '';
  if (raw.ip) return String(raw.ip);
  const forwarded = raw.headers && raw.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length) return String(forwarded[0]).split(',')[0].trim();
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return raw.socket && raw.socket.remoteAddress ? String(raw.socket.remoteAddress) : '';
}

async function enforceRateLimit(request, kind, maxRequests, windowMs) {
  const ip = requestIp(request);
  // App Check still protects the endpoint if the platform does not expose an IP.
  if (!ip) return;

  const id = crypto.createHash('sha256').update(`${kind}|${ip}`).digest('hex');
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(id);
  const now = Date.now();

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    let windowStart = Number(data.windowStart) || now;
    let count = Number(data.count) || 0;

    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    if (count >= maxRequests) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a little and try again.');
    }

    tx.set(ref, {
      kind,
      windowStart,
      count: count + 1,
      expiresAt: admin.firestore.Timestamp.fromMillis(windowStart + (windowMs * 2))
    }, { merge: true });
  });
}

function registrationWindow(intake) {
  const value = intake || {};
  const openDate = validIsoDate(value.registrationOpenDate) ? value.registrationOpenDate : '';
  const configuredClose = validIsoDate(value.registrationCloseDate) ? value.registrationCloseDate : '';
  const intakeEnd = validIsoDate(value.endDate) ? value.endDate : '';

  // Older intake records automatically used the orientation/start date as the
  // registration closing date. That made registration close immediately after
  // orientation. Treat that legacy value as "no custom close date" and keep
  // registration open through the intake end date instead.
  const legacyAutoClose = configuredClose && validIsoDate(value.startDate) && configuredClose === value.startDate;
  const closeDate = legacyAutoClose ? intakeEnd : (configuredClose || intakeEnd);
  return { openDate, closeDate };
}

function ensureCallable(callable, name) {
  if (!callable || typeof callable.run !== 'function') {
    throw new HttpsError('internal', `${name} handler is unavailable.`);
  }
}

const baseCatalog = app.publicCatalog;
app.publicCatalog = onCall({ enforceAppCheck: true }, async request => {
  ensureCallable(baseCatalog, 'Catalog');
  const result = await baseCatalog.run(request);
  const intake = { ...((result && result.intake) || {}) };
  const window = registrationWindow(intake);
  intake.registrationOpenDate = window.openDate;
  intake.registrationCloseDate = window.closeDate;
  return { ...(result || {}), intake };
});

const baseRegister = app.registerStudent;
app.registerStudent = onCall({ enforceAppCheck: true }, async request => {
  await enforceRateLimit(request, 'register', 30, 60 * 60 * 1000);
  const intake = await readStorageJson('sdta_intake', {});
  const window = registrationWindow(intake);
  const today = todayIso();

  if (window.openDate && today < window.openDate) {
    throw new HttpsError('failed-precondition', `Online registration opens on ${friendlyDate(window.openDate)}.`);
  }
  if (window.closeDate && today > window.closeDate) {
    throw new HttpsError('failed-precondition', `Online registration for this intake closed on ${friendlyDate(window.closeDate)}. Please contact the academy if you need assistance.`);
  }

  ensureCallable(baseRegister, 'Registration');
  return baseRegister.run(request);
});

const baseStatus = app.checkStudentStatus;
app.checkStudentStatus = onCall({ enforceAppCheck: true }, async request => {
  await enforceRateLimit(request, 'status', 60, 15 * 60 * 1000);
  ensureCallable(baseStatus, 'Status');
  return baseStatus.run(request);
});

const baseContact = app.submitContactMessage;
app.submitContactMessage = onCall({ enforceAppCheck: true }, async request => {
  await enforceRateLimit(request, 'contact', 20, 60 * 60 * 1000);
  ensureCallable(baseContact, 'Contact');
  return baseContact.run(request);
});

const baseNextIntake = app.adminStartNextIntake;
app.adminStartNextIntake = onCall({ enforceAppCheck: true }, async request => {
  const data = request.data || {};
  const startDate = cleanDate(data.startDate);
  const endDate = cleanDate(data.endDate);
  const openDate = cleanDate(data.registrationOpenDate);
  const requestedClose = cleanDate(data.registrationCloseDate);
  const closeDate = requestedClose || (validIsoDate(endDate) ? endDate : '');

  if (openDate && !validIsoDate(openDate)) {
    throw new HttpsError('invalid-argument', 'The registration opening date is invalid.');
  }
  if (closeDate && !validIsoDate(closeDate)) {
    throw new HttpsError('invalid-argument', 'The registration closing date is invalid.');
  }
  if (openDate && closeDate && openDate > closeDate) {
    throw new HttpsError('invalid-argument', 'Registration cannot open after it closes.');
  }

  ensureCallable(baseNextIntake, 'Next intake');
  const result = await baseNextIntake.run(request);

  const intakeRef = db.collection(STORAGE_COLLECTION).doc('sdta_intake');
  let updatedIntake = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(intakeRef);
    const current = snap.exists ? parseJson(snap.data().value, {}) : {};
    if (!current || current.startDate !== startDate) {
      throw new HttpsError('aborted', 'The intake changed while registration dates were being saved. Please try again.');
    }
    updatedIntake = {
      ...current,
      registrationOpenDate: openDate,
      registrationCloseDate: closeDate
    };
    tx.set(intakeRef, { value: JSON.stringify(updatedIntake) });
  });

  return { ...(result || {}), intake: updatedIntake };
});

module.exports = app;
