(() => {
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const call=(name,data={})=>SkyDreamFirebase.call(name,data);
  const today=()=>new Date().toISOString().slice(0,10);
  const date=v=>{const d=new Date(v||'');return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-GB',{timeZone:'Africa/Accra'});};
  let desk=null,info=null,prevUnread=null,busy=null;
  const students=()=>desk&&Array.isArray(desk.students)?desk.students:[];
  const courses=()=>desk&&desk.courses||{};
  const msg=(t,type='info')=>{const el=$('deskOperationsNotice');el.textContent=t;el.className='notice notice-'+type;};
  const studentOptions=rows=>rows.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.fullName)+' — '+esc(s.regNumber)+'</option>').join('');
  function filterStudents(){
    const q=$('deskStudentSearch').value.trim().toLowerCase(),rows=students().filter(s=>
      !q||[s.fullName,s.regNumber,s.mobile].some(v=>String(v||'').toLowerCase().includes(q)));
    const selected=$('deskStudentSelect').value;
    $('deskStudentSelect').innerHTML=studentOptions(rows);
    if(rows.some(s=>s.id===selected))$('deskStudentSelect').value=selected;
    showStudentTracking();
  }
  function showStudentTracking(){
    const x=info&&info.workflow&&info.workflow[$('deskStudentSelect').value]||{};
    $('deskVerification').value=x.verification||'Pending review';
    $('deskFollowup').value=x.followUp||'Not contacted';
    $('deskFollowupDate').value=x.followUpDate||'';
    $('deskFollowupNote').value=x.note||'';
  }
  function renderTracking(){
    filterStudents();
    const flow=info.workflow||{},need=students().filter(s=>{
      const x=flow[s.id]||{};
      return x.verification==='Needs correction'||x.followUp==='Callback needed'||
        (x.followUpDate&&x.followUpDate<=today()&&x.followUp!=='Orientation confirmed');
    });
    $('deskPendingTable').innerHTML=need.length?
      '<table class="table"><thead><tr><th>Student</th><th>Verification</th><th>Follow-up</th><th>Due</th><th>Action</th></tr></thead><tbody>'+
      need.slice(0,100).map(s=>{const x=flow[s.id]||{};
        return '<tr><td>'+esc(s.fullName)+'</td><td>'+esc(x.verification||'Pending review')+'</td><td>'+
        esc(x.followUp||'Not contacted')+'</td><td>'+esc(x.followUpDate||'—')+'</td><td>'+
        '<button type="button" class="btn btn-outline btn-small" data-workflow-focus="'+esc(s.id)+'">Review</button></td></tr>';
      }).join('')+'</tbody></table>':'<p>No corrections or callbacks require attention.</p>';
  }
  function renderCapacity(){
    const cap=info.capacity||{};
    $('deskCapacityTable').innerHTML='<table class="table"><thead><tr><th>Program</th><th>Enrolled</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead><tbody>'+
      Object.entries(cap).map(([id,x])=>{
        const n=Number(x.available)||0;
        return '<tr><td>'+esc(courses()[id]||id)+'</td><td>'+Number(x.used||0)+'</td><td>'+Number(x.limit||0)+
          '</td><td>'+n+'</td><td>'+esc(n===0?'Full':n<=3?'Nearly full':'Available')+'</td></tr>';
      }).join('')+'</tbody></table>';
    const fresh=info.newRegistrations||[];
    $('deskAlertBadge').textContent=String(info.unreadCount||0);
    $('deskAlertBadge').classList.toggle('hidden',!info.unreadCount);
    $('deskNewRegistrations').innerHTML=fresh.length?
      '<table class="table"><thead><tr><th>Received</th><th>Student</th><th>Program</th></tr></thead><tbody>'+
      fresh.map(s=>'<tr><td>'+esc(date(s.date))+'</td><td>'+esc(s.fullName)+'</td><td>'+
        esc(courses()[s.course]||s.course)+'</td></tr>').join('')+'</tbody></table>':
      '<p>No unread registration alerts.</p>';
  }
  function renderOnboarding(){
    const state=info.onboarding||{},fac=desk.facilitators||[];
    const option=(value,label,x)=>'<label class="check-row"><input data-onboard-flag="'+value+'" type="checkbox"'+
      (x[value]?' checked':'')+'> '+esc(label)+'</label>';
    $('deskOnboardingCards').innerHTML=fac.length?fac.map(f=>{
      const x=state[f.id]||{};
      return '<div class="card" data-onboard-id="'+esc(f.id)+'"><h3>'+esc(f.name)+'</h3><p class="hint">@'+esc(f.username)+'</p>'+
        option('instructionsSent','Login instructions sent',x)+
        option('availabilityConfirmed','Availability confirmed',x)+
        option('orientationCompleted','Orientation completed',x)+
        '<p class="hint">'+(x.updatedAt?'Updated '+esc(date(x.updatedAt)):'Not yet tracked')+'</p>'+
        '<button type="button" class="btn btn-outline btn-small" data-save-onboard="'+esc(f.id)+'">Save onboarding</button></div>';
    }).join(''):'<p>No facilitators to onboard yet.</p>';
  }
  function previewMessage(){
    const s=students().find(x=>x.id===$('deskMessageStudent').value),
      t=(info.templates||[]).find(x=>x.id===$('deskMessageTemplate').value);
    if(!s||!t){$('deskMessagePreview').textContent='Choose a student and approved template.';return;}
    const vars={student:s.fullName||'',program:courses()[s.course]||s.course||'',
      registration:s.regNumber||'',orientation_date:desk.intakeStart||''};
    $('deskMessagePreview').textContent=t.body.replace(/\{\{(student|program|registration|orientation_date)\}\}/g,
      (_,key)=>vars[key]);
  }
  function renderMessages(){
    const previousStudent=$('deskMessageStudent').value,previousTemplate=$('deskMessageTemplate').value,
      templates=info.templates||[];
    $('deskMessageStudent').innerHTML=studentOptions(students());
    if(students().some(s=>s.id===previousStudent))$('deskMessageStudent').value=previousStudent;
    $('deskMessageTemplate').innerHTML=templates.length?
      templates.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.title)+'</option>').join(''):
      '<option value="">No approved templates yet</option>';
    if(templates.some(t=>t.id===previousTemplate))$('deskMessageTemplate').value=previousTemplate;
    $('deskTemplateSend').disabled=!templates.length||!students().length;
    previewMessage();
    const audits=info.ownAudit||[];
    $('deskOwnActivity').innerHTML=audits.length?
      '<table class="table"><thead><tr><th>When</th><th>Action</th><th>Record</th></tr></thead><tbody>'+
      audits.map(a=>'<tr><td>'+esc(date(a.date))+'</td><td>'+esc(a.action)+'</td><td>'+
        esc(a.target||'—')+'</td></tr>').join('')+'</tbody></table>':'<p>No recorded staff activity yet.</p>';
  }
  function dailyData(){
    const day=$('deskDailyDate').value||today(),selected=students().filter(s=>String(s.regDate||'').slice(0,10)===day),
      workflow=info&&info.workflow||{},perProgram={};
    for(const s of selected){
      const id=s.course||'Unspecified';
      const item=perProgram[id]||(perProgram[id]={total:0,registered:0,cancelled:0,verified:0,corrections:0,callbacks:0});
      const tracking=workflow[s.id]||{};
      item.total++;
      if(s.status==='Cancelled')item.cancelled++;else item.registered++;
      if(tracking.verification==='Verified')item.verified++;
      if(tracking.verification==='Needs correction')item.corrections++;
      if(tracking.followUp==='Callback needed')item.callbacks++;
    }
    return{day,selected,perProgram};
  }
  function renderDaily(){
    const result=dailyData();
    $('deskDailyPreview').innerHTML='<p><strong>'+result.selected.length+'</strong> registrations received on '+esc(result.day)+
      ' (other statuses are current, not historical).</p>'+
      (Object.keys(result.perProgram).length?'<table class="table"><thead><tr><th>Program</th><th>New</th><th>Verified</th><th>Needs correction</th><th>Callbacks</th></tr></thead><tbody>'+
        Object.entries(result.perProgram).map(([id,v])=>'<tr><td>'+esc(courses()[id]||id)+'</td><td>'+v.total+
          '</td><td>'+v.verified+'</td><td>'+v.corrections+'</td><td>'+v.callbacks+'</td></tr>').join('')+
        '</tbody></table>':'<p>No registrations on this date.</p>');
  }
  const csvCell=value=>{let s=String(value==null?'':value).replace(/^\s+/,'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  function csvDownload(filename,rows){
    const file='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'),
      url=URL.createObjectURL(new Blob([file],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=filename;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  async function refresh(){
    if(!desk||busy)return busy;
    busy=(async()=>{
      const latest=await call('adminDeskGetInsights');
      if(prevUnread!==null&&latest.unreadCount>prevUnread&&
        !$('registrationStaffShell').classList.contains('hidden')){
        msg('New registrations have arrived. Open Capacity & Alerts to review them.','info');
      }
      prevUnread=latest.unreadCount;info=latest;
      renderTracking();renderCapacity();renderOnboarding();renderMessages();renderDaily();
    })();
    try{return await busy;}finally{busy=null;}
  }
  function safeRefresh(){return refresh().catch(e=>msg(SkyDreamFirebase.friendlyError(e),'error'));}
  function bind(){
    $('deskDailyDate').value=today();
    $('deskStudentSearch').addEventListener('input',filterStudents);
    $('deskStudentSelect').addEventListener('change',showStudentTracking);
    $('deskTrackingForm').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!$('deskStudentSelect').value)return;
      const button=$('deskTrackingSave');button.disabled=true;
      try{
        await call('adminDeskSaveTracking',{studentId:$('deskStudentSelect').value,
          verification:$('deskVerification').value,followUp:$('deskFollowup').value,
          followUpDate:$('deskFollowupDate').value,note:$('deskFollowupNote').value});
        await refresh();msg('Verification and follow-up saved.','success');
      }catch(e){msg(SkyDreamFirebase.friendlyError(e),'error');}finally{button.disabled=false;}
    });
    $('deskPendingTable').addEventListener('click',event=>{
      const b=event.target.closest('[data-workflow-focus]');if(!b)return;
      $('deskStudentSearch').value='';filterStudents();
      $('deskStudentSelect').value=b.dataset.workflowFocus;showStudentTracking();
      location.hash='deskWorkflow';$('deskVerification').focus();
    });
    $('deskAlertRefresh').addEventListener('click',safeRefresh);
    $('deskAcknowledgeAlerts').addEventListener('click',async()=>{
      try{await call('adminDeskAcknowledgeAlerts');prevUnread=0;await refresh();msg('Registration alerts marked as seen.','success');}
      catch(e){msg(SkyDreamFirebase.friendlyError(e),'error');}
    });
    $('deskOnboardingCards').addEventListener('click',async event=>{
      const button=event.target.closest('[data-save-onboard]');if(!button)return;
      const parent=button.closest('[data-onboard-id]'),flags={};
      for(const key of ['instructionsSent','availabilityConfirmed','orientationCompleted']){
        flags[key]=parent.querySelector('[data-onboard-flag="'+key+'"]').checked;
      }
      button.disabled=true;
      try{
        await call('adminDeskSetOnboarding',{facilitatorId:button.dataset.saveOnboard,flags});
        await refresh();msg('Facilitator onboarding updated.','success');
      }catch(e){msg(SkyDreamFirebase.friendlyError(e),'error');}finally{button.disabled=false;}
    });
    $('deskMessageStudent').addEventListener('change',previewMessage);
    $('deskMessageTemplate').addEventListener('change',previewMessage);
    $('deskTemplateForm').addEventListener('submit',async event=>{
      event.preventDefault();
      const studentId=$('deskMessageStudent').value,templateId=$('deskMessageTemplate').value;
      if(!studentId||!templateId||!confirm('Send this approved message to the selected student?'))return;
      const button=$('deskTemplateSend');button.disabled=true;
      try{
        await call('adminDeskSendApprovedTemplate',{studentId,templateId});
        await refresh();msg('Approved message delivered to the Student Portal.','success');
      }catch(e){msg(SkyDreamFirebase.friendlyError(e),'error');}finally{button.disabled=false;}
    });
    $('deskDailyDate').addEventListener('change',renderDaily);
    $('deskDailyDownload').addEventListener('click',async()=>{
      if(!info)return;
      const {day,perProgram}=dailyData(),button=$('deskDailyDownload');
      const rows=[['Registration date','Program','New','Not cancelled (current)',
        'Cancelled (current)','Verified (current)','Needs correction (current)','Callbacks (current)']];
      for(const [id,v] of Object.entries(perProgram))rows.push([day,courses()[id]||id,v.total,
        v.registered,v.cancelled,v.verified,v.corrections,v.callbacks]);
      button.disabled=true;
      try{
        await call('adminDeskLogExport',{kind:'daily'});
        csvDownload('SkyDream-Daily-Registration-'+day+'.csv',rows);
        await refresh();msg('Daily report exported.','success');
      }catch(e){msg(SkyDreamFirebase.friendlyError(e),'error');}finally{button.disabled=false;}
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{
    bind();
    window.addEventListener('skydream-registration-workspace-ready',event=>{
      desk=event.detail;safeRefresh();
    });
    setInterval(()=>{
      if(desk&&!$('registrationStaffShell').classList.contains('hidden')&&!document.hidden)safeRefresh();
    },90000);
  });
})();
