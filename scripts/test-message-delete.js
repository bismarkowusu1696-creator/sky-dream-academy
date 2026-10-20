'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../functions/academic-portal-loader.js'),'utf8');
const sectionStart=source.indexOf('function publicMessage(doc){');
const sectionEnd=source.indexOf('async function sendPushToStudents(',sectionStart);
const deleteStart=source.indexOf('// Hide one student portal announcement');
const deleteEnd=source.indexOf('app.adminPreviewBulkStudentMessage=onCall(',deleteStart);
assert.ok(sectionStart>0&&sectionEnd>sectionStart&&deleteStart>sectionEnd&&deleteEnd>deleteStart,
  'Student portal message handling source must exist and be verifiable.');
const docs=new Map(),writes=[];
const clone=v=>JSON.parse(JSON.stringify(v));
const idref=(collection,id)=>({
  collection,id,async get(){
    const key=collection+'/'+id;
    return{exists:docs.has(key),id,data:()=>clone(docs.get(key))};
  }
});
const db={
  collection(collection){return{
    doc(id){return idref(collection,id);},
    where(field,operator,value){
      assert.equal(operator,'==');
      let sort=false,max=100;
      const query={
        orderBy(field,direction){assert.equal(field,'createdAt');assert.equal(direction,'desc');sort=true;return query;},
        limit(n){max=n;return query;},
        async get(){
          let entries=[...docs].filter(([k,v])=>k.startsWith(collection+'/')&&v[field]===value);
          if(sort)entries.sort((a,b)=>String(b[1].createdAt).localeCompare(String(a[1].createdAt)));
          entries=entries.slice(0,max);
          return{docs:entries.map(([k,v])=>({id:k.slice(collection.length+1),data:()=>clone(v)}))};
        }
      };
      return query;
    }
  };},
  async runTransaction(cb){
    const pending=[];
    const tx={
      get:ref=>ref.get(),
      update(ref,record){pending.push([ref,record]);}
    };
    await cb(tx);
    for(const [ref,record]of pending){
      const key=ref.collection+'/'+ref.id;
      docs.set(key,{...docs.get(key),...clone(record)});writes.push(ref.id);
    }
  }
};
const COLLECTION='sdta_student_messages';
docs.set(COLLECTION+'/m1',{studentId:'s1',message:'Welcome student 1',createdAt:'2026-10-20T12:00:00Z',senderType:'admin',active:true,readAt:''});
docs.set(COLLECTION+'/m2',{studentId:'s1',message:'Lesson reminder',createdAt:'2026-10-20T13:00:00Z',senderType:'facilitator',active:true,readAt:''});
docs.set(COLLECTION+'/m3',{studentId:'s2',message:'Welcome student 2',createdAt:'2026-10-20T14:00:00Z',senderType:'admin',active:true,readAt:''});
const app={},HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
const context={
  app,db,HttpsError,COL:{studentMessages:COLLECTION},KEYS:{students:'sdta_students'},
  onCall:(config,run)=>({config,run}),
  clean:(v,max)=>String(v==null?'':v).trim().slice(0,max),
  requireStudent:request=>{
    const auth=request.auth,token=auth&&auth.token;
    if(!auth||token.role!=='student'||auth.uid!=='student-'+token.studentId)throw new HttpsError('permission-denied','Student sign-in required.');
    return token;
  },
  requireAdmin:async request=>{
    if(!request.auth||request.auth.role!=='admin')throw new HttpsError('permission-denied','Admin required.');
    return{username:'owner'};
  },
  readValue:async()=>[{id:'s1'},{id:'s2'}],
  Promise,console
};
vm.runInNewContext(source.slice(sectionStart,sectionEnd)+source.slice(deleteStart,deleteEnd)+
  '\napp.testListMessages=latestStudentMessages;',context,{timeout:1500});
const request=(id,data={})=>({data,auth:{uid:'student-'+id,token:{role:'student',studentId:id}}});
const adminRequest=(data={})=>({data,auth:{role:'admin'}});
async function main(){
  for(const action of ['studentDeletePortalMessage','adminDeleteStudentPortalMessage'])
    assert.equal(app[action].config.enforceAppCheck,true);
  assert.equal((await app.testListMessages('s1','student')).length,2);
  await assert.rejects(app.studentDeletePortalMessage.run(request('s2',{id:'m1'})),
    error=>error.code==='not-found');
  await assert.rejects(app.studentDeletePortalMessage.run({
    data:{id:'m1'},auth:{uid:'student-s2',token:{role:'student',studentId:'s1'}}
  }),error=>error.code==='permission-denied');
  await assert.rejects(app.adminDeleteStudentPortalMessage.run({
    data:{studentId:'s1',id:'m1'}
  }),error=>error.code==='permission-denied');
  await assert.rejects(app.adminDeleteStudentPortalMessage.run(
    adminRequest({studentId:'s2',id:'m1'})),error=>error.code==='not-found');
  const deleted=await app.studentDeletePortalMessage.run(request('s1',{id:'m1'}));
  assert.equal(deleted.removed,true);
  assert.equal((await app.testListMessages('s1','student')).length,1);
  assert.equal((await app.testListMessages('s1','admin')).length,2,
    'Admin must retain message after student deletes it');
  assert.equal((await app.studentDeletePortalMessage.run(request('s1',{id:'m1'}))).removed,false);
  const adminDeleted=await app.adminDeleteStudentPortalMessage.run(
    adminRequest({studentId:'s1',id:'m2'}));
  assert.equal(adminDeleted.removed,true);
  assert.equal((await app.testListMessages('s1','admin')).length,1);
  assert.equal((await app.testListMessages('s1','student')).length,1,
    'Student must retain their own copy after admin hides it');
  assert.equal((await app.testListMessages('s2','student')).length,1);
  assert.equal(writes.length,2,'Repeated deletion must not write twice');
  console.log('SkyDream student portal deletion tests passed: recipient isolation, account permissions and non-destructive inbox cleanup.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
