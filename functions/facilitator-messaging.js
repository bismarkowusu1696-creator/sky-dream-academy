'use strict';
// Private admin -> facilitator messages are separate from INTERNAL admin notes.
// Each message is scoped to an immutable facilitator account id.
module.exports=function installFacilitatorMessaging(app,{onCall,HttpsError,db,admin,crypto,requireStrongAdminSession}){
  const MESSAGES='sdta_facilitator_messages',STORAGE='sdta_storage';
  const clean=(v,n)=>String(v==null?'':v).trim().slice(0,n);
  async function roster(){
    const snap=await db.collection(STORAGE).doc('sdta_facilitators').get();
    let list=[];
    try{list=snap.exists?JSON.parse(snap.data().value||'[]'):[];}catch(_){}
    if(!Array.isArray(list))throw new HttpsError('internal','Facilitator directory could not be loaded.');
    return list;
  }
  async function owner(request){
    const {account}=await requireStrongAdminSession(request);
    if((account.role||'staff')!=='owner')
      throw new HttpsError('permission-denied','Main Admin access is required.');
    return account;
  }
  async function facilitator(request){
    let auth=request.auth;
    if(!(auth&&auth.uid&&auth.token?.role==='facilitator'&&auth.token?.username)){
      const idToken=clean(request.data?._facIdToken,5000);
      if(!idToken)throw new HttpsError('permission-denied','Sign in as a facilitator to view messages.');
      try{
        const token=await admin.auth().verifyIdToken(idToken);
        auth={uid:token.uid,token};
      }catch(_){throw new HttpsError('permission-denied','Facilitator session expired. Please sign in again.');}
    }
    const token=auth.token;
    if(token.role!=='facilitator'||!token.username)
      throw new HttpsError('permission-denied','Facilitator access is required.');
    const fac=(await roster()).find(f=>auth.uid==='fac-'+f.id&&
      String(f.username||'').toLowerCase()===String(token.username).toLowerCase());
    if(!fac||fac.active===false)
      throw new HttpsError('permission-denied','This facilitator account is not active.');
    return fac;
  }
  async function messagesFor(facilitatorId,viewer){
    const snap=await db.collection(MESSAGES).where('facilitatorId','==',facilitatorId).limit(200).get();
    const hidden=viewer==='admin'?'hiddenForAdmin':'hiddenForFacilitator';
    return snap.docs.map(doc=>({id:doc.id,...doc.data()}))
      .filter(m=>m.active!==false&&m[hidden]!==true)
      .map(m=>({...m,replies:(Array.isArray(m.replies)?m.replies:[])
        .filter(r=>r&&r[hidden]!==true)}))
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
      .slice(0,100);
  }
  app.adminGetFacilitatorMessages=onCall({enforceAppCheck:true},async request=>{
    await owner(request);
    const list=await roster(),facilitators=list.filter(f=>f.active!==false).map(f=>({
      id:f.id,name:f.name||f.username,username:f.username,courses:Array.isArray(f.courses)?f.courses:[]
    }));
    const facilitatorId=clean(request.data?.facilitatorId,140);
    if(!facilitatorId)return{facilitators,messages:[]};
    if(!list.some(f=>f.id===facilitatorId))
      throw new HttpsError('not-found','Facilitator no longer exists.');
    const messages=await messagesFor(facilitatorId,'admin');
    return{facilitators,messages,unreadReplies:messages.reduce((total,m)=>
      total+(Array.isArray(m.replies)?m.replies.filter(r=>!r.readAt).length:0),0)};
  });
  app.adminSendFacilitatorMessage=onCall({enforceAppCheck:true},async request=>{
    const account=await owner(request),d=request.data||{};
    const facilitatorId=clean(d.facilitatorId,140),message=clean(d.message,1500);
    if(!facilitatorId||!message||String(d.message||'').trim().length>1500)
      throw new HttpsError('invalid-argument','Choose a facilitator and enter a message (maximum 1500 characters).');
    const fac=(await roster()).find(f=>f.id===facilitatorId&&f.active!==false);
    if(!fac)throw new HttpsError('not-found','The selected facilitator is not active.');
    const now=new Date().toISOString(),ref=db.collection(MESSAGES).doc();
    const audit=db.collection('sdta_admin_audit_archive').doc('audit_'+crypto.randomUUID());
    const record={facilitatorId:fac.id,facilitatorUsername:fac.username,
      message,createdAt:now,senderName:account.name||'SkyDream Administration',
      senderUsername:account.username,active:true,readAt:''};
    const batch=db.batch();
    batch.set(ref,record);
    batch.set(audit,{id:audit.id,action:'Sent facilitator inbox message',
      facilitatorId:fac.id,facilitatorUsername:fac.username,admin:account.username,
      date:now,messageId:ref.id});
    await batch.commit();
    return{ok:true,id:ref.id,createdAt:now};
  });
  app.facilitatorGetInbox=onCall({enforceAppCheck:true},async request=>{
    const fac=await facilitator(request);
    const messages=await messagesFor(fac.id,'facilitator');
    return{messages,unread:messages.filter(m=>!m.readAt).length};
  });
  app.facilitatorMarkInboxRead=onCall({enforceAppCheck:true},async request=>{
    const fac=await facilitator(request),id=clean(request.data?.id,140);
    if(!id)throw new HttpsError('invalid-argument','Select a message to mark read.');
    const ref=db.collection(MESSAGES).doc(id);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists||snap.data().facilitatorId!==fac.id||snap.data().active===false||snap.data().hiddenForFacilitator===true)
        throw new HttpsError('not-found','Message not found.');
      if(!snap.data().readAt)tx.update(ref,{readAt:new Date().toISOString()});
    });
    return{ok:true};
  });
  // Facilitator replies are linked to an existing message rather than
  // published as admin-only notes. All changes use a Firestore transaction.
  app.facilitatorReplyToMessage=onCall({enforceAppCheck:true},async request=>{
    const fac=await facilitator(request),id=clean(request.data?.id,140);
    const raw=String(request.data?.reply==null?'':request.data.reply);
    const reply=raw.trim();
    if(!id||!reply||reply.length>1500||raw.length>1600)
      throw new HttpsError('invalid-argument','Choose a message and enter a reply of up to 1500 characters.');
    const ref=db.collection(MESSAGES).doc(id);
    const now=new Date().toISOString(),replyId='reply_'+crypto.randomUUID();
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists||snap.data().active===false||snap.data().facilitatorId!==fac.id||snap.data().hiddenForFacilitator===true)
        throw new HttpsError('not-found','Message not found in your inbox.');
      const data=snap.data();
      const replies=Array.isArray(data.replies)?data.replies:[];
      if(replies.length>=40)
        throw new HttpsError('failed-precondition','This conversation is full. Ask the administrator to start a new message.');
      tx.update(ref,{replies:[...replies,{
        id:replyId,message:reply,createdAt:now,facilitatorId:fac.id,
        senderName:fac.name||fac.username,readAt:''
      }],readAt:data.readAt||now});
    });
    return{ok:true,id:replyId,createdAt:now};
  });

  // Owner manually acknowledges unread facilitator replies. Existing
  // facilitator read receipts remain completely independent.
  app.adminMarkFacilitatorRepliesRead=onCall({enforceAppCheck:true},async request=>{
    await owner(request);
    const id=clean(request.data?.id,140);
    if(!id)throw new HttpsError('invalid-argument','Select a message.');
    const ref=db.collection(MESSAGES).doc(id);
    let marked=0;
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists||snap.data().active===false)
        throw new HttpsError('not-found','Facilitator message not found.');
      const data=snap.data(),replies=Array.isArray(data.replies)?data.replies:[];
      marked=replies.filter(r=>!r.readAt&&r.hiddenForAdmin!==true).length;
      if(marked){
        const when=new Date().toISOString();
        tx.update(ref,{replies:replies.map(r=>r.readAt||r.hiddenForAdmin===true?r:{...r,readAt:when})});
      }
    });
    return{ok:true,marked};
  });

  // Delete for me: retain the recipient's copy and the original message in
  // Firestore backups. A reply may also be hidden without hiding the thread.
  async function hideForViewer(request,viewer){
    const account=viewer==='admin'?await owner(request):await facilitator(request);
    const id=clean(request.data?.id,140),replyId=clean(request.data?.replyId,140);
    if(!id)throw new HttpsError('invalid-argument','Select the message you want to delete.');
    const ref=db.collection(MESSAGES).doc(id),hiddenKey=
      viewer==='admin'?'hiddenForAdmin':'hiddenForFacilitator';
    let removed=false;
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists||snap.data().active===false||
        (viewer==='facilitator'&&snap.data().facilitatorId!==account.id))
        throw new HttpsError('not-found','The selected message was not found in your inbox.');
      const data=snap.data();
      if(replyId){
        const replies=Array.isArray(data.replies)?data.replies:[];
        if(!replies.some(r=>r.id===replyId&&r[hiddenKey]!==true))
          throw new HttpsError('not-found','The selected reply was not found.');
        tx.update(ref,{replies:replies.map(r=>r.id===replyId?
          {...r,[hiddenKey]:true}:r)});
      }else{
        if(data[hiddenKey]===true)return;
        tx.update(ref,{[hiddenKey]:true,
          [viewer==='admin'?'hiddenByAdminAt':'hiddenByFacilitatorAt']:new Date().toISOString()});
      }
      removed=true;
    });
    return{ok:true,removed};
  }
  app.adminDeleteFacilitatorInboxItem=onCall({enforceAppCheck:true},async request=>
    hideForViewer(request,'admin'));
  app.facilitatorDeleteInboxItem=onCall({enforceAppCheck:true},async request=>
    hideForViewer(request,'facilitator'));

  async function clearVisibleInbox(request,viewer){
    const account=viewer==='admin'?await owner(request):await facilitator(request);
    const facilitatorId=viewer==='admin'?clean(request.data?.facilitatorId,140):account.id;
    if(viewer==='admin'&&!(await roster()).some(f=>f.id===facilitatorId))
      throw new HttpsError('not-found','Select a valid facilitator.');
    const messages=await messagesFor(facilitatorId,viewer);
    if(!messages.length)return{ok:true,cleared:0};
    const hidden=viewer==='admin'?'hiddenForAdmin':'hiddenForFacilitator';
    const batch=db.batch();
    for(const m of messages){
      batch.update(db.collection(MESSAGES).doc(m.id),{
        [hidden]:true,
        [viewer==='admin'?'hiddenByAdminAt':'hiddenByFacilitatorAt']:new Date().toISOString()
      });
    }
    await batch.commit();
    return{ok:true,cleared:messages.length,morePossible:messages.length===100};
  }
  app.adminClearFacilitatorInbox=onCall({enforceAppCheck:true},async request=>
    clearVisibleInbox(request,'admin'));
  app.facilitatorClearInbox=onCall({enforceAppCheck:true},async request=>
    clearVisibleInbox(request,'facilitator'));

};
