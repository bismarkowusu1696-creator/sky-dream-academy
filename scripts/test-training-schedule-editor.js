'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../functions/training-schedule-editor.js'),'utf8');
const documents=new Map(),writes=[];
const clone=v=>JSON.parse(JSON.stringify(v));
const initialIntake={
  startDate:'2026-10-03',label:'October 2026 Intake',classesStartDate:'2026-10-04',
  breakStartDate:'2026-12-14',resumeDate:'2027-01-09',
  endDate:'2027-02-27',thanksgivingDate:'2027-02-28',
  registrationCloseDate:'2026-10-03'
};
documents.set('sdta_storage/sdta_intake',{value:JSON.stringify(initialIntake)});
documents.set('sdta_storage/sdta_students',{value:JSON.stringify([
  {id:'s1',intakeStart:'2026-10-03',fullName:'Registered Student',course:'graphic-design'}
])});
let docSerial=0;
function ref(collection,id){
  const docId=id||('doc'+(++docSerial));
  return{collection,id:docId,async get(){
    const key=collection+'/'+docId;
    return{exists:documents.has(key),id:docId,data:()=>clone(documents.get(key))};
  }};
}
const db={
  collection(name){return{
    doc(id){return ref(name,id);},
    where(field,operator,value){
      assert.equal(operator,'==');
      let max=100;
      const q={
        limit(n){max=n;return q;},
        async get(){
          const docs=[...documents].filter(([key,data])=>key.startsWith(name+'/')&&data[field]===value)
            .slice(0,max).map(([key,data])=>({
              id:key.slice(name.length+1),data:()=>clone(data)
            }));
          return{docs,empty:docs.length===0};
        }
      };
      return q;
    }
  };},
  async runTransaction(fn){
    const staged=[],tx={
      get:r=>r.get(),
      set(r,data){staged.push(['set',r,clone(data)]);},
      create(r,data){staged.push(['create',r,clone(data)]);}
    };
    const result=await fn(tx);
    for(const [kind,r,data]of staged){
      const key=r.collection+'/'+r.id;
      if(kind==='create'&&documents.has(key))throw Error('duplicate audit');
      documents.set(key,data);writes.push(key);
    }
    return result;
  }
};
const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
const app={
  publicCatalog:{async run(){
    const current=JSON.parse(documents.get('sdta_storage/sdta_intake').value);
    return{intake:current,programs:[{id:'graphic-design',name:'Graphic Design'}]};
  }}
};
const moduleObject={exports:{}};
vm.runInNewContext(source,{module:moduleObject},{timeout:2000,filename:'training-schedule-editor.js'});
moduleObject.exports(app,{
  onCall:(config,run)=>({config,run}),HttpsError,db,crypto,
  requireStrongAdminSession:async request=>{
    if(!request||request.mockAuth!==true)throw new HttpsError('permission-denied','Sign in required');
    return{account:{role:request.mockRole||'owner',username:request.user||'owner'}};
  }
});
const req=(data={},role='owner')=>({mockAuth:true,mockRole:role,data});
const proposed={
  label:'October Updated',startDate:'2026-10-03',
  classesStartDate:'2026-10-05',breakStartDate:'2026-12-15',
  resumeDate:'2027-01-09',endDate:'2027-02-27',thanksgivingDate:'2027-03-01'
};
const sessions=[
  {course:'graphic-design',day:'Saturday',startTime:'09:00',endTime:'12:00',venue:'Lab 2'},
  {course:'korean',day:'Sunday',startTime:'13:00',endTime:'15:00',venue:'Room B'}
];
async function main(){
  for(const name of ['adminGetTrainingSchedule','adminSaveTrainingSchedule'])
    assert.equal(app[name].config.enforceAppCheck,true,'Owner callables must enforce App Check.');
  assert.equal(app.publicCatalog.config.enforceAppCheck,false,'Public schedule must remain readable without app tokens.');
  await assert.rejects(app.adminGetTrainingSchedule.run(req({},'staff')),
    e=>e.code==='permission-denied');
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:proposed,sessions
  },'staff')),e=>e.code==='permission-denied');
  await assert.rejects(app.adminGetTrainingSchedule.run({data:{}}),
    e=>e.code==='permission-denied');
  const initial=await app.adminGetTrainingSchedule.run(req());
  assert.equal(initial.revision,0);
  assert.equal(initial.sessions.length,0);
  assert.equal(initial.changes.length,0);
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:{...proposed,startDate:'2026-10-04'},sessions
  })),e=>e.code==='failed-precondition');
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:{...proposed,classesStartDate:'2026-13-04'},sessions
  })),e=>e.code==='invalid-argument');
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:{...proposed,breakStartDate:''},sessions
  })),e=>e.code==='invalid-argument');
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:proposed,
    sessions:[...sessions,{course:'graphic-design',day:'Saturday',startTime:'11:00',endTime:'13:00'}]
  })),e=>e.code==='already-exists');
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:proposed,
    sessions:[{course:'invalid-programme',day:'Monday',startTime:'11:00',endTime:'13:00'}]
  })),e=>e.code==='invalid-argument');
  assert.equal(writes.length,0,'Invalid attempts must not modify records.');
  const result=await app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:proposed,sessions
  }));
  assert.equal(result.ok,true);assert.equal(result.revision,1);
  assert.equal(result.intake.classesStartDate,'2026-10-05');
  assert.equal(JSON.parse(documents.get('sdta_storage/sdta_students').value)[0].id,'s1',
    'Existing student enrollment must remain unchanged');
  assert.equal(writes.filter(x=>x.startsWith('sdta_training_schedule_changes/')).length,1,
    'An immutable schedule audit record is required');
  const publicResult=await app.publicCatalog.run({});
  assert.equal(publicResult.trainingSchedule.sessions.length,2);
  assert.equal(publicResult.trainingSchedule.sessions.find(s=>s.course==='graphic-design').venue,'Lab 2');
  assert.equal(JSON.stringify(publicResult).includes('updatedBy'),false,
    'Private admin identity must not leak through publicCatalog');
  const updated=await app.adminGetTrainingSchedule.run(req());
  assert.equal(updated.changes.length,1);
  assert.equal(updated.changes[0].updatedBy,'owner');
  assert.ok(updated.changes[0].changedDates.includes('classesStartDate'));
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:0,intake:proposed,sessions
  })),e=>e.code==='aborted','Stale admin sessions must not overwrite changes');
  await assert.rejects(app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-09-01',revision:1,intake:proposed,sessions
  })),e=>e.code==='aborted','Cross-intake edits must be rejected');
  const next=await app.adminSaveTrainingSchedule.run(req({
    intakeStart:'2026-10-03',revision:1,intake:{...proposed,endDate:'2027-03-02',thanksgivingDate:'2027-03-03'},sessions:[]
  }));
  assert.equal(next.revision,2);
  assert.equal((await app.publicCatalog.run({})).trainingSchedule.sessions.length,0,
    'Clearing weekly sessions must update the public view');
  assert.equal((await app.adminGetTrainingSchedule.run(req())).changes.length,2);
  const backup=fs.readFileSync(path.resolve(__dirname,'../functions/backup-collections.js'),'utf8');
  assert.ok(backup.includes("'sdta_training_schedule_changes'"));
  const loader=fs.readFileSync(path.resolve(__dirname,'../functions/security-hardening-loader.js'),'utf8');
  assert.ok(loader.includes("require('./training-schedule-editor')"));
  const publicUi=fs.readFileSync(path.resolve(__dirname,'../assets/schedule-live.js'),'utf8');
  assert.ok(publicUi.includes('weeklyScheduleGrid')&&publicUi.includes('trainingSchedule'));
  console.log('Training schedule editor tests passed: owner authorization, date ordering, programme conflicts, cohort safety, audit history, optimistic revisions, public schedule and backups.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
