// Enterprise administration extension for SkyDream Skills Training Academy.
// Adds TOTP 2-step verification, session/device controls, recycle bin,
// CSV imports, cohort archiving, notifications, class sessions, facilitator
// performance, internal notes, field-level history, and scheduled backups.
const app = require('./final-admin-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const COLLECTION = 'sdta_storage';
const STORAGE_BUCKET = 'skydream-academy.firebasestorage.app';
const KEYS = {
  students: 'sdta_students', admins: 'sdta_admins', facilitators: 'sdta_facilitators',
  attendance: 'sdta_attendance', capacities: 'sdta_capacities', intake: 'sdta_intake',
  intakeHistory: 'sdta_intake_history', contacts: 'sdta_contact_messages', broadcasts: 'sdta_broadcasts',
  settings: 'sdta_admin_settings', recycle: 'sdta_recycle_bin', sessions: 'sdta_admin_sessions',
  twoFactor: 'sdta_admin_2fa', challenges: 'sdta_2fa_challenges', cohortMeta: 'sdta_cohort_meta',
  notificationState: 'sdta_notification_state', classSessions: 'sdta_class_sessions', notes: 'sdta_internal_notes',
  history: 'sdta_change_history', audit: 'sdta_activity_log', smartRules: 'sdta_smart_notification_rules',
  smartRuleState: 'sdta_smart_notification_state', smartRuleLog: 'sdta_smart_notification_log'
};
const COURSE_NAMES = {
  'household-chemicals':'Household Chemicals Production','hair-dressing':'Hair Dressing',cosmetology:'Cosmetology',
  electricals:'Electricals','floral-decor':'Floral Decor','fashion-design':'Fashion Design',beading:'Beading',
  french:'French Language',korean:'Korean Language',pastries:'Pastries & Baking','graphic-design':'Graphic Design',
  barbering:'Barbering',accounting:'Accounting'
};
const COURSE_CODES = {
  'household-chemicals':'HC','hair-dressing':'HD',cosmetology:'CO',electricals:'EE','floral-decor':'FD',
  'fashion-design':'FS',beading:'BE',french:'FL',korean:'KL',pastries:'PA','graphic-design':'GD',barbering:'BA',accounting:'AC'
};
const ROLE_PERMISSIONS = {
  owner:['*'], manager:['students','attendance','facilitators','reports','announcements','settings'],
  staff:['students','attendance','reports','announcements'], registration:['students','attendance','reports'],
  finance:['reports'], viewer:['reports']
};

const refFor = key => db.collection(COLLECTION).doc(key);
const parseJson = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } };
const clean = (v,max=500) => String(v == null ? '' : v).trim().slice(0,max);
const nowIso = () => new Date().toISOString();
async function readValue(key, fallback){ const s=await refFor(key).get(); return s.exists?parseJson(s.data().value,fallback):fallback; }
async function writeValue(key, value){ await refFor(key).set({value:JSON.stringify(value)}); }
function requestIp(request){ const r=request&&request.rawRequest;if(!r)return'';const f=r.headers&&r.headers['x-forwarded-for'];return clean((Array.isArray(f)?f[0]:f)||r.ip||'',120).split(',')[0].trim(); }
function requestUa(request){ return clean(request&&request.rawRequest&&request.rawRequest.headers&&request.rawRequest.headers['user-agent'],240); }
function permissionsFor(role){ return ROLE_PERMISSIONS[role]||ROLE_PERMISSIONS.staff; }
async function adminAccount(request){
  const auth=request.auth, token=auth&&auth.token;
  if(!auth||!token||token.role!=='admin'||!token.username) throw new HttpsError('permission-denied','Administrator access is required.');
  const admins=await readValue(KEYS.admins,[]); const u=String(token.username).toLowerCase();
  const account=admins.find(a=>String(a.username||'').toLowerCase()===u);
  if(!account||auth.uid!=='admin-'+account.id) throw new HttpsError('permission-denied','This administrator session is no longer valid.');
  return account;
}
async function requirePermission(request, permission, ownerOnly=false){
  const a=await adminAccount(request); const role=a.role||'staff'; const p=permissionsFor(role);
  if(ownerOnly&&role!=='owner') throw new HttpsError('permission-denied','Main administrator access is required.');
  if(!ownerOnly&&!p.includes('*')&&!p.includes(permission)) throw new HttpsError('permission-denied','Your administrator role does not allow this action.');
  return a;
}
async function appendAudit(account, action, detail='', target=''){
  try{const ref=refFor(KEYS.audit);await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];list.push({id:'audit_'+crypto.randomUUID(),date:nowIso(),admin:account?account.username:'system',role:account?(account.role||'staff'):'system',action:clean(action,100),target:clean(target,140),detail:clean(detail,400)});if(list.length>1000)list=list.slice(-1000);tx.set(ref,{value:JSON.stringify(list)});});}catch(_){}
}
async function appendHistory(account, entityType, entityId, action, before, after){
  try{const ref=refFor(KEYS.history);await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];list.push({id:'chg_'+crypto.randomUUID(),date:nowIso(),admin:account.username,entityType,entityId,action,before:before||null,after:after||null});if(list.length>1200)list=list.slice(-1200);tx.set(ref,{value:JSON.stringify(list)});});}catch(_){}
}

const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf){let bits='',out='';for(const b of buf)bits+=b.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5){const c=bits.slice(i,i+5).padEnd(5,'0');out+=B32[parseInt(c,2)];}return out;}
function base32Decode(str){let bits='';for(const ch of String(str||'').toUpperCase().replace(/=|\s/g,'')){const n=B32.indexOf(ch);if(n<0)continue;bits+=n.toString(2).padStart(5,'0');}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);}
function totp(secret,time=Date.now(),stepOffset=0){const counter=Math.floor(time/30000)+stepOffset;const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(counter));const h=crypto.createHmac('sha1',base32Decode(secret)).update(b).digest();const o=h[h.length-1]&15;const n=(h.readUInt32BE(o)&0x7fffffff)%1000000;return String(n).padStart(6,'0');}
function verifyTotp(secret,code){const c=String(code||'').replace(/\D/g,'');if(c.length!==6)return false;return [-1,0,1].some(w=>crypto.timingSafeEqual(Buffer.from(totp(secret,Date.now(),w)),Buffer.from(c)));}
async function read2fa(){const v=await readValue(KEYS.twoFactor,[]);return Array.isArray(v)?v:[];}
async function upsert2fa(mutator){const ref=refFor(KEYS.twoFactor);let result;await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];result=await mutator(list);tx.set(ref,{value:JSON.stringify(list)});});return result;}

