'use strict';

// Registration numbers are externally communicated identifiers. Only students
// without linked activity may be renumbered. Student IDs never change.
const NUMBER_PATTERN = /^(SD[A-Z]{2})(\d{3})\/(\d{2})\/(\d{4})$/;

function numberInfo(value) {
  const match = NUMBER_PATTERN.exec(String(value || '').toUpperCase());
  if (!match) return null;
  return { prefix:match[1], sequence:Number(match[2]), suffix:match[3]+'/'+match[4] };
}
function sameCohort(student, removed) {
  return student && student.course === removed.course &&
    String(student.intakeStart || '') === String(removed.intakeStart || '');
}
function hasPayments(student) {
  return Number(student.feePaid || 0) > 0 ||
    (Array.isArray(student.payments) && student.payments.length > 0);
}
function previousNumbers(student) {
  return Array.isArray(student.previousRegNumbers)
    ? student.previousRegNumbers.filter(x=>typeof x==='string' && x.trim() !== '') : [];
}
function matchesRegistration(student, regNumber) {
  const wanted=String(regNumber||'').trim().toUpperCase();
  return wanted && [student.regNumber,...previousNumbers(student)]
    .some(x=>String(x).toUpperCase()===wanted);
}

// Fail closed. No partial renumbering if ANY affected student is ineligible.
function planCompaction(students, deletedId, linkedIds = new Set()) {
  const removed = (students || []).find(s=>s&&s.id===deletedId);
  if (!removed) return { changes:[], reason:'Student not found.' };
  const original = numberInfo(removed.regNumber);
  if (!original || original.sequence < 1) {
    return { changes:[], reason:'The deleted registration number uses an unsupported format.' };
  }
  const group=students.filter(s=>s && sameCohort(s,removed));
  const sorted=group.map(s=>({student:s,info:numberInfo(s.regNumber)}))
    .sort((a,b)=>(a.info?.sequence||0)-(b.info?.sequence||0));
  if (sorted.some(x=>!x.info || x.info.prefix!==original.prefix ||
      x.info.suffix!==original.suffix || x.info.sequence<1)) {
    return { changes:[], reason:'The course has historical registration numbering that must be preserved.' };
  }
  const numbers=sorted.map(x=>x.info.sequence);
  if (new Set(numbers).size!==numbers.length) {
    return { changes:[], reason:'Duplicate registration numbers require manual review.' };
  }
  if (sorted.some(x=>x.info.sequence>999)) {
    return { changes:[], reason:'The registration sequence exceeds supported limits.' };
  }
  if (removed.status && removed.status !== 'Registered') {
    return { changes:[], reason:'The deleted student has a protected registration status.' };
  }
  if (hasPayments(removed) || linkedIds.has(deletedId)) {
    return { changes:[], reason:'Deleted student has linked records or payments; original number must be preserved.' };
  }
  const remaining=sorted.filter(x=>x.student.id!==deletedId);
  const changes=[];
  for(let i=0;i<remaining.length;i++){
    const {student,info}=remaining[i];
    const target=original.prefix+String(i+1).padStart(3,'0')+'/'+original.suffix;
    if (target===student.regNumber) continue;
    if (student.status && student.status !== 'Registered' ||
        hasPayments(student) || linkedIds.has(student.id)) {
      return { changes:[], reason:'A remaining student has linked records, payments, or a protected status.' };
    }
    changes.push({ id:student.id, from:student.regNumber, to:target });
  }
  // Also reject assignments that collide with a current number in another
  // intake or course (two intakes in the same month can share a suffix).
  const other=students.filter(s=>s&&s.id!==deletedId&&!sameCohort(s,removed));
  if(changes.some(change=>other.some(s=>String(s.regNumber||'').toUpperCase()===change.to))) {
    return {changes:[],reason:'A registration number is already used by another course or intake.'};
  }
  // The portal supports old numbers using the matching mobile. Never create
  // an ambiguous number+mobile combination with a different student.
  const normalizedMobile = student => String(student.mobile||'').replace(/\\D/g,'').slice(-10);
  const assigned=remaining.map(({student})=>{
    const changed=changes.find(c=>c.id===student.id);
    return {id:student.id,phone:normalizedMobile(student),
      numbers:changed?[changed.to,changed.from,...previousNumbers(student)]
        :[student.regNumber,...previousNumbers(student)]};
  }).concat(other.map(student=>({id:student.id,phone:normalizedMobile(student),
    numbers:[student.regNumber,...previousNumbers(student)]})));
  const seen=new Map();
  for(const entry of assigned){
    if(!entry.phone)continue;
    for(const value of entry.numbers){
      const key=String(value||'').toUpperCase()+'|'+entry.phone;
      if(seen.has(key)&&seen.get(key)!==entry.id) {
        return {changes:[],reason:'Renumbering would make an existing portal login ambiguous.'};
      }
      seen.set(key,entry.id);
    }
  }
  return { changes, reason:'' };
}
function applyCompaction(students, changes) {
  for(const change of changes){
    const student=students.find(s=>s.id===change.id);
    if(!student || student.regNumber!==change.from) throw new Error('Registration changed during renumbering.');
    const aliases=new Set(previousNumbers(student));
    aliases.add(change.from);
    student.previousRegNumbers=[...aliases];
    student.regNumber=change.to;
  }
  return students;
}
function nextFreeRegistration(students, restored) {
  const info=numberInfo(restored.regNumber);
  if(!info) return null;
  const used=new Set(students.map(s=>String(s.regNumber||'').toUpperCase()));
  for(let idx=1;idx<=999;idx++){
    const n=info.prefix+String(idx).padStart(3,'0')+'/'+info.suffix;
    if(!used.has(n))return n;
  }
  return null;
}
module.exports={numberInfo,sameCohort,hasPayments,previousNumbers,matchesRegistration,
  planCompaction,applyCompaction,nextFreeRegistration};
