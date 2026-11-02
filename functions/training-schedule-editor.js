'use strict';
// The current intake's stable startDate is also a cohort identifier throughout
// SkyDream. Never silently migrate it when registrations already exist.
module.exports=function installTrainingSchedule(app,{
  onCall,HttpsError,db,crypto,requireStrongAdminSession
}){
  const STORAGE='sdta_storage',KEY='sdta_training_schedule',INTAKE='sdta_intake';
  const COURSES=new Set(['household-chemicals','hair-dressing','cosmetology',
    'electricals','floral-decor','fashion-design','beading','french','korean',
    'pastries','graphic-design','barbering','accounting']);
  const DAYS=new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
  const FIELDS=['label','startDate','classesStartDate','breakStartDate','resumeDate',
    'endDate','thanksgivingDate'];
  const clean=(v,max=120)=>String(v==null?'':v).trim().slice(0,max);
  const parse=(snapshot,fallback)=>{
    if(!snapshot.exists)return fallback;
    try{const value=JSON.parse(snapshot.data().value||'null');return value&&typeof value==='object'?value:fallback;}
    catch(_){throw new HttpsError('internal','Stored training schedule could not be read.');}
  };
  const ref=key=>db.collection(STORAGE).doc(key);
  const validDate=value=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  };
  const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  async function requireOwner(request){
    const {account}=await requireStrongAdminSession(request);
    if((account.role||'staff')!=='owner')
      throw new HttpsError('permission-denied','Only the Main Admin can edit the training schedule.');
    return account;
  }
  function validateDates(input,current){
    if(!input||typeof input!=='object'||Array.isArray(input))
      throw new HttpsError('invalid-argument','Provide the current intake schedule.');
    const dates={};
    for(const key of FIELDS){
      const value=clean(input[key],key==='label'?100:20);
      if(key==='label'){
        if(!value||String(input[key]||'').trim().length>100)
          throw new HttpsError('invalid-argument','Enter an intake label (up to 100 characters).');
      }else if(!value){
        if(['startDate','classesStartDate','endDate'].includes(key))
          throw new HttpsError('invalid-argument','Orientation, classes start and graduation dates are required.');
      }else if(!validDate(value)){
        throw new HttpsError('invalid-argument','Invalid date for '+key+'.');
      }
      dates[key]=value;
    }
    if(dates.startDate>dates.classesStartDate||dates.classesStartDate>dates.endDate)
      throw new HttpsError('invalid-argument','Orientation must be on/before classes, and classes must finish by graduation.');
    if(Boolean(dates.breakStartDate)!==Boolean(dates.resumeDate))
      throw new HttpsError('invalid-argument','Enter both break and resumption dates, or neither.');
    if(dates.breakStartDate&&(dates.breakStartDate<dates.classesStartDate||
      dates.resumeDate<=dates.breakStartDate||dates.resumeDate>dates.endDate))
      throw new HttpsError('invalid-argument','The break must fall within the training period.');
    if(dates.thanksgivingDate&&dates.thanksgivingDate<dates.endDate)
      throw new HttpsError('invalid-argument','Closing ceremony cannot precede graduation.');
    if(current.registrationCloseDate&&validDate(current.registrationCloseDate)&&
      current.registrationCloseDate>dates.classesStartDate)
      throw new HttpsError('failed-precondition','The current registration closing date is after the proposed first class date. Edit registration settings first.');
    return dates;
  }
  function validateSessions(rows){
    if(!Array.isArray(rows)||rows.length>60)
      throw new HttpsError('invalid-argument','Use at most 60 weekly programme sessions.');
    const result=rows.map((row,index)=>{
      if(!row||typeof row!=='object')
        throw new HttpsError('invalid-argument','A class session is invalid.');
      const course=clean(row.course,80),day=clean(row.day,18);
      const startTime=clean(row.startTime,8),endTime=clean(row.endTime,8);
      const venue=clean(row.venue,120);
      if(!COURSES.has(course)||!DAYS.has(day)||!validTime(startTime)||
        !validTime(endTime)||startTime>=endTime||String(row.venue||'').length>120)
        throw new HttpsError('invalid-argument','Check programme, day, start/end times and venue for session '+(index+1)+'.');
      return{course,day,startTime,endTime,venue};
    });
    for(let i=0;i<result.length;i++)for(let j=0;j<i;j++){
      const a=result[i],b=result[j];
      if(a.course===b.course&&a.day===b.day&&a.startTime<b.endTime&&b.startTime<a.endTime)
        throw new HttpsError('already-exists','This programme has overlapping classes on '+a.day+'.');
    }
    return result.sort((a,b)=>a.day.localeCompare(b.day)||a.startTime.localeCompare(b.startTime)||a.course.localeCompare(b.course));
  }
  async function loadState(){
    const [intakeSnap,weekSnap]=await Promise.all([ref(INTAKE).get(),ref(KEY).get()]);
    const intake=parse(intakeSnap,{});
    const weekly=parse(weekSnap,{});
    if(!intake.startDate)throw new HttpsError('failed-precondition','Create the current intake before editing its training schedule.');
    return{intake,weekly:weekly.intakeStart===intake.startDate?weekly:{intakeStart:intake.startDate,revision:0,sessions:[]}};
  }
  app.adminGetTrainingSchedule=onCall({enforceAppCheck:true},async request=>{
    await requireOwner(request);
    const state=await loadState();
    const auditSnap=await db.collection('sdta_training_schedule_changes')
      .where('intakeStart','==',state.intake.startDate).limit(100).get();
    const changes=auditSnap.docs.map(doc=>doc.data()).sort((a,b)=>
      String(b.date||'').localeCompare(String(a.date||''))).slice(0,15).map(c=>({
        id:c.id,date:c.date,updatedBy:c.updatedBy,revision:c.revision,
        changedDates:FIELDS.filter(f=>(c.before?.intake?.[f]||'')!==(c.after?.intake?.[f]||'')),
        sessionCount:c.after?.sessions?.length||0
      }));
    return{intake:state.intake,revision:Number(state.weekly.revision)||0,
      sessions:Array.isArray(state.weekly.sessions)?state.weekly.sessions:[],changes};
  });
  app.adminSaveTrainingSchedule=onCall({enforceAppCheck:true},async request=>{
    const account=await requireOwner(request),d=request.data||{};
    if(!Number.isSafeInteger(d.revision)||d.revision<0)
      throw new HttpsError('invalid-argument','Refresh the schedule before saving.');
    if(!validDate(clean(d.intakeStart,20)))
      throw new HttpsError('invalid-argument','The expected intake identifier is missing.');
    const sessions=validateSessions(d.sessions);
    const now=new Date().toISOString(),updatedBy=clean(account.username,80);
    let result=null;
    await db.runTransaction(async tx=>{
      const intakeRef=ref(INTAKE),weeklyRef=ref(KEY);
      const studentsRef=ref('sdta_students');
      const historyRef=db.collection('sdta_training_schedule_changes').doc('change_'+crypto.randomUUID());
      const [intakeSnap,weeklySnap,studentSnap,attendanceSnap,classSnap]=await Promise.all([
        tx.get(intakeRef),tx.get(weeklyRef),tx.get(studentsRef),
        tx.get(ref('sdta_attendance')),tx.get(ref('sdta_class_sessions'))]);
      const old=parse(intakeSnap,{}),stored=parse(weeklySnap,{});
      if(!old.startDate||old.startDate!==d.intakeStart)
        throw new HttpsError('aborted','The active intake changed. Refresh before editing.');
      const revision=stored.intakeStart===old.startDate?(Number(stored.revision)||0):0;
      if(revision!==d.revision)
        throw new HttpsError('aborted','Another admin session updated this schedule. Refresh before saving.');
      const dates=validateDates(d.intake,old);
      const students=parse(studentSnap,[]);
      if(!Array.isArray(students))throw new HttpsError('internal','Student records are unavailable.');
      if(dates.startDate!==old.startDate&&students.some(s=>s.intakeStart===old.startDate))
        throw new HttpsError('failed-precondition',
          'Orientation/start date identifies the current student cohort and cannot change after registrations. Edit the other dates instead.');
      if(dates.startDate!==old.startDate){
        const attendance=parse(attendanceSnap,[]);
        const classSessions=parse(classSnap,[]);
        if((Array.isArray(attendance)&&attendance.some(a=>a.intakeStart===old.startDate))||
          (Array.isArray(classSessions)&&classSessions.some(c=>c.intakeStart===old.startDate)))
          throw new HttpsError('failed-precondition',
            'This intake has recorded attendance or class sessions. Its identifying orientation date cannot be changed safely.');
      }
      if(dates.startDate!==old.startDate&&revision>0)
        throw new HttpsError('failed-precondition',
          'The active intake has schedule history. Changing its identifying orientation date requires a separate cohort migration.');
      const newIntake={...old,...dates,scheduleUpdatedAt:now,scheduleUpdatedBy:updatedBy};
      const saved={
        intakeStart:dates.startDate,
        revision:revision+1,
        sessions,updatedAt:now,updatedBy
      };
      tx.set(intakeRef,{value:JSON.stringify(newIntake)});
      tx.set(weeklyRef,{value:JSON.stringify(saved)});
      tx.create(historyRef,{
        id:historyRef.id,date:now,updatedBy,role:'owner',
        intakeStart:old.startDate,revision:saved.revision,
        before:{intake:Object.fromEntries(FIELDS.map(f=>[f,old[f]||''])),
          sessions:stored.intakeStart===old.startDate?(stored.sessions||[]):[]},
        after:{intake:dates,sessions}
      });
      result={ok:true,intake:newIntake,revision:saved.revision,sessions};
    });
    return result;
  });
  const previousCatalog=app.publicCatalog;
  app.publicCatalog=onCall({enforceAppCheck:false},async request=>{
    const original=await previousCatalog.run(request);
    const intake=original?.intake||{};
    const snap=await ref(KEY).get();
    const doc=parse(snap,{});
    return{...original,trainingSchedule:{
      intakeStart:intake.startDate||'',
      updatedAt:doc.intakeStart===intake.startDate?doc.updatedAt||'':'',
      sessions:doc.intakeStart===intake.startDate&&Array.isArray(doc.sessions)?
        doc.sessions.map(x=>({course:x.course,day:x.day,startTime:x.startTime,
          endTime:x.endTime,venue:x.venue||''})):[]
    }};
  });
};
