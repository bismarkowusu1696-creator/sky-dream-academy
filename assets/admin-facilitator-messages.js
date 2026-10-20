(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const call=(name,data={})=>SkyDreamFirebase.call(name,data);
  let ready=false;
  function build(){
    if(ready)return;ready=true;
    const nav=document.querySelector('#dashboardShell .dashboard-sidebar nav');
    const main=document.querySelector('#dashboardShell .dashboard-main');
    if(!nav||!main)return;
    const a=document.createElement('a');a.href='#facilitatorMessages';a.textContent='Facilitator Messages';
    nav.insertBefore(a,nav.querySelector('a[href="#account"]')||nav.querySelector('button')||null);
    const section=document.createElement('section');section.id='facilitatorMessages';section.className='dashboard-panel';
    section.innerHTML='<h2>Facilitator Messages</h2><p class="hint">Messages sent here appear in the selected facilitator\'s private inbox. Internal Admin Notes remain private and are not delivered.</p>'+
      '<div class="card"><div class="field"><label for="fmRecipient">Facilitator</label><select id="fmRecipient"></select></div>'+
      '<div class="field mt-14"><label for="fmMessage">Message</label><textarea id="fmMessage" rows="4" maxlength="1500" placeholder="Write a private message to the facilitator"></textarea></div>'+
      '<div class="toolbar mt-14"><button id="fmSend" class="btn btn-primary" type="button">Send to Facilitator</button>'+
      '<button id="fmRefresh" class="btn btn-outline" type="button">Refresh</button>'+
      '<button id="fmClear" class="btn btn-outline" type="button">Clear my message history</button></div>'+
      '<p id="fmStatus" class="hint" role="status" aria-live="polite"></p></div>'+
      '<h3 class="mt-18">Messages and replies</h3><p id="fmReplyStatus" class="hint" role="status"></p><div id="fmHistory" class="grid"></div>';
    main.insertBefore(section,$('account')||null);
    $('fmRecipient').addEventListener('change',()=>refresh(false));
    $('fmRefresh').addEventListener('click',()=>refresh(false));
    $('fmSend').addEventListener('click',send);
    $('fmClear').addEventListener('click',async()=>{
      const facilitatorId=$('fmRecipient').value;
      if(!facilitatorId||!confirm('Clear your admin view of messages with this facilitator? The facilitator keeps their messages.'))return;
      $('fmClear').disabled=true;
      try{
        const result=await call('adminClearFacilitatorInbox',{facilitatorId});
        await refresh(false);
        $('fmStatus').textContent=result.cleared+' message(s) hidden from your admin view.'+
          (result.morePossible?' Repeat Clear to hide older messages.':'');
      }catch(e){error(e);}finally{$('fmClear').disabled=false;}
    });
    refresh(true).catch(error);
  }
  function error(e){$('fmStatus').textContent=SkyDreamFirebase.friendlyError(e)||e.message||'Could not load facilitator messages.';}
  async function refresh(initial){
    const selected=initial?'':$('fmRecipient').value;
    const result=await call('adminGetFacilitatorMessages',{facilitatorId:selected});
    const roster=result.facilitators||[];
    if(initial){
      $('fmRecipient').innerHTML=roster.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+' (@'+esc(f.username)+')</option>').join('');
      $('fmSend').disabled=!roster.length;
      if(roster.length)return refresh(false);
    }
    $('fmReplyStatus').textContent=Number(result.unreadReplies||0)+' unread facilitator reply/replies.';
    $('fmHistory').innerHTML=(result.messages||[]).map(m=>{
      const replies=Array.isArray(m.replies)?m.replies:[];
      const unread=replies.filter(r=>!r.readAt).length;
      return '<div class="card"><div class="dashboard-top"><strong>'+esc(m.senderName||'SkyDream Administration')+
        '</strong><small>'+esc(new Date(m.createdAt).toLocaleString('en-GB'))+'</small></div>'+
        '<p class="pre-wrap">'+esc(m.message)+'</p><small class="hint">'+
        (m.readAt?'Read '+esc(new Date(m.readAt).toLocaleString('en-GB')):'Not read yet')+'</small>'+'<button type="button" class="btn btn-outline btn-small" data-admin-delete-fac="'+esc(m.id)+'">Delete for me</button>'+
        (replies.length?'<h4 class="mt-14">Facilitator replies ('+replies.length+')</h4>'+
          replies.map(r=>'<div class="card"><strong>'+esc(r.senderName||'Facilitator')+'</strong>'+
            '<small class="hint"> · '+esc(new Date(r.createdAt).toLocaleString('en-GB'))+'</small>'+
            '<p class="pre-wrap">'+esc(r.message)+'</p><small class="hint">'+
            (r.readAt?'Read':'New reply')+'</small>'+'<button type="button" class="btn btn-outline btn-small" data-admin-delete-fac="'+esc(m.id)+'" data-admin-delete-reply="'+esc(r.id)+'">Delete for me</button></div>').join('')+
          (unread?'<button type="button" class="btn btn-outline btn-small" data-fac-admin-read="'+esc(m.id)+'">Mark '+unread+' reply/replies as read</button>':'')
          :'')+'</div>';
    }).join('')||'<p class="hint">No facilitator inbox messages have been sent to this account.</p>';
  }
  async function send(){
    const facilitatorId=$('fmRecipient').value,message=$('fmMessage').value.trim(),b=$('fmSend');
    if(!facilitatorId||!message){$('fmStatus').textContent='Choose a facilitator and type a message.';return;}
    if(!confirm('Send this message to the selected facilitator inbox?'))return;
    b.disabled=true;$('fmStatus').textContent='Sending…';
    try{await call('adminSendFacilitatorMessage',{facilitatorId,message});
      $('fmMessage').value='';$('fmStatus').textContent='Message saved to the facilitator inbox.';
      await refresh(false);
    }catch(e){error(e);}finally{b.disabled=false;}
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-fac-admin-read]');
    if(!b||!$('facilitatorMessages')?.contains(b))return;
    b.disabled=true;
    try{
      await call('adminMarkFacilitatorRepliesRead',{id:b.dataset.facAdminRead});
      await refresh(false);
    }catch(err){error(err);b.disabled=false;}
  });
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-admin-delete-fac]');
    if(!button||!$('facilitatorMessages')?.contains(button))return;
    if(!confirm('Delete this '+(button.dataset.adminDeleteReply?'reply':'message')+' from your admin view? The facilitator will still see their copy.'))return;
    button.disabled=true;
    try{
      await call('adminDeleteFacilitatorInboxItem',{
        id:button.dataset.adminDeleteFac,replyId:button.dataset.adminDeleteReply||''});
      await refresh(false);
      $('fmStatus').textContent='Removed from your admin view.';
    }catch(err){error(err);button.disabled=false;}
  });
  window.addEventListener('skydream-owner-session-ready',build);
})();