app.adminBeginTwoFactorSetup=onCall({enforceAppCheck:true},async request=>{
  const a=await adminAccount(request);const secret=base32Encode(crypto.randomBytes(20));const expires=Date.now()+10*60*1000;
  await upsert2fa(list=>{let r=list.find(x=>x.username===a.username);if(!r){r={username:a.username,enabled:false};list.push(r);}r.pendingSecret=secret;r.pendingExpiresAt=expires;return r;});
  const label=encodeURIComponent(`SkyDream:${a.username}`);const issuer=encodeURIComponent('SkyDream Skills Training Academy');
  return {secret,otpauth:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`};
});
app.adminConfirmTwoFactorSetup=onCall({enforceAppCheck:true},async request=>{
  const a=await adminAccount(request);const code=clean(request.data&&request.data.code,12);
  await upsert2fa(list=>{const r=list.find(x=>x.username===a.username);if(!r||!r.pendingSecret||Number(r.pendingExpiresAt)<Date.now())throw new HttpsError('failed-precondition','Start 2-step setup again.');if(!verifyTotp(r.pendingSecret,code))throw new HttpsError('permission-denied','That verification code is not correct.');r.secret=r.pendingSecret;r.enabled=true;r.enabledAt=nowIso();delete r.pendingSecret;delete r.pendingExpiresAt;return r;});
  await appendAudit(a,'Enabled 2-step verification');return {ok:true};
});
app.adminDisableTwoFactor=onCall({enforceAppCheck:true},async request=>{
  const a=await adminAccount(request);const target=clean(request.data&&request.data.username,80)||a.username;const code=clean(request.data&&request.data.code,12);
  if(target!==a.username&&(a.role||'staff')!=='owner')throw new HttpsError('permission-denied','Only the main administrator can disable another account’s 2-step verification.');
  await upsert2fa(list=>{const r=list.find(x=>x.username===target);if(!r)return null;if(target===a.username&&r.enabled&&!verifyTotp(r.secret,code))throw new HttpsError('permission-denied','Enter a valid current authenticator code.');r.enabled=false;delete r.secret;delete r.pendingSecret;delete r.pendingExpiresAt;return r;});
  await appendAudit(a,'Disabled 2-step verification','',target);return {ok:true};
});

async function createSession(account,request){
  const id='sess_'+crypto.randomUUID(), createdAt=nowIso();const ref=refFor(KEYS.sessions);
  await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];list.push({id,username:account.username,createdAt,lastSeen:createdAt,ip:requestIp(request),userAgent:requestUa(request),revoked:false});if(list.length>300)list=list.slice(-300);tx.set(ref,{value:JSON.stringify(list)});});
  const token=await admin.auth().createCustomToken('admin-'+account.id,{role:'admin',adminRole:account.role||'staff',username:account.username,sessionId:id});return {id,token};
}
async function assertSession(request){
  const a=await adminAccount(request);const sid=request.auth&&request.auth.token&&request.auth.token.sessionId;if(!sid)return a;
  const sessions=await readValue(KEYS.sessions,[]);const s=sessions.find(x=>x.id===sid&&x.username===a.username);if(!s||s.revoked)throw new HttpsError('permission-denied','This admin session has been signed out. Please log in again.');return a;
}
const baseAdminLogin=app.adminLogin;
app.adminLogin=onCall({enforceAppCheck:true},async request=>{
  const result=await baseAdminLogin.run(request);if(!result||!result.account||result.upgradeRequired)return result;
  const two=await read2fa();const r=two.find(x=>x.username===result.account.username&&x.enabled&&x.secret);
  if(r){const challengeId='2fa_'+crypto.randomUUID();const ref=refFor(KEYS.challenges);await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];list=list.filter(x=>Number(x.expiresAt)>Date.now());list.push({id:challengeId,username:result.account.username,accountId:result.account.id,expiresAt:Date.now()+5*60*1000,ip:requestIp(request)});tx.set(ref,{value:JSON.stringify(list)});});return {twoFactorRequired:true,challengeId,account:result.account};}
  const session=await createSession(result.account,request);return {...result,token:session.token,sessionId:session.id};
});
app.adminVerifyTwoFactorLogin=onCall({enforceAppCheck:true},async request=>{
  const challengeId=clean(request.data&&request.data.challengeId,120),code=clean(request.data&&request.data.code,12);if(!challengeId)throw new HttpsError('invalid-argument','Login challenge is missing.');
  const ref=refFor(KEYS.challenges);let challenge=null;await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];challenge=list.find(x=>x.id===challengeId);if(!challenge||Number(challenge.expiresAt)<Date.now())throw new HttpsError('failed-precondition','This verification request expired. Sign in again.');tx.set(ref,{value:JSON.stringify(list.filter(x=>x.id!==challengeId))});});
  const two=await read2fa();const t=two.find(x=>x.username===challenge.username&&x.enabled&&x.secret);if(!t||!verifyTotp(t.secret,code))throw new HttpsError('permission-denied','That authenticator code is not correct.');
  const admins=await readValue(KEYS.admins,[]);const account=admins.find(x=>x.id===challenge.accountId&&x.username===challenge.username);if(!account)throw new HttpsError('permission-denied','Administrator account is unavailable.');
  const session=await createSession(account,request);return {token:session.token,sessionId:session.id,account:{id:account.id,name:account.name||'',username:account.username,role:account.role||'staff'}};
});
app.adminListSessions=onCall({enforceAppCheck:true},async request=>{const a=await assertSession(request);const list=await readValue(KEYS.sessions,[]);const owner=(a.role||'staff')==='owner';return {sessions:(Array.isArray(list)?list:[]).filter(s=>owner||s.username===a.username).slice().sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt))).slice(0,100),currentSessionId:request.auth.token.sessionId||''};});
app.adminRevokeSession=onCall({enforceAppCheck:true},async request=>{const a=await assertSession(request),id=clean(request.data&&request.data.id,140);const ref=refFor(KEYS.sessions);let target=null;await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];target=list.find(x=>x.id===id);if(!target)throw new HttpsError('not-found','Session not found.');if(target.username!==a.username&&(a.role||'staff')!=='owner')throw new HttpsError('permission-denied','You cannot revoke that session.');target.revoked=true;target.revokedAt=nowIso();target.revokedBy=a.username;tx.set(ref,{value:JSON.stringify(list)});});await appendAudit(a,'Revoked admin session','',id);return {ok:true};});
app.adminRevokeAllSessions=onCall({enforceAppCheck:true},async request=>{const a=await assertSession(request),targetUser=clean(request.data&&request.data.username,80)||a.username;if(targetUser!==a.username&&(a.role||'staff')!=='owner')throw new HttpsError('permission-denied','You cannot sign out that account.');const admins=await readValue(KEYS.admins,[]);const target=admins.find(x=>x.username===targetUser);const ref=refFor(KEYS.sessions);await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];list.forEach(x=>{if(x.username===targetUser){x.revoked=true;x.revokedAt=nowIso();x.revokedBy=a.username;}});tx.set(ref,{value:JSON.stringify(list)});});if(target)try{await admin.auth().revokeRefreshTokens('admin-'+target.id);}catch(_){}await appendAudit(a,'Signed out all admin devices','',targetUser);return {ok:true};});

async function moveToRecycle(account,type,record,sourceKey){const ref=refFor(KEYS.recycle);await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];list.push({id:'bin_'+crypto.randomUUID(),type,sourceKey,record,deletedAt:nowIso(),deletedBy:account.username});if(list.length>500)list=list.slice(-500);tx.set(ref,{value:JSON.stringify(list)});});}
async function softDeleteFromList(request,key,type,ownerOnly=false){const a=await requirePermission(request,type==='student'?'students':type==='announcement'?'announcements':'facilitators',ownerOnly);const id=clean(request.data&&request.data.id,140);const ref=refFor(key);let removed=null;await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];const i=list.findIndex(x=>x&&x.id===id);if(i<0)throw new HttpsError('not-found',`${type} not found.`);removed=list[i];list.splice(i,1);tx.set(ref,{value:JSON.stringify(list)});});await moveToRecycle(a,type,removed,key);await appendAudit(a,`Moved ${type} to recycle bin`,'',id);return {ok:true};}
app.adminDeleteStudent=onCall({enforceAppCheck:true},r=>softDeleteFromList(r,KEYS.students,'student',true));
app.adminDeleteFacilitator=onCall({enforceAppCheck:true},r=>softDeleteFromList(r,KEYS.facilitators,'facilitator',true));
app.adminDeleteBroadcast=onCall({enforceAppCheck:true},r=>softDeleteFromList(r,KEYS.broadcasts,'announcement',false));
app.adminDeleteAdmin=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'settings',true);const id=clean(request.data&&request.data.id,140);const ref=refFor(KEYS.admins);let removed=null;await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];const i=list.findIndex(x=>x&&x.id===id);if(i<0)throw new HttpsError('not-found','Administrator not found.');if((list[i].role||'staff')==='owner'||list[i].username===a.username)throw new HttpsError('failed-precondition','The main/current administrator cannot be deleted.');removed=list[i];list.splice(i,1);tx.set(ref,{value:JSON.stringify(list)});});await moveToRecycle(a,'admin',removed,KEYS.admins);try{await admin.auth().deleteUser('admin-'+id);}catch(_){}await appendAudit(a,'Moved administrator to recycle bin','',removed.username||id);return {ok:true};});
app.adminGetRecycleBin=onCall({enforceAppCheck:true},async request=>{await requirePermission(request,'settings',true);const list=await readValue(KEYS.recycle,[]);return {items:(Array.isArray(list)?list:[]).slice().sort((a,b)=>String(b.deletedAt).localeCompare(String(a.deletedAt)))};});
app.adminRestoreRecycleItem=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'settings',true),id=clean(request.data&&request.data.id,140);const binRef=refFor(KEYS.recycle);let item=null;await db.runTransaction(async tx=>{const bs=await tx.get(binRef);const bin=bs.exists?parseJson(bs.data().value,[]):[];const i=bin.findIndex(x=>x.id===id);if(i<0)throw new HttpsError('not-found','Recycle item not found.');item=bin[i];const sourceRef=refFor(item.sourceKey);const ss=await tx.get(sourceRef);const list=ss.exists?parseJson(ss.data().value,[]):[];if(list.some(x=>x&&x.id===item.record.id))throw new HttpsError('already-exists','A record with the same ID already exists.');list.push(item.record);bin.splice(i,1);tx.set(sourceRef,{value:JSON.stringify(list)});tx.set(binRef,{value:JSON.stringify(bin)});});await appendAudit(a,'Restored recycle item',item.type,item.record&&item.record.id);return {ok:true};});
app.adminPurgeRecycleItem=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'settings',true),id=clean(request.data&&request.data.id,140);const ref=refFor(KEYS.recycle);await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];if(!list.some(x=>x.id===id))throw new HttpsError('not-found','Recycle item not found.');tx.set(ref,{value:JSON.stringify(list.filter(x=>x.id!==id))});});await appendAudit(a,'Permanently deleted recycle item','',id);return {ok:true};});

function parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<String(text||'').length;i++){const c=text[i],n=text[i+1];if(q){if(c==='"'&&n==='"'){field+='"';i++;}else if(c==='"')q=false;else field+=c;}else if(c==='"')q=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}row.push(field.replace(/\r$/,''));if(row.some(v=>v!==''))rows.push(row);return rows;}
const normHeader=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const normPhone=v=>{let d=String(v||'').replace(/\D/g,'');if(d.startsWith('233')&&d.length===12)d='0'+d.slice(3);return d;};
const normCard=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function courseId(v){const raw=clean(v,100).toLowerCase();if(COURSE_NAMES[raw])return raw;for(const [id,name] of Object.entries(COURSE_NAMES))if(name.toLowerCase()===raw)return id;return '';}
function nextReg(course,list,intakeStart){const prefix='SD'+(COURSE_CODES[course]||course.slice(0,2).toUpperCase());const used=new Set(list.map(s=>{const m=String(s.regNumber||'').match(new RegExp('^'+prefix+'(\\d{3})/'));return m?Number(m[1]):null;}).filter(Boolean));let i=1;while(used.has(i))i++;const d=new Date((intakeStart||nowIso().slice(0,10))+'T00:00:00Z');return prefix+String(i).padStart(3,'0')+'/'+String(d.getUTCMonth()+1).padStart(2,'0')+'/'+d.getUTCFullYear();}
function importRows(csv,existing,intake){const rows=parseCsv(csv);if(rows.length<2)return[];const headers=rows[0].map(normHeader);const get=(r,names)=>{for(const n of names){const i=headers.indexOf(n);if(i>=0)return clean(r[i],180);}return'';};const mobileSet=new Set(existing.map(s=>normPhone(s.mobile)).filter(Boolean)),emailSet=new Set(existing.map(s=>String(s.email||'').toLowerCase()).filter(Boolean)),cardSet=new Set(existing.map(s=>normCard(s.ghanaCard)).filter(Boolean)),regSet=new Set(existing.map(s=>String(s.regNumber||'').toUpperCase()).filter(Boolean));return rows.slice(1,501).map((r,idx)=>{const fullName=get(r,['fullname','name','studentname']),mobile=normPhone(get(r,['mobile','phone','phonenumber'])),email=get(r,['email']).toLowerCase(),ghanaCard=get(r,['ghanacard','ghanaid','idnumber']),course=courseId(get(r,['course','program','programme'])),givenReg=get(r,['registrationnumber','regnumber','regno']).toUpperCase();const issues=[];if(!fullName)issues.push('Missing name');if(!/^0\d{9}$/.test(mobile))issues.push('Invalid mobile');if(!course)issues.push('Unknown program');const duplicate=(mobile&&mobileSet.has(mobile))||(email&&emailSet.has(email))||(ghanaCard&&cardSet.has(normCard(ghanaCard)))||(givenReg&&regSet.has(givenReg));if(duplicate)issues.push('Possible duplicate');return {row:idx+2,fullName,mobile,email,ghanaCard,course,givenReg,dob:get(r,['dob','dateofbirth']),gender:get(r,['gender']),address:get(r,['address']),gpsAddress:get(r,['gpsaddress','ghanapostgps']),whatsapp:normPhone(get(r,['whatsapp']))||mobile,emName:get(r,['emergencycontact','emergencyname']),emPhone:normPhone(get(r,['emergencyphone'])),status:get(r,['status'])||'Registered',issues,duplicate};});}
app.adminPreviewStudentImport=onCall({enforceAppCheck:true},async request=>{await requirePermission(request,'students');const csv=String(request.data&&request.data.csv||'');if(csv.length>1000000)throw new HttpsError('invalid-argument','CSV file is too large.');const [students,intake]=await Promise.all([readValue(KEYS.students,[]),readValue(KEYS.intake,{})]);const rows=importRows(csv,students,intake);return {rows,total:rows.length,valid:rows.filter(r=>!r.issues.length).length,duplicates:rows.filter(r=>r.duplicate).length};});
app.adminCommitStudentImport=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'students');const csv=String(request.data&&request.data.csv||'');const skipDuplicates=request.data&&request.data.skipDuplicates!==false;const studentsRef=refFor(KEYS.students);let imported=0,skipped=0;await db.runTransaction(async tx=>{const [ss,is]=await Promise.all([tx.get(studentsRef),tx.get(refFor(KEYS.intake))]);const students=ss.exists?parseJson(ss.data().value,[]):[];const intake=is.exists?parseJson(is.data().value,{}):{};const rows=importRows(csv,students,intake);for(const r of rows){if(r.issues.some(x=>x!=='Possible duplicate')||(skipDuplicates&&r.duplicate)){skipped++;continue;}const reg=r.givenReg||nextReg(r.course,students,intake.startDate);students.push({id:'stu_'+crypto.randomUUID(),regNumber:reg,regDate:nowIso(),intakeStart:intake.startDate||'',fullName:r.fullName,dob:r.dob,gender:r.gender,ghanaCard:r.ghanaCard,gpsAddress:r.gpsAddress,address:r.address,mobile:r.mobile,whatsapp:r.whatsapp,email:r.email,emName:r.emName,emPhone:r.emPhone,course:r.course,status:['Registered','Active','Completed','Deferred','Cancelled'].includes(r.status)?r.status:'Registered',feePaid:0,payments:[]});imported++;}tx.set(studentsRef,{value:JSON.stringify(students)});});await appendAudit(a,'Imported students from CSV',`${imported} imported, ${skipped} skipped`);return {ok:true,imported,skipped};});
app.adminFindDuplicateStudents=onCall({enforceAppCheck:true},async request=>{await requirePermission(request,'students');const students=await readValue(KEYS.students,[]);const groups=[];const seen=new Set();for(let i=0;i<students.length;i++){if(seen.has(students[i].id))continue;const a=students[i],matches=students.filter((b,j)=>j!==i&&((normPhone(a.mobile)&&normPhone(a.mobile)===normPhone(b.mobile))||(a.email&&String(a.email).toLowerCase()===String(b.email||'').toLowerCase())||(a.ghanaCard&&normCard(a.ghanaCard)===normCard(b.ghanaCard))));if(matches.length){const g=[a,...matches.filter(m=>!seen.has(m.id))];g.forEach(x=>seen.add(x.id));groups.push(g.map(x=>({id:x.id,regNumber:x.regNumber,fullName:x.fullName,mobile:x.mobile,email:x.email,ghanaCard:x.ghanaCard,course:x.course,status:x.status})));}}return {groups};});
app.adminMergeStudents=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'students',true);const keepId=clean(request.data&&request.data.keepId,140),mergeId=clean(request.data&&request.data.mergeId,140);if(!keepId||!mergeId||keepId===mergeId)throw new HttpsError('invalid-argument','Choose two different student records.');const sRef=refFor(KEYS.students),aRef=refFor(KEYS.attendance);let before=null,after=null;await db.runTransaction(async tx=>{const [ss,as]=await Promise.all([tx.get(sRef),tx.get(aRef)]);const students=ss.exists?parseJson(ss.data().value,[]):[],att=as.exists?parseJson(as.data().value,[]):[];const keep=students.find(x=>x.id===keepId),merge=students.find(x=>x.id===mergeId);if(!keep||!merge)throw new HttpsError('not-found','Student record not found.');before={keep:{...keep},merge:{...merge}};for(const [k,v] of Object.entries(merge))if((keep[k]===undefined||keep[k]===null||keep[k]==='')&&v!==undefined)keep[k]=v;const kp=Array.isArray(keep.payments)?keep.payments:[],mp=Array.isArray(merge.payments)?merge.payments:[];keep.payments=[...kp,...mp];keep.feePaid=Math.max(Number(keep.feePaid)||0,0)+Math.max(Number(merge.feePaid)||0,0);att.forEach(r=>{if(r.studentId===mergeId)r.studentId=keepId;});tx.set(sRef,{value:JSON.stringify(students.filter(x=>x.id!==mergeId))});tx.set(aRef,{value:JSON.stringify(att)});after={...keep};});await moveToRecycle(a,'student-merged',before.merge,KEYS.students);await appendHistory(a,'student',keepId,'Merged duplicate student',before,after);await appendAudit(a,'Merged duplicate students',mergeId,keepId);return {ok:true};});

app.adminSetCohortArchived=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'settings');const start=clean(request.data&&request.data.intakeStart,10),archived=request.data&&request.data.archived===true;if(!/^\d{4}-\d{2}-\d{2}$/.test(start))throw new HttpsError('invalid-argument','Choose a valid intake date.');const meta=await readValue(KEYS.cohortMeta,{});meta[start]={...(meta[start]||{}),archived,updatedAt:nowIso(),updatedBy:a.username};await writeValue(KEYS.cohortMeta,meta);await appendAudit(a,archived?'Archived intake':'Restored intake','',start);return {ok:true};});

app.adminCreateClassSession=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'attendance');const d=request.data||{},date=clean(d.date,10),course=clean(d.course,60),facilitatorId=clean(d.facilitatorId,140),title=clean(d.title,120)||'Class session';if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!COURSE_NAMES[course])throw new HttpsError('invalid-argument','Valid date and program are required.');const ref=refFor(KEYS.classSessions);let item;await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(list.some(x=>x.date===date&&x.course===course&&x.facilitatorId===facilitatorId))throw new HttpsError('already-exists','That class session already exists.');item={id:'cls_'+crypto.randomUUID(),date,course,facilitatorId,title,status:'Scheduled',createdAt:nowIso(),createdBy:a.username};list.push(item);tx.set(ref,{value:JSON.stringify(list)});});await appendAudit(a,'Created class session',`${course} ${date}`,item.id);return {ok:true,item};});
app.adminUpdateClassSession=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'attendance');const d=request.data||{},id=clean(d.id,140),status=clean(d.status,30),title=clean(d.title,120),facilitatorId=clean(d.facilitatorId,140);const ref=refFor(KEYS.classSessions);await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];const item=list.find(x=>x.id===id);if(!item)throw new HttpsError('not-found','Class session not found.');if(title)item.title=title;if(['Scheduled','Completed','Cancelled'].includes(status))item.status=status;if(d.facilitatorId!==undefined)item.facilitatorId=facilitatorId;item.updatedAt=nowIso();tx.set(ref,{value:JSON.stringify(list)});});await appendAudit(a,'Updated class session','',id);return {ok:true};});
app.adminDeleteClassSession=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'attendance');const id=clean(request.data&&request.data.id,140),ref=refFor(KEYS.classSessions);await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];if(!list.some(x=>x.id===id))throw new HttpsError('not-found','Class session not found.');tx.set(ref,{value:JSON.stringify(list.filter(x=>x.id!==id))});});await appendAudit(a,'Deleted class session','',id);return {ok:true};});
const baseMarkAttendance=app.markFacilitatorAttendance;
app.markFacilitatorAttendance=onCall({enforceAppCheck:true},async request=>{const settings=await readValue(KEYS.settings,{});if(settings.sessionEnforcement===true){const course=clean(request.data&&request.data.course,60),date=clean(request.data&&request.data.date,10),username=clean(request.auth&&request.auth.token&&request.auth.token.username,80);const [sessions,facilitators]=await Promise.all([readValue(KEYS.classSessions,[]),readValue(KEYS.facilitators,[])]);const fac=facilitators.find(f=>String(f.username||'').toLowerCase()===username.toLowerCase());const match=sessions.find(s=>s.course===course&&s.date===date&&s.status!=='Cancelled'&&(!s.facilitatorId||(fac&&s.facilitatorId===fac.id)));if(!match)throw new HttpsError('failed-precondition','No active class session is scheduled for this program and date.');}return baseMarkAttendance.run(request);});

app.adminAddInternalNote=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'students');const d=request.data||{},targetType=clean(d.targetType,30),targetId=clean(d.targetId,140),text=clean(d.text,1000);if(!['student','facilitator','intake'].includes(targetType)||!targetId||!text)throw new HttpsError('invalid-argument','Target and note are required.');const ref=refFor(KEYS.notes);let note;await db.runTransaction(async tx=>{const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];note={id:'note_'+crypto.randomUUID(),targetType,targetId,text,date:nowIso(),createdBy:a.username};list.push(note);if(list.length>1500)list=list.slice(-1500);tx.set(ref,{value:JSON.stringify(list)});});await appendAudit(a,'Added internal note',text.slice(0,80),targetId);return {ok:true,note};});
app.adminDeleteInternalNote=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'students');const id=clean(request.data&&request.data.id,140),ref=refFor(KEYS.notes);await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];const note=list.find(x=>x.id===id);if(!note)throw new HttpsError('not-found','Note not found.');if(note.createdBy!==a.username&&(a.role||'staff')!=='owner')throw new HttpsError('permission-denied','Only the note author or main administrator can delete it.');tx.set(ref,{value:JSON.stringify(list.filter(x=>x.id!==id))});});return {ok:true};});

function wrapHistory(name,permission,entityType,idField='id'){
  const base=app[name];if(!base||typeof base.run!=='function')return;
  app[name]=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,permission);const id=clean(request.data&&request.data[idField],140);let before=null,after=null,key=entityType==='student'?KEYS.students:entityType==='facilitator'?KEYS.facilitators:entityType==='admin'?KEYS.admins:null;if(key&&id){const list=await readValue(key,[]);before=list.find(x=>x.id===id);if(before)before=JSON.parse(JSON.stringify(before));}const result=await base.run(request);if(key&&id){const list=await readValue(key,[]);after=list.find(x=>x.id===id);if(after)after=JSON.parse(JSON.stringify(after));if(JSON.stringify(before)!==JSON.stringify(after))await appendHistory(a,entityType,id,name,before,after);}return result;});
}
wrapHistory('adminUpdateStudent','students','student');
wrapHistory('adminUpdateFacilitator','facilitators','facilitator');
wrapHistory('adminSetAdminRole','settings','admin');


const DEFAULT_SMART_RULES={
  enabled:false,
  attendance:{enabled:true,threshold:70,minMarks:3},
  feeBalance:{enabled:true,graceDays:14,minBalance:1},
  inactivity:{enabled:true,days:14},
  highRisk:{enabled:true,threshold:65},
  cooldownDays:7
};
function clamp(n,min,max,fallback){const v=Number(n);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;}
function smartRules(raw){
  const x=raw&&typeof raw==='object'?raw:{};
  return{
    enabled:x.enabled===true,
    attendance:{enabled:x.attendance?.enabled!==false,threshold:clamp(x.attendance?.threshold,40,95,70),minMarks:clamp(x.attendance?.minMarks,1,20,3)},
    feeBalance:{enabled:x.feeBalance?.enabled!==false,graceDays:clamp(x.feeBalance?.graceDays,0,180,14),minBalance:clamp(x.feeBalance?.minBalance,0,100000,1)},
    inactivity:{enabled:x.inactivity?.enabled!==false,days:clamp(x.inactivity?.days,7,90,14)},
    highRisk:{enabled:x.highRisk?.enabled!==false,threshold:clamp(x.highRisk?.threshold,35,95,65)},
    cooldownDays:clamp(x.cooldownDays,1,30,7)
  };
}
function daysSince(date){
  const t=new Date(date||0).getTime();
  return Number.isFinite(t)&&t>0?Math.max(0,Math.floor((Date.now()-t)/86400000)):null;
}
function studentRisk(student,attendance,settings,intake){
  const rows=(attendance||[]).filter(r=>r.studentId===student.id&&(r.status==='Present'||r.status==='Absent')).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const present=rows.filter(r=>r.status==='Present').length,absent=rows.filter(r=>r.status==='Absent').length,marked=present+absent;
  const attendancePct=marked?Math.round(present/marked*100):100;
  let consecutiveAbsences=0;for(const r of rows){if(r.status==='Absent')consecutiveAbsences++;else break;}
  const lastAttendanceDate=rows[0]&&rows[0].date||'';
  const courseStart=intake&&(intake.classesStartDate||intake.startDate)||student.intakeStart||'';
  const inactiveDays=lastAttendanceDate?daysSince(lastAttendanceDate):daysSince(courseStart);
  const fee=Math.max(0,Number(settings&&settings.registrationFee)||0),paid=Math.max(0,Number(student.feePaid)||0),balance=Math.max(0,fee-paid);
  const balanceRatio=fee>0?balance/fee:0;
  let score=0;const reasons=[];
  if(marked>=3){
    if(attendancePct<50){score+=40;reasons.push(`Very low attendance (${attendancePct}%)`);}
    else if(attendancePct<70){score+=30;reasons.push(`Low attendance (${attendancePct}%)`);}
    else if(attendancePct<80){score+=15;reasons.push(`Attendance below target (${attendancePct}%)`);}
  }
  if(consecutiveAbsences>=3){score+=25;reasons.push(`${consecutiveAbsences} consecutive absences`);}
  else if(consecutiveAbsences===2){score+=15;reasons.push('2 consecutive absences');}
  else if(consecutiveAbsences===1){score+=5;}
  if(balanceRatio>=0.75){score+=20;reasons.push(`Large outstanding balance (GHS ${balance.toFixed(2)})`);}
  else if(balanceRatio>=0.5){score+=15;reasons.push(`Outstanding balance (GHS ${balance.toFixed(2)})`);}
  else if(balance>0){score+=8;reasons.push(`Fee balance GHS ${balance.toFixed(2)}`);}
  if(inactiveDays!==null&&inactiveDays>21){score+=20;reasons.push(`No attendance activity for ${inactiveDays} days`);}
  else if(inactiveDays!==null&&inactiveDays>14){score+=12;reasons.push(`No attendance activity for ${inactiveDays} days`);}
  const capped=Math.max(0,Math.min(100,score)),level=capped>=65?'High':capped>=35?'Medium':'Low';
  return{id:student.id,regNumber:student.regNumber||'',fullName:student.fullName||'',course:student.course||'',status:student.status||'',score:capped,level,reasons,attendance:attendancePct,marked,present,absent,consecutiveAbsences,lastAttendanceDate,inactiveDays,fee,paid,balance};
}
function buildRiskAnalysis(students,attendance,settings,intake){
  return (students||[]).filter(s=>!['Cancelled','Completed','Deferred'].includes(s.status||'')).map(s=>studentRisk(s,attendance,settings,intake)).sort((a,b)=>b.score-a.score||a.fullName.localeCompare(b.fullName));
}
function riskSummary(rows){return{high:rows.filter(r=>r.level==='High').length,medium:rows.filter(r=>r.level==='Medium').length,low:rows.filter(r=>r.level==='Low').length,total:rows.length};}
function buildSmartAlerts(risks,rules){
  const out=[];
  for(const r of risks){
    const per=[];
    if(rules.highRisk.enabled&&r.score>=rules.highRisk.threshold)per.push({rule:'high-risk',title:'Student support alert',message:`Your SkyDream progress needs attention. Current support score: ${r.score}/100. Please contact the academy so we can help you stay on track.`});
    if(rules.attendance.enabled&&r.marked>=rules.attendance.minMarks&&r.attendance<rules.attendance.threshold)per.push({rule:'low-attendance',title:'Attendance reminder',message:`Your attendance is currently ${r.attendance}%. Please attend your upcoming classes or contact your facilitator if you need support.`});
    if(rules.inactivity.enabled&&r.inactiveDays!==null&&r.inactiveDays>=rules.inactivity.days)per.push({rule:'inactivity',title:'We have missed you',message:`We have not recorded class attendance for you in ${r.inactiveDays} days. Please contact your facilitator if you need assistance.`});
    if(rules.feeBalance.enabled&&r.balance>=rules.feeBalance.minBalance){
      const startDays=daysSince((r.lastAttendanceDate||''))===null?0:0;
      per.push({rule:'fee-balance',title:'Payment reminder',message:`Your current SkyDream balance is GHS ${r.balance.toFixed(2)}. Please contact the academy if you need clarification about your account.`});
    }
    per.slice(0,3).forEach(a=>out.push({...a,studentId:r.id,regNumber:r.regNumber,studentName:r.fullName,score:r.score}));
  }
  return out;
}
async function evaluateSmartNotifications({send=false}={}){
  const [students,attendance,settings,intake,rawRules,stateRaw,logRaw]=await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.attendance,[]),readValue(KEYS.settings,{}),readValue(KEYS.intake,{}),
    readValue(KEYS.smartRules,DEFAULT_SMART_RULES),readValue(KEYS.smartRuleState,{}),readValue(KEYS.smartRuleLog,[])
  ]);
  const rules=smartRules(rawRules),risks=buildRiskAnalysis(students,attendance,settings,intake),alerts=buildSmartAlerts(risks,rules);
  const state=stateRaw&&typeof stateRaw==='object'?stateRaw:{},sent=state.sent&&typeof state.sent==='object'?state.sent:{};
  const cooldown=rules.cooldownDays*86400000,now=Date.now();
  const eligible=alerts.filter(a=>{const last=new Date(sent[a.rule+':'+a.studentId]||0).getTime();return !Number.isFinite(last)||last<=0||now-last>=cooldown;});
  if(!send)return{rules,risks,alerts,eligible};
  if(!rules.enabled)return{rules,risks,alerts,eligible:[],sent:0,disabled:true};
  let batch=db.batch(),ops=0,sentCount=0;const log=Array.isArray(logRaw)?logRaw:[];
  for(const a of eligible.slice(0,200)){
    const ref=db.collection('sdta_student_messages').doc(),createdAt=nowIso();
    batch.set(ref,{studentId:a.studentId,message:a.message,createdAt,createdBy:'smart-rules',senderName:'SkyDream Smart Alerts',senderType:'system',active:true,readAt:'',systemRule:a.rule});
    sent[a.rule+':'+a.studentId]=createdAt;log.push({id:'rule_'+crypto.randomUUID(),date:createdAt,rule:a.rule,studentId:a.studentId,regNumber:a.regNumber,title:a.title});
    ops++;sentCount++;
    if(ops>=400){await batch.commit();batch=db.batch();ops=0;}
  }
  if(ops)await batch.commit();
  state.sent=sent;state.updatedAt=nowIso();await writeValue(KEYS.smartRuleState,state);await writeValue(KEYS.smartRuleLog,log.slice(-1000));
  return{rules,risks,alerts,eligible,sent:sentCount,disabled:false};
}
function findCourseInQuestion(q){
  const text=String(q||'').toLowerCase();
  for(const [id,name] of Object.entries(COURSE_NAMES)){if(text.includes(id.replace(/-/g,' '))||text.includes(name.toLowerCase()))return id;}
  return'';
}
function assistantAnswer(question,base,risks){
  const q=String(question||'').trim(),lower=q.toLowerCase(),students=base.students||[],attendance=base.attendance||[],active=students.filter(s=>!['Cancelled','Completed'].includes(s.status||'')),fee=Math.max(0,Number(base.settings&&base.settings.registrationFee)||0);
  const courseId=findCourseInQuestion(lower),courseStudents=courseId?active.filter(s=>s.course===courseId):active;
  const pctMatch=lower.match(/(?:below|under|less than)\s*(\d{1,3})\s*%?/),threshold=pctMatch?Math.max(0,Math.min(100,Number(pctMatch[1]))):70;
  const rowsForAttendance=courseStudents.map(s=>{const a=attendance.filter(x=>x.studentId===s.id&&(x.status==='Present'||x.status==='Absent')),p=a.filter(x=>x.status==='Present').length,m=a.length;return{s,pct:m?Math.round(p/m*100):100,marked:m};});
  if(/summary|overview|how are we doing/.test(lower)){
    const high=risks.filter(r=>r.level==='High').length,outstanding=active.reduce((n,s)=>n+Math.max(0,fee-(Number(s.feePaid)||0)),0),marked=attendance.filter(a=>a.status==='Present'||a.status==='Absent'),present=marked.filter(a=>a.status==='Present').length,rate=marked.length?Math.round(present/marked.length*100):0;
    return{answer:`SkyDream currently has ${active.length} active/registered students, ${high} high-risk student(s), ${rate}% recorded attendance, and GHS ${outstanding.toFixed(2)} outstanding under the current fee setting.`,rows:[]};
  }
  if(/high.?risk|at risk|risk students|drop.?out/.test(lower)){
    const list=risks.filter(r=>r.level==='High').slice(0,20);
    return{answer:list.length?`${list.length} high-risk student(s) are shown below. The score is explainable and based on attendance, absences, inactivity and outstanding fees.`:'No students are currently classified as High risk.',rows:list.map(r=>({student:r.fullName,regNumber:r.regNumber,course:COURSE_NAMES[r.course]||r.course,score:r.score,reasons:r.reasons.join('; ')}))};
  }
  if(/attendance/.test(lower)&&/(below|under|low|less than)/.test(lower)){
    const list=rowsForAttendance.filter(x=>x.marked>=3&&x.pct<threshold).sort((a,b)=>a.pct-b.pct).slice(0,30);
    return{answer:`${list.length} student(s)${courseId?' in '+COURSE_NAMES[courseId]:''} have attendance below ${threshold}% with at least 3 recorded sessions.`,rows:list.map(x=>({student:x.s.fullName,regNumber:x.s.regNumber,attendance:x.pct+'%',marked:x.marked}))};
  }
  if(/owe|owing|outstanding|balance|unpaid|fees?/.test(lower)){
    const list=courseStudents.map(s=>({s,balance:Math.max(0,fee-(Number(s.feePaid)||0))})).filter(x=>x.balance>0).sort((a,b)=>b.balance-a.balance),total=list.reduce((n,x)=>n+x.balance,0);
    return{answer:`${list.length} student(s)${courseId?' in '+COURSE_NAMES[courseId]:''} have an outstanding balance totalling GHS ${total.toFixed(2)}.`,rows:list.slice(0,30).map(x=>({student:x.s.fullName,regNumber:x.s.regNumber,balance:'GHS '+x.balance.toFixed(2)}))};
  }
  if(/popular|largest|most students|top program|top course/.test(lower)){
    const counts={};active.forEach(s=>counts[s.course]=(counts[s.course]||0)+1);const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);const top=sorted[0];
    return{answer:top?`${COURSE_NAMES[top[0]]||top[0]} currently has the most students with ${top[1]} active/registered student(s).`:'There are no active student registrations to compare.',rows:sorted.slice(0,10).map(([id,count])=>({program:COURSE_NAMES[id]||id,students:count}))};
  }
  if(/how many|number of students|student count|students/.test(lower)){
    return{answer:`There are ${courseStudents.length} active/registered student(s)${courseId?' in '+COURSE_NAMES[courseId]:''}.`,rows:[]};
  }
  if(/facilitator/.test(lower)){
    const rows=(base.facilitators||[]).filter(f=>f.active!==false);return{answer:`There are ${rows.length} active facilitator(s).`,rows:rows.slice(0,30).map(f=>({facilitator:f.name,username:f.username,programs:(f.courses||[]).map(c=>COURSE_NAMES[c]||c).join(', ')}))};
  }
  if(/capacity|full|spaces|places/.test(lower)){
    const rows=Object.entries(base.capacities||{}).map(([id,cap])=>{const used=active.filter(s=>s.course===id).length;return{program:COURSE_NAMES[id]||id,used,capacity:Number(cap)||0,remaining:Math.max(0,(Number(cap)||0)-used)};}).sort((a,b)=>a.remaining-b.remaining);
    return{answer:'Here is the current program-capacity position.',rows:rows.slice(0,30)};
  }
  if(/unread.*message|message.*unread/.test(lower)){
    const n=Number(base.messageStats&&base.messageStats.unread)||0;return{answer:`There are ${n} unread student portal message(s).`,rows:[]};
  }
  if(/this month|monthly registration|registrations this month/.test(lower)){
    const ym=new Date().toISOString().slice(0,7),rows=students.filter(s=>String(s.regDate||'').startsWith(ym));
    return{answer:`${rows.length} student(s) registered this month.`,rows:rows.slice(0,30).map(s=>({student:s.fullName,regNumber:s.regNumber,program:COURSE_NAMES[s.course]||s.course,date:s.regDate||''}))};
  }
  return{answer:'I can answer questions about student counts, high-risk students, attendance below a percentage, outstanding fees, popular programs, facilitators, capacity, unread messages, registrations this month, or give you an overall summary.',rows:[]};
}

const baseSuite=app.adminGetSuiteSnapshot;
app.adminGetEnterpriseSnapshot=onCall({enforceAppCheck:true},async request=>{
  const a=await assertSession(request);const base=await baseSuite.run(request);
  const [intakeHistory,contacts,recycle,classSessions,notes,history,cohortMeta,sessions,two,notificationState,rawSmartRules,smartLog]=await Promise.all([
    readValue(KEYS.intakeHistory,[]),readValue(KEYS.contacts,[]),readValue(KEYS.recycle,[]),readValue(KEYS.classSessions,[]),readValue(KEYS.notes,[]),readValue(KEYS.history,[]),readValue(KEYS.cohortMeta,{}),readValue(KEYS.sessions,[]),read2fa(),readValue(KEYS.notificationState,{}),readValue(KEYS.smartRules,DEFAULT_SMART_RULES),readValue(KEYS.smartRuleLog,[])
  ]);
  const students=base.students||[],attendance=base.attendance||[],facilitators=base.facilitators||[],risks=buildRiskAnalysis(students,attendance,base.settings||{},base.intake||{}),riskStats=riskSummary(risks),rules=smartRules(rawSmartRules);
  const cohortMap={};for(const s of students){const k=s.intakeStart||'Unknown';cohortMap[k]=cohortMap[k]||{intakeStart:k,label:k,students:0,archived:!!(cohortMeta[k]&&cohortMeta[k].archived)};cohortMap[k].students++;}for(const h of (Array.isArray(intakeHistory)?intakeHistory:[])){const k=h.startDate||h.intakeStart;if(k){cohortMap[k]=cohortMap[k]||{intakeStart:k,label:h.label||k,students:0,archived:true};if(h.label)cohortMap[k].label=h.label;}}if(base.intake&&base.intake.startDate){const k=base.intake.startDate;cohortMap[k]=cohortMap[k]||{intakeStart:k,label:base.intake.label||k,students:0,archived:false};}
  const performance=facilitators.map(f=>{const marks=attendance.filter(r=>String(r.markedBy||'').toLowerCase()===String(f.username||'').toLowerCase()),sessions=classSessions.filter(s=>s.facilitatorId===f.id),assignedStudents=students.filter(s=>(f.courses||[]).includes(s.course)&&s.status!=='Cancelled').length;return {id:f.id,name:f.name,username:f.username,assignedStudents,attendanceMarks:marks.length,sessions:sessions.length,completedSessions:sessions.filter(s=>s.status==='Completed').length};});
  const notifications=[];const seven=Date.now()-7*86400000;for(const s of students){const t=new Date(s.regDate||0).getTime();if(t>=seven)notifications.push({id:'registration:'+s.id,type:'registration',title:'New registration',message:`${s.fullName} registered for ${COURSE_NAMES[s.course]||s.course}.`,date:s.regDate});}for(const m of (Array.isArray(contacts)?contacts:[])){const t=new Date(m.date||0).getTime();if(t>=seven)notifications.push({id:'contact:'+m.id,type:'message',title:'New website message',message:`Message from ${m.name||m.email||'visitor'}.`,date:m.date});}for(const [course,cap] of Object.entries(base.capacities||{})){const count=students.filter(s=>s.course===course&&s.status!=='Cancelled'&&(!base.intake.startDate||s.intakeStart===base.intake.startDate)).length;const c=Number(cap)||0;if(c&&count/c>=0.8)notifications.push({id:'capacity:'+course+':'+(base.intake.startDate||''),type:'capacity',title:'Program nearly full',message:`${COURSE_NAMES[course]||course}: ${count}/${c} places used.`,date:nowIso()});}const close=base.intake&&base.intake.registrationCloseDate;if(close){const days=Math.ceil((new Date(close+'T23:59:59Z').getTime()-Date.now())/86400000);if(days>=0&&days<=7)notifications.push({id:'registration-closing:'+close,type:'deadline',title:'Registration closing soon',message:`Registration closes in ${days} day(s) on ${close}.`,date:nowIso()});}for(const n of (base.broadcasts||[])){if(n.expiresAt){const hrs=(new Date(n.expiresAt).getTime()-Date.now())/3600000;if(hrs>0&&hrs<=48)notifications.push({id:'notice-expiry:'+n.id,type:'announcement',title:'Announcement expiring',message:(n.message||'Announcement').slice(0,120),date:n.expiresAt});}}for(const s of students){const rows=attendance.filter(r=>r.studentId===s.id&&(r.status==='Present'||r.status==='Absent'));if(rows.length>=3){const pct=rows.filter(r=>r.status==='Present').length/rows.length;if(pct<0.75)notifications.push({id:'low-attendance:'+s.id,type:'attendance',title:'Low attendance',message:`${s.fullName} is at ${Math.round(pct*100)}% attendance.`,date:nowIso()});}}for(const r of risks.filter(x=>x.level==='High').slice(0,50)){notifications.push({id:'high-risk:'+r.id,type:'risk',title:'High student risk',message:`${r.fullName} has a risk score of ${r.score}/100 — ${r.reasons.slice(0,2).join('; ')||'review recommended'}.`,date:nowIso()});}
  const dismissed=Array.isArray(notificationState[a.username])?new Set(notificationState[a.username]):new Set();
  return {...base,cohorts:Object.values(cohortMap).sort((x,y)=>String(y.intakeStart).localeCompare(String(x.intakeStart))),classSessions:Array.isArray(classSessions)?classSessions:[],facilitatorPerformance:performance,internalNotes:Array.isArray(notes)?notes:[],changeHistory:Array.isArray(history)?history.slice(-500).reverse():[],recycleCount:Array.isArray(recycle)?recycle.length:0,notifications:notifications.filter(n=>!dismissed.has(n.id)).sort((x,y)=>String(y.date).localeCompare(String(x.date))).slice(0,100),sessions:(Array.isArray(sessions)?sessions:[]).filter(s=>(a.role||'staff')==='owner'||s.username===a.username).slice().sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt))).slice(0,100),twoFactorEnabled:!!two.find(x=>x.username===a.username&&x.enabled),riskAnalysis:risks,riskSummary:riskStats,smartNotificationRules:rules,smartNotificationLog:Array.isArray(smartLog)?smartLog.slice(-100).reverse():[]};
});
app.adminDismissNotification=onCall({enforceAppCheck:true},async request=>{const a=await assertSession(request),id=clean(request.data&&request.data.id,200);const state=await readValue(KEYS.notificationState,{});const list=Array.isArray(state[a.username])?state[a.username]:[];if(!list.includes(id))list.push(id);state[a.username]=list.slice(-500);await writeValue(KEYS.notificationState,state);return {ok:true};});

app.adminGetStudentRiskAnalysis=onCall({enforceAppCheck:true},async request=>{
  await requirePermission(request,'reports');const [students,attendance,settings,intake]=await Promise.all([readValue(KEYS.students,[]),readValue(KEYS.attendance,[]),readValue(KEYS.settings,{}),readValue(KEYS.intake,{})]);const rows=buildRiskAnalysis(students,attendance,settings,intake);return{rows,summary:riskSummary(rows)};
});
app.adminSaveSmartNotificationRules=onCall({enforceAppCheck:true},async request=>{
  const a=await requirePermission(request,'settings');const rules=smartRules(request.data&&request.data.rules);await writeValue(KEYS.smartRules,rules);await appendAudit(a,'Updated smart notification rules',rules.enabled?'Automation enabled':'Automation disabled');return{ok:true,rules};
});
app.adminPreviewSmartNotificationRules=onCall({enforceAppCheck:true},async request=>{
  await requirePermission(request,'reports');const result=await evaluateSmartNotifications({send:false});return{rules:result.rules,total:result.alerts.length,eligible:result.eligible.length,alerts:result.eligible.slice(0,100)};
});
app.adminRunSmartNotificationRules=onCall({enforceAppCheck:true},async request=>{
  const a=await requirePermission(request,'settings');const result=await evaluateSmartNotifications({send:true});await appendAudit(a,'Ran smart notification rules',result.disabled?'Automation is disabled':`${result.sent||0} portal alert(s) sent`);return{ok:true,disabled:!!result.disabled,sent:result.sent||0,eligible:(result.eligible||[]).length};
});
app.adminAskAssistant=onCall({enforceAppCheck:true},async request=>{
  const a=await requirePermission(request,'reports');const question=clean(request.data&&request.data.question,400);if(question.length<2)throw new HttpsError('invalid-argument','Ask a question about SkyDream data.');const base=await baseSuite.run(request);const risks=buildRiskAnalysis(base.students||[],base.attendance||[],base.settings||{},base.intake||{});const result=assistantAnswer(question,base,risks);await appendAudit(a,'Used Admin Assistant','',question.slice(0,80));return{...result,asOf:nowIso()};
});
app.smartNotificationDaily=onSchedule({schedule:'every day 08:00',timeZone:'Africa/Accra',region:'us-central1'},async()=>{await evaluateSmartNotifications({send:true});});


async function createBackup(){
  const keys=Object.values(KEYS);const data={createdAt:nowIso(),project:'skydream-academy',documents:{}};for(const key of keys)data.documents[key]=await readValue(key,null);
  const bucket=admin.storage().bucket(STORAGE_BUCKET);const day=nowIso().slice(0,10),stamp=nowIso().replace(/[:.]/g,'-');const file=bucket.file(`admin-backups/${day}/skydream-${stamp}.json`);await file.save(JSON.stringify(data),{contentType:'application/json',resumable:false,metadata:{cacheControl:'no-store'}});
  try{const [files]=await bucket.getFiles({prefix:'admin-backups/'});const cutoff=Date.now()-30*86400000;await Promise.all(files.filter(f=>{const m=f.name.match(/admin-backups\/(\d{4}-\d{2}-\d{2})\//);return m&&new Date(m[1]+'T00:00:00Z').getTime()<cutoff;}).map(f=>f.delete().catch(()=>null)));}catch(_){}
  try{const bin=await readValue(KEYS.recycle,[]);const keep=(Array.isArray(bin)?bin:[]).filter(x=>new Date(x.deletedAt||0).getTime()>=Date.now()-30*86400000);if(keep.length!==(Array.isArray(bin)?bin.length:0))await writeValue(KEYS.recycle,keep);}catch(_){}
  return file.name;
}
app.dailyAdminBackup=onSchedule({schedule:'every day 02:30',timeZone:'Africa/Accra',region:'us-central1'},async()=>{await createBackup();});
app.adminRunManualBackup=onCall({enforceAppCheck:true},async request=>{const a=await requirePermission(request,'settings',true);const path=await createBackup();await appendAudit(a,'Created manual cloud backup','',path);return {ok:true,path};});

const SESSION_PROTECTED=[
  'getAdminSnapshot','adminGetSuiteSnapshot','adminUpdateStudent','adminAddPayment','adminDeleteStudent','adminSetCapacity',
  'adminCreateFacilitator','adminDeleteFacilitator','adminSetFacilitatorPin','adminCreateAdmin','adminDeleteAdmin','adminChangePassword',
  'adminStartNextIntake','adminCreateBroadcast','adminSetBroadcastActive','adminDeleteBroadcast','adminBulkUpdateStudents',
  'adminUpdateFacilitator','adminSetAdminRole','adminSaveRegistrationSettings'
];
for(const name of SESSION_PROTECTED){const base=app[name];if(!base||typeof base.run!=='function')continue;app[name]=onCall({enforceAppCheck:true},async request=>{await assertSession(request);return base.run(request);});}

module.exports=app;
