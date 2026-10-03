// Academic operations + student self-service portal extension.
// Adds assessment/progress tracking, timetable/room management with clash checks,
// a protected student portal, and global admin search.
const app = require('./enterprise-final-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE = 'sdta_storage';
const KEYS = {
  students: 'sdta_students',
  admins: 'sdta_admins',
  facilitators: 'sdta_facilitators',
  attendance: 'sdta_attendance',
  intake: 'sdta_intake',
  intakeHistory: 'sdta_intake_history',
  contacts: 'sdta_contact_messages',
  broadcasts: 'sdta_broadcasts',
  settings: 'sdta_admin_settings',
  sessions: 'sdta_admin_sessions',
  assessments: 'sdta_assessments',
  timetable: 'sdta_timetable',
  audit: 'sdta_activity_log'
};

const COURSE_NAMES = {
  'household-chemicals':'Household Chemicals Production','hair-dressing':'Hair Dressing',cosmetology:'Cosmetology',
  electricals:'Electricals','floral-decor':'Floral Decor','fashion-design':'Fashion Design',beading:'Beading',
  french:'French Language',korean:'Korean Language',pastries:'Pastries & Baking','graphic-design':'Graphic Design',
  barbering:'Barbering',accounting:'Accounting'
};
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const ASSESSMENT_TYPES = ['Assignment','Quiz','Practical','Project','Exam','Participation','Other'];

const refFor = key => db.collection(STORAGE).doc(key);
const parseJson = (raw,fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } };
const clean = (v,max=500) => String(v == null ? '' : v).trim().slice(0,max);
const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g,'');
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3);
  return digits;
};
async function readValue(key,fallback){ const s=await refFor(key).get(); return s.exists ? parseJson(s.data().value,fallback) : fallback; }
async function appendAudit(account,action,detail='',target=''){
  try {
    const ref=refFor(KEYS.audit);
    await db.runTransaction(async tx=>{
      const s=await tx.get(ref); let list=s.exists?parseJson(s.data().value,[]):[]; if(!Array.isArray(list))list=[];
      list.push({id:'audit_'+crypto.randomUUID(),date:new Date().toISOString(),admin:account.username,role:account.role||'staff',action:clean(action,100),detail:clean(detail,400),target:clean(target,140)});
      if(list.length>1000) list=list.slice(-1000);
      tx.set(ref,{value:JSON.stringify(list)});
    });
  } catch (_) {}
}

async function requireAdmin(request, permission='students'){
  const auth=request.auth, token=auth&&auth.token;
  if(!auth||!token||token.role!=='admin'||!token.username) throw new HttpsError('permission-denied','Administrator access is required.');
  const admins=await readValue(KEYS.admins,[]);
  const account=admins.find(a=>String(a.username||'').toLowerCase()===String(token.username).toLowerCase());
  if(!account||auth.uid!=='admin-'+account.id) throw new HttpsError('permission-denied','This administrator account is no longer active.');
  if(!token.sessionId) throw new HttpsError('permission-denied','Please sign out and sign in again to start a protected admin session.');
  const sessions=await readValue(KEYS.sessions,[]);
  const session=sessions.find(s=>s.id===token.sessionId&&s.username===account.username&&!s.revoked);
  if(!session) throw new HttpsError('permission-denied','This admin session has been signed out. Please log in again.');
  const role=account.role||'staff';
  const permissions={owner:['*'],manager:['students','attendance','facilitators','reports','announcements','settings'],staff:['students','attendance','reports','announcements'],registration:['students','attendance','reports'],finance:['reports'],viewer:['reports']}[role]||['students'];
  if(!permissions.includes('*')&&!permissions.includes(permission)) throw new HttpsError('permission-denied','Your administrator role does not allow this action.');
  return account;
}

async function enforcePortalRateLimit(request){
  const raw=request&&request.rawRequest;
  const forwarded=raw&&raw.headers&&raw.headers['x-forwarded-for'];
  const ip=clean((Array.isArray(forwarded)?forwarded[0]:forwarded)||(raw&&raw.ip)||'',120).split(',')[0].trim();
  if(!ip) return;
  const id=crypto.createHash('sha256').update('student-portal|'+ip).digest('hex');
  const ref=db.collection('sdta_portal_rate_limits').doc(id); const now=Date.now();
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref); const d=s.exists?s.data():{}; let start=Number(d.windowStart)||now, count=Number(d.count)||0;
    if(now-start>=15*60*1000){start=now;count=0;}
    if(count>=15) throw new HttpsError('resource-exhausted','Too many login attempts. Please wait 15 minutes and try again.');
    tx.set(ref,{windowStart:start,count:count+1,expiresAt:admin.firestore.Timestamp.fromMillis(start+30*60*1000)},{merge:true});
  });
}

