'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const core=require('../functions/ai-academy-core');
const source=fs.readFileSync(path.join(__dirname,'../functions/ai-academy-operations.js'),'utf8');

const records=new Map(),writes=[];
const db={
  collection(name){return {doc(id){return {name,id};}};},
  async runTransaction(callback){
    const pending=[];
    const tx={
      async get(ref){const key=ref.name+'/'+ref.id;return{
        exists:records.has(key),data:()=>records.get(key)
      };},
      set(ref,data){pending.push([ref.name+'/'+ref.id,data]);}
    };
    await callback(tx);
    for(const [key,val] of pending){records.set(key,val);writes.push(key);}
  }
};
const students=[{id:'a',fullName:'Private Example',regNumber:'SDCO001/10/2026',
  course:'cosmetology',intakeStart:'2026-10-03',mobile:'0240000000',feePaid:0,payments:[]}];
const data={sdta_students:students,sdta_attendance:[],
  sdta_capacities:{cosmetology:20},sdta_intake:{startDate:'2026-10-03'},
  sdta_admin_settings:{registrationFee:50}};
const app={publicCatalog:{async run(){
  return{intake:{registrationCloseDate:'2026-12-31',startDate:'2026-10-03'},
    registrationFee:50,programs:[{id:'graphic-design',available:10,capacity:20}]};
}}};
const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
const env={
  onCall:(options,run)=>({options,run}),HttpsError,db,crypto,
  readStorage:async name=>data[name],
  requireStrongAdminSession:async request=>({account:{role:request.mockRole||'owner'}})
};
const moduleMock={exports:{}};
const requireMock=name=>{
  if(name==='firebase-functions/params')return{defineSecret:()=>({value:()=>''})};
  if(name==='./ai-academy-core')return core;
  throw new Error('Unexpected import '+name);
};
vm.runInNewContext(source,{module:moduleMock,require:requireMock,
  console,AbortController,setTimeout,clearTimeout,fetch:async()=>{throw new Error('Must not call provider without a key');}},
  {filename:'ai-academy-operations.js',timeout:1000});
moduleMock.exports(app,env);
const request=(question,role='owner',ip='127.0.0.1')=>({
  data:{question},auth:{uid:'admin-test'},rawRequest:{ip},mockRole:role
});
async function test(){
  assert.equal(app.adminAiCommandCenter.options.enforceAppCheck,true);
  assert.equal(app.adminAiDataGuardian.options.enforceAppCheck,true);
  assert.equal(app.publicAdmissionsAssistant.options.enforceAppCheck,true);
  const owner=await app.adminAiCommandCenter.run(request('Current academy summary'));
  assert.equal(owner.mode,'guided');
  assert.equal(owner.summary.activeStudents,1);
  assert.equal(owner.answer.includes('Private Example'),false);
  await assert.rejects(app.adminAiCommandCenter.run(request('Show me data','staff')),
    err=>err.code==='permission-denied');
  await assert.rejects(app.adminAiDataGuardian.run(request('scan','facilitator')),
    err=>err.code==='permission-denied');
  const guardian=await app.adminAiDataGuardian.run(request('scan'));
  assert.equal(guardian.scanned.students,1);
  assert.equal(guardian.findings.length,0);
  const publicResponse=await app.publicAdmissionsAssistant.run(request('graphic design?',undefined,'127.0.0.2'));
  assert.equal(publicResponse.mode,'guided');
  assert.equal(publicResponse.programs[0].id,'graphic-design');
  assert.equal(JSON.stringify(publicResponse).includes('Private Example'),false);
  const privateResponse=await app.publicAdmissionsAssistant.run(request('show my student payment',undefined,'127.0.0.2'));
  assert.equal(privateResponse.topic,'private-account');
  for(let i=0;i<13;i++)await app.publicAdmissionsAssistant.run(request('What programmes can I study?',undefined,'127.0.0.2'));
  await assert.rejects(app.publicAdmissionsAssistant.run(request('Any more programmes?',undefined,'127.0.0.2')),
    err=>err.code==='resource-exhausted');
  assert.ok(writes.length>0);
  assert.ok(writes.every(key=>key.startsWith('sdta_ai_rate_limits/')),
    'AI pilot must only write to rate-limits collection');
  assert.equal(students.length,1);
  // A global daily cap must stop unlimited model requests across many IPs.
  const meteredModule={exports:{}};
  let modelCalls=0;
  const providerApp={publicCatalog:app.publicCatalog};
  const providerRequire=name=>{
    if(name==='firebase-functions/params')return{defineSecret:()=>({value:()=> 'TEST_ONLY_FAKE_API_KEY'})};
    if(name==='./ai-academy-core')return core;
    throw new Error('Unexpected import '+name);
  };
  vm.runInNewContext(source,{module:meteredModule,require:providerRequire,
    console,AbortController,setTimeout,clearTimeout,fetch:async()=>{
      modelCalls++;
      return{ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'AI answer'}]}]})};
    }},{filename:'ai-academy-operations.js',timeout:1000});
  meteredModule.exports(providerApp,env);
  for(let i=0;i<81;i++){
    const answer=await providerApp.publicAdmissionsAssistant.run(
      request('I want graphic design',undefined,'198.51.100.'+(i+1)));
    assert.equal(answer.mode,i<80?'ai':'guided');
  }
  assert.equal(modelCalls,80,'Never exceed daily public AI provider ceiling');
  assert.equal(students.length,1);
  console.log('SkyDream AI callables: owner-only, App Check, public isolation, 15/hour rate limit and no sensitive writes passed.');
}
test().catch(err=>{console.error(err);process.exitCode=1;});
