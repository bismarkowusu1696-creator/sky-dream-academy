// Student engagement, attendance and self-service portal extension.
// Assessment and timetable features are retired; existing historical records are left intact.
const app = require('./enterprise-final-loader');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const db = admin.firestore();
const STORAGE = 'sdta_storage';
const KEYS = {
  students: 'sdta_students', admins: 'sdta_admins', facilitators: 'sdta_facilitators',
  attendance: 'sdta_attendance', intake: 'sdta_intake', intakeHistory: 'sdta_intake_history',
  contacts: 'sdta_contact_messages', broadcasts: 'sdta_broadcasts', settings: 'sdta_admin_settings',
  sessions: 'sdta_admin_sessions', audit: 'sdta_activity_log'
};
const COL = {
  assessments: 'sdta_assessment_records',
  timetable: 'sdta_timetable_entries',
  rooms: 'sdta_rooms',
  studentMessages: 'sdta_student_messages',
  studentPushTokens: 'sdta_student_push_tokens',
  qrAttendance: 'sdta_qr_attendance_sessions'
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
async function readCollection(name, limit=2500){
  const snap=await db.collection(name).limit(limit).get();
  return snap.docs.map(doc=>({id:doc.id,...doc.data()}));
}
async function appendAudit(account,action,detail='',target=''){
  try{
    const ref=refFor(KEYS.audit);
    await db.runTransaction(async tx=>{
      const s=await tx.get(ref);let list=s.exists?parseJson(s.data().value,[]):[];if(!Array.isArray(list))list=[];
      list.push({id:'audit_'+crypto.randomUUID(),date:new Date().toISOString(),admin:account.username,role:account.role||'staff',action:clean(action,100),detail:clean(detail,400),target:clean(target,140)});
      if(list.length>1000)list=list.slice(-1000);tx.set(ref,{value:JSON.stringify(list)});
    });
  }catch(_){}
}
async function requireAdmin(request,permission='students'){
  const auth=request.auth,token=auth&&auth.token;
  if(!auth||!token||token.role!=='admin'||!token.username)throw new HttpsError('permission-denied','Administrator access is required.');
  const admins=await readValue(KEYS.admins,[]);
  const account=admins.find(a=>String(a.username||'').toLowerCase()===String(token.username).toLowerCase());
  if(!account||auth.uid!=='admin-'+account.id)throw new HttpsError('permission-denied','This administrator account is no longer active.');
  if(!token.sessionId)throw new HttpsError('permission-denied','Please sign out and sign in again to start a protected admin session.');
  const sessions=await readValue(KEYS.sessions,[]);
  const session=sessions.find(s=>s.id===token.sessionId&&s.username===account.username&&!s.revoked);
  if(!session)throw new HttpsError('permission-denied','This admin session has been signed out. Please log in again.');
  const permissions={owner:['*'],manager:['students','attendance','facilitators','reports','announcements','settings'],staff:['students','attendance','reports','announcements'],registration:['students','attendance','reports'],finance:['reports'],viewer:['reports']}[account.role||'staff']||['students'];
  if(!permissions.includes('*')&&!permissions.includes(permission))throw new HttpsError('permission-denied','Your administrator role does not allow this action.');
  return account;
}
async function enforcePortalRateLimit(request){
  const raw=request&&request.rawRequest,forwarded=raw&&raw.headers&&raw.headers['x-forwarded-for'];
  const ip=clean((Array.isArray(forwarded)?forwarded[0]:forwarded)||(raw&&raw.ip)||'',120).split(',')[0].trim();if(!ip)return;
  const id=crypto.createHash('sha256').update('student-portal|'+ip).digest('hex');const ref=db.collection('sdta_portal_rate_limits').doc(id),now=Date.now();
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref),d=s.exists?s.data():{};let start=Number(d.windowStart)||now,count=Number(d.count)||0;
    if(now-start>=15*60*1000){start=now;count=0;}if(count>=15)throw new HttpsError('resource-exhausted','Too many login attempts. Please wait 15 minutes and try again.');
    tx.set(ref,{windowStart:start,count:count+1,expiresAt:admin.firestore.Timestamp.fromMillis(start+30*60*1000)},{merge:true});
  });
}
function validTime(value){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''));}
function overlaps(aStart,aEnd,bStart,bEnd){return aStart<bEnd&&bStart<aEnd;}
function safeStudent(s){return{id:s.id,regNumber:s.regNumber,fullName:s.fullName,course:s.course,status:s.status||'Registered',intakeStart:s.intakeStart||'',mobile:s.mobile||'',email:s.email||''};}

