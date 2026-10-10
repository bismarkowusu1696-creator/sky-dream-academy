'use strict';
const assert = require('node:assert/strict');
const { BACKUP_COLLECTIONS, backupCollections } = require('../functions/backup-collections');

function setup(fixtures, failurePath = '') {
  const files = new Map();
  const db = {
    collection(name) {
      let after = '', pageSize = 25;
      const chain = {
        orderBy(field) {
          assert.equal(field, '__name__');
          return chain;
        },
        startAfter(document) { after = document.id; return chain; },
        limit(value) { pageSize = value; return chain; },
        async get() {
          const docs = (fixtures[name] || []).filter(x => x.id > after)
            .sort((a,b) => a.id.localeCompare(b.id)).slice(0, pageSize)
            .map(row => ({ id: row.id, data: () => row.data }));
          return { empty: docs.length === 0, docs };
        }
      };
      return chain;
    }
  };
  const bucket = {
    file(path) {
      return {
        async save(payload, config) {
          if (path === failurePath) throw new Error('Simulated Cloud Storage outage');
          assert.equal(config.contentType, 'application/json');
          assert.equal(config.metadata.cacheControl, 'private, no-store');
          files.set(path, JSON.parse(payload));
        }
      };
    }
  };
  return { db, bucket, files };
}

async function main() {
  assert(BACKUP_COLLECTIONS.includes('sdta_storage'));
  for (const collection of ['sdta_student_messages','sdta_admin_audit_archive',
    'sdta_registration_workflow_rows','sdta_facilitator_onboarding_rows',
    'sdta_desk_daily_reports','sdta_admin_recovery_codes']) {
    assert(BACKUP_COLLECTIONS.includes(collection), 'Backup missing '+collection);
  }
  const fx = {
    sdta_storage:[{id:'a',data:{value:'[]'}}],
    sdta_student_messages:[
      {id:'a',data:{message:'One'}},{id:'b',data:{message:'Two'}},
      {id:'c',data:{message:'Three'}}
    ]
  };
  const prefix='admin-backups/2026-10-10/skydream-test';
  const firestore={FieldPath:{documentId:()=> '__name__'}};
  const h=setup(fx);
  const manifest=await backupCollections({
    db:h.db,bucket:h.bucket,firestore,prefix,pageSize:2
  });
  assert.equal(manifest.sdta_storage.documents,1);
  assert.equal(manifest.sdta_student_messages.documents,3);
  assert.equal(manifest.sdta_student_messages.parts,2);
  assert.equal(manifest.sdta_admin_audit_archive.parts,0);
  assert.deepEqual(h.files.get(prefix+'/collections/sdta_student_messages/part-000000.json')
    .records.map(x=>x.id),['a','b']);
  assert.deepEqual(h.files.get(prefix+'/collections/sdta_student_messages/part-000001.json')
    .records.map(x=>x.id),['c']);
  const fail=setup(fx,prefix+'/collections/sdta_student_messages/part-000001.json');
  await assert.rejects(
    backupCollections({db:fail.db,bucket:fail.bucket,firestore,prefix,pageSize:2}),
    /Simulated Cloud Storage outage/
  );
  console.log('SkyDream backup collection tests passed (paging, completeness, failures).');
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
