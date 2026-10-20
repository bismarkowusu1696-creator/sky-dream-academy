'use strict';

// Run locally even when GitHub Actions cannot allocate a runner:
//   node scripts/validate-local.js
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}
function read(name) {
  // Git may check out text with CRLF on Windows. Normalize for comparison,
  // without altering any project file or weakening the checks.
  return fs.readFileSync(path.join(root, name), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}
function jsFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root,directory), { withFileTypes:true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const rel = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...jsFiles(rel));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(rel);
  }
  return result;
}
function runNode(args) {
  const result = spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});
  if (result.error || result.status !== 0) {
    throw new Error('Node check failed: node '+args.join(' ')+'\n'+
      (result.stderr||result.stdout||(result.error&&result.error.message)||'No details'));
  }
}

for (const file of [...jsFiles('functions'), ...jsFiles('assets'),
  ...jsFiles('scripts'), 'pwa.js', 'service-worker.js', 'firebase-messaging-sw.js']) {
  runNode(['--check',file]);
  checks += 1;
}
for (const config of ['firebase.json','firestore.indexes.json','manifest.webmanifest']) {
  JSON.parse(read(config));
  checks += 1;
}

const routes = read('_redirects');
const retired = ['admin','staff','facilitator'];
const notFound = read('404.html');
for (const role of retired) {
  assert(read(role+'.html') === notFound, role+' public page still contains an active login.');
  for (const route of ['/'+role,'/'+role+'/', '/'+role+'/*','/'+role+'.html']) {
    assert(routes.includes(route+' /404.html 404!'), 'Missing 404 rule for '+route);
  }
}
const admin = read('academy-team-access-83d7c921.html');
const fac = read('academy-facilitator-access-64c2f89a.html');
for (const id of ['adminLoginForm','dashboardShell','registrationStaffShell']) {
  assert(admin.includes('id="'+id+'"'), 'Admin page is missing '+id);
}
for (const id of ['facLoginForm','facDashboard']) {
  assert(fac.includes('id="'+id+'"'), 'Facilitator page is missing '+id);
}
assert(admin.includes('href="/academy-facilitator-access-64c2f89a"'),
  'Team portal must link to facilitator login.');