function validTime(value){ return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||'')); }
function overlaps(aStart,aEnd,bStart,bEnd){ return aStart < bEnd && bStart < aEnd; }
function safeStudent(student){
  return {id:student.id,regNumber:student.regNumber,fullName:student.fullName,course:student.course,status:student.status||'Registered',intakeStart:student.intakeStart||'',mobile:student.mobile||'',email:student.email||''};
}

app.adminGetAcademicSnapshot = onCall({enforceAppCheck:true}, async request => {
  await requireAdmin(request,'students');
  const [students,facilitators,assessments,timetable,intake] = await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.facilitators,[]),readValue(KEYS.assessments,[]),readValue(KEYS.timetable,[]),readValue(KEYS.intake,{})
  ]);
  return {
    students:(students||[]).map(safeStudent),
    facilitators:(facilitators||[]).map(f=>({id:f.id,name:f.name,username:f.username,phone:f.phone||'',courses:Array.isArray(f.courses)?f.courses:[],active:f.active!==false})),
    assessments:Array.isArray(assessments)?assessments:[], timetable:Array.isArray(timetable)?timetable:[], intake, courses:COURSE_NAMES,
    assessmentTypes:ASSESSMENT_TYPES, days:DAYS
  };
});

app.adminSaveAssessment = onCall({enforceAppCheck:true}, async request => {
  const account=await requireAdmin(request,'students'); const d=request.data||{};
  const id=clean(d.id,120), studentId=clean(d.studentId,120), title=clean(d.title,120), type=clean(d.type,40), remark=clean(d.remark,700), date=clean(d.date,10);
  const score=Number(d.score), maxScore=Number(d.maxScore);
  if(!studentId||!title||!ASSESSMENT_TYPES.includes(type)) throw new HttpsError('invalid-argument','Student, assessment type and title are required.');
  if(!Number.isFinite(score)||!Number.isFinite(maxScore)||maxScore<=0||score<0||score>maxScore) throw new HttpsError('invalid-argument','Enter a valid score and maximum score.');
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('invalid-argument','Assessment date is invalid.');
  const students=await readValue(KEYS.students,[]); const student=students.find(s=>s.id===studentId);
  if(!student) throw new HttpsError('not-found','Student not found.');
  const ref=refFor(KEYS.assessments); let saved=null;
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref); let list=s.exists?parseJson(s.data().value,[]):[]; if(!Array.isArray(list))list=[];
    if(id){
      saved=list.find(x=>x.id===id); if(!saved) throw new HttpsError('not-found','Assessment record not found.');
      Object.assign(saved,{studentId,course:student.course,title,type,score,maxScore,remark,date:date||new Date().toISOString().slice(0,10),updatedAt:new Date().toISOString(),updatedBy:account.username});
    } else {
      saved={id:'asm_'+crypto.randomUUID(),studentId,course:student.course,title,type,score,maxScore,remark,date:date||new Date().toISOString().slice(0,10),createdAt:new Date().toISOString(),createdBy:account.username};
      list.push(saved);
    }
    if(list.length>5000) list=list.slice(-5000);
    tx.set(ref,{value:JSON.stringify(list)});
  });
  await appendAudit(account,id?'Updated assessment':'Added assessment',`${title}: ${score}/${maxScore}`,student.regNumber||studentId);
  return {ok:true,assessment:saved};
});

app.adminDeleteAssessment = onCall({enforceAppCheck:true}, async request => {
  const account=await requireAdmin(request,'students'); const id=clean(request.data&&request.data.id,120); if(!id) throw new HttpsError('invalid-argument','Assessment ID is required.');
  const ref=refFor(KEYS.assessments); let removed=null;
  await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];removed=list.find(x=>x.id===id);if(!removed)throw new HttpsError('not-found','Assessment not found.');tx.set(ref,{value:JSON.stringify(list.filter(x=>x.id!==id))});});
  await appendAudit(account,'Deleted assessment',removed.title||'',removed.studentId||''); return {ok:true};
});

