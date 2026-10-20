'use strict';
// Private course-scoped Student <-> Facilitator chat.
// Data stays in two flat Firestore collections so SkyDream's existing
// collection backup exporter can capture every message and conversation.
module.exports=function installStudentFacilitatorChat(app,{onCall,HttpsError,db,admin,crypto}){
  const STORAGE='sdta_storage';
  const THREADS='sdta_student_facilitator_threads';
  const MESSAGES='sdta_student_facilitator_messages';
  const BLOCKED=new Set(['Cancelled','Completed','Deferred']);
  const clean=(v,max=120)=>String(v==null?'':v).trim().slice(0,max);
  const load=async(key)=>{
    const snap=await db.collection(STORAGE).doc(key).get();
    if(!snap.exists)return[];
    try{
      const parsed=JSON.parse(snap.data().value||'[]');
      if(!Array.isArray(parsed))throw Error('invalid');
      return parsed;
    }catch(_){throw new HttpsError('internal','Academy records are temporarily unavailable.');}
  };
  async function context(){
    const [students,facilitators,intakeDocs]=await Promise.all([
      load('sdta_students'),load('sdta_facilitators'),
      db.collection(STORAGE).doc('sdta_intake').get()
    ]);
    let intake={};
    try{intake=intakeDocs.exists?JSON.parse(intakeDocs.data().value||'{}'):{};}catch(_){}
    if(!intake||typeof intake!=='object'||!intake.startDate)
      throw new HttpsError('failed-precondition','Active intake information is not available. Student chats are paused.');
    return{students,facilitators,intake};
  }
  function activeStudent(s,intake){
    return !!s&&!!s.id&&!!s.course&&!BLOCKED.has(s.status)&&
      (!intake.startDate||(s.intakeStart||'')===intake.startDate);
  }
  function activeFacilitator(f,student){
    return !!f&&!!f.id&&f.active!==false&&Array.isArray(f.courses)&&f.courses.includes(student.course);
  }
  function studentIdentity(request,c){
    const auth=request.auth,token=auth&&auth.token;
    if(!auth||!token||token.role!=='student'||!token.studentId||
      auth.uid!=='student-'+token.studentId)
      throw new HttpsError('permission-denied','Sign in to your own student portal.');
    const student=c.students.find(s=>s.id===token.studentId);
    if(!activeStudent(student,c.intake))
      throw new HttpsError('permission-denied','Student messaging is available to current enrolled students.');
    return student;
  }
  async function facilitatorIdentity(request,c){
    let auth=request.auth,token=auth&&auth.token;
    if(!(auth&&auth.uid&&token&&token.role==='facilitator'&&token.username)){
      const idToken=clean(request.data?._facIdToken,5000);
      if(!idToken)throw new HttpsError('permission-denied','Sign in as a facilitator.');
      try{token=await admin.auth().verifyIdToken(idToken);auth={uid:token.uid,token};}
      catch(_){throw new HttpsError('permission-denied','Facilitator session expired. Sign in again.');}
    }
    if(token.role!=='facilitator'||!token.username)
      throw new HttpsError('permission-denied','Facilitator sign-in is required.');
    const fac=c.facilitators.find(f=>auth.uid==='fac-'+f.id&&
      String(f.username||'').toLowerCase()===String(token.username).toLowerCase());
    if(!fac||fac.active===false)
      throw new HttpsError('permission-denied','Your facilitator account is not active.');
    return fac;
  }
  function pair(c,studentId,facilitatorId){
    const student=c.students.find(s=>s.id===studentId);
    const fac=c.facilitators.find(f=>f.id===facilitatorId);
    if(!activeStudent(student,c.intake)||!activeFacilitator(fac,student))
      throw new HttpsError('permission-denied','You may only message an assigned facilitator or enrolled student in the current intake.');
    return{student,fac};
  }
  const threadId=(sid,fid)=>crypto.createHash('sha256').update(sid+'|'+fid).digest('hex');
  const threadRef=(sid,fid)=>db.collection(THREADS).doc(threadId(sid,fid));
  function safeThread(data){
    if(!data)return null;
    return{
      studentId:data.studentId,facilitatorId:data.facilitatorId,
      studentName:clean(data.studentName,110),facilitatorName:clean(data.facilitatorName,110),
      course:clean(data.course,70),
      lastMessage:clean(data.lastMessage,1000),lastMessageAt:data.lastMessageAt||'',
      lastSenderType:data.lastSenderType||'',
      unreadStudent:Number(data.unreadStudent)||0,
      unreadFacilitator:Number(data.unreadFacilitator)||0,
      studentReadAt:data.studentReadAt||'',facilitatorReadAt:data.facilitatorReadAt||''
    };
  }
  function validText(text){
    if(typeof text!=='string'||!text.trim()||text.trim().length>1000||text.length>1100)
      throw new HttpsError('invalid-argument','Enter a message of up to 1000 characters.');
    return text.trim();
  }
  async function writeMessage({student,fac},senderType,body){
    const ref=threadRef(student.id,fac.id),messageRef=db.collection(MESSAGES).doc();
    const now=new Date().toISOString(),nowMs=Date.now();
    const side=senderType==='student'?'student':'facilitator';
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref),old=snap.exists?snap.data():{};
      if(snap.exists&&(old.studentId!==student.id||old.facilitatorId!==fac.id))
        throw new HttpsError('failed-precondition','Chat record does not match its participants.');
      const start=Number(old[side+'RateStart'])||0;
      const reset=!start||nowMs-start>=3600000||start>nowMs;
      const count=reset?0:(Number(old[side+'RateCount'])||0);
      if(count>=30)
        throw new HttpsError('resource-exhausted','Message limit reached. Please try again later.');
      const sequence=(Number(old.messageSeq)||0)+1;
      const meta={
        messageSeq:sequence,
        studentId:student.id,facilitatorId:fac.id,
        studentName:clean(student.fullName,110),
        facilitatorName:clean(fac.name||fac.username,110),
        course:student.course,intakeStart:student.intakeStart||'',
        lastMessage:body,lastMessageAt:now,lastSenderType:senderType,
        [side+'RateStart']:reset?nowMs:start,[side+'RateCount']:count+1,
        [senderType==='student'?'unreadFacilitator':'unreadStudent']:
          Math.min(500,(Number(old[senderType==='student'?'unreadFacilitator':'unreadStudent'])||0)+1)
      };
      tx.set(ref,meta,{merge:true});
      tx.create(messageRef,{
        threadId:ref.id,studentId:student.id,facilitatorId:fac.id,
        sequence,
        senderType,senderName:senderType==='student'?clean(student.fullName,110):clean(fac.name||fac.username,110),
        message:body,createdAt:now
      });
    });
    return{ok:true,id:messageRef.id,createdAt:now};
  }
  async function getThread({student,fac},viewer){
    const ref=threadRef(student.id,fac.id),snap=await ref.get();
    if(!snap.exists)return{thread:null,messages:[]};
    const raw=snap.data();
    if(raw.studentId!==student.id||raw.facilitatorId!==fac.id)
      throw new HttpsError('permission-denied','Conversation is unavailable.');
    const msgs=await db.collection(MESSAGES).where('threadId','==',ref.id)
      .orderBy('sequence','desc').limit(80).get();
    const messages=msgs.docs.map(doc=>({
      id:doc.id,message:clean(doc.data().message,1000),
      createdAt:doc.data().createdAt||'',senderType:doc.data().senderType,
      senderName:clean(doc.data().senderName,110)
    })).reverse();
    const unreadKey=viewer==='student'?'unreadStudent':'unreadFacilitator';
    if(Number(raw[unreadKey])>0){
      await db.runTransaction(async tx=>{
        const fresh=await tx.get(ref);
        if(fresh.exists&&fresh.data().studentId===student.id&&
          fresh.data().facilitatorId===fac.id&&fresh.data().lastMessageAt===raw.lastMessageAt&&
          Number(fresh.data()[unreadKey])>0)
          tx.update(ref,{[unreadKey]:0,[viewer+'ReadAt']:new Date().toISOString()});
      });
    }
    return{thread:safeThread({...raw,[unreadKey]:0}),messages};
  }
  app.studentListFacilitatorChats=onCall({enforceAppCheck:true},async request=>{
    const c=await context(),student=studentIdentity(request,c);
    const facilitators=c.facilitators.filter(f=>activeFacilitator(f,student));
    const threads=await Promise.all(facilitators.slice(0,40).map(async f=>{
      const snap=await threadRef(student.id,f.id).get();
      return snap.exists?safeThread(snap.data()):null;
    }));
    return{facilitators:facilitators.slice(0,40).map(f=>({id:f.id,name:clean(f.name||f.username,110)})),
      threads:threads.filter(Boolean).sort((a,b)=>String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)))};
  });
  app.studentGetFacilitatorChat=onCall({enforceAppCheck:true},async request=>{
    const c=await context(),s=studentIdentity(request,c);
    const participants=pair(c,s.id,clean(request.data?.facilitatorId,140));
    return getThread(participants,'student');
  });
  app.studentSendFacilitatorChat=onCall({enforceAppCheck:true},async request=>{
    const c=await context(),s=studentIdentity(request,c);
    return writeMessage(pair(c,s.id,clean(request.data?.facilitatorId,140)),
      'student',validText(request.data?.message));
  });
  app.facilitatorListStudentChats=onCall({enforceAppCheck:true},async request=>{
    const c=await context(),f=await facilitatorIdentity(request,c);
    const roster=c.students.filter(s=>activeStudent(s,c.intake)&&activeFacilitator(f,s));
    const threadSnap=await db.collection(THREADS).where('facilitatorId','==',f.id)
      .orderBy('lastMessageAt','desc').limit(200).get();
    const allowed=new Set(roster.map(s=>s.id));
    const threads=threadSnap.docs.map(d=>safeThread(d.data()))
      .filter(t=>t&&allowed.has(t.studentId))
      .sort((a,b)=>String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
    return{roster:roster.slice(0,500).map(s=>({id:s.id,name:clean(s.fullName,110),
      regNumber:clean(s.regNumber,80),course:s.course})),threads};
  });
  app.facilitatorGetStudentChat=onCall({enforceAppCheck:true},async request=>{
    const c=await context(),f=await facilitatorIdentity(request,c);
    return getThread(pair(c,clean(request.data?.studentId,140),f.id),'facilitator');
  });
  app.facilitatorSendStudentChat=onCall({enforceAppCheck:true},async request=>{
    const c=await context(),f=await facilitatorIdentity(request,c);
    return writeMessage(pair(c,clean(request.data?.studentId,140),f.id),
      'facilitator',validText(request.data?.message));
  });
};