app.adminGetAcademicSnapshot=onCall({enforceAppCheck:true},async request=>{
  await requireAdmin(request,'students');
  const [students,facilitators,assessments,timetable,rooms,intake]=await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.facilitators,[]),readCollection(COL.assessments),readCollection(COL.timetable),readCollection(COL.rooms,500),readValue(KEYS.intake,{})
  ]);
  return{students:(students||[]).map(safeStudent),facilitators:(facilitators||[]).map(f=>({id:f.id,name:f.name,username:f.username,phone:f.phone||'',courses:Array.isArray(f.courses)?f.courses:[],active:f.active!==false})),assessments,timetable,rooms,intake,courses:COURSE_NAMES,assessmentTypes:ASSESSMENT_TYPES,days:DAYS};
});

app.adminSaveAssessment=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'students'),d=request.data||{};
  const id=clean(d.id,120),studentId=clean(d.studentId,120),title=clean(d.title,120),type=clean(d.type,40),remark=clean(d.remark,700),date=clean(d.date,10);
  const score=Number(d.score),maxScore=Number(d.maxScore);
  if(!studentId||!title||!ASSESSMENT_TYPES.includes(type))throw new HttpsError('invalid-argument','Student, assessment type and title are required.');
  if(!Number.isFinite(score)||!Number.isFinite(maxScore)||maxScore<=0||score<0||score>maxScore)throw new HttpsError('invalid-argument','Enter a valid score and maximum score.');
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new HttpsError('invalid-argument','Assessment date is invalid.');
  const students=await readValue(KEYS.students,[]),student=students.find(s=>s.id===studentId);if(!student)throw new HttpsError('not-found','Student not found.');
  const docRef=id?db.collection(COL.assessments).doc(id):db.collection(COL.assessments).doc();
  const existing=id?await docRef.get():null;if(id&&!existing.exists)throw new HttpsError('not-found','Assessment record not found.');
  const saved={...(existing&&existing.exists?existing.data():{}),studentId,course:student.course,title,type,score,maxScore,remark,date:date||new Date().toISOString().slice(0,10),updatedAt:new Date().toISOString(),updatedBy:account.username};
  if(!id){saved.createdAt=saved.updatedAt;saved.createdBy=account.username;}
  await docRef.set(saved,{merge:true});await appendAudit(account,id?'Updated assessment':'Added assessment',`${title}: ${score}/${maxScore}`,student.regNumber||studentId);
  return{ok:true,assessment:{id:docRef.id,...saved}};
});
app.adminDeleteAssessment=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'students'),id=clean(request.data&&request.data.id,120);if(!id)throw new HttpsError('invalid-argument','Assessment ID is required.');
  const ref=db.collection(COL.assessments).doc(id),snap=await ref.get();if(!snap.exists)throw new HttpsError('not-found','Assessment not found.');await ref.delete();
  const removed=snap.data();await appendAudit(account,'Deleted assessment',removed.title||'',removed.studentId||'');return{ok:true};
});

app.adminSaveRoom=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'settings'),d=request.data||{},id=clean(d.id,120),name=clean(d.name,80),location=clean(d.location,120),capacity=Number(d.capacity);
  if(!name||!Number.isInteger(capacity)||capacity<1||capacity>1000)throw new HttpsError('invalid-argument','Room name and a valid capacity are required.');
  const rooms=await readCollection(COL.rooms,500);if(rooms.some(r=>r.id!==id&&String(r.name||'').toLowerCase()===name.toLowerCase()))throw new HttpsError('already-exists','A room with that name already exists.');
  const ref=id?db.collection(COL.rooms).doc(id):db.collection(COL.rooms).doc();const saved={name,location,capacity,updatedAt:new Date().toISOString(),updatedBy:account.username};if(!id){saved.createdAt=saved.updatedAt;saved.createdBy=account.username;}
  await ref.set(saved,{merge:true});await appendAudit(account,id?'Updated room':'Created room',`${name} · capacity ${capacity}`,ref.id);return{ok:true,room:{id:ref.id,...saved}};
});
app.adminDeleteRoom=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'settings'),id=clean(request.data&&request.data.id,120);if(!id)throw new HttpsError('invalid-argument','Room ID is required.');
  const ref=db.collection(COL.rooms).doc(id),snap=await ref.get();if(!snap.exists)throw new HttpsError('not-found','Room not found.');
  const timetable=await readCollection(COL.timetable);if(timetable.some(t=>t.roomId===id))throw new HttpsError('failed-precondition','This room is used by the timetable. Remove or move those timetable entries first.');
  await ref.delete();await appendAudit(account,'Deleted room',snap.data().name||'',id);return{ok:true};
});