for (const [name,html] of [['academy-team-access-83d7c921',admin],
  ['academy-facilitator-access-64c2f89a',fac]]) {
  assert(html.includes('name="robots" content="noindex,nofollow,noarchive"'),
    name+' must not be indexed');
  assert(routes.includes('/'+name+' /'+name+'.html 200'),name+' rewrite is missing');
  assert(read('_headers').includes('/'+name+'.html\n  Cache-Control: no-store, max-age=0'),
    name+' must not be cached');
}
const sw = read('service-worker.js');
assert(!/PUBLIC_SHELL\s*=\s*\[[\s\S]*?academy-team-access-83d7c921/.test(sw.split('self.addEventListener(\'install\'')[0]),
  'Admin gateway must not be in offline public shell');
assert(sw.includes("'/academy-facilitator-access-64c2f89a.html'"),
  'Facilitator page must bypass service-worker cache');
assert(read('firestore.rules').includes('allow read, write: if false'),
  'Firestore client access must remain denied.');
const backup = read('functions/enterprise-admin-loader.js');
assert(backup.includes("require('./backup-collections')"),
  'Daily backups must include additional Firestore collections.');
assert(backup.includes('data.collections=await backupCollections('),
  'A complete backup manifest is required.');

runNode(['scripts/test-backup-collections.js']);
checks += 1;
runNode(['scripts/test-registration-renumbering.js']);
checks += 1;
runNode(['scripts/test-delete-registration-transaction.js']);
checks += 1;
runNode(['scripts/test-payment-correction.js']);
checks += 1;
runNode(['scripts/test-payment-correction-transaction.js']);
checks += 1;
runNode(['scripts/test-facilitator-messaging.js']);
checks += 1;
runNode(['scripts/test-student-facilitator-chat.js']);
checks += 1;
runNode(['scripts/test-message-delete.js']);
checks += 1;
for(const [page,script] of [
  ['student-portal.html','assets/student-facilitator-chat.js'],
  ['academy-facilitator-access-64c2f89a.html','assets/facilitator-student-chat.js']
]){
  assert(read(page).includes(script+'?v=20261020-delete1'),
    'Private student-facilitator chat script missing on '+page);
}
assert(read('assets/student-portal.js').includes('skydream-student-portal-ready'),
  'Student chat must open after authentication.');
assert(read('assets/facilitator.js').includes('skydream-facilitator-open-student-chat'),
  'Facilitator roster Chat control must open the conversation.');
const chatServiceWorker=read('service-worker.js');
assert(chatServiceWorker.includes("'/assets/student-facilitator-chat.js'")&&
  chatServiceWorker.includes("'/assets/facilitator-student-chat.js'"),
  'Private chat scripts must bypass the PWA cache.');
assert(read('_headers').includes('/assets/student-facilitator-chat.js')&&
  read('_headers').includes('/assets/facilitator-student-chat.js'),
  'Private chat scripts must have no-store cache headers.');

for(const [page,script] of [
  ['academy-team-access-83d7c921.html','assets/admin-facilitator-messages.js'],
  ['academy-facilitator-access-64c2f89a.html','assets/facilitator-inbox.js']
]){
  assert(new RegExp('src="'+script.replace('.', '\\.')+'(?:\\?v=[a-zA-Z0-9-]+)?"').test(read(page)),
    'Facilitator messaging script missing on '+page);
}
const inboxScript=read('assets/facilitator-inbox.js');
assert(inboxScript.includes('data-toggle-fac-reply')&&inboxScript.includes('data-send-fac-reply'),
  'Reply must be a visible button and must send to the protected reply callable.');
const worker=read('service-worker.js');
assert(worker.includes("'/assets/facilitator-inbox.js'")&&
  worker.includes("'/assets/admin-facilitator-messages.js'"),
  'Service worker must bypass caching both private messaging interfaces.');
assert(read('assets/facilitator.js').includes("skydream-facilitator-dashboard-ready"),
  'Inbox must refresh after facilitator login.');

const deleteFunctions=[
  'studentDeleteFacilitatorChatMessage','facilitatorDeleteStudentChatMessage',
  'studentClearFacilitatorChat','facilitatorClearStudentChat',
  'adminDeleteFacilitatorInboxItem','facilitatorDeleteInboxItem',
  'adminClearFacilitatorInbox','facilitatorClearInbox',
  'studentDeletePortalMessage','adminDeleteStudentPortalMessage',
  'studentClearPortalMessages','adminClearStudentPortalMessages'
];
const deleteSources=read('functions/student-facilitator-chat.js')+
  read('functions/facilitator-messaging.js')+read('functions/academic-portal-loader.js');
for(const action of deleteFunctions){
  assert(deleteSources.includes(action+'=onCall({enforceAppCheck:true}'),
    'Message delete callable must enforce App Check: '+action);
}
assert(read('assets/student-portal.js').includes('data-delete-portal-message')&&
  read('assets/admin-suite.js').includes('data-suite-delete-message'),
  'Both student and administrator portal messages need delete controls.');
assert(read('assets/facilitator-inbox.js').includes('data-delete-fac-inbox')&&
  read('assets/admin-facilitator-messages.js').includes('data-admin-delete-fac'),
  'Admin/facilitator inbox and reply delete controls are required.');
assert(read('assets/student-facilitator-chat.js').includes('studentClearFacilitatorChat')&&
  read('assets/facilitator-student-chat.js').includes('facilitatorClearStudentChat'),
  'Students and facilitators must be able to clear only their own chat history.');
assert(read('student-portal.html').includes('id="portalClearMessages"')&&
  read('assets/student-portal.js').includes('studentClearPortalMessages'),
  'Student Portal must provide a clear message history action.');
assert(read('assets/admin-suite.js').includes('adminClearStudentPortalMessages'),
  'Admin student profile must provide a clear message history action.');
assert(read('student-portal.html').includes('student-portal.js?v=20261020-delete1'),
  'Student portal must load the current script version.');
assert(read('service-worker.js').includes("'/assets/student-portal.js'"),
  'Student portal script must not use stale offline message history.');

const enterprise=read('functions/enterprise-admin-loader.js');
const portal=read('functions/academic-portal-loader.js');
assert(enterprise.includes('planCompaction(students,id,protectedIds)'),
  'Student deletion must use protected cohort registration renumbering.');
assert(enterprise.includes('tx.set(recycleRef,{value:JSON.stringify(bin)})'),
  'Student deletion must remain recoverable.');
assert(enterprise.includes("app.adminRestoreRecycleItem=onCall"),
  'Recycle bin restore must remain available.');
assert(portal.includes('matchesRegistration(s,regNumber)'),
  'Student portal sign-in must honor previous registration numbers.');
assert(read('functions/index.js').includes('checkStudentStatus'),
  'The existing student registration status check must remain unchanged.');

console.log('SkyDream local validation passed: '+checks+
  ' checks (JavaScript, configuration, private routes, backup regression).');
