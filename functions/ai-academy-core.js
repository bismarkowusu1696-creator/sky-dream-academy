'use strict';
// Pure, independently testable SkyDream AI facts and safety rules.
// No LLM ever receives individual student profiles, contacts or payment ledgers.
const COURSES = Object.freeze({
  'household-chemicals':['Household Chemicals Production','Formulate, mix and package household products.'],
  'hair-dressing':['Hair Dressing','Braiding, weaving, styling and salon client care.'],
  cosmetology:['Cosmetology','Skin care, make-up, facials and nail care.'],
  electricals:['Electricals','House wiring, circuit testing and safe installations.'],
  'floral-decor':['Floral Decor','Bouquets, centrepieces and event decor.'],
  'fashion-design':['Fashion Design','Pattern drafting, cutting, sewing and fitting.'],
  beading:['Beading','Jewellery, accessories and basic wire work.'],
  french:['French Language','Conversational and workplace French.'],
  korean:['Korean Language','Hangul, everyday Korean and practical grammar.'],
  pastries:['Pastries & Baking','Bread, cakes, pastry and baking business skills.'],
  'graphic-design':['Graphic Design','Branding, print, social media and digital design.'],
  barbering:['Barbering','Haircuts, grooming, hygiene and customer care.'],
  accounting:['Accounting','Bookkeeping, records and small-business finance.']
});
const safeText=(v,max=140)=>String(v==null?'':v).trim().slice(0,max);
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const isoDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):'';
const asList=v=>Array.isArray(v)?v:[];
const phone=v=>{let s=String(v||'').replace(/\D/g,'');if(s.startsWith('233')&&s.length===12)s='0'+s.slice(3);return s;};
const REG=/^SD[A-Z]{2}\d{3}\/\d{2}\/\d{4}$/;

