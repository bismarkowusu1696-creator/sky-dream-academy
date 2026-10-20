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
      '<button id="fmRefresh" class="btn btn-outline" type="button">Refresh</button></div>'+
      '<p id="fmStatus" class="hint" role="status" aria-live="polite"></p></div>'+
      '<h3 class="mt-18">Messages sent to this facilitator</h3><div id="fmHistory" class="grid"></div>';
    main.insertBefore(section,$('account')||null);
    $('fmRecipient').addEventListener('change',()=>refresh(false));
    $('fmRefresh').addEventListener('click',()=>refresh(false));
    $('fmSend').addEventListener('click',send);
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
    $('fmHistory').innerHTML=(result.messages||[]).map(m=>'<div class="card"><div class="dashboard-top"><strong>'+esc(m.senderName||'SkyDream Administration')+'</strong><small>'+esc(new Date(m.createdAt).toLocaleString('en-GB'))+'</small></div><p class="pre-wrap">'+esc(m.message)+'</p><small class="hint">'+(m.readAt?'Read '+esc(new Date(m.readAt).toLocaleString('en-GB')):'Not read yet')+'</small></div>').join('')||'<p class="hint">No facilitator inbox messages have been sent to this account.</p>';
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
  window.addEventListener('skydream-owner-session-ready',build);
})();