app.adminSaveTimetableEntry=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'settings'),d=request.data||{};
  const id=clean(d.id,120),day=clean(d.day,20),startTime=clean(d.startTime,5),endTime=clean(d.endTime,5),course=clean(d.course,60),facilitatorId=clean(d.facilitatorId,120),roomId=clean(d.roomId,120),title=clean(d.title,120)||'Class';
  if(!DAYS.includes(day)||!validTime(startTime)||!validTime(endTime)||startTime>=endTime||!COURSE_NAMES[course]||!roomId)throw new HttpsError('invalid-argument','Day, time, program and room are required.');
  const [facilitators,intake,roomSnap,timetable]=await Promise.all([readValue(KEYS.facilitators,[]),readValue(KEYS.intake,{}),db.collection(COL.rooms).doc(roomId).get(),readCollection(COL.timetable)]);
  if(!roomSnap.exists)throw new HttpsError('invalid-argument','Choose a valid room.');
  if(facilitatorId&&!facilitators.some(f=>f.id===facilitatorId&&f.active!==false))throw new HttpsError('invalid-argument','Choose an active facilitator.');
  const intakeStart=intake.startDate||'';
  const conflict=timetable.find(x=>x.id!==id&&x.day===day&&(!x.intakeStart||!intakeStart||x.intakeStart===intakeStart)&&overlaps(startTime,endTime,x.startTime,x.endTime)&&(x.roomId===roomId||(facilitatorId&&x.facilitatorId===facilitatorId)||x.course===course));
  if(conflict){const reason=conflict.roomId===roomId?'room':(facilitatorId&&conflict.facilitatorId===facilitatorId?'facilitator':'program');throw new HttpsError('already-exists',`Timetable clash: that ${reason} already has a session on ${day} from ${conflict.startTime} to ${conflict.endTime}.`);}
  const ref=id?db.collection(COL.timetable).doc(id):db.collection(COL.timetable).doc(),existing=id?await ref.get():null;if(id&&!existing.exists)throw new HttpsError('not-found','Timetable entry not found.');
  const room=roomSnap.data();const saved={...(existing&&existing.exists?existing.data():{}),day,startTime,endTime,course,facilitatorId,roomId,room:room.name,title,intakeStart,updatedAt:new Date().toISOString(),updatedBy:account.username};if(!id){saved.createdAt=saved.updatedAt;saved.createdBy=account.username;}
  await ref.set(saved,{merge:true});await appendAudit(account,id?'Updated timetable':'Created timetable entry',`${day} ${startTime}-${endTime} · ${room.name}`,course);return{ok:true,entry:{id:ref.id,...saved}};
});
app.adminDeleteTimetableEntry=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'settings'),id=clean(request.data&&request.data.id,120),ref=db.collection(COL.timetable).doc(id),snap=await ref.get();if(!snap.exists)throw new HttpsError('not-found','Timetable entry not found.');
  const removed=snap.data();await ref.delete();await appendAudit(account,'Deleted timetable entry',`${removed.day||''} ${removed.startTime||''}-${removed.endTime||''}`,removed.course||'');return{ok:true};
});

app.adminGlobalSearch=onCall({enforceAppCheck:true},async request=>{
  await requireAdmin(request,'reports');const q=clean(request.data&&request.data.q,100).toLowerCase();if(q.length<2)return{results:[]};
  const [students,facilitators,admins,contacts,broadcasts,intakeHistory]=await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.facilitators,[]),readValue(KEYS.admins,[]),
    readValue(KEYS.contacts,[]),readValue(KEYS.broadcasts,[]),readValue(KEYS.intakeHistory,[])
  ]);
  const includes=(...vals)=>vals.some(v=>String(v||'').toLowerCase().includes(q)),results=[];
  (students||[]).forEach(s=>{if(includes(s.fullName,s.regNumber,s.mobile,s.email,s.ghanaCard,COURSE_NAMES[s.course]))results.push({type:'Student',id:s.id,title:s.fullName,subtitle:`${s.regNumber||''} · ${COURSE_NAMES[s.course]||s.course||''}`,target:'#studentProfiles',query:s.fullName});});
  (facilitators||[]).forEach(f=>{if(includes(f.name,f.username,f.phone,...(f.courses||[]).map(c=>COURSE_NAMES[c])))results.push({type:'Facilitator',id:f.id,title:f.name,subtitle:`@${f.username||''} · ${f.phone||''}`,target:'#facilitatorManagement',query:f.name});});
  (admins||[]).forEach(a=>{if(includes(a.name,a.username,a.role))results.push({type:'Administrator',id:a.id,title:a.name||a.username,subtitle:`@${a.username} · ${a.role||'staff'}`,target:'#adminRoles',query:a.username});});
  (contacts||[]).forEach(m=>{if(includes(m.name,m.email,m.message))results.push({type:'Website message',id:m.id,title:m.name||m.email,subtitle:clean(m.message,100),target:'#messages',query:m.name||m.email});});
  (broadcasts||[]).forEach(n=>{if(includes(n.message,n.createdBy))results.push({type:'Announcement',id:n.id,title:clean(n.message,80),subtitle:n.active===false?'Hidden':'Active',target:'#scheduledAnnouncements',query:n.message});});
  (intakeHistory||[]).forEach(i=>{if(includes(i.label,i.startDate))results.push({type:'Intake',id:i.startDate,title:i.label||i.startDate,subtitle:i.startDate||'',target:'#cohortArchive',query:i.label||i.startDate});});
  return{results:results.slice(0,40)};
});

