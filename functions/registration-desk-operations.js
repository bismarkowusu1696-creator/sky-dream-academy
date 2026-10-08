'use strict';

// Registration Desk operational tools. Installed before the final owner/staff
// session wrapper, and every handler independently checks the stored account.
module.exports = function installRegistrationDeskOperations(app, env) {
  const { onCall, HttpsError, db, crypto, admin, STORAGE_COLLECTION,
    requireStrongAdminSession, enforceRateLimit, readStorage, clean } = env;
  const col = db.collection(STORAGE_COLLECTION);
  const keys = {
    students: 'sdta_students',
    facilitators: 'sdta_facilitators',
    workflow: 'sdta_registration_desk_workflow',
    onboarding: 'sdta_registration_desk_onboarding',
    templates: 'sdta_registration_desk_templates',
    alertCursors: 'sdta_registration_desk_alert_cursors',
    audit: 'sdta_activity_log',
    capacities: 'sdta_capacities',
    intake: 'sdta_intake'
  };
  const parse = (value, fallback) => {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
  };
  const readTx = (snapshot, fallback) =>
    snapshot.exists ? parse((snapshot.data() || {}).value, fallback) : fallback;
  const nowIso = () => new Date().toISOString();
  const trim = (value, max) => clean(value, max);
  const VERIFICATION = ['Pending review', 'Verified', 'Needs correction'];
  const FOLLOWUP = ['Not contacted', 'Contacted', 'Callback needed', 'Orientation confirmed'];
  const oneOf = (value, options, label) => {
    if (!options.includes(value)) throw new HttpsError('invalid-argument', 'Choose a valid '+label+'.');
    return value;
  };
  const requireOwner = async request => {
    const result = await requireStrongAdminSession(request);
    if ((result.account.role || 'staff') !== 'owner')
      throw new HttpsError('permission-denied', 'Only the main administrator can approve message templates.');
    return result.account;
  };
  const requireAccount = async request => (await requireStrongAdminSession(request)).account;
  const auditEntry = (account, action, target, detail = '') => ({
    id: 'audit_'+crypto.randomUUID(), date: nowIso(),
    admin: account.username, role: account.role || 'staff', action, target, detail
  });
  const recordAudit = (tx, ref, snapshot, entry) => {
    const values = readTx(snapshot, []);
    if (!Array.isArray(values)) throw new HttpsError('internal','Audit records are unavailable.');
    // Preserve legacy recent activity while also retaining an immutable
    // per-entry audit document that does not disappear at 1,000 actions.
    tx.set(ref,{ value: JSON.stringify([...values, entry].slice(-1000)) });
    tx.create(db.collection('sdta_admin_audit_archive').doc(entry.id), entry);
  };
  const validDate = value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value+'T00:00:00Z')) &&
    new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value);
  const dateStamp = date => {
    const n = Date.parse(String(date || ''));
    return Number.isFinite(n) ? n : 0;
  };
  function publicTemplate(template) {
    return { id: template.id, title: template.title, body: template.body,
      approved: template.approved === true, updatedAt: template.updatedAt || '' };
  }
  function formatTemplate(template, student, intake) {
    const replacements = {
      student: String(student.fullName || ''),
      program: String(env.registrationCourses[student.course] || student.course || ''),
      registration: String(student.regNumber || ''),
      orientation_date: String(intake && intake.startDate || '')
    };
    return String(template.body || '').replace(/\{\{(student|program|registration|orientation_date)\}\}/g,
      (match, key) => replacements[key] || '');
  }

  app.adminDeskGetInsights = onCall({ enforceAppCheck: true }, async request => {
    const account = await requireAccount(request);
    const [students, facilitators, workflow, onboarding, capacity, templates, cursorMap, audit, intake] =
      await Promise.all([
        readStorage(keys.students,[]),readStorage(keys.facilitators,[]),
        readStorage(keys.workflow,{}),readStorage(keys.onboarding,{}),
        readStorage(keys.capacities,{}),readStorage(keys.templates,[]),
        readStorage(keys.alertCursors,{}),readStorage(keys.audit,[]),
        readStorage(keys.intake,{})
      ]);
    const safeStudents=Array.isArray(students)?students:[];
    const safeFacilitators=Array.isArray(facilitators)?facilitators:[];
    const current=String(intake && intake.startDate || '');
    const currentStudents=safeStudents.filter(s=>!current || String(s.intakeStart||'')===current);
    const capacities=Object.create(null);
    for (const course of Object.keys(env.registrationCourses)) {
      const raw = Number(capacity && capacity[course]);
      const limit = raw>0 ? raw : 25;
      const used=currentStudents.filter(s=>s.course===course && s.status!=='Cancelled').length;
      capacities[course]={limit,used,available:Math.max(0,limit-used)};
    }
    const cursor=String(cursorMap && cursorMap[account.username] || '');
    // New accounts see registrations from the current intake (or previous
    // 30 days if an intake date is unavailable), never an arbitrary 1-hour cut.
    const since=dateStamp(cursor) ||
      (dateStamp(current) || (Date.now() - 30*24*60*60*1000));
    const unread=safeStudents.filter(s=>dateStamp(s.regDate)>=since &&
      (!current || String(s.intakeStart||'')===current || !!cursor))
      .sort((a,b)=>dateStamp(b.regDate)-dateStamp(a.regDate));
    const fresh=unread.slice(0,20).map(s=>({
      id:s.id,regNumber:s.regNumber,fullName:s.fullName,course:s.course,date:s.regDate
    }));
    const ownAudit=(Array.isArray(audit)?audit:[])
      .filter(a=>String(a.admin || '').toLowerCase()===String(account.username).toLowerCase())
      .slice(-60).reverse().map(a=>({
        id:a.id||'',date:a.date||'',action:a.action||'',target:a.target||'',detail:a.detail||''
      }));
    return {
      serverTime:nowIso(), currentIntake:current,
      workflow:workflow && typeof workflow==='object' && !Array.isArray(workflow)?workflow:{},
      onboarding:onboarding && typeof onboarding==='object' && !Array.isArray(onboarding)?onboarding:{},
      capacity:capacities, newRegistrations:fresh, unreadCount:unread.length,
      facilitators:safeFacilitators.length,
      templates:(Array.isArray(templates)?templates:[]).filter(t=>t.approved===true).map(publicTemplate),
      ownAudit
    };
  });

  app.adminDeskSaveTracking = onCall({ enforceAppCheck: true }, async request => {
    const account=await requireAccount(request),d=request.data||{};
    const studentId=trim(d.studentId,120);
    const verification=oneOf(trim(d.verification,40),VERIFICATION,'verification status');
    const followUp=oneOf(trim(d.followUp,40),FOLLOWUP,'follow-up status');
    const due=trim(d.followUpDate,10),note=trim(d.note,500);
    if (!studentId || !validDate(due) || String(d.note || '').trim().length>500)
      throw new HttpsError('invalid-argument','Check the student, note and follow-up date.');
    const studRef=col.doc(keys.students),workRef=col.doc(keys.workflow),auditRef=col.doc(keys.audit);
    await db.runTransaction(async tx=>{
      const [studSnap,workSnap,auditSnap]=await Promise.all([
        tx.get(studRef),tx.get(workRef),tx.get(auditRef)
      ]);
      const students=readTx(studSnap,[]);
      const student=Array.isArray(students) && students.find(s=>s.id===studentId);
      if (!student) throw new HttpsError('not-found','Registration no longer exists.');
      const records=readTx(workSnap,{});
      const state=records && typeof records==='object' && !Array.isArray(records)?records:{};
      state[studentId]={
        verification,followUp,followUpDate:due,note,
        updatedAt:nowIso(),updatedBy:account.username
      };
      tx.set(workRef,{value:JSON.stringify(state)});
      recordAudit(tx,auditRef,auditSnap,auditEntry(account,
        'Updated registration verification and follow-up',String(student.regNumber||studentId),
        verification+'; '+followUp+'; due '+(due||'none')));
    });
    return {ok:true};
  });

  app.adminDeskSetOnboarding = onCall({ enforceAppCheck: true }, async request => {
    const account=await requireAccount(request),d=request.data||{};
    const id=trim(d.facilitatorId,120),flags=d.flags;
    const allowed=['instructionsSent','availabilityConfirmed','orientationCompleted'];
    if(!id || !flags || typeof flags!=='object' || Array.isArray(flags) ||
      Object.keys(flags).length!==3 ||
      Object.keys(flags).some(k=>!allowed.includes(k) || typeof flags[k]!=='boolean')) {
      throw new HttpsError('invalid-argument','Complete the three facilitator onboarding checks.');
    }
    const facRef=col.doc(keys.facilitators),onRef=col.doc(keys.onboarding),auditRef=col.doc(keys.audit);
    await db.runTransaction(async tx=>{
      const [facSnap,onSnap,auditSnap]=await Promise.all([tx.get(facRef),tx.get(onRef),tx.get(auditRef)]);
      const list=readTx(facSnap,[]);
      const fac=Array.isArray(list) && list.find(f=>f.id===id);
      if(!fac)throw new HttpsError('not-found','Facilitator was not found.');
      const current=readTx(onSnap,{});
      const state=current && typeof current==='object'&&!Array.isArray(current)?current:{};
      state[id]={...flags,updatedAt:nowIso(),updatedBy:account.username};
      tx.set(onRef,{value:JSON.stringify(state)});
      recordAudit(tx,auditRef,auditSnap,auditEntry(account,'Updated facilitator onboarding',
        String(fac.username||id),allowed.filter(k=>flags[k]).join(', ')||'No checks completed'));
    });
    return {ok:true};
  });

  app.adminDeskAcknowledgeAlerts=onCall({enforceAppCheck:true},async request=>{
    const account=await requireAccount(request);
    const ref=col.doc(keys.alertCursors);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref),current=readTx(snap,{});
      const rows=current && typeof current==='object'&&!Array.isArray(current)?current:{};
      rows[account.username]=nowIso();
      tx.set(ref,{value:JSON.stringify(rows)});
    });
    return{ok:true};
  });

  app.adminDeskLogExport=onCall({enforceAppCheck:true},async request=>{
    const account=await requireAccount(request);
    await enforceRateLimit(request,'desk-export-log',account.username,120,60*60*1000);
    const kind=oneOf(trim(request.data&&request.data.kind,30),
      ['all','filtered','summary','daily'],'export type');
    const ref=col.doc(keys.audit);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      recordAudit(tx,ref,snap,auditEntry(account,'Exported registration data',kind,'CSV export'));
    });
    return{ok:true};
  });

  app.adminOwnerGetDeskTemplates=onCall({enforceAppCheck:true},async request=>{
    await requireOwner(request);
    const raw=await readStorage(keys.templates,[]);
    return{templates:(Array.isArray(raw)?raw:[]).map(publicTemplate)};
  });

  app.adminOwnerSaveDeskTemplate=onCall({enforceAppCheck:true},async request=>{
    const owner=await requireOwner(request),d=request.data||{};
    const id=trim(d.id,100),title=trim(d.title,80),body=trim(d.body,1200);
    const approved=d.approved===true;
    if(!title || title.length<3 || !body || body.length<5 ||
      String(d.title||'').trim().length>80 || String(d.body||'').trim().length>1200) {
      throw new HttpsError('invalid-argument','Enter a title and a message up to 1,200 characters.');
    }
    const ref=col.doc(keys.templates),auditRef=col.doc(keys.audit);
    let saved;
    await db.runTransaction(async tx=>{
      const [snapshot,auditSnap]=await Promise.all([tx.get(ref),tx.get(auditRef)]);
      const current=readTx(snapshot,[]);
      if(!Array.isArray(current))throw new HttpsError('internal','Message templates are unavailable.');
      const index=id?current.findIndex(t=>t.id===id):-1;
      if(id&&index<0)throw new HttpsError('not-found','Message template no longer exists.');
      if(index<0&&current.length>=50)throw new HttpsError('resource-exhausted','Template limit reached.');
      saved={id:id||'tpl_'+crypto.randomUUID(),title,body,approved,
        updatedAt:nowIso(),updatedBy:owner.username};
      if(index<0)current.push(saved);else current[index]=saved;
      tx.set(ref,{value:JSON.stringify(current)});
      recordAudit(tx,auditRef,auditSnap,auditEntry(owner,
        approved?'Approved registration message template':'Saved unapproved registration message template',
        title,saved.id));
    });
    return{ok:true,template:publicTemplate(saved)};
  });

  app.adminDeskSendApprovedTemplate=onCall({enforceAppCheck:true},async request=>{
    const account=await requireAccount(request),d=request.data||{};
    const studentId=trim(d.studentId,120),templateId=trim(d.templateId,100);
    if(!studentId||!templateId)throw new HttpsError('invalid-argument','Choose a student and an approved message.');
    await enforceRateLimit(request,'desk-approved-template-user',account.username,30,60*60*1000);
    await enforceRateLimit(request,'desk-approved-template-student',account.username+'|'+studentId,5,24*60*60*1000);
    const [students,templates,intake]=await Promise.all([
      readStorage(keys.students,[]),readStorage(keys.templates,[]),readStorage(keys.intake,{})
    ]);
    const student=(Array.isArray(students)?students:[]).find(s=>s.id===studentId);
    const template=(Array.isArray(templates)?templates:[]).find(t=>t.id===templateId&&t.approved===true);
    if(!student)throw new HttpsError('not-found','Registration was not found.');
    if(!template)throw new HttpsError('permission-denied','This message template is not approved.');
    const message=formatTemplate(template,student,intake);
    if(!message || message.length>1500)throw new HttpsError('invalid-argument','Template message is invalid.');
    const ref=db.collection('sdta_student_messages').doc();
    const auditRef=col.doc(keys.audit);
    const createdAt=nowIso();
    await db.runTransaction(async tx=>{
      const auditSnap=await tx.get(auditRef);
      tx.set(ref,{studentId,message,createdAt,createdBy:account.username,
        senderName:'SkyDream Registration Desk',senderType:'admin',
        active:true,readAt:'',templateId});
      recordAudit(tx,auditRef,auditSnap,auditEntry(account,'Sent approved registration message',
        String(student.regNumber||studentId),template.title));
    });
    // A portal message is authoritative. Push is best-effort and never
    // leaks the message body to a lock screen.
    try {
      const subscriptions=await db.collection('sdta_student_push_tokens')
        .where('studentId','==',studentId).limit(20).get();
      const tokens=subscriptions.docs.map(d=>String(d.data().token||'')).filter(Boolean);
      if(tokens.length)await admin.messaging().sendEachForMulticast({
        tokens,
        data:{title:'SkyDream Skills Training Academy',
          body:'You have a new SkyDream message.',
          url:'https://skydream.academy/student-portal#portalMessages'}
      });
    } catch(error){console.warn('Registration message push was unavailable',error);}
    return {ok:true};
  });
};
