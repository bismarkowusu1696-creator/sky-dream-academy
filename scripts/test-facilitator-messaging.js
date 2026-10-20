'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../functions/facilitator-messaging.js'),'utf8');
const docs=new Map(),writes=[],log=[],sessions=[];
let counter=0;
const clone=value=>JSON.parse(JSON.stringify(value));
const ref=(collection,id)=>({collection,id,
  async get(){const key=collection+'/'+id;return{exists:docs.has(key),data:()=>clone(docs.get(key))};}});
const database={
  collection(name){return{
    doc(id){return ref(name,id||'generated-'+(++counter));},
    where(field,op,value){assert.equal(op,'==');return{limit(n){return{async get(){
      const entries=[...docs].filter(([key,data])=>key.startsWith(name+'/')&&data[field]===value).slice(0,n);
      return{docs:entries.map(([key,data])=>({id:key.slice(name.length+1),data:()=>clone(data)}))};
    }};}};}
  };},
  batch(){const ops=[];return{set(r,data){ops.push([r,data]);},async commit(){
    for(const [r,value]of ops){docs.set(r.collection+'/'+r.id,clone(value));writes.push(r.collection);}
  }};},
  async runTransaction(fn){const changes=[];const tx={get:r=>r.get(),update(r,data){changes.push([r,data]);}};
    await fn(tx);for(const [r,data]of changes){const key=r.collection+'/'+r.id;
      docs.set(key,{...docs.get(key),...data});writes.push(r.collection);}
  }
};
const list=[
  {id:'f1',username:'one',name:'Facilitator One',courses:['korean'],active:true},
  {id:'f2',username:'two',name:'Facilitator Two',courses:['french'],active:true},
  {id:'f3',username:'off',name:'Disabled User',courses:[],active:false}
];
docs.set('sdta_storage/sdta_facilitators',{value:JSON.stringify(list)});
const app={};
const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
const fakeAdmin={auth(){return{async verifyIdToken(value){
    if(value==='valid-f1')return{uid:'fac-f1',username:'one',role:'facilitator'};
    throw Error('Bad token');
  }};}};
const moduleObject={exports:{}};
vm.runInNewContext(source,{module:moduleObject,console},{timeout:1500});
moduleObject.exports(app,{onCall:(options,run)=>({options,run}),HttpsError,db:database,admin:fakeAdmin,crypto,
  requireStrongAdminSession:async r=>({account:{username:r.mockRole==='staff'?'staff':'owner',name:'Administrator',role:r.mockRole||'owner'}})});
const adminReq=(data={},mockRole='owner')=>({data,mockRole});
const facReq=(id,username,data={})=>({data,auth:{uid:'fac-'+id,token:{role:'facilitator',username}}});
async function main(){
  for(const name of ['adminGetFacilitatorMessages','adminSendFacilitatorMessage','facilitatorGetInbox','facilitatorMarkInboxRead'])
    assert.equal(app[name].options.enforceAppCheck,true,'AppCheck must be on');
  await assert.rejects(app.adminSendFacilitatorMessage.run(adminReq({facilitatorId:'f1',message:'Hello'},'staff')),e=>e.code==='permission-denied');
  const initial=await app.adminGetFacilitatorMessages.run(adminReq());
  assert.equal(initial.facilitators.length,2);assert.equal(initial.messages.length,0);
  await assert.rejects(app.adminSendFacilitatorMessage.run(adminReq({facilitatorId:'f3',message:'Hello'})),e=>e.code==='not-found');
  const sent=await app.adminSendFacilitatorMessage.run(adminReq({facilitatorId:'f1',message:'Meeting at 9 AM'}));
  assert.equal(sent.ok,true);assert.equal(writes.filter(x=>x==='sdta_facilitator_messages').length,1);
  assert.equal(writes.filter(x=>x==='sdta_admin_audit_archive').length,1);
  const inbox1=await app.facilitatorGetInbox.run(facReq('f1','one'));
  assert.equal(inbox1.messages.length,1);assert.equal(inbox1.unread,1);
  const inbox2=await app.facilitatorGetInbox.run(facReq('f2','two'));
  assert.equal(inbox2.messages.length,0);
  await assert.rejects(app.facilitatorMarkInboxRead.run(facReq('f2','two',{id:sent.id})),e=>e.code==='not-found');
  await assert.rejects(app.facilitatorGetInbox.run(facReq('f2','one')),e=>e.code==='permission-denied');
  await assert.rejects(app.facilitatorGetInbox.run(facReq('f3','off')),e=>e.code==='permission-denied');
  await assert.rejects(app.facilitatorGetInbox.run({data:{_facIdToken:'bad-token'}}),e=>e.code==='permission-denied');
  const fallback=await app.facilitatorGetInbox.run({data:{_facIdToken:'valid-f1'}});assert.equal(fallback.unread,1);
  await app.facilitatorMarkInboxRead.run(facReq('f1','one',{id:sent.id}));
  assert.equal((await app.facilitatorGetInbox.run(facReq('f1','one'))).unread,0);
  const history=await app.adminGetFacilitatorMessages.run(adminReq({facilitatorId:'f1'}));
  assert.ok(history.messages[0].readAt);
  assert.ok(writes.every(x=>['sdta_facilitator_messages','sdta_admin_audit_archive'].includes(x)));
  const loader=fs.readFileSync(path.resolve(__dirname,'../functions/security-hardening-loader.js'),'utf8');
  assert.ok(loader.includes("require('./facilitator-messaging')"));
  const backups=fs.readFileSync(path.resolve(__dirname,'../functions/backup-collections.js'),'utf8');
  assert.ok(backups.includes("'sdta_facilitator_messages'"));
  const facilitator=fs.readFileSync(path.resolve(__dirname,'../assets/facilitator-inbox.js'),'utf8');
  const owner=fs.readFileSync(path.resolve(__dirname,'../assets/admin-facilitator-messages.js'),'utf8');
  assert.ok(facilitator.includes("facilitatorGetInbox")&&facilitator.includes('Mark as read'));
  assert.ok(owner.includes('adminSendFacilitatorMessage'));
  console.log('SkyDream facilitator messaging tests passed: admin authorization, account isolation, inbox, read receipts, token verification and backup inclusion.');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