async function requireFacilitator(request){
  const auth=request&&request.auth,token=auth&&auth.token;
  if(!auth||!token||token.role!=='facilitator'||!token.username)throw new HttpsError('permission-denied','Facilitator access is required.');
  const facilitators=await readValue(KEYS.facilitators,[]);
  const account=(facilitators||[]).find(f=>String(f.username||'').toLowerCase()===String(token.username||'').toLowerCase());
  if(!account||account.active===false||auth.uid!=='fac-'+account.id)throw new HttpsError('permission-denied','This facilitator account is no longer active.');
  return account;
}
function requireStudent(request){
  const auth=request&&request.auth,token=auth&&auth.token;
  if(!auth||!token||token.role!=='student'||!token.studentId||auth.uid!=='student-'+token.studentId)throw new HttpsError('permission-denied','Student sign-in is required.');
  return token;
}
function attendanceDateAllowed(date,intake){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return false;
  const first=intake&&(intake.classesStartDate||intake.startDate),last=intake&&intake.endDate;
  if(!first||!last||date<first||date>last||date>new Date().toISOString().slice(0,10))return false;
  if(intake.breakStartDate&&intake.resumeDate&&date>=intake.breakStartDate&&date<intake.resumeDate)return false;
  const day=new Date(date+'T00:00:00Z').getUTCDay();
  return day===0||day===6;
}
function clampPct(n){return Math.max(0,Math.min(100,Math.round(Number(n)||0)));}
function timeProgress(intake){
  const start=intake&&(intake.classesStartDate||intake.startDate),end=intake&&intake.endDate;
  if(!start||!end)return 0;
  const a=new Date(start+'T00:00:00Z').getTime(),b=new Date(end+'T23:59:59Z').getTime(),now=Date.now();
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return 0;
  return clampPct((now-a)/(b-a)*100);
}
function publicMessage(doc){
  const m=doc.data?doc.data():doc;
  return{
    id:doc.id||m.id||'',
    message:clean(m.message,1500),
    date:m.createdAt||m.date||'',
    from:clean(m.senderName||m.createdBy||'SkyDream Administration',100),
    senderType:clean(m.senderType||'admin',20),
    readAt:m.readAt||''
  };
}

// Retrieve recent messages in Firestore ordering instead of taking the
// first arbitrary 100 documents and sorting them only in memory. The
// compatibility query also includes older records without createdAt.
async function latestStudentMessages(studentId){
  const base=db.collection(COL.studentMessages).where('studentId','==',studentId);
  const legacy=base.limit(100).get();
  const recent=base.orderBy('createdAt','desc').limit(100).get()
    .catch(error=>{
      console.warn('Recent message index unavailable; deploy firestore indexes.',error);
      return null;
    });
  const [legacySnap,recentSnap]=await Promise.all([legacy,recent]);
  const merged=new Map();
  for(const snap of [legacySnap,recentSnap]){
    if(snap)for(const doc of snap.docs)merged.set(doc.id,doc);
  }
  return [...merged.values()].map(publicMessage).filter(m=>m.message)
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')).slice(0,50);
}

async function sendPushToStudents(studentIds){
  const ids=new Set((studentIds||[]).filter(Boolean));
  if(!ids.size)return{devices:0,sent:0,failed:0};
  try{
    const snap=await db.collection(COL.studentPushTokens).limit(5000).get();
    const docs=snap.docs.filter(doc=>ids.has((doc.data()||{}).studentId));
    if(!docs.length)return{devices:0,sent:0,failed:0};
    let sent=0,failed=0;
    for(let offset=0;offset<docs.length;offset+=500){
      const chunk=docs.slice(offset,offset+500),tokens=chunk.map(doc=>String((doc.data()||{}).token||'')).filter(Boolean);
      if(!tokens.length)continue;
      const result=await admin.messaging().sendEachForMulticast({
        tokens,
        data:{
          title:'SkyDream Skills Training Academy',
          body:'You have a new SkyDream message.',
          url:'https://skydream.academy/student-portal#portalMessages'
        },
        webpush:{headers:{Urgency:'high'}}
      });
      sent+=result.successCount;failed+=result.failureCount;
      const deletes=[];
      result.responses.forEach((response,index)=>{
        if(response.success)return;
        const code=response.error&&response.error.code||'';
        if(code==='messaging/registration-token-not-registered'||code==='messaging/invalid-registration-token'){
          const token=tokens[index],doc=chunk.find(x=>String((x.data()||{}).token||'')===token);
          if(doc)deletes.push(doc.ref.delete().catch(()=>null));
        }
      });
      if(deletes.length)await Promise.all(deletes);
    }
    return{devices:docs.length,sent,failed};
  }catch(err){
    console.warn('Student push notification failed.',err);
    return{devices:0,sent:0,failed:0};
  }
}