async function saveTimetable(request){
  const account=await requireAdmin(request,'settings'); const d=request.data||{};
  const id=clean(d.id,120), day=clean(d.day,20), startTime=clean(d.startTime,5), endTime=clean(d.endTime,5), course=clean(d.course,60), facilitatorId=clean(d.facilitatorId,120), room=clean(d.room,80), title=clean(d.title,120)||'Class';
  if(!DAYS.includes(day)||!validTime(startTime)||!validTime(endTime)||startTime>=endTime||!COURSE_NAMES[course]||!room) throw new HttpsError('invalid-argument','Day, time, program and room are required.');
  const facilitators=await readValue(KEYS.facilitators,[]);
  if(facilitatorId&&!facilitators.some(f=>f.id===facilitatorId&&f.active!==false)) throw new HttpsError('invalid-argument','Choose an active facilitator.');
  const intake=await readValue(KEYS.intake,{}); const ref=refFor(KEYS.timetable); let saved=null;
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref); let list=s.exists?parseJson(s.data().value,[]):[]; if(!Array.isArray(list))list=[];
    const conflict=list.find(x=>x.id!==id&&x.day===day&&overlaps(startTime,endTime,x.startTime,x.endTime) && (
      String(x.room||'').toLowerCase()===room.toLowerCase() || (facilitatorId&&x.facilitatorId===facilitatorId) || x.course===course
    ));
    if(conflict){
      const reason=String(conflict.room||'').toLowerCase()===room.toLowerCase()?'room':(facilitatorId&&conflict.facilitatorId===facilitatorId?'facilitator':'program');
      throw new HttpsError('already-exists',`Timetable clash: that ${reason} already has a session on ${day} from ${conflict.startTime} to ${conflict.endTime}.`);
    }
    if(id){saved=list.find(x=>x.id===id);if(!saved)throw new HttpsError('not-found','Timetable entry not found.');Object.assign(saved,{day,startTime,endTime,course,facilitatorId,room,title,intakeStart:intake.startDate||'',updatedAt:new Date().toISOString(),updatedBy:account.username});}
    else {saved={id:'tt_'+crypto.randomUUID(),day,startTime,endTime,course,facilitatorId,room,title,intakeStart:intake.startDate||'',createdAt:new Date().toISOString(),createdBy:account.username};list.push(saved);}
    if(list.length>1000) list=list.slice(-1000); tx.set(ref,{value:JSON.stringify(list)});
  });
  await appendAudit(account,id?'Updated timetable':'Created timetable entry',`${day} ${startTime}-${endTime} · ${room}`,course); return {ok:true,entry:saved};
}
app.adminSaveTimetableEntry = onCall({enforceAppCheck:true}, saveTimetable);
app.adminDeleteTimetableEntry = onCall({enforceAppCheck:true}, async request => {
  const account=await requireAdmin(request,'settings'); const id=clean(request.data&&request.data.id,120); const ref=refFor(KEYS.timetable); let removed=null;
  await db.runTransaction(async tx=>{const s=await tx.get(ref);const list=s.exists?parseJson(s.data().value,[]):[];removed=list.find(x=>x.id===id);if(!removed)throw new HttpsError('not-found','Timetable entry not found.');tx.set(ref,{value:JSON.stringify(list.filter(x=>x.id!==id))});});
  await appendAudit(account,'Deleted timetable entry',removed?`${removed.day} ${removed.startTime}-${removed.endTime}`:'',removed&&removed.course); return {ok:true};
});

app.adminGlobalSearch = onCall({enforceAppCheck:true}, async request => {
  await requireAdmin(request,'reports'); const q=clean(request.data&&request.data.q,100).toLowerCase(); if(q.length<2)return {results:[]};
  const [students,facilitators,admins,contacts,broadcasts,intakeHistory,timetable] = await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.facilitators,[]),readValue(KEYS.admins,[]),readValue(KEYS.contacts,[]),readValue(KEYS.broadcasts,[]),readValue(KEYS.intakeHistory,[]),readValue(KEYS.timetable,[])
  ]);
  const includes=(...vals)=>vals.some(v=>String(v||'').toLowerCase().includes(q)); const results=[];
  (students||[]).forEach(s=>{if(includes(s.fullName,s.regNumber,s.mobile,s.email,s.ghanaCard,COURSE_NAMES[s.course]))results.push({type:'Student',id:s.id,title:s.fullName,subtitle:`${s.regNumber||''} · ${COURSE_NAMES[s.course]||s.course||''}`,target:'#studentProfiles',query:s.fullName});});
  (facilitators||[]).forEach(f=>{if(includes(f.name,f.username,f.phone,...(f.courses||[]).map(c=>COURSE_NAMES[c])))results.push({type:'Facilitator',id:f.id,title:f.name,subtitle:`@${f.username||''} · ${f.phone||''}`,target:'#facilitatorManagement',query:f.name});});
  (admins||[]).forEach(a=>{if(includes(a.name,a.username,a.role))results.push({type:'Administrator',id:a.id,title:a.name||a.username,subtitle:`@${a.username} · ${a.role||'staff'}`,target:'#adminRoles',query:a.username});});
  (contacts||[]).forEach(m=>{if(includes(m.name,m.email,m.message))results.push({type:'Website message',id:m.id,title:m.name||m.email,subtitle:clean(m.message,100),target:'#messages',query:m.name||m.email});});
  (broadcasts||[]).forEach(n=>{if(includes(n.message,n.createdBy))results.push({type:'Announcement',id:n.id,title:clean(n.message,80),subtitle:n.active===false?'Hidden':'Active',target:'#scheduledAnnouncements',query:n.message});});
  (intakeHistory||[]).forEach(i=>{if(includes(i.label,i.startDate))results.push({type:'Intake',id:i.startDate,title:i.label||i.startDate,subtitle:i.startDate||'',target:'#cohortArchive',query:i.label||i.startDate});});
  (timetable||[]).forEach(t=>{if(includes(t.title,t.room,t.day,COURSE_NAMES[t.course]))results.push({type:'Timetable',id:t.id,title:t.title||COURSE_NAMES[t.course],subtitle:`${t.day} ${t.startTime}-${t.endTime} · ${t.room}`,target:'#academicTimetable',query:t.room});});
  return {results:results.slice(0,40)};
});

