// Final facilitator authentication repair layer.
// Some wrapped callable handlers can lose Firebase callable auth metadata when
// they invoke another handler through .run(). The facilitator UI therefore
// includes the current Firebase ID token as a fallback. This loader verifies
// that token and rebuilds an explicit auth context before delegating to the
// existing secured facilitator handlers, preserving all current attendance and
// intake/session rules.
const app = require('./facilitator-create-fix-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

async function resolveFacilitatorAuth(request) {
  const direct = request && request.auth;
  if (direct && direct.uid && direct.token && direct.token.role === 'facilitator' && direct.token.username) {
    return direct;
  }

  const explicit = String(request && request.data && request.data._facIdToken || '').trim();
  if (!explicit) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(explicit);
    if (decoded.role !== 'facilitator' || !decoded.username || !decoded.uid) return null;
    return { uid: decoded.uid, token: decoded };
  } catch (_) {
    return null;
  }
}

function repairFacilitatorCallable(name) {
  const base = app[name];
  if (!base || typeof base.run !== 'function') return;

  app[name] = onCall({ enforceAppCheck: true }, async request => {
    const auth = await resolveFacilitatorAuth(request);
    if (!auth) {
      throw new HttpsError('permission-denied', 'Facilitator access is required. Please sign out and sign in again.');
    }

    const data = { ...(request.data || {}) };
    delete data._facIdToken;

    return base.run({
      data,
      auth,
      app: request.app,
      rawRequest: request.rawRequest,
      instanceIdToken: request.instanceIdToken
    });
  });
}

repairFacilitatorCallable('getFacilitatorDashboard');
repairFacilitatorCallable('markFacilitatorAttendance');
repairFacilitatorCallable('facilitatorSendStudentMessage');
repairFacilitatorCallable('facilitatorCreateQrAttendance');

module.exports = app;