async function selectBulkRecipients(data){
  const d=data||{},target=clean(d.target,40),value=clean(d.value,120);
  const threshold=Math.max(40,Math.min(95,Number(d.attendanceThreshold)||70));
  const minMarks=Math.max(1,Math.min(20,Number(d.minAttendanceMarks)||3));
  const [students,attendance,settings,intake]=await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.attendance,[]),readValue(KEYS.settings,{}),readValue(KEYS.intake,{})
  ]);
  const current=intake&&intake.startDate||'',fee=Math.max(0,Number(settings&&settings.registrationFee)||0);
  const eligible=(students||[]).filter(s=>s&&s.id&&s.status!=='Cancelled');
  let recipients=[];
  if(target==='course'){
    if(!COURSE_NAMES[value])throw new HttpsError('invalid-argument','Choose a valid program.');
    recipients=eligible.filter(s=>s.course===value&&(!current||(s.intakeStart||'')===current));
  }else if(target==='intake'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new HttpsError('invalid-argument','Choose a valid intake.');
    recipients=eligible.filter(s=>(s.intakeStart||'')===value);
  }else if(target==='owing-fees'){
    recipients=eligible.filter(s=>(!current||(s.intakeStart||'')===current)&&Math.max(0,fee-(Number(s.feePaid)||0))>0);
  }else if(target==='low-attendance'){
    recipients=eligible.filter(s=>{
      if(current&&(s.intakeStart||'')!==current)return false;
      const rows=(attendance||[]).filter(a=>a.studentId===s.id&&(a.status==='Present'||a.status==='Absent'));
      if(rows.length<minMarks)return false;
      const present=rows.filter(a=>a.status==='Present').length,pct=Math.round(present/rows.length*100);
      return pct<threshold;
    });
  }else{
    throw new HttpsError('invalid-argument','Choose a bulk message audience.');
  }
  const seen=new Set();
  recipients=recipients.filter(s=>!seen.has(s.id)&&seen.add(s.id));
  return{recipients,target,value,threshold,minMarks,currentIntake:current,fee};
}

async function writeStudentMessages(students,recordBase){
  let batch=db.batch(),ops=0;
  for(const student of students){
    const ref=db.collection(COL.studentMessages).doc();
    batch.set(ref,{...recordBase,studentId:student.id});
    ops++;
    if(ops>=400){await batch.commit();batch=db.batch();ops=0;}
  }
  if(ops)await batch.commit();
}

app.adminSendStudentMessage=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'students'),d=request.data||{},studentId=clean(d.studentId,120),message=clean(d.message,1500);
  if(!studentId||!message)throw new HttpsError('invalid-argument','Choose a student and enter a message.');
  const students=await readValue(KEYS.students,[]),student=(students||[]).find(s=>s.id===studentId);
  if(!student)throw new HttpsError('not-found','Student not found.');
  const ref=db.collection(COL.studentMessages).doc(),createdAt=new Date().toISOString();
  const record={studentId,message,createdAt,createdBy:account.username||'',senderName:account.name||'SkyDream Administration',senderType:'admin',active:true,readAt:''};
  await ref.set(record);
  const push=await sendPushToStudents([student.id]);
  await appendAudit(account,'Sent student portal message',message.slice(0,120),student.regNumber||studentId);
  return{ok:true,message:{id:ref.id,...record},push};
});

app.adminGetStudentMessages=onCall({enforceAppCheck:true},async request=>{
  await requireAdmin(request,'students');
  const studentId=clean(request.data&&request.data.studentId,120);
  const students=await readValue(KEYS.students,[]);
  if(!(students||[]).some(s=>s.id===studentId))throw new HttpsError('not-found','Student not found.');
  const messages=await latestStudentMessages(studentId);
  return{messages,unread:messages.filter(m=>!m.readAt).length};
});

app.adminPreviewBulkStudentMessage=onCall({enforceAppCheck:true},async request=>{
  await requireAdmin(request,'students');
  const selected=await selectBulkRecipients(request.data||{});
  return{
    count:selected.recipients.length,
    target:selected.target,
    sample:selected.recipients.slice(0,50).map(s=>({id:s.id,fullName:s.fullName,regNumber:s.regNumber,course:s.course,courseName:COURSE_NAMES[s.course]||s.course,intakeStart:s.intakeStart||''}))
  };
});

