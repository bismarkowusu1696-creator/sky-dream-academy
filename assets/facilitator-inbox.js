(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  let ready=false;
  function createInbox(){
    if(ready)return;ready=true;
    const sidebar=document.querySelector('#facDashboard .dashboard-sidebar nav');
    const main=document.querySelector('#facDashboard .dashboard-main');
    if(!sidebar||!main)return;
    const nav=document.createElement('a');nav.href='#facInbox';nav.id='facInboxNav';nav.textContent='Messages';
    sidebar.insertBefore(nav,sidebar.querySelector('button')||null);
    const section=document.createElement('section');section.className='dashboard-panel';section.id='facInbox';
    section.innerHTML='<h2>Messages from SkyDream Administration <span id="facInboxBadge" class="badge">0 unread</span></h2>'+
      '<p class="hint">Private messages sent to your facilitator account. These are not messages from students.</p>'+
      '<button id="facInboxRefresh" class="btn btn-outline btn-small" type="button">Refresh Messages</button>'+
      '<p id="facInboxStatus" class="hint" role="status" aria-live="polite"></p>'+
      '<div id="facInboxItems" class="grid mt-16"></div>';
    main.appendChild(section);
    $('facInboxRefresh').addEventListener('click',refresh);
  }
  async function call(name,data={}){
    const user=SkyDreamFirebase.auth?.currentUser;
    if(!user)throw new Error('Please sign in as a facilitator.');
    const token=await user.getIdToken(true);
    return SkyDreamFirebase.call(name,{...data,_facIdToken:token});
  }
  async function refresh(){
    createInbox();
    const label=$('facInboxStatus');
    label.textContent='Checking your inbox…';
    try{
      const result=await call('facilitatorGetInbox');
      $('facInboxBadge').textContent=String(Number(result.unread)||0)+' unread';
      const items=result.messages||[];
      $('facInboxItems').innerHTML=items.map(m=>{
        const date=new Date(m.createdAt).toLocaleString('en-GB');
        return '<div class="card"><div class="dashboard-top"><strong>'+esc(m.senderName||'SkyDream Administration')+'</strong>'+
          '<span class="badge">'+(m.readAt?'Read':'Unread')+'</span></div>'+
          '<p class="hint">'+esc(date)+'</p><p class="pre-wrap">'+esc(m.message)+'</p>'+
          (m.readAt?'':'<button class="btn btn-outline btn-small" type="button" data-inbox-read="'+esc(m.id)+'">Mark as read</button>')+
          '<div class="mt-14">'+(Array.isArray(m.replies)?m.replies.map(r=>
            '<div class="card"><small class="hint">'+esc(r.senderName||'Your reply')+' · '+esc(new Date(r.createdAt).toLocaleString('en-GB'))+'</small>'+
            '<p class="pre-wrap">'+esc(r.message)+'</p><small class="hint">'+(r.readAt?'Seen by Main Admin':'Awaiting Main Admin review')+'</small></div>'
          ).join(''):'')+'</div>'+
          '<details class="mt-14"><summary>Reply to this message</summary>'+
          '<label class="block-my-8" for="facReply_'+esc(m.id)+'">Your private reply</label>'+
          '<textarea id="facReply_'+esc(m.id)+'" data-fac-reply-input rows="3" maxlength="1500" placeholder="Type your reply to the Main Admin"></textarea>'+
          '<div class="toolbar mt-8"><button type="button" class="btn btn-primary btn-small" data-send-fac-reply="'+esc(m.id)+'">Send Reply</button></div>'+
          '</details></div>';
      }).join('')||'<p class="hint">No messages from the administration yet.</p>';
      label.textContent=items.length+' message(s) in your inbox.';
    }catch(err){label.textContent=SkyDreamFirebase.friendlyError(err)||err.message||'Could not load messages.';}
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-inbox-read]');if(!b)return;
    b.disabled=true;
    try{await call('facilitatorMarkInboxRead',{id:b.dataset.inboxRead});await refresh();}
    catch(err){alert(SkyDreamFirebase.friendlyError(err)||err.message);b.disabled=false;}
  });
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-send-fac-reply]');
    if(!button)return;
    const textarea=button.closest('details')?.querySelector('[data-fac-reply-input]');
    const reply=textarea?.value.trim()||'';
    if(!reply||reply.length>1500){alert('Enter a reply of up to 1500 characters.');return;}
    button.disabled=true;
    const original=button.textContent;button.textContent='Sending…';
    try{
      await call('facilitatorReplyToMessage',{id:button.dataset.sendFacReply,reply});
      await refresh();
      $('facInboxStatus').textContent='Your reply has been sent to the Main Admin.';
    }catch(err){
      alert(SkyDreamFirebase.friendlyError(err)||err.message);
      button.disabled=false;button.textContent=original;
    }
  });
  window.addEventListener('skydream-facilitator-dashboard-ready',refresh);
})();
