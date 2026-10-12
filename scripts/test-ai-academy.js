'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {publicFacts,publicGuidance,guardianScan,ownerSummary,ownerGuidance}=
  require('../functions/ai-academy-core');

const catalog={registrationFee:50,intake:{label:'October 2026',
  startDate:'2026-10-03',classesStartDate:'2026-10-04',
  registrationOpenDate:'2026-10-01',registrationCloseDate:'2026-10-31'},
  programs:[{id:'graphic-design',available:4,full:false,capacity:20},
    {id:'electricals',available:0,full:true,capacity:25}]};
const open=publicFacts(catalog,new Date('2026-10-12T10:00:00Z'));
assert.equal(open.registrationStatus,'open');
assert.equal(open.registrationFee,50);
assert.equal(open.programs.find(p=>p.id==='graphic-design').available,4);
const closed=publicFacts(catalog,new Date('2026-11-01T00:00:00Z'));
assert.equal(closed.registrationStatus,'closed');
assert.match(publicGuidance('Can I register?',closed).answer,/closed/i);
assert.match(publicGuidance('I want to learn wiring',open).answer,/Electricals/);
assert.match(publicGuidance('How much is registration?',open).answer,/GHS 50/);
assert.match(publicGuidance('What is the tuition?',open).answer,/GHS 50/);
assert.match(publicGuidance('How much does Graphic Design cost?',open).answer,/GHS 50/);
assert.equal(publicGuidance('My student portal or payment status?',open).topic,'private-account');
assert.equal(publicGuidance('I am a student and want to learn Electricals',open).topic,'recommendation');
assert.equal(publicGuidance('Can you check my student record?',open).topic,'private-account');
assert.equal(JSON.stringify(open).includes('fullName'),false);

const students=[
 {id:'a',fullName:'Private Name A',regNumber:'SDCO001/10/2026',intakeStart:'2026-10-03',
   course:'cosmetology',mobile:'0240000001',status:'Registered',
   feePaid:50,payments:[{amount:50}]},
 {id:'b',fullName:'Private Name B',regNumber:'SDCO001/10/2026',intakeStart:'2026-10-03',
   course:'cosmetology',mobile:'+233240000001',status:'Registered',
   feePaid:45,payments:[{amount:20}]},
 {id:'c',fullName:'Private Name C',regNumber:'SDBA003/10/2026',intakeStart:'2026-10-03',
   course:'barbering',mobile:'0240000003',status:'Registered',feePaid:0,payments:[]}
];
const attendance=[
 {id:'m1',studentId:'a',course:'cosmetology',status:'Absent',date:'2026-10-08'},
 {id:'m2',studentId:'a',course:'cosmetology',status:'Absent',date:'2026-10-09'},
 {id:'m3',studentId:'a',course:'cosmetology',status:'Absent',date:'2026-10-10'},
 {id:'m4',studentId:'c',course:'cosmetology',status:'Present',date:'2026-10-10'},
 {id:'m5',studentId:'deleted',course:'cosmetology',status:'Present',date:'2026-10-10'}
];
const original=JSON.stringify({students,attendance});
const data={students,attendance,capacities:{cosmetology:20,barbering:15},
  settings:{registrationFee:50},intake:{startDate:'2026-10-03',label:'October 2026'}};
const issues=guardianScan(data);
assert.ok(issues.total>=4);
for(const code of ['duplicate-number','shared-mobile','payment-mismatch','attendance-course','orphan-attendance'])
  assert.ok(issues.findings.some(x=>x.code===code),code+' not found');
assert.ok(issues.findings.every(x=>!JSON.stringify(x).includes('Private Name')));
assert.equal(JSON.stringify({students,attendance}),original,'Scan must be read-only');
const summary=ownerSummary(data);
assert.equal(summary.activeStudents,3);
assert.equal(summary.attendanceMarks,5);
assert.equal(summary.programs.find(p=>p.id==='cosmetology').students,2);
assert.equal(JSON.stringify(summary).includes('Private Name'),false,
  'External-model facts must not contain student names');
const attendanceAnswer=ownerGuidance('Who needs attendance follow-up?',data);
assert.equal(attendanceAnswer.topic,'attendance');
assert.equal(attendanceAnswer.rows[0].regNumber,'SDCO001/10/2026');
assert.equal(ownerGuidance('How are programmes filling up?',data).topic,'capacity');
assert.equal(ownerGuidance('Who has unpaid fees?',data).topic,'fees');
assert.equal(ownerGuidance('Any data anomalies?',data).topic,'data-integrity');

const backend=fs.readFileSync(path.resolve(__dirname,'../functions/ai-academy-operations.js'),'utf8');
const loader=fs.readFileSync(path.resolve(__dirname,'../functions/security-hardening-loader.js'),'utf8');
for(const callable of ['adminAiCommandCenter','adminAiDataGuardian','publicAdmissionsAssistant'])
  assert.ok(backend.includes('app.'+callable+'=onCall('),callable+' not exported');
assert.ok(loader.includes("require('./ai-academy-operations')"),'Missing backend install');
assert.ok(backend.includes("requireStrongAdminSession(request)"),'Owner session check required');
assert.ok(backend.includes("account.role||'staff')!=='owner'"),'Owner role check required');
assert.ok(backend.includes('enforceAppCheck:true'),'App Check must be enforced');
assert.ok(backend.includes('publicCatalog.run(request)'),'Public answers must use public-only data');
assert.ok(backend.includes('secrets:[API_KEY]'),'AI key must be server-only');
assert.ok(!backend.includes('JSON.stringify(data.students)'),'Private register must never be sent to LLM');
console.log('SkyDream AI pilot: published facts, model privacy, owner gating, data integrity and read-only regression tests passed.');