app.adminSendBulkStudentMessage=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'students'),d=request.data||{},message=clean(d.message,1500);
  if(!message)throw new HttpsError('invalid-argument','Enter a message to send.');
  const selected=await selectBulkRecipients(d);
  if(!selected.recipients.length)throw new HttpsError('failed-precondition','No students match this audience.');
  if(selected.recipients.length>1000)throw new HttpsError('failed-precondition','This audience is too large for one send. Narrow the selection and try again.');
  const createdAt=new Date().toISOString(),bulkId='bulk_'+crypto.randomUUID();
  const recordBase={message,createdAt,createdBy:account.username||'',senderName:account.name||'SkyDream Administration',senderType:'admin',active:true,readAt:'',bulkId,bulkTarget:selected.target};
  await writeStudentMessages(selected.recipients,recordBase);
  const push=await sendPushToStudents(selected.recipients.map(s=>s.id));
  await appendAudit(account,'Sent bulk student portal message',`${selected.recipients.length} recipient(s) · ${selected.target}`,bulkId);
  return{ok:true,bulkId,recipients:selected.recipients.length,push};
});

app.adminSetWebPushVapidKey=onCall({enforceAppCheck:true},async request=>{
  const account=await requireAdmin(request,'settings');
  if((account.role||'staff')!=='owner')throw new HttpsError('permission-denied','Only the main administrator can configure web push.');
  const vapidKey=clean(request.data&&request.data.vapidKey,300);
  if(!/^[A-Za-z0-9_-]{60,300}$/.test(vapidKey))throw new HttpsError('invalid-argument','Paste the public Web Push certificate key from Firebase Cloud Messaging.');
  const settings=await readValue(KEYS.settings,{});
  settings.webPushVapidKey=vapidKey;
  await refFor(KEYS.settings).set({value:JSON.stringify(settings)});
  await appendAudit(account,'Configured student web push','Firebase Web Push public key updated','');
  return{ok:true,configured:true};
});

app.studentGetPushConfig=onCall({enforceAppCheck:true},async request=>{
  requireStudent(request);
  const settings=await readValue(KEYS.settings,{});
  const vapidKey=clean(settings&&settings.webPushVapidKey,300);
  return{configured:!!vapidKey,vapidKey};
});

app.studentGetPushStatus=onCall({enforceAppCheck:true},async request=>{
  const token=requireStudent(request);
  const snap=await db.collection(COL.studentPushTokens).where('studentId','==',token.studentId).limit(20).get();
  return{enabled:!snap.empty,devices:snap.size};
});

app.studentRegisterPushToken=onCall({enforceAppCheck:true},async request=>{
  const auth=requireStudent(request),token=clean(request.data&&request.data.token,4096);
  if(!token||token.length<40)throw new HttpsError('invalid-argument','A valid notification token is required.');
  const id=crypto.createHash('sha256').update(token).digest('hex'),ref=db.collection(COL.studentPushTokens).doc(id),now=new Date().toISOString();
  const raw=request&&request.rawRequest,userAgent=clean(raw&&raw.headers&&raw.headers['user-agent'],300);
  await ref.set({studentId:auth.studentId,token,createdAt:now,updatedAt:now,userAgent},{merge:true});
  return{ok:true};
});

app.studentUnregisterPushToken=onCall({enforceAppCheck:true},async request=>{
  const auth=requireStudent(request),token=clean(request.data&&request.data.token,4096);
  let removed=0;
  if(token){
    const id=crypto.createHash('sha256').update(token).digest('hex'),ref=db.collection(COL.studentPushTokens).doc(id),snap=await ref.get();
    if(snap.exists&&(snap.data()||{}).studentId===auth.studentId){await ref.delete();removed=1;}
  }else{
    const snap=await db.collection(COL.studentPushTokens).where('studentId','==',auth.studentId).limit(50).get();
    if(!snap.empty){const batch=db.batch();snap.docs.forEach(doc=>batch.delete(doc.ref));await batch.commit();removed=snap.size;}
  }
  return{ok:true,removed};
});

app.facilitatorSendStudentMessage=onCall({enforceAppCheck:true},async request=>{
  const account=await requireFacilitator(request),d=request.data||{},studentId=clean(d.studentId,120),message=clean(d.message,1500);
  if(!studentId||!message)throw new HttpsError('invalid-argument','Choose a student and enter a message.');
  const [students,intake]=await Promise.all([readValue(KEYS.students,[]),readValue(KEYS.intake,{})]);
  const student=(students||[]).find(s=>s.id===studentId&&s.status!=='Cancelled'&&Array.isArray(account.courses)&&account.courses.includes(s.course)&&(!intake.startDate||(s.intakeStart||'')===intake.startDate));
  if(!student)throw new HttpsError('permission-denied','You can only message students in your assigned active roster.');
  const ref=db.collection(COL.studentMessages).doc(),createdAt=new Date().toISOString();
  const record={studentId,message,createdAt,createdBy:account.username||'',senderName:account.name||account.username||'Facilitator',senderType:'facilitator',active:true,readAt:''};
  await ref.set(record);
  const push=await sendPushToStudents([student.id]);
  return{ok:true,message:{id:ref.id,...record},push};
});

