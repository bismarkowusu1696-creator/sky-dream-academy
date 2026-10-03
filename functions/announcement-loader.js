// Production entrypoint extension for website announcements.
// Keeps the existing guarded backend intact and adds authenticated admin
// controls for posting, hiding and deleting public website notices.
const app = require('./guarded-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE_COLLECTION = 'sdta_storage';
const ADMINS_KEY = 'sdta_admins';
const BROADCASTS_KEY = 'sdta_broadcasts';

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
}

function cleanString(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

async function requireAdminMembership(request) {
  const auth = request.auth;
  const token = auth && auth.token;
  if (!auth || !auth.uid || !token || token.role !== 'admin' || !token.username) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }

  const snap = await db.collection(STORAGE_COLLECTION).doc(ADMINS_KEY).get();
  const list = snap.exists ? parseJson(snap.data().value, []) : [];
  const username = String(token.username).toLowerCase();
  const account = list.find(item => String(item.username || '').toLowerCase() === username);

  if (!account || !account.id || auth.uid !== 'admin-' + account.id) {
    throw new HttpsError('permission-denied', 'This administrator session is no longer valid.');
  }
  return account;
}

app.adminCreateBroadcast = onCall({ enforceAppCheck: true }, async request => {
  const account = await requireAdminMembership(request);
  const message = cleanString(request.data && request.data.message, 500);
  if (!message) throw new HttpsError('invalid-argument', 'Enter an announcement message.');

  const ref = db.collection(STORAGE_COLLECTION).doc(BROADCASTS_KEY);
  let notice = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    let list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list)) list = [];
    notice = {
      id: 'notice_' + crypto.randomUUID(),
      message,
      date: new Date().toISOString(),
      active: true,
      createdBy: account.username
    };
    list.push(notice);
    // Keep a practical history without allowing this legacy JSON document to grow forever.
    if (list.length > 100) list = list.slice(-100);
    tx.set(ref, { value: JSON.stringify(list) });
  });

  return { ok: true, notice };
});

app.adminSetBroadcastActive = onCall({ enforceAppCheck: true }, async request => {
  await requireAdminMembership(request);
  const id = cleanString(request.data && request.data.id, 120);
  const active = request.data && request.data.active === true;
  if (!id) throw new HttpsError('invalid-argument', 'Announcement ID is required.');

  const ref = db.collection(STORAGE_COLLECTION).doc(BROADCASTS_KEY);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    const notice = Array.isArray(list) ? list.find(item => item && item.id === id) : null;
    if (!notice) throw new HttpsError('not-found', 'Announcement not found.');
    notice.active = active;
    tx.set(ref, { value: JSON.stringify(list) });
  });
  return { ok: true };
});

app.adminDeleteBroadcast = onCall({ enforceAppCheck: true }, async request => {
  await requireAdminMembership(request);
  const id = cleanString(request.data && request.data.id, 120);
  if (!id) throw new HttpsError('invalid-argument', 'Announcement ID is required.');

  const ref = db.collection(STORAGE_COLLECTION).doc(BROADCASTS_KEY);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const list = snap.exists ? parseJson(snap.data().value, []) : [];
    if (!Array.isArray(list) || !list.some(item => item && item.id === id)) {
      throw new HttpsError('not-found', 'Announcement not found.');
    }
    tx.set(ref, { value: JSON.stringify(list.filter(item => item && item.id !== id)) });
  });
  return { ok: true };
});

module.exports = app;