app.studentPortalLogin = onCall({enforceAppCheck:true}, async request => {
  await enforcePortalRateLimit(request);
  const regNumber=clean(request.data&&request.data.regNumber,60).toUpperCase(); const phone=normalizePhone(request.data&&request.data.mobile);
  if(!regNumber||!/^0\d{9}$/.test(phone)) throw new HttpsError('invalid-argument','Enter your registration number and 10-digit mobile number.');
  const students=await readValue(KEYS.students,[]); const student=students.find(s=>String(s.regNumber||'').toUpperCase()===regNumber && normalizePhone(s.mobile)===phone);
  if(!student) throw new HttpsError('permission-denied','The registration number and mobile number do not match our records.');
  const token=await admin.auth().createCustomToken('student-'+student.id,{role:'student',studentId:student.id,regNumber:student.regNumber});
  return {token,student:{fullName:student.fullName,regNumber:student.regNumber}};
});

app.getStudentPortalDashboard = onCall({enforceAppCheck:true}, async request => {
  const auth=request.auth, token=auth&&auth.token; if(!auth||!token||token.role!=='student'||!token.studentId) throw new HttpsError('permission-denied','Student sign-in is required.');
  if(auth.uid!=='student-'+token.studentId) throw new HttpsError('permission-denied','This student session is invalid.');
  const [students,attendance,assessments,timetable,broadcasts,settings,intake] = await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.attendance,[]),readValue(KEYS.assessments,[]),readValue(KEYS.timetable,[]),readValue(KEYS.broadcasts,[]),readValue(KEYS.settings,{}),readValue(KEYS.intake,{})
  ]);
  const student=students.find(s=>s.id===token.studentId); if(!student) throw new HttpsError('permission-denied','Student record is no longer available.');
  const marks=(attendance||[]).filter(a=>a.studentId===student.id); const present=marks.filter(a=>a.status==='Present').length, absent=marks.filter(a=>a.status==='Absent').length;
  const studentAssessments=(assessments||[]).filter(a=>a.studentId===student.id).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const totalWeight=studentAssessments.reduce((sum,a)=>sum+(Number(a.maxScore)||0),0); const totalScore=studentAssessments.reduce((sum,a)=>sum+(Number(a.score)||0),0); const average=totalWeight?Math.round((totalScore/totalWeight)*100):0;
  const currentIntake=student.intakeStart||intake.startDate||'';
  const studentTimetable=(timetable||[]).filter(t=>t.course===student.course && (!t.intakeStart||!currentIntake||t.intakeStart===currentIntake));
  const now=Date.now(); const notices=(broadcasts||[]).filter(n=>n&&n.active!==false&&(!n.startsAt||new Date(n.startsAt).getTime()<=now)&&(!n.expiresAt||new Date(n.expiresAt).getTime()>now)).slice(-10).reverse().map(n=>({id:n.id,message:n.message,date:n.date||''}));
  const fee=Number.isFinite(Number(settings.registrationFee))?Number(settings.registrationFee):50; const paid=Math.max(0,Number(student.feePaid)||0);
  return {
    student:{fullName:student.fullName,regNumber:student.regNumber,course:student.course,courseName:COURSE_NAMES[student.course]||student.course,status:student.status||'Registered',mobile:student.mobile||'',email:student.email||'',intakeStart:currentIntake},
    payment:{fee,paid,balance:Math.max(0,fee-paid),status:paid>=fee?'Paid':(paid>0?'Partial':'Unpaid')},
    attendance:{present,absent,marked:present+absent,percentage:(present+absent)?Math.round((present/(present+absent))*100):0,records:marks.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,30)},
    assessments:studentAssessments,progress:{average,totalAssessments:studentAssessments.length}, timetable:studentTimetable, notices
  };
});

module.exports = app;