app.facilitatorCreateQrAttendance=onCall({enforceAppCheck:true},async request=>{
  const account=await requireFacilitator(request),course=clean(request.data&&request.data.course,60);
  if(!course||!Array.isArray(account.courses)||!account.courses.includes(course))throw new HttpsError('permission-denied','Choose one of your assigned programs.');
  const intake=await readValue(KEYS.intake,{});
  const date=new Date().toISOString().slice(0,10);
  if(!attendanceDateAllowed(date,intake))throw new HttpsError('failed-precondition','QR attendance can only be opened during an active Saturday/Sunday class day outside the scheduled break.');
  const token=crypto.randomBytes(24).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');
  const now=Date.now(),expiresAt=now+15*60*1000;
  await db.collection(COL.qrAttendance).doc(hash).set({
    course,date,intakeStart:intake.startDate||'',facilitatorId:account.id,facilitatorUsername:account.username||'',
    createdAt:new Date(now).toISOString(),expiresAt,active:true
  });
  return{token,course,date,expiresAt:new Date(expiresAt).toISOString()};
});

app.studentQrCheckIn=onCall({enforceAppCheck:true},async request=>{
  const tokenAuth=requireStudent(request),raw=clean(request.data&&request.data.token,200);
  if(!raw)throw new HttpsError('invalid-argument','QR attendance token is missing.');
  const hash=crypto.createHash('sha256').update(raw).digest('hex'),sessionRef=db.collection(COL.qrAttendance).doc(hash),sessionSnap=await sessionRef.get();
  if(!sessionSnap.exists)throw new HttpsError('not-found','This attendance QR code is not valid.');
  const session=sessionSnap.data()||{};
  if(session.active===false||Number(session.expiresAt)<Date.now())throw new HttpsError('failed-precondition','This attendance QR code has expired. Ask your facilitator for a new one.');
  const [students,intake]=await Promise.all([readValue(KEYS.students,[]),readValue(KEYS.intake,{})]);
  const student=(students||[]).find(s=>s.id===tokenAuth.studentId);
  if(!student||student.status==='Cancelled')throw new HttpsError('permission-denied','Student record is unavailable.');
  if(student.course!==session.course||(!session.intakeStart?false:(student.intakeStart||'')!==session.intakeStart))throw new HttpsError('permission-denied','This QR code is for a different class.');
  if(!attendanceDateAllowed(session.date,intake))throw new HttpsError('failed-precondition','This class is not currently open for attendance.');
  const ref=refFor(KEYS.attendance);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);const list=snap.exists?parseJson(snap.data().value,[]):[];
    const i=list.findIndex(r=>r.course===session.course&&r.date===session.date&&r.studentId===student.id);
    const entry={course:session.course,date:session.date,studentId:student.id,status:'Present',note:'QR check-in',markedBy:'qr:'+String(session.facilitatorUsername||'facilitator'),updatedAt:new Date().toISOString()};
    if(i>=0)list[i]={...list[i],...entry};else list.push({id:'att_'+crypto.randomUUID(),...entry});
    tx.set(ref,{value:JSON.stringify(list)});
  });
  return{ok:true,date:session.date,course:COURSE_NAMES[session.course]||session.course};
});

app.studentMarkMessagesRead=onCall({enforceAppCheck:true},async request=>{
  const token=requireStudent(request),ids=Array.isArray(request.data&&request.data.ids)?request.data.ids.map(v=>clean(v,140)).filter(Boolean).slice(0,50):[];
  if(!ids.length)return{ok:true,updated:0};
  const snaps=await Promise.all(ids.map(id=>db.collection(COL.studentMessages).doc(id).get()));
  const batch=db.batch(),readAt=new Date().toISOString();let updated=0;
  snaps.forEach(s=>{if(!s.exists)return;const m=s.data()||{};if(m.studentId!==token.studentId||m.readAt)return;batch.update(s.ref,{readAt});updated++;});
  if(updated)await batch.commit();
  return{ok:true,updated,readAt};
});

app.studentPortalLogin=onCall({enforceAppCheck:true},async request=>{
  await enforcePortalRateLimit(request);const regNumber=clean(request.data&&request.data.regNumber,60).toUpperCase(),phone=normalizePhone(request.data&&request.data.mobile);
  if(!regNumber||!/^0\d{9}$/.test(phone))throw new HttpsError('invalid-argument','Enter your registration number and 10-digit mobile number.');
  const students=await readValue(KEYS.students,[]),student=students.find(s=>String(s.regNumber||'').toUpperCase()===regNumber&&normalizePhone(s.mobile)===phone);
  if(!student)throw new HttpsError('permission-denied','The registration number and mobile number do not match our records.');
  const token=await admin.auth().createCustomToken('student-'+student.id,{role:'student',studentId:student.id,regNumber:student.regNumber});return{token,student:{fullName:student.fullName,regNumber:student.regNumber}};
});

