'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {correctPaymentInPlace}=require('../functions/payment-corrections');
const source=fs.readFileSync(path.resolve(__dirname,'../functions/security-hardening-loader.js'),'utf8');
const first=source.indexOf('// Correct a single payment with a durable in-record revision trail.');
const last=source.lastIndexOf('module.exports = app;');
assert.ok(first>=0&&last>first,'Correction endpoint missing');
const endpoint=source.slice(first,last);
const students=[{id:'s1',regNumber:'SDHD005/10/2026',fullName:'Example Student',feePaid:100,payments:[{amount:100,date:'2026-10-16T10:00:00Z',note:'Tuition',recordedBy:'original-admin'}]}];
const docs=new Map([['sdta_storage/sdta_students',{value:JSON.stringify(students)}]]);
let commits=0;
const db={collection(name){return{doc(id){return{name,id};}};},
  async runTransaction(task){
    const changes=[];
    const tx={async get(ref){const k=ref.name+'/'+ref.id;return{exists:docs.has(k),data:()=>docs.get(k)};},
      set(ref,value){changes.push({kind:'set',key:ref.name+'/'+ref.id,value});},
      create(ref,value){changes.push({kind:'create',key:ref.name+'/'+ref.id,value});}};
    await task(tx);
    for(const c of changes)if(c.kind==='create'&&docs.has(c.key))throw new Error('Duplicate audit');
    for(const c of changes)docs.set(c.key,c.value);
    commits++;
  }
};
const app={},HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
const sandbox={app,onCall:(config,run)=>({config,run}),HttpsError,db,crypto,
  STORAGE_COLLECTION:'sdta_storage',parseJson:(raw,fallback)=>{try{return JSON.parse(raw);}catch(_){return fallback;}},
  clean:(v,n)=>String(v||'').trim().slice(0,n),
  requireStrongAdminSession:async r=>({account:{username:'admin',role:r.role}}),
  require:n=>{if(n==='./payment-corrections')return{correctPaymentInPlace};throw Error(n);}};
vm.runInNewContext(endpoint,sandbox,{timeout:1000});
const request=(role,newAmount,expectedAmount=100)=>({role,data:{studentId:'s1',paymentIndex:0,expectedDate:'2026-10-16T10:00:00Z',
  expectedAmount,newAmount,reason:'Corrected incorrect payment entry'}});
async function main(){
  assert.equal(app.adminCorrectPayment.config.enforceAppCheck,true);
  await assert.rejects(app.adminCorrectPayment.run(request('staff','50')),e=>e.code==='permission-denied');
  assert.equal(commits,0,'Staff denial must not write');
  await assert.rejects(app.adminCorrectPayment.run(request('owner','50',99)),e=>e.code==='aborted');
  assert.equal(commits,0,'Stale payment denial must not write');
  const result=await app.adminCorrectPayment.run(request('owner','50'));
  assert.equal(result.newTotal,50);assert.equal(commits,1);
  const updated=JSON.parse(docs.get('sdta_storage/sdta_students').value);
  assert.equal(updated[0].feePaid,50);assert.equal(updated[0].payments[0].amount,50);
  const audits=[...docs].filter(([key])=>key.startsWith('sdta_admin_audit_archive/'));
  assert.equal(audits.length,1);assert.equal(audits[0][1].previousAmount,100);
  assert.equal(audits[0][1].newAmount,50);
  assert.equal(updated[0].payments[0].recordedBy,'original-admin');
  await assert.rejects(app.adminCorrectPayment.run(request('owner','20')),e=>e.code==='aborted');
  assert.equal(commits,1);
  console.log('SkyDream payment correction transaction passed: authorization, atomic audit, stale-write guard and correct new total.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
