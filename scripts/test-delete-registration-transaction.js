'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {planCompaction,applyCompaction,sameCohort,previousNumbers,nextFreeRegistration} =
  require('../functions/registration-number-compaction');

const src=fs.readFileSync(path.resolve(__dirname,'../functions/enterprise-admin-loader.js'),'utf8');
const start=src.indexOf('async function linkedStudentIds(group){');
const end=src.indexOf('app.adminDeleteFacilitator=onCall(',start);
assert(start>=0 && end>start,'Protected student deletion handler not found.');
const snippet=src.slice(start,end);
const names={
  students:'sdta_students',recycle:'sdta_recycle_bin',audit:'sdta_activity_log',
  attendance:'sdta_attendance',history:'sdta_change_history',notes:'sdta_internal_notes'
};
const makeStudent=(id,seq,course='cosmetology',intake='2026-10-03')=>({
  id,course,intakeStart:intake,regNumber:'SDCO'+String(seq).padStart(3,'0')+'/10/2026',
  status:'Registered',mobile:'024000000'+seq,feePaid:0,payments:[]
});
async function scenario({protectedStudent='',paid=false}={}){
  const initial=[makeStudent('a',1),makeStudent('b',2),makeStudent('c',3),
    {...makeStudent('different',1,'accounting'),regNumber:'SDAC001/10/2026'},
    {...makeStudent('another',1,'cosmetology','2026-09-03'),regNumber:'SDCO001/09/2026'}];
  if(paid)initial[1].payments=[{amount:100}];
  const storage=new Map([
    ['sdta_students',initial],['sdta_recycle_bin',[]],['sdta_activity_log',[]],
    ['sdta_attendance',[]],['sdta_change_history',[]],['sdta_internal_notes',[]]
  ]);
  const written=new Map();
  const refFor=id=>({id,kind:'storage'});
  const db={
    collection(collection) {
      return {
        doc(id){
          return {collection,id,
            async get(){return {exists:false,data:()=>({})}}};
        },
        where(field,operator,id){
          assert.equal(field,'studentId');assert.equal(operator,'==');
          return {limit(){return this},async get(){
            return {empty:!(collection==='sdta_student_messages'&&id===protectedStudent)};
          }};
        }
      };
    },
    async runTransaction(handler){
      const writes=[];
      const tx={
        async get(ref) {
          assert.equal(ref.kind,'storage');
          const value=storage.get(ref.id);
          return {exists:value!==undefined,data:()=>({value:JSON.stringify(value)})};
        },
        set(ref,doc){writes.push(()=>storage.set(ref.id,JSON.parse(doc.value)))},
        create(ref,doc){writes.push(()=>written.set(ref.collection+'/'+ref.id,doc))}
      };
      await handler(tx);
      writes.forEach(write=>write());
    }
  };
  const app={};
  let serial=0;
  const context={
    app, db, KEYS:names, refFor, planCompaction, applyCompaction,
    sameCohort, previousNumbers, nextFreeRegistration,
    admin:{auth:()=>({getUser:async()=>{throw {code:'auth/user-not-found'}}})},
    requirePermission:async (_req,_perm,ownerOnly)=>{
      assert.equal(ownerOnly,true);return {username:'owner',role:'owner'};
    },
    readValue:async key=>storage.get(key),
    parseJson:(text,fallback)=>{try{return JSON.parse(text)}catch{return fallback}},
    nowIso:()=> '2026-10-11T12:00:00.000Z',
    clean:(x,len)=>String(x||'').slice(0,len),
    crypto:{randomUUID:()=>String(++serial)},
    onCall:(_options,run)=>({run}),
    HttpsError:class extends Error{}
  };
  vm.runInNewContext(snippet,context,{timeout:2000});
  const outcome=await app.adminDeleteStudent.run({data:{id:'a'}});
  const list=storage.get('sdta_students');
  assert.equal(list.length,4);
  assert.equal(storage.get('sdta_recycle_bin').length,1);
  assert.equal(storage.get('sdta_recycle_bin')[0].record.regNumber,'SDCO001/10/2026');
  assert.equal(list.find(s=>s.id==='different').regNumber,'SDAC001/10/2026');
  assert.equal(list.find(s=>s.id==='another').regNumber,'SDCO001/09/2026');
  assert.equal(storage.get('sdta_activity_log').some(e=>e.action==='Moved student to recycle bin'),true);
  if(protectedStudent || paid){
    assert.equal(outcome.renumbered,0);
    assert.equal(list.find(s=>s.id==='b').regNumber,'SDCO002/10/2026');
  }else{
    assert.equal(outcome.renumbered,2);
    assert.equal(list.find(s=>s.id==='b').regNumber,'SDCO001/10/2026');
    assert.equal(list.find(s=>s.id==='c').regNumber,'SDCO002/10/2026');
    assert.equal(list.find(s=>s.id==='b').previousRegNumbers[0],'SDCO002/10/2026');
    assert.equal([...written.values()].filter(e=>e.action==='Renumbered student after deletion').length,2);
  }
}
(async()=>{
  await scenario();
  await scenario({protectedStudent:'b'});
  await scenario({paid:true});
  console.log('SkyDream deletion transaction tests passed: atomic recycle, numbering and protected records.');
})().catch(err=>{console.error(err);process.exitCode=1});