function publicFacts(catalog,at=new Date()){
  const c=catalog&&typeof catalog==='object'?catalog:{};
  const intake=c.intake&&typeof c.intake==='object'?c.intake:{};
  const date=at.toISOString().slice(0,10);
  const opens=isoDate(intake.registrationOpenDate);
  const closes=isoDate(intake.registrationCloseDate||intake.startDate||intake.classesStartDate);
  const enabled=c.registrationEnabled!==false;
  const status=!enabled?'paused':(opens&&date<opens?'not-yet-open':(closes&&date>closes?'closed':'open'));
  const live=new Map(asList(c.programs).map(p=>[p.id,p]));
  const programs=Object.entries(COURSES).map(([id,[name,description]])=>{
    const p=live.get(id);
    const capacity=p&&Number.isFinite(Number(p.capacity))?Math.max(0,number(p.capacity)):null;
    const available=p&&Number.isFinite(Number(p.available))?Math.max(0,number(p.available)):null;
    return {id,name,description,capacity,available,full:!!(p&&p.full)};
  });
  return {
    date,registrationStatus:status,registrationOpens:opens,registrationCloses:closes,
    intakeName:safeText(intake.label,100),orientationDate:isoDate(intake.startDate),
    classesStartDate:isoDate(intake.classesStartDate),
    registrationFee:Number.isFinite(Number(c.registrationFee))?number(c.registrationFee):null,
    programs,registrationUrl:'https://skydream.academy/register',
    programsUrl:'https://skydream.academy/programs'
  };
}
const INTERESTS={
  design:['graphic-design','fashion-design','floral-decor'],
  art:['graphic-design','floral-decor','beading'],
  computer:['graphic-design','accounting'],
  business:['accounting','pastries','household-chemicals'],
  finance:['accounting'],
  electricity:['electricals'],
  wiring:['electricals'],
  beauty:['cosmetology','hair-dressing','barbering'],
  hair:['hair-dressing','barbering','cosmetology'],
  makeup:['cosmetology'],
  baking:['pastries'],
  cake:['pastries'],
  clothes:['fashion-design'],
  sewing:['fashion-design'],
  language:['french','korean'],
  france:['french'],
  korea:['korean']
};
function publicGuidance(question,facts){
  const q=safeText(question,350).toLowerCase();
  const matched=facts.programs.filter(p=>q.includes(p.name.toLowerCase())||q.includes(p.id.replace(/-/g,' ')));
  let chosen=matched.slice(0,3);
  if(!chosen.length){
    const scores=new Map();
    for(const [term,ids] of Object.entries(INTERESTS))if(q.includes(term))
      ids.forEach((id,index)=>scores.set(id,(scores.get(id)||0)+4-index));
    chosen=[...scores].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>facts.programs.find(p=>p.id===id)).filter(Boolean);
  }
  const status=facts.registrationStatus;
  const availability=chosen.map(p=>p.name+(status!=='open'?' (registration not currently open)':
    p.available===null?' (ask the academy for current places)':p.full?' (waitlist)':` (${p.available} place(s) shown)`));
  const asksStatus=/register|apply|admission|join|enrol|enroll|open|deadline|start/.test(q);
  const asksFee=/fee|cost|price|payment|pay/.test(q);
  const asksPlaces=/availab|space|slot|full|capacity/.test(q);
  let answer='';
  let topic='course-guidance';
  if(/(?:my|own)\s+(?:student\s+)?(?:record|registration|status|payment|account|portal|details)|registration number|student portal|password|ghana card|personal (?:record|details)|private (?:record|details)/.test(q)){
    topic='private-account';
    answer='I cannot access private student records. Use the Student Portal or the Check Status page, or contact the academy. Do not share your registration number, phone or payment details here.';
  }else if(asksFee&&!chosen.length){
    topic='fees';
    answer=facts.registrationFee===null?'Contact SkyDream for current registration fees.':
      `The published registration fee is GHS ${facts.registrationFee.toFixed(2)}. Other course charges, if any, must be confirmed directly with the academy.`;
  }else if(asksStatus&&!chosen.length){
    topic='admissions';
    answer=status==='open'? 'Online registration is currently open.':
      status==='closed'?'Online registration is currently closed.':
      status==='paused'?'Online registration is currently paused.':'The next registration period has not opened yet.';
    if(facts.registrationOpens&&status==='not-yet-open')answer+=` Opening date: ${facts.registrationOpens}.`;
    if(facts.registrationCloses)answer+=` Published closing date: ${facts.registrationCloses}.`;
    answer+=' View current programmes and register using the SkyDream website.';
  }else if(chosen.length){
    topic='recommendation';
    answer=`Based on your question, you could explore ${availability.join(', ')}. `+
      (status==='open'?'Use the registration page to apply.':'Check the registration page or contact the academy for a future intake.');
  }else if(asksPlaces){
    topic='capacity';
    answer='Current programme availability is displayed on the SkyDream programmes page. Places can change as registrations are processed.';
  }else{
    topic='general';
    answer='I can help you choose a training programme and explain published registration dates, fees and available places. Tell me what skill you want to learn.';
  }
  return {topic,answer,programs:chosen.map(p=>({id:p.id,name:p.name,available:p.available,full:p.full})),links:[
    {label:'Explore programmes',url:facts.programsUrl},
    {label:'Registration',url:facts.registrationUrl}
  ]};
}
function guardianScan(raw){
  const students=asList(raw.students),attendance=asList(raw.attendance);
  const findings=[];const idSet=new Set(students.map(s=>s.id));
  const regMap=new Map(),phones=new Map();
  const add=(severity,code,title,detail,studentIds=[],advice='Review this entry before making changes.')=>{
    findings.push({severity,code,title,detail,studentIds:studentIds.slice(0,10),advice});
  };
  for(const s of students){
    const id=safeText(s.id,120),reg=safeText(s.regNumber,80).toUpperCase();
    if(!id){add('high','missing-id','Student missing permanent ID','A registration has no stable student ID.',[]);continue;}
    if(!REG.test(reg))add('medium','invalid-number','Registration format requires review',
      'Registration number for student '+id+' does not match the expected pattern.',[id]);
    if(reg){
      if(regMap.has(reg))add('high','duplicate-number','Duplicate registration number',
        reg+' belongs to more than one student.',[regMap.get(reg),id],
        'Resolve the conflicting registrations using the audit history. Do not automatically renumber historical records.');
      else regMap.set(reg,id);
    }
    const mobile=phone(s.mobile),key=(s.intakeStart||'unknown')+'|'+mobile;
    if(mobile.length===10){
      if(phones.has(key)&&phones.get(key)!==id)
        add('medium','shared-mobile','Same mobile used in one intake',
          'Two registrations in the same intake share a mobile number.',[phones.get(key),id],
          'Check whether this is a legitimate shared family number or a duplicate.');
      else phones.set(key,id);
    }
    const payments=asList(s.payments);
    if(payments.length){
      const paid=number(s.feePaid);
      if(payments.some(p=>!Number.isFinite(Number(p.amount))||Number(p.amount)<0))
        add('high','invalid-payment','Invalid payment entry',
          'A payment amount is invalid or negative.',[id],'Finance staff should verify the source receipt.');
      const sum=payments.reduce((n,p)=>n+number(p.amount),0);
      if(Math.abs(sum-paid)>0.011)
        add('high','payment-mismatch','Payment ledger mismatch',
          'Stored amount does not agree with recorded payment entries.',[id],
          'Compare each receipt with the ledger; do not automatically overwrite amounts.');
    }
  }
  const byId=new Map(students.filter(s=>s.id).map(s=>[s.id,s]));
  for(const a of attendance){
    const student=byId.get(a.studentId);
    if(!student)add('high','orphan-attendance','Attendance references missing student',
      'An attendance record points to a student ID that is not in the register.',[safeText(a.studentId,120)],
      'Check deleted student history and the recycle bin before editing attendance.');
    else if(a.course&&student.course&&a.course!==student.course)
      add('medium','attendance-course','Attendance programme mismatch',
        'A mark references a different programme from the student record.',[student.id],
        'Review historical programme changes before correcting the mark.');
  }
  const counts={high:0,medium:0,low:0};
  for(const f of findings)counts[f.severity]++;
  return {counts,total:findings.length,scanned:{students:students.length,attendance:attendance.length},
    findings:findings.slice(0,100),truncated:findings.length>100,
    explanation:'Potential issues are diagnostic flags, not proof of wrongdoing. No records were changed.'};
}
function ownerSummary(raw){
  const students=asList(raw.students),attendance=asList(raw.attendance);
  const intake=raw.intake&&typeof raw.intake==='object'?raw.intake:{};
  const active=students.filter(s=>s.status!=='Cancelled'&&s.status!=='Completed'&&s.status!=='Deferred'&&
    (!intake.startDate||s.intakeStart===intake.startDate));
  const counted=attendance.filter(a=>a.status==='Present'||a.status==='Absent');
  const programs=Object.entries(COURSES).map(([id,[name]])=>({
    id,name,students:active.filter(s=>s.course===id).length,
    capacity:Number.isFinite(Number(raw.capacities&&raw.capacities[id]))?number(raw.capacities[id]):null
  }));
  const guardian=guardianScan(raw);
  return {intake:safeText(intake.label,80),asOf:new Date().toISOString(),
    activeStudents:active.length,allRegisteredRecords:students.length,
    attendanceMarks:counted.length,attendanceRate:counted.length?
      Math.round(100*counted.filter(a=>a.status==='Present').length/counted.length):null,
    programs,guardianIssues:guardian.counts};
}
function ownerGuidance(question,raw){
  const q=safeText(question,400).toLowerCase(),summary=ownerSummary(raw);
  const students=asList(raw.students),attendance=asList(raw.attendance);
  let topic='overview',rows=[],answer='';
  if(/absence|absent|attendance|missed/.test(q)){
    topic='attendance';
    rows=students.map(s=>{
      const marks=attendance.filter(a=>a.studentId===s.id&&(a.status==='Present'||a.status==='Absent'));
      if(marks.length<3)return null;
      const rate=Math.round(100*marks.filter(a=>a.status==='Present').length/marks.length);
      return {student:s.fullName,regNumber:s.regNumber,course:COURSES[s.course]?.[0]||s.course,attendance:rate+'%',marked:marks.length,score:rate};
    }).filter(x=>x&&x.score<75).sort((a,b)=>a.score-b.score).slice(0,25).map(({score,...rest})=>rest);
    answer=`${rows.length} student(s) are shown with attendance below 75% and at least three recorded marks. This is a review list, not a disciplinary decision.`;
  }else if(/owe|fee|pay|balance|outstanding|financial/.test(q)){
    topic='fees';
    const fee=Number.isFinite(Number(raw.settings?.registrationFee))?number(raw.settings.registrationFee):50;
    rows=students.filter(s=>s.status!=='Cancelled').map(s=>({
      student:s.fullName,regNumber:s.regNumber,course:COURSES[s.course]?.[0]||s.course,
      balance:Math.max(0,fee-number(s.feePaid))
    })).filter(x=>x.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,25)
      .map(x=>({...x,balance:'GHS '+x.balance.toFixed(2)}));
    answer=`Showing up to 25 registrations with an outstanding balance using the configured fee (GHS ${fee.toFixed(2)}). Reconcile actual receipts before contacting anyone.`;
  }else if(/problem|error|anomal|duplicate|data|guardian|integrity/.test(q)){
    topic='data-integrity';
    const g=guardianScan(raw);
    answer=`Data Guardian found ${g.total} potential issue(s): ${g.counts.high} high priority and ${g.counts.medium} medium priority. Open Data Guardian to review evidence. No records were modified.`;
  }else if(/capacity|full|space|programme|program|course|intake|popular/.test(q)){
    topic='capacity';
    rows=summary.programs.filter(p=>p.students>0).sort((a,b)=>b.students-a.students).map(p=>({
      program:p.name,students:p.students,capacity:p.capacity===null?'Not configured':p.capacity,
      available:p.capacity===null?'Unknown':Math.max(0,p.capacity-p.students)
    }));
    answer='Here is the current intake programme distribution. Confirm capacities before changing intake availability.';
  }else{
    answer=`SkyDream currently has ${summary.activeStudents} active/current-intake student(s) across ${summary.programs.filter(p=>p.students).length} programmes. `+
      `Recorded attendance: ${summary.attendanceRate===null?'not yet measured':summary.attendanceRate+'%'}. `+
      `Data Guardian flags: ${summary.guardianIssues.high} high and ${summary.guardianIssues.medium} medium. No changes were made.`;
  }
  return {topic,answer,rows,sources:['sdta_students','sdta_attendance','sdta_capacities','sdta_intake'],summary};
}
module.exports={COURSES,publicFacts,publicGuidance,guardianScan,ownerSummary,ownerGuidance};