app.getStudentPortalDashboard=onCall({enforceAppCheck:true},async request=>{
  const token=requireStudent(request);
  const [students,attendance,broadcasts,settings,intake,intakeHistory,messageSnap]=await Promise.all([
    readValue(KEYS.students,[]),readValue(KEYS.attendance,[]),readValue(KEYS.broadcasts,[]),readValue(KEYS.settings,{}),
    readValue(KEYS.intake,{}),readValue(KEYS.intakeHistory,[]),latestStudentMessages(token.studentId)
  ]);
  const student=students.find(s=>s.id===token.studentId);if(!student)throw new HttpsError('permission-denied','Student record is no longer available.');
  const currentIntake=student.intakeStart||intake.startDate||'';
  const relevantIntake=(intake&&intake.startDate===currentIntake)?intake:((intakeHistory||[]).find(i=>i&&i.startDate===currentIntake)||intake||{});
  const start=relevantIntake.classesStartDate||relevantIntake.startDate||'',end=relevantIntake.endDate||'';
  const marks=(attendance||[]).filter(a=>a.studentId===student.id&&(!start||a.date>=start)&&(!end||a.date<=end));
  const present=marks.filter(a=>a.status==='Present').length,absent=marks.filter(a=>a.status==='Absent').length,marked=present+absent;
  const attendancePct=marked?Math.round(present/marked*100):0;
  const now=Date.now(),notices=(broadcasts||[]).filter(n=>n&&n.active!==false&&(!n.startsAt||new Date(n.startsAt).getTime()<=now)&&(!n.expiresAt||new Date(n.expiresAt).getTime()>now)).slice(-10).reverse().map(n=>({id:n.id,message:n.message,date:n.date||''}));
  const messages=messageSnap;
  const fee=Number.isFinite(Number(settings.registrationFee))?Number(settings.registrationFee):50,paid=Math.max(0,Number(student.feePaid)||0),balance=Math.max(0,fee-paid);
  const coursePct=timeProgress(relevantIntake),feePct=fee>0?clampPct(paid/fee*100):100,attendanceComponent=marked?attendancePct:coursePct,overall=clampPct((coursePct+feePct+attendanceComponent)/3);
  const notifications=[];
  messages.filter(m=>!m.readAt).slice(0,10).forEach(m=>notifications.push({id:'message:'+m.id,type:'message',title:'New message',message:m.message,date:m.date,target:'#portalMessages',unread:true}));
  notices.slice(0,5).forEach(n=>notifications.push({id:'announcement:'+n.id,type:'announcement',title:'Academy announcement',message:n.message,date:n.date,target:'#portalNotices',unread:false}));
  if(balance>0)notifications.push({id:'payment-balance',type:'payment',title:'Payment balance',message:`You have GHS ${balance.toFixed(2)} outstanding.`,date:'',target:'#portalOverview',unread:false});
  if(marked>=3&&attendancePct<70)notifications.push({id:'attendance-warning',type:'attendance',title:'Attendance needs attention',message:`Your attendance is ${attendancePct}%. Please speak with your facilitator if you need support.`,date:'',target:'#portalAttendance',unread:false});
  return{
    student:{fullName:student.fullName,regNumber:student.regNumber,course:student.course,courseName:COURSE_NAMES[student.course]||student.course,status:student.status||'Registered',mobile:student.mobile||'',email:student.email||'',intakeStart:currentIntake},
    payment:{fee,paid,balance,status:paid>=fee?'Paid':(paid>0?'Partial':'Unpaid'),percentage:feePct},
    attendance:{present,absent,marked,percentage:attendancePct,records:marks.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,30).map(r=>({date:clean(r.date,10),status:clean(r.status,20),note:clean(r.note,500)}))},
    progress:{course:coursePct,attendance:attendancePct,fees:feePct,overall,startDate:start,endDate:end},
    notices,messages,notifications,unreadMessages:messages.filter(m=>!m.readAt).length
  };
});

const removedAcademicFeature=onCall({enforceAppCheck:true},async()=>{throw new HttpsError('failed-precondition','Assessments and timetable have been removed from the SkyDream system.');});
app.adminGetAcademicSnapshot=removedAcademicFeature;
app.adminSaveAssessment=removedAcademicFeature;
app.adminDeleteAssessment=removedAcademicFeature;
app.adminSaveTimetableEntry=removedAcademicFeature;
app.adminDeleteTimetableEntry=removedAcademicFeature;

module.exports=app;
