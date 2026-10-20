'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../functions/student-facilitator-chat.js'),'utf8');
const docs=new Map(),writes=[];
const clone=x=>JSON.parse(JSON.stringify(x));
let nextId=0;
function ref(collection,id){
  const key=collection+'/'+id;
  return{collection,id,async get(){
    return{exists:docs.has(key),id,data:()=>clone(docs.get(key))};
  }};
}
const db={
  collection(name){return{
    doc(id){return ref(name,id||'generated-'+(++nextId));},
    where(field,operator,value){
      assert.equal(operator,'==');
      const conditions=[[field,value]];
      const query={
        where(f,op,v){assert.equal(op,'==');conditions.push([f,v]);return query;},
        orderBy(f,direction){query.orderField=f;query.orderDirection=direction;return query;},
        limit(num){query.max=num;return query;},
        async get(){
          let entries=[...docs].filter(([key,data])=>key.startsWith(name+'/')&&
            conditions.every(([f,v])=>data[f]===v));
          if(query.orderField){
            entries.sort((a,b)=>String(a[1][query.orderField]||'').localeCompare(
              String(b[1][query.orderField]||''))*(query.orderDirection==='desc'?-1:1));
          }
          entries=entries.slice(0,query.max||2000);
          return{docs:entries.map(([key,data])=>({id:key.slice(name.length+1),
            data:()=>clone(data)})),empty:entries.length===0};
        }
      };
      return query;
    }
  };},
  async runTransaction(callback){
    const changes=[];
    const tx={
      get:r=>r.get(),
      set(r,data,options){changes.push({kind:'set',r,data:clone(data),merge:options&&options.merge});},
      create(r,data){changes.push({kind:'create',r,data:clone(data)});},
      update(r,data){changes.push({kind:'update',r,data:clone(data)});}
    };
    const out=await callback(tx);
    for(const op of changes){
      const key=op.r.collection+'/'+op.r.id;
      if(op.kind==='create'&&docs.has(key))throw Error('Mock duplicate document');
      if(op.kind==='update'&&!docs.has(key))throw Error('Mock missing update document');
    }
    for(const op of changes){
      const key=op.r.collection+'/'+op.r.id;
      const old=docs.get(key)||{};
      docs.set(key,(op.kind==='update'||op.merge)?{...old,...op.data}:op.data);
      writes.push(op.r.collection);
    }
    return out;
  }
};
const students=[
  {id:'s1',fullName:'Student One',course:'graphic-design',intakeStart:'2026-10-03',status:'Registered'},
  {id:'s2',fullName:'Student Two',course:'korean',intakeStart:'2026-10-03',status:'Registered'},
  {id:'s3',fullName:'Old Intake',course:'graphic-design',intakeStart:'2026-09-01',status:'Registered'},
  {id:'s4',fullName:'Cancelled',course:'graphic-design',intakeStart:'2026-10-03',status:'Cancelled'}
];
const facilitators=[
  {id:'f1',name:'Graphic Teacher',username:'graphic',courses:['graphic-design'],active:true},
  {id:'f2',name:'Korean Teacher',username:'korean',courses:['korean'],active:true},
  {id:'f3',name:'Disabled Teacher',username:'disabled',courses:['graphic-design'],active:false}
];
docs.set('sdta_storage/sdta_students',{value:JSON.stringify(students)});
docs.set('sdta_storage/sdta_facilitators',{value:JSON.stringify(facilitators)});
docs.set('sdta_storage/sdta_intake',{value:JSON.stringify({startDate:'2026-10-03'})});
const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
const admin={auth(){return{async verifyIdToken(value){
  if(value==='f1-token')return{uid:'fac-f1',role:'facilitator',username:'graphic'};
  throw Error('Invalid token');
}}}};
const moduleObject={exports:{}};
vm.runInNewContext(source,{module:moduleObject,console},{filename:'student-facilitator-chat.js',timeout:2000});
const app={};
moduleObject.exports(app,{onCall:(options,run)=>({options,run}),HttpsError,db,admin,crypto});
const studentReq=(id,data={})=>({auth:{uid:'student-'+id,token:{role:'student',studentId:id}},data});
const facilitatorReq=(id,username,data={})=>({
  auth:{uid:'fac-'+id,token:{role:'facilitator',username}},data
});
async function main(){
  for(const action of [
    'studentListFacilitatorChats','studentGetFacilitatorChat','studentSendFacilitatorChat',
    'facilitatorListStudentChats','facilitatorGetStudentChat','facilitatorSendStudentChat',
    'studentDeleteFacilitatorChatMessage','facilitatorDeleteStudentChatMessage',
    'studentClearFacilitatorChat','facilitatorClearStudentChat'
  ])assert.equal(app[action].options.enforceAppCheck,true,action+' must enforce App Check');

  const studentList=await app.studentListFacilitatorChats.run(studentReq('s1'));
  assert.equal(studentList.facilitators.map(f=>f.id).join(','),'f1');
  assert.equal(studentList.threads.length,0);
  const facilitatorList=await app.facilitatorListStudentChats.run(facilitatorReq('f1','graphic'));
  assert.equal(facilitatorList.roster.map(s=>s.id).join(','),'s1');

  await assert.rejects(app.studentListFacilitatorChats.run(studentReq('s3')),
    error=>error.code==='permission-denied');
  await assert.rejects(app.studentListFacilitatorChats.run(studentReq('s4')),
    error=>error.code==='permission-denied');
  await assert.rejects(app.studentListFacilitatorChats.run({
    auth:{uid:'student-s2',token:{role:'student',studentId:'s1'}}
  }),error=>error.code==='permission-denied');
  await assert.rejects(app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f2',message:'Cross class'})),error=>error.code==='permission-denied');
  await assert.rejects(app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f3',message:'Inactive teacher'})),error=>error.code==='permission-denied');
  await assert.rejects(app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1',message:' '})),error=>error.code==='invalid-argument');
  await assert.rejects(app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1',message:'a'.repeat(1001)})),error=>error.code==='invalid-argument');
  await assert.rejects(app.facilitatorSendStudentChat.run(
    facilitatorReq('f2','korean',{studentId:'s1',message:'Cross class'})),
    error=>error.code==='permission-denied');
  await assert.rejects(app.facilitatorListStudentChats.run(
    facilitatorReq('f1','korean')),error=>error.code==='permission-denied');
  await assert.rejects(app.facilitatorListStudentChats.run({
    data:{_facIdToken:'invalid-token'}
  }),error=>error.code==='permission-denied');

  const sent=await app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1',message:'Can I get help with typography?'}));
  assert.equal(sent.ok,true);
  assert.equal((await app.facilitatorListStudentChats.run(facilitatorReq('f1','graphic'))).threads[0].unreadFacilitator,1);
  assert.equal((await app.facilitatorListStudentChats.run(facilitatorReq('f2','korean'))).threads.length,0);
  const teacherChat=await app.facilitatorGetStudentChat.run(
    facilitatorReq('f1','graphic',{studentId:'s1'}));
  assert.equal(teacherChat.messages.length,1);
  assert.equal(teacherChat.messages[0].senderType,'student');
  assert.equal(teacherChat.thread.unreadFacilitator,0);
  const reply=await app.facilitatorSendStudentChat.run({
    data:{studentId:'s1',message:'Yes, start with visual hierarchy.',_facIdToken:'f1-token'}
  });
  assert.equal(reply.ok,true);
  const studentChat=await app.studentGetFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1'}));
  assert.equal(studentChat.messages.length,2);
  assert.equal(studentChat.messages[0].message,'Can I get help with typography?');
  assert.equal(studentChat.messages[1].senderType,'facilitator');
  assert.equal(studentChat.thread.unreadStudent,0);
  assert.equal((await app.studentListFacilitatorChats.run(studentReq('s2'))).threads.length,0);
  await assert.rejects(app.studentGetFacilitatorChat.run(
    studentReq('s2',{facilitatorId:'f1'})),error=>error.code==='permission-denied');
  await assert.rejects(app.facilitatorGetStudentChat.run(
    facilitatorReq('f2','korean',{studentId:'s1'})),error=>error.code==='permission-denied');


  await assert.rejects(app.studentDeleteFacilitatorChatMessage.run(
    studentReq('s2',{facilitatorId:'f1',id:sent.id})),
    error=>error.code==='permission-denied');
  await assert.rejects(app.facilitatorDeleteStudentChatMessage.run(
    facilitatorReq('f2','korean',{studentId:'s1',id:sent.id})),
    error=>error.code==='permission-denied');
  await assert.rejects(app.studentDeleteFacilitatorChatMessage.run(
    studentReq('s1',{facilitatorId:'f1',id:'random-message'})),
    error=>error.code==='not-found');
  const removed=await app.studentDeleteFacilitatorChatMessage.run(
    studentReq('s1',{facilitatorId:'f1',id:reply.id}));
  assert.equal(removed.removed,true);
  assert.equal((await app.studentGetFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1'}))).messages.length,1);
  assert.equal((await app.facilitatorGetStudentChat.run(
    facilitatorReq('f1','graphic',{studentId:'s1'}))).messages.length,2,
    'Student deletion must not remove facilitator transcript');
  await app.facilitatorDeleteStudentChatMessage.run(
    facilitatorReq('f1','graphic',{studentId:'s1',id:sent.id}));
  assert.equal((await app.facilitatorGetStudentChat.run(
    facilitatorReq('f1','graphic',{studentId:'s1'}))).messages.length,1);
  await app.studentClearFacilitatorChat.run(studentReq('s1',{facilitatorId:'f1'}));
  assert.equal((await app.studentGetFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1'}))).messages.length,0);
  assert.equal((await app.studentListFacilitatorChats.run(studentReq('s1'))).threads.length,0);
  assert.equal((await app.facilitatorListStudentChats.run(
    facilitatorReq('f1','graphic'))).threads.length,1,
    'Clearing student view must not clear facilitator view');
  await app.facilitatorClearStudentChat.run(
    facilitatorReq('f1','graphic',{studentId:'s1'}));
  assert.equal((await app.facilitatorListStudentChats.run(
    facilitatorReq('f1','graphic'))).threads.length,0);
  const resumed=await app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1',message:'New conversation message'}));
  assert.equal(resumed.ok,true);
  assert.equal((await app.facilitatorGetStudentChat.run(
    facilitatorReq('f1','graphic',{studentId:'s1'}))).messages.length,1);
  assert.equal((await app.studentGetFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1'}))).messages.length,1);

  for(let n=0;n<28;n++){
    await app.studentSendFacilitatorChat.run(studentReq('s1',{
      facilitatorId:'f1',message:'Test message '+(n+1)
    }));
  }
  await assert.rejects(app.studentSendFacilitatorChat.run(
    studentReq('s1',{facilitatorId:'f1',message:'Rate limit'})),
    error=>error.code==='resource-exhausted');
  assert.ok(writes.every(c=>[
    'sdta_student_facilitator_messages','sdta_student_facilitator_threads'
  ].includes(c)),'Chat must not modify enrollment, attendance or payments');
  const backups=fs.readFileSync(path.resolve(__dirname,'../functions/backup-collections.js'),'utf8');
  assert.ok(backups.includes("'sdta_student_facilitator_messages'"));
  assert.ok(backups.includes("'sdta_student_facilitator_threads'"));
  const numberSafety=fs.readFileSync(path.resolve(__dirname,'../functions/enterprise-admin-loader.js'),'utf8');
  assert.ok(numberSafety.includes("db.collection('sdta_student_facilitator_threads')"));
  const backend=fs.readFileSync(path.resolve(__dirname,'../functions/security-hardening-loader.js'),'utf8');
  assert.ok(backend.includes("require('./student-facilitator-chat')"));
  const indexes=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../firestore.indexes.json'),'utf8'));
  assert.ok(indexes.indexes.some(i=>i.collectionGroup==='sdta_student_facilitator_messages'&&
    i.fields.some(f=>f.fieldPath==='threadId')&&i.fields.some(f=>f.fieldPath==='sequence')));
  assert.ok(indexes.indexes.some(i=>i.collectionGroup==='sdta_student_facilitator_threads'&&
    i.fields.some(f=>f.fieldPath==='facilitatorId')&&
    i.fields.some(f=>f.fieldPath==='lastMessageAt')));
  const validator=fs.readFileSync(path.resolve(__dirname,'../scripts/validate-local.js'),'utf8');
  assert.ok(validator.includes("runNode(['scripts/test-student-facilitator-chat.js'])"));
  console.log('Student/facilitator messaging passed: identity, intake and course isolation, send/receive, unread counts, 30/h spam limit, backups and index.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
