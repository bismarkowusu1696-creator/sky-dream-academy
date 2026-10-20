(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const call=(name,data={})=>SkyDreamFirebase.call(name,data);
  const err=e=>SkyDreamFirebase.friendlyError(e)||e.message||'Unable to load the conversation.';
  let ready=false,facilitators=[],selected='',busy=false;
  function install(){
    if(ready)return;
    const anchor=$('portalMessageList');
    if(!anchor)return;
    const parent=anchor.parentElement;
    const section=document.createElement('div');
    section.id='portalFacChat';
    section.className='card mt-16';
    section.innerHTML='<h3>Chat with your facilitator</h3>'+
      '<p class="hint">Only facilitators assigned to your current programme can view your messages. Messages are saved in your private portal.</p>'+
      '<div class="field"><label for="studentChatFac">Choose your facilitator</label><select id="studentChatFac"></select></div>'+
      '<div class="toolbar mt-12"><button type="button" class="btn btn-outline btn-small" id="studentChatRefresh">Refresh Conversation</button>'+
      '<span class="hint" id="studentChatUnread"></span>'+'<button type="button" class="btn btn-outline btn-small" id="studentChatClear">Clear conversation</button></div>'+
      '<div id="studentChatHistory" class="grid mt-12" aria-live="polite"></div>'+
      '<div class="field mt-16"><label for="studentChatText">Your message</label>'+
      '<textarea id="studentChatText" rows="3" maxlength="1000" placeholder="Ask about a lesson, assignment, or practical activity"></textarea></div>'+
      '<button type="button" class="btn btn-primary mt-12" id="studentChatSend">Send to Facilitator</button>'+
      '<p class="hint" role="status" id="studentChatStatus"></p>';
    parent.appendChild(section);
    $('studentChatFac').addEventListener('change',()=>{selected=$('studentChatFac').value;showChat();});
    $('studentChatRefresh').addEventListener('click',async()=>{await loadList();await showChat();});
    $('studentChatSend').addEventListener('click',send);
    $('studentChatClear').addEventListener('click',clearChat);
    $('studentChatHistory').addEventListener('click',deleteMessage);
    ready=true;
  }
  const status=(v)=>{if($('studentChatStatus'))$('studentChatStatus').textContent=v;};
  async function loadList(){
    install();
    status('Checking your assigned facilitators…');
    try{
      const result=await call('studentListFacilitatorChats');
      facilitators=result.facilitators||[];
      const allowed=new Set(facilitators.map(f=>f.id));
      if(!allowed.has(selected))selected=facilitators[0]?.id||'';
      const select=$('studentChatFac');
      select.innerHTML=facilitators.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('')||
        '<option value="">No active facilitator assigned</option>';
      select.value=selected;
      $('studentChatSend').disabled=!selected;
      $('studentChatText').disabled=!selected;
      $('studentChatUnread').textContent=(result.threads||[]).reduce((n,t)=>n+(Number(t.unreadStudent)||0),0)+' unread';
      if(!selected){$('studentChatHistory').textContent='No facilitator is currently assigned to your programme. Please contact SkyDream administration.';}
      status('');
    }catch(e){status(err(e));}
  }
  async function showChat(){
    if(!selected)return;
    const history=$('studentChatHistory');
    history.textContent='Loading private conversation…';
    try{
      const result=await call('studentGetFacilitatorChat',{facilitatorId:selected});
      const msgs=result.messages||[];
      history.innerHTML=msgs.map(m=>
        '<div class="card"><div class="dashboard-top"><strong>'+esc(m.senderType==='student'?'You':m.senderName||'Facilitator')+
        '</strong><small class="hint">'+esc(new Date(m.createdAt).toLocaleString('en-GB'))+'</small></div>'+
        '<p class="pre-wrap">'+esc(m.message)+'</p>'+
        '<button type="button" class="btn btn-outline btn-small" data-delete-student-chat="'+esc(m.id)+'">Delete for me</button></div>').join('')||
        '<p class="hint">No messages yet. Send a question to begin the conversation.</p>';
      status('');
    }catch(e){history.textContent=err(e);}
  }
  async function deleteMessage(e){
    const button=e.target.closest('[data-delete-student-chat]');
    if(!button||!selected)return;
    if(!confirm('Remove this message from your own conversation? The facilitator keeps their copy.'))return;
    button.disabled=true;
    try{
      await call('studentDeleteFacilitatorChatMessage',{
        facilitatorId:selected,id:button.dataset.deleteStudentChat});
      await showChat();
      status('Message deleted from your view.');
    }catch(error){status(err(error));button.disabled=false;}
  }
  async function clearChat(){
    if(!selected||!confirm('Clear your conversation with this facilitator? Only your view will be cleared. New messages will still arrive.'))return;
    const button=$('studentChatClear');button.disabled=true;
    try{
      await call('studentClearFacilitatorChat',{facilitatorId:selected});
      await loadList();await showChat();status('Conversation cleared from your view.');
    }catch(error){status(err(error));}finally{button.disabled=false;}
  }
  async function send(){
    if(busy||!selected)return;
    const body=$('studentChatText').value.trim();
    if(!body||body.length>1000){status('Enter a message of up to 1000 characters.');return;}
    busy=true;
    const button=$('studentChatSend');button.disabled=true;
    status('Sending your message…');
    try{
      await call('studentSendFacilitatorChat',{facilitatorId:selected,message:body});
      $('studentChatText').value='';
      await showChat();
      status('Message delivered to your facilitator inbox.');
    }catch(e){status(err(e));}
    finally{busy=false;button.disabled=false;}
  }
  window.addEventListener('skydream-student-portal-ready',async()=>{
    install();await loadList();await showChat();
  });
})();
