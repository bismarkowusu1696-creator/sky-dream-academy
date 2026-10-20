'use strict';

// Extra Firestore collections created by newer SkyDream features are not included
// in the legacy sdta_storage JSON snapshot. Export them in small ordered pages.
// A complete legacy snapshot manifest is saved only after all pages succeed.
const BACKUP_COLLECTIONS = Object.freeze([
  'sdta_storage',
  'sdta_student_messages',
  'sdta_facilitator_messages',
  'sdta_student_push_tokens',
  'sdta_qr_attendance_sessions',
  'sdta_registration_workflow_rows',
  'sdta_facilitator_onboarding_rows',
  'sdta_admin_audit_archive',
  'sdta_desk_daily_reports',
  'sdta_assessment_records',
  'sdta_timetable_entries',
  'sdta_rooms',
  'sdta_admin_recovery_codes'
]);

async function backupCollections({ db, bucket, prefix, firestore, collections = BACKUP_COLLECTIONS, pageSize = 25 }) {
  if (!db || !bucket || !firestore || !firestore.FieldPath || !prefix ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid backup configuration.');
  }
  const manifest = {};
  for (const name of collections) {
    if (!/^sdta_[a-z_]+$/.test(name)) throw new Error('Invalid Firestore collection name: ' + name);
    const collection = db.collection(name);
    let lastDocument = null, part = 0, total = 0;
    const files = [];
    for (;;) {
      let query = collection.orderBy(firestore.FieldPath.documentId());
      if (lastDocument) query = query.startAfter(lastDocument);
      const snapshot = await query.limit(pageSize).get();
      if (snapshot.empty || snapshot.docs.length === 0) break;
      const records = snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
      const relative = 'collections/' + name + '/part-' + String(part).padStart(6, '0') + '.json';
      await bucket.file(prefix + '/' + relative).save(JSON.stringify({
        collection: name, formatVersion: 1, records
      }), {
        contentType: 'application/json',
        resumable: false,
        metadata: { cacheControl: 'private, no-store' }
      });
      files.push(relative);
      total += snapshot.docs.length;
      part += 1;
      lastDocument = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < pageSize) break;
    }
    manifest[name] = { documents: total, parts: part, files };
  }
  return manifest;
}

module.exports = { BACKUP_COLLECTIONS, backupCollections };
