// Final production entrypoint. Extends the advanced admin suite with a dynamic
// registration-fee status calculation so the public status page always matches
// the fee configured by administrators.
const app = require('./admin-suite-loader');
const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const db = admin.firestore();
const baseStatus = app.checkStudentStatus;

app.checkStudentStatus = onCall({ enforceAppCheck: true }, async request => {
  const result = await baseStatus.run(request);
  const snap = await db.collection('sdta_storage').doc('sdta_admin_settings').get();
  let fee = 50;
  if (snap.exists) {
    try {
      const settings = JSON.parse(snap.data().value || '{}');
      const configured = Number(settings.registrationFee);
      if (Number.isFinite(configured) && configured >= 0) fee = configured;
    } catch (_) {}
  }
  const paid = Math.max(0, Number(result && result.paid) || 0);
  const balance = Math.max(0, fee - paid);
  return {
    ...(result || {}),
    fee,
    paid,
    balance,
    paymentStatus: paid >= fee ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid')
  };
});

module.exports = app;
