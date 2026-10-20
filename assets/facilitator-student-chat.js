(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const error=e=>SkyDreamFirebase.friendlyError(e)||e.message||'Unable to load chat.';
  async function call(name,data={}){
    const user=SkyDreamFirebase.auth?.currentUser;
    if(!user)throw new Error('Sign in as a facilitator first.');
    return SkyDreamFirebase.call(name,{...data,_facIdToken:await user.getIdToken(true)});
  }
  let ready=false,selected='',roster=[],busy=false;
  function install(){
    if(ready)return;
    const sidebar=document.querySelector('#facDashboard .dashboard-sidebar nav');
    const main=document.querySelector('#facDashboard .dashboard-main');
    if(!sidebar||!main)return;
    const link=document.createElement('a');link.href='#facStudentChats';link.textContent='Student Chats';
    sidebar.insertBefore(link,sidebar.querySelector('button')||null);
    const section=document.createElement('section');
    section.className='dashboard-panel';section.id='facStudentChats';
    section.innerHTML='<h2>Student Chats</h2><p class="hint">Private conversations with students in your assigned current-intake programmes.</p>'+
      '<div class="field"><label for="facChatStudent">Student</label><select id="facChatStudent"></select></div>'+
      '<div class="toolbar mt-12"><button type="button" class="btn btn-outline btn-small" id="facChatRefresh">Refresh Chats</button>'+
      '<span class="hint" id="facChatUnread"></span></div>'+
      '<div id="facChatHistory" class="grid mt-12" aria-live="polite"></div>'+
      '<div class="field mt-16"><label for="facChatText">Message</label>'+
      '<textarea id="facChatText" rows="3" maxlength="1000" placeholder="Reply to the student or send course guidance"></textarea></div>'+
      '<button type="button" class="btn btn-primary mt-12" id="facChatSend">Send to Student</button>'+
      '<p id="facChatStatus" class="hint" role="status"></p>';
    main.appendChild(section);
    $('facChatStudent').addEventListener('change',()=>{selected=$('facChatStudent').value;showChat();});
    $('facChatRefresh').addEventListener('click',async()=>{await loadList();await showChat();});
    $('facChatSend').addEventListener('click',send);
    ready=true;
  }
  const status=t=>{if($('facChatStatus'))$('facChatStatus').textContent=t;};
  async function loadList(){
    install();
    status('Checking assigned student conversations…');
    try{
      const response=await call('facilitatorListStudentChats');
      roster=response.roster||[];
      if(!roster.some(s=>s.id===selected))selected=roster[0]?.id||'';
      const sel=$('facChatStudent');
      sel.innerHTML=roster.map(s=>
        '<option value="'+esc(s.id)+'">'+esc(s.name)+' · '+esc(s.regNumber)+'</option>').join('')||
        '<option value="">No enrolled students</option>';
      sel.value=selected;
      $('facChatSend').disabled=!selected;
      $('facChatText').disabled=!selected;
      $('facChatUnread').textContent=(response.threads||[]).reduce((n,t)=>
        n+(Number(t.unreadFacilitator)||0),0)+' unread';
      if(!selected)$('facChatHistory').textContent='No active students are assigned to your current programme.';
      status('');
    }catch(e){status(error(e));}
  }
  async function showChat(){
    if(!selected)return;
    const history=$('facChatHistory');history.textContent='Loading student messages…';
    try{
      const response=await call('facilitatorGetStudentChat',{studentId:selected});
      const msgs=response.messages||[];
      history.innerHTML=msgs.map(m=>
        '<div class="card"><div class="dashboard-top"><strong>'+esc(m.senderType==='facilitator'?'You':m.senderName||'Student')+
        '</strong><small class="hint">'+esc(new Date(m.createdAt).toLocaleString('en-GB'))+'</small></div>'+
        '<p class="pre-wrap">'+esc(m.message)+'</p></div>').join('')||
        '<p class="hint">No messages yet. Send a course-related message to begin.</p>';
      status('');
    }catch(e){history.textContent=error(e);}
  }
  async function send(){
    if(busy||!selected)return;
    const body=$('facChatText').value.trim();
    if(!body||body.length>1000){status('Enter a message of up to 1000 characters.');return;}
    busy=true;const b=$('facChatSend');b.disabled=true;status('Sending…');
    try{
      await call('facilitatorSendStudentChat',{studentId:selected,message:body});
      $('facChatText').value='';
      await showChat();
      status('Your message is available in the student portal.');
    }catch(e){status(error(e));}finally{busy=false;b.disabled=false;}
  }
  window.addEventListener('skydream-facilitator-dashboard-ready',async()=>{
    install();await loadList();await showChat();
  });
  window.addEventListener('skydream-facilitator-open-student-chat',async e=>{
    install();
    const studentId=e.detail?.studentId||'';
    await loadList();
    if(roster.some(s=>s.id===studentId)){
      selected=studentId;$('facChatStudent').value=selected;await showChat();
      location.hash='#facStudentChats';
      $('facChatText').focus();
    }
  });
})();
