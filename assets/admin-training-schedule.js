(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=v=>String(v==null?'':v).replace(/[&<>"']/g,
    c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=[
    ['label','Intake name','text',true],
    ['startDate','Orientation / intake identifier','date',true],
    ['classesStartDate','Classes begin','date',true],
    ['breakStartDate','Break begins (optional)','date',false],
    ['resumeDate','Classes resume (optional)','date',false],
    ['endDate','Training ends / graduation','date',true],
    ['thanksgivingDate','Closing ceremony (optional)','date',false]
  ];
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  let ready=false,state=null,programs=[],busy=false;
  const warn=error=>SkyDreamFirebase.friendlyError(error)||error.message||'The schedule could not be updated.';
  const msg=t=>{if($('scheduleEditStatus'))$('scheduleEditStatus').textContent=t;};
  function rowHtml(row={}){
    const d=document.createElement('div');d.className='card mt-12';d.dataset.scheduleRow='true';
    const course=String(row.course||''),day=String(row.day||'Saturday');
    d.innerHTML='<div class="form-grid">'+
      '<div class="field"><label>Programme</label><select data-schedule-course>'+
      programs.map(p=>'<option value="'+escape(p.id)+'"'+(p.id===course?' selected':'')+'>'+escape(p.name)+'</option>').join('')+
      '</select></div>'+
      '<div class="field"><label>Day</label><select data-schedule-day>'+
      days.map(x=>'<option'+(day===x?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Start time</label><input type="time" required data-schedule-start value="'+escape(row.startTime||'09:00')+'"></div>'+
      '<div class="field"><label>End time</label><input type="time" required data-schedule-end value="'+escape(row.endTime||'11:00')+'"></div>'+
      '<div class="field"><label>Venue / classroom (optional)</label><input maxlength="120" data-schedule-venue value="'+escape(row.venue||'')+'"></div>'+
      '<div class="field"><label>Session</label><button type="button" class="btn btn-outline btn-small" data-remove-schedule-row>Remove class</button></div></div>';
    return d;
  }
  async function refresh(){
    const [schedule,catalog]=await Promise.all([
      SkyDreamFirebase.call('adminGetTrainingSchedule'),
      SkyDreamFirebase.call('publicCatalog')
    ]);
    state=schedule;
    programs=(catalog.programs||[]).map(p=>({id:p.id,name:p.name}));
    for(const [key] of fields)$('scheduleEdit_'+key).value=state.intake?.[key]||'';
    const host=$('scheduleEditRows');
    host.innerHTML='';
    for(const session of state.sessions||[])host.appendChild(rowHtml(session));
    renderHistory();
    msg('Current intake schedule loaded. Changes are not live until you click Save Schedule.');
  }
  function renderHistory(){
    const list=state?.changes||[];
    $('scheduleEditHistory').innerHTML=list.map(c=>'<div class="card"><strong>Revision '+
      escape(c.revision)+'</strong> · '+escape(c.updatedBy||'Main Admin')+
      ' · '+escape(new Date(c.date).toLocaleString('en-GB'))+
      '<p class="hint">'+(c.changedDates?.length?'Updated '+escape(c.changedDates.join(', '))+'; ':'')+
      escape(c.sessionCount)+' weekly class session(s)</p></div>').join('')||
      '<p class="hint">No schedule edits recorded yet.</p>';
  }
  function readSessions(){
    return [...document.querySelectorAll('#scheduleEditRows [data-schedule-row]')].map(row=>({
      course:row.querySelector('[data-schedule-course]').value,
      day:row.querySelector('[data-schedule-day]').value,
      startTime:row.querySelector('[data-schedule-start]').value,
      endTime:row.querySelector('[data-schedule-end]').value,
      venue:row.querySelector('[data-schedule-venue]').value.trim()
    }));
  }
  async function save(event){
    event.preventDefault();
    if(!state||busy)return;
    const intake={};
    for(const [key] of fields)intake[key]=$('scheduleEdit_'+key).value.trim();
    const sessions=readSessions();
    if(!intake.label||!intake.startDate||!intake.classesStartDate||!intake.endDate){
      msg('Enter an intake name, orientation, classes start and graduation dates.');return;
    }
    if(intake.startDate>intake.classesStartDate||intake.classesStartDate>intake.endDate){
      msg('Orientation, classes start and graduation dates must be in chronological order.');return;
    }
    if(Boolean(intake.breakStartDate)!==Boolean(intake.resumeDate)){
      msg('Enter both break and resumption dates, or leave both blank.');return;
    }
    if(sessions.some(s=>!s.course||!s.day||!s.startTime||!s.endTime||s.endTime<=s.startTime)){
      msg('Check that each weekly class has a programme, day, and valid start/end time.');return;
    }
    if(!confirm('Publish these schedule changes to the current intake and public Schedule page? Existing student records will not be moved.'))return;
    const button=$('scheduleEditSave');
    busy=true;button.disabled=true;msg('Saving the current training schedule…');
    try{
      await SkyDreamFirebase.call('adminSaveTrainingSchedule',{
        intakeStart:state.intake.startDate,revision:state.revision,intake,sessions
      });
      await refresh();msg('Training schedule saved. Public changes may take up to two minutes to refresh due to the existing catalogue cache.');
    }catch(error){msg(warn(error));}
    finally{busy=false;button.disabled=false;}
  }
  function install(){
    if(ready)return;
    const shell=document.querySelector('#dashboardShell');
    const main=shell?.querySelector('.dashboard-main');
    const nav=shell?.querySelector('.dashboard-sidebar nav');
    if(!main||!nav)return;
    ready=true;
    const link=document.createElement('a');
    link.href='#trainingScheduleEditor';link.textContent='Edit Training Schedule';
    nav.appendChild(link);
    const section=document.createElement('section');
    section.id='trainingScheduleEditor';section.className='dashboard-panel';
    section.innerHTML='<h2>Edit Training Schedule</h2>'+
      '<p class="hint">Update the active intake without starting another intake. Training and graduation dates update the public schedule; programme sessions show weekly days and times. Only the Main Admin can save.</p>'+
      '<div class="notice notice-info">The orientation date is also the intake identifier. Once students have registered, you cannot change it here because that could break their registrations. Editing these weekly times does not change attendance enforcement rules.</div>'+
      '<form id="scheduleEditForm"><div class="card"><h3>Current intake dates</h3><div class="form-grid">'+
      fields.map(([key,label,type,required])=>
        '<div class="field"><label for="scheduleEdit_'+key+'">'+escape(label)+'</label><input id="scheduleEdit_'+key+
        '" type="'+type+'" '+(required?'required ':'')+(type==='text'?'maxlength="100"':'')+'></div>').join('')+
      '</div></div><div class="card mt-16"><h3>Weekly programme class sessions</h3>'+
      '<p class="hint">Add any active class days and times. Leave empty when no weekly timetable has been announced. Up to 60 sessions.</p>'+
      '<div id="scheduleEditRows"></div>'+
      '<button id="scheduleEditAdd" class="btn btn-outline mt-12" type="button">Add Programme Class</button></div>'+
      '<div class="toolbar mt-16"><button id="scheduleEditSave" class="btn btn-primary" type="submit">Save Schedule</button>'+
      '<button id="scheduleEditReload" class="btn btn-outline" type="button">Reload Current Schedule</button></div>'+
      '<p id="scheduleEditStatus" role="status" aria-live="polite" class="hint"></p></form>'+
      '<div class="card mt-20"><h3>Recent Schedule Changes</h3><div id="scheduleEditHistory"></div></div>';
    main.appendChild(section);
    $('scheduleEditForm').addEventListener('submit',save);
    $('scheduleEditReload').addEventListener('click',()=>refresh().catch(error=>msg(warn(error))));
    $('scheduleEditAdd').addEventListener('click',()=>{
      if(document.querySelectorAll('#scheduleEditRows [data-schedule-row]').length>=60){
        msg('Maximum 60 programme sessions.');return;
      }
      $('scheduleEditRows').appendChild(rowHtml());
    });
    $('scheduleEditRows').addEventListener('click',e=>{
      const button=e.target.closest('[data-remove-schedule-row]');
      if(button)button.closest('[data-schedule-row]')?.remove();
    });
    refresh().catch(error=>msg(warn(error)));
  }
  window.addEventListener('skydream-owner-session-ready',install);
})();