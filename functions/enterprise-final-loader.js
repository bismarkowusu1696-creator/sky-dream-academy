// Final enterprise entrypoint. Adds class-session enforcement controls,
// preserves settings, and requires device-bound admin sessions after login.
const app = require('./enterprise-admin-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const db = admin.firestore();
const COLLECTION = 'sdta_storage';

const parseJson=(raw,fallback)=>{try{return raw?JSON.parse(raw):fallback;}catch(_){return fallback;}};
async function read(key,fallback){const s=await db.collection(COLLECTION).doc(key).get();return s.exists?parseJson(s.data().value,fallback):fallback;}
async function write(key,value){await db.collection(COLLECTION).doc(key).set({value:JSON.stringify(value)});}
async function requireStrongSession(request){
  const auth=request.auth,token=auth&&auth.token;
  if(!auth||!token||token.role!=='admin'||!token.username)throw new HttpsError('permission-denied','Administrator access is required.');
  const admins=await read('sdta_admins',[]);const account=admins.find(a=>String(a.username||'').toLowerCase()===String(token.username).toLowerCase());
  if(!account||auth.uid!=='admin-'+account.id)throw new HttpsError('permission-denied','This administrator account is no longer active.');
  if(!token.sessionId)throw new HttpsError('permission-denied','For security, please sign out and sign in again to start a protected admin session.');
  const sessions=await read('sdta_admin_sessions',[]);const session=sessions.find(s=>s.id===token.sessionId&&s.username===account.username);
  if(!session||session.revoked)throw new HttpsError('permission-denied','This admin session has been signed out. Please log in again.');
  return account;
}
async function requireSettingsAdmin(request){
  const account=await requireStrongSession(request);
  if(!['owner','manager'].includes(account.role||'staff'))throw new HttpsError('permission-denied','Owner or manager access is required.');
  return account;
}

app.adminSetSessionEnforcement=onCall({enforceAppCheck:true},async request=>{
  await requireSettingsAdmin(request);
  const settings=await read('sdta_admin_settings',{});
  settings.sessionEnforcement=request.data&&request.data.enabled===true;
  await write('sdta_admin_settings',settings);
  return {ok:true,enabled:settings.sessionEnforcement};
});

const baseSave=app.adminSaveRegistrationSettings;
if(baseSave&&typeof baseSave.run==='function'){
  app.adminSaveRegistrationSettings=onCall({enforceAppCheck:true},async request=>{
    await requireStrongSession(request);
    const before=await read('sdta_admin_settings',{});
    const result=await baseSave.run(request);
    const after=await read('sdta_admin_settings',{});
    if(Object.prototype.hasOwnProperty.call(before,'sessionEnforcement')){
      after.sessionEnforcement=before.sessionEnforcement===true;
      await write('sdta_admin_settings',after);
    }
    return result;
  });
}

const PROTECTED=[
  'getAdminSnapshot','adminGetSuiteSnapshot','adminGetEnterpriseSnapshot','adminUpdateStudent','adminAddPayment','adminDeleteStudent',
  'adminSetCapacity','adminCreateFacilitator','adminDeleteFacilitator','adminSetFacilitatorPin','adminCreateAdmin','adminDeleteAdmin',
  'adminChangePassword','adminStartNextIntake','adminCreateBroadcast','adminSetBroadcastActive','adminDeleteBroadcast',
  'adminBulkUpdateStudents','adminUpdateFacilitator','adminSetAdminRole','adminBeginTwoFactorSetup','adminConfirmTwoFactorSetup',
  'adminDisableTwoFactor','adminListSessions','adminRevokeSession','adminRevokeAllSessions','adminGetRecycleBin',
  'adminRestoreRecycleItem','adminPurgeRecycleItem','adminPreviewStudentImport','adminCommitStudentImport','adminFindDuplicateStudents',
  'adminMergeStudents','adminSetCohortArchived','adminCreateClassSession','adminUpdateClassSession','adminDeleteClassSession',
  'adminAddInternalNote','adminDeleteInternalNote','adminDismissNotification','adminRunManualBackup','adminSetSessionEnforcement'
];
for(const name of PROTECTED){
  const base=app[name];
  if(!base||typeof base.run!=='function')continue;
  app[name]=onCall({enforceAppCheck:true},async request=>{await requireStrongSession(request);return base.run(request);});
}

module.exports=app;
