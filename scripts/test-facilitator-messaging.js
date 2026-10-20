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
  for(const name of ['adminGetFacilitatorMessages','adminSendFacilitatorMessage','facilitatorGetInbox','facilitatorMarkInboxRead','facilitatorReplyToMessage','adminMarkFacilitatorRepliesRead'])
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
  // New: replying must be scoped to the facilitator ID, not a supplied username.
  await assert.rejects(
    app.facilitatorReplyToMessage.run(facReq('f2','two',{id:sent.id,reply:'I cannot see this'})),
    e=>e.code==='not-found');
  await assert.rejects(
    app.facilitatorReplyToMessage.run(facReq('f2','one',{id:sent.id,reply:'Spoofed account'})),
    e=>e.code==='permission-denied');
  await assert.rejects(
    app.facilitatorReplyToMessage.run(facReq('f3','off',{id:sent.id,reply:'Disabled account'})),
    e=>e.code==='permission-denied');
  await assert.rejects(
    app.facilitatorReplyToMessage.run(facReq('f1','one',{id:sent.id,reply:'  '})),
    e=>e.code==='invalid-argument');
  await assert.rejects(
    app.facilitatorReplyToMessage.run(facReq('f1','one',{id:sent.id,reply:'a'.repeat(1501)})),
    e=>e.code==='invalid-argument');
  await assert.rejects(
    app.facilitatorReplyToMessage.run({data:{id:sent.id,reply:'Anonymous'}}),
    e=>e.code==='permission-denied');

  const reply=await app.facilitatorReplyToMessage.run(
    facReq('f1','one',{id:sent.id,reply:'I will attend the meeting.'}));
  assert.ok(reply.id.startsWith('reply_'));
  const secondReply=await app.facilitatorReplyToMessage.run(
    {data:{id:sent.id,reply:'Thank you for the reminder.',_facIdToken:'valid-f1'}});
  assert.ok(secondReply.id.startsWith('reply_'));
  const ownerThread=await app.adminGetFacilitatorMessages.run(adminReq({facilitatorId:'f1'}));
  assert.equal(ownerThread.messages[0].replies.length,2);
  assert.equal(ownerThread.unreadReplies,2);
  assert.equal(ownerThread.messages[0].replies[0].senderName,'Facilitator One');
  assert.equal((await app.facilitatorGetInbox.run(facReq('f2','two'))).messages.length,0);
  assert.equal((await app.facilitatorGetInbox.run(facReq('f1','one'))).unread,0,
    'Sending a reply marks the original message read but not the admin reply.');
  await assert.rejects(app.adminMarkFacilitatorRepliesRead.run(
    adminReq({id:sent.id},'staff')),e=>e.code==='permission-denied');
  await assert.rejects(app.adminMarkFacilitatorRepliesRead.run(adminReq({id:'missing'})),
    e=>e.code==='not-found');
  const acknowledged=await app.adminMarkFacilitatorRepliesRead.run(adminReq({id:sent.id}));
  assert.equal(acknowledged.marked,2);
  const readThread=await app.adminGetFacilitatorMessages.run(adminReq({facilitatorId:'f1'}));
  assert.equal(readThread.unreadReplies,0);
  assert.ok(readThread.messages[0].replies.every(r=>r.readAt));
  assert.equal((await app.adminMarkFacilitatorRepliesRead.run(adminReq({id:sent.id}))).marked,0);

  await assert.rejects(
    app.adminGetFacilitatorMessages.run(adminReq({facilitatorId:'f1'},'staff')),
    e=>e.code==='permission-denied');
  // Bound each conversation so abusive clients cannot grow Firestore documents indefinitely.
  for(let i=0;i<38;i++){
    await app.facilitatorReplyToMessage.run(facReq('f1','one',{
      id:sent.id,reply:'Follow-up '+(i+1)
    }));
  }
  await assert.rejects(
    app.facilitatorReplyToMessage.run(facReq('f1','one',{id:sent.id,reply:'Overflow'})),
    e=>e.code==='failed-precondition');
  assert.equal((await app.facilitatorGetInbox.run(facReq('f1','one'))).messages[0].replies.length,40);
  assert.ok(writes.every(x=>['sdta_facilitator_messages','sdta_admin_audit_archive'].includes(x)));
  const loader=fs.readFileSync(path.resolve(__dirname,'../functions/security-hardening-loader.js'),'utf8');
  assert.ok(loader.includes("require('./facilitator-messaging')"));
  const backups=fs.readFileSync(path.resolve(__dirname,'../functions/backup-collections.js'),'utf8');
  assert.ok(backups.includes("'sdta_facilitator_messages'"));
  const facilitator=fs.readFileSync(path.resolve(__dirname,'../assets/facilitator-inbox.js'),'utf8');
  const owner=fs.readFileSync(path.resolve(__dirname,'../assets/admin-facilitator-messages.js'),'utf8');
  assert.ok(facilitator.includes("facilitatorGetInbox")&&facilitator.includes('Mark as read'));
  assert.ok(owner.includes('adminSendFacilitatorMessage'));
  assert.ok(facilitator.includes('facilitatorReplyToMessage'),'Facilitator reply button is wired');
  assert.ok(owner.includes('adminMarkFacilitatorRepliesRead'),'Admin reply acknowledgement is wired');

  console.log('SkyDream facilitator messaging tests passed: admin authorization, account isolation, inbox, replies, cross-account isolation, owner acknowledgement, token verification and backups.');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
