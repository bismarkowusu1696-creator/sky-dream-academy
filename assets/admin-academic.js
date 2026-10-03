(() => {
  let data = null;
  let editingAssessment = '';
  let editingTimetable = '';
  let searchTimer = null;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const call = (name,payload={}) => SkyDreamFirebase.call(name,payload);
  const courseName = id => data && data.courses && data.courses[id] ? data.courses[id] : (id || '');

  function addNav(href,label,before='#account'){
    const nav=document.querySelector('.dashboard-sidebar nav'); if(!nav||nav.querySelector(`a[href="${href}"]`))return;
    const a=document.createElement('a');a.href=href;a.textContent=label;nav.insertBefore(a,nav.querySelector(`a[href="${before}"]`)||nav.querySelector('button')||null);
  }
  function addSection(id,title,html,before='account'){
    if($(id))return;const main=document.querySelector('.dashboard-main'),section=document.createElement('section');section.id=id;section.className='dashboard-panel';section.innerHTML=`<h2>${title}</h2>${html}`;main.insertBefore(section,$(before)||null);
  }

  function inject(){
    if($('academicAssessments'))return;
    const top=document.querySelector('.dashboard-main > .dashboard-top');
    if(top){
      const search=document.createElement('div');search.style.cssText='position:relative;min-width:min(420px,100%);flex:1;max-width:520px';
      search.innerHTML=`<input id="adminGlobalSearch" aria-label="Search all admin records" placeholder="Search students, facilitators, messages, intakes…" style="width:100%"><div id="adminGlobalResults" class="card hidden" style="position:absolute;z-index:150;top:46px;left:0;right:0;max-height:420px;overflow:auto;padding:8px"></div>`;
      top.insertBefore(search,top.lastElementChild);
    }

    addNav('#academicAssessments','Assessments & Progress');
    addNav('#academicTimetable','Timetable & Rooms');

    addSection('academicAssessments','Assessments & Progress',`
      <p class="hint">Record assignments, quizzes, practicals, projects and exams. Student progress percentages are calculated automatically.</p>
      <div class="card"><input id="assessmentId" type="hidden"><div class="form-grid">
        <div class="field full"><label>Student</label><select id="assessmentStudent"></select></div>
        <div class="field"><label>Type</label><select id="assessmentType"></select></div>
        <div class="field"><label>Date</label><input id="assessmentDate" type="date"></div>
        <div class="field full"><label>Title</label><input id="assessmentTitle" maxlength="120" placeholder="e.g. Practical wiring assessment"></div>
        <div class="field"><label>Score</label><input id="assessmentScore" type="number" min="0" step="0.01"></div>
        <div class="field"><label>Maximum score</label><input id="assessmentMax" type="number" min="0.01" step="0.01" value="100"></div>
        <div class="field full"><label>Remark / progress note</label><textarea id="assessmentRemark" rows="3" maxlength="700" placeholder="Strengths, areas to improve, facilitator remark…"></textarea></div>
        <div class="field full"><div class="toolbar"><button id="saveAssessment" class="btn btn-primary" type="button">Save Assessment</button><button id="cancelAssessmentEdit" class="btn btn-outline hidden" type="button">Cancel Edit</button></div></div>
      </div></div>
      <div class="dashboard-top" style="margin-top:18px"><div><h3 style="margin:0">Assessment records</h3><span id="assessmentSummary" class="hint"></span></div><div class="toolbar"><select id="assessmentFilterStudent"><option value="">All students</option></select><select id="assessmentFilterType"><option value="">All types</option></select></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Student</th><th>Assessment</th><th>Score</th><th>Progress</th><th>Actions</th></tr></thead><tbody id="assessmentBody"></tbody></table></div>
    `,'account');

    addSection('academicTimetable','Timetable & Room Management',`
      <p class="hint">Create recurring weekly class times. The system blocks room, facilitator and program clashes automatically.</p>
      <div class="card"><input id="timetableId" type="hidden"><div class="form-grid">
        <div class="field"><label>Day</label><select id="timetableDay"></select></div>
        <div class="field"><label>Program</label><select id="timetableCourse"></select></div>
        <div class="field"><label>Start time</label><input id="timetableStart" type="time"></div>
        <div class="field"><label>End time</label><input id="timetableEnd" type="time"></div>
        <div class="field"><label>Room / venue</label><input id="timetableRoom" maxlength="80" placeholder="e.g. Lab 1"></div>
        <div class="field"><label>Facilitator</label><select id="timetableFacilitator"><option value="">Not assigned</option></select></div>
        <div class="field full"><label>Session title</label><input id="timetableTitle" maxlength="120" placeholder="e.g. Graphic Design Practical"></div>
        <div class="field full"><div class="toolbar"><button id="saveTimetable" class="btn btn-primary" type="button">Save Timetable Entry</button><button id="cancelTimetableEdit" class="btn btn-outline hidden" type="button">Cancel Edit</button></div></div>
      </div></div>
      <div class="table-wrap" style="margin-top:18px"><table class="table"><thead><tr><th>Day</th><th>Time</th><th>Program</th><th>Room</th><th>Facilitator</th><th>Actions</th></tr></thead><tbody id="timetableBody"></tbody></table></div>
    `,'account');
    bind();
  }

  async function load(){ data=await call('adminGetAcademicSnapshot'); render(); }
  function render(){ populate(); renderAssessments(); renderTimetable(); }
  function populate(){
    const students=(data.students||[]).slice().sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName)));
    const studentOptions=students.map(s=>`<option value="${esc(s.id)}">${esc(s.fullName)} — ${esc(s.regNumber)}</option>`).join('');
    $('assessmentStudent').innerHTML=studentOptions;$('assessmentFilterStudent').innerHTML='<option value="">All students</option>'+studentOptions;
    const typeOptions=(data.assessmentTypes||[]).map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');$('assessmentType').innerHTML=typeOptions;$('assessmentFilterType').innerHTML='<option value="">All types</option>'+typeOptions;
    $('timetableDay').innerHTML=(data.days||[]).map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
    $('timetableCourse').innerHTML=Object.entries(data.courses||{}).map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('');
    $('timetableFacilitator').innerHTML='<option value="">Not assigned</option>'+(data.facilitators||[]).filter(f=>f.active!==false).map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    if(!$('assessmentDate').value)$('assessmentDate').value=new Date().toISOString().slice(0,10);
  }
  function studentById(id){return (data.students||[]).find(s=>s.id===id);}
  function facById(id){return (data.facilitators||[]).find(f=>f.id===id);}
  function filteredAssessments(){const s=$('assessmentFilterStudent').value,t=$('assessmentFilterType').value;return (data.assessments||[]).filter(a=>(!s||a.studentId===s)&&(!t||a.type===t)).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));}
  function renderAssessments(){
    const rows=filteredAssessments();const totalMax=rows.reduce((x,a)=>x+(Number(a.maxScore)||0),0),total=rows.reduce((x,a)=>x+(Number(a.score)||0),0),avg=totalMax?Math.round(total/totalMax*100):0;
    $('assessmentSummary').textContent=`${rows.length} record${rows.length===1?'':'s'} · combined progress ${avg}%`;
    $('assessmentBody').innerHTML=rows.length?rows.map(a=>{const s=studentById(a.studentId),pct=Number(a.maxScore)?Math.round(Number(a.score)/Number(a.maxScore)*100):0;return `<tr><td>${esc(a.date||'')}</td><td><strong>${esc(s?s.fullName:'Unknown student')}</strong><br><small>${esc(s?s.regNumber:'')}</small></td><td><strong>${esc(a.title)}</strong><br><small>${esc(a.type)}${a.remark?` · ${esc(a.remark)}`:''}</small></td><td>${Number(a.score)} / ${Number(a.maxScore)}</td><td><span class="badge">${pct}%</span></td><td><div class="toolbar"><button class="btn btn-outline btn-small" data-edit-assessment="${esc(a.id)}">Edit</button><button class="btn btn-danger btn-small" data-delete-assessment="${esc(a.id)}">Delete</button></div></td></tr>`;}).join(''):'<tr><td colspan="6">No assessment records.</td></tr>';
  }
  function renderTimetable(){
    const dayIndex=Object.fromEntries((data.days||[]).map((d,i)=>[d,i]));const rows=(data.timetable||[]).slice().sort((a,b)=>(dayIndex[a.day]??99)-(dayIndex[b.day]??99)||String(a.startTime).localeCompare(String(b.startTime)));
    $('timetableBody').innerHTML=rows.length?rows.map(t=>{const f=facById(t.facilitatorId);return `<tr><td>${esc(t.day)}</td><td>${esc(t.startTime)}–${esc(t.endTime)}</td><td><strong>${esc(courseName(t.course))}</strong><br><small>${esc(t.title||'Class')}</small></td><td>${esc(t.room)}</td><td>${esc(f?f.name:'Not assigned')}</td><td><div class="toolbar"><button class="btn btn-outline btn-small" data-edit-timetable="${esc(t.id)}">Edit</button><button class="btn btn-danger btn-small" data-delete-timetable="${esc(t.id)}">Delete</button></div></td></tr>`;}).join(''):'<tr><td colspan="6">No timetable entries.</td></tr>';
  }
  function resetAssessment(){editingAssessment='';$('assessmentId').value='';$('assessmentTitle').value='';$('assessmentScore').value='';$('assessmentMax').value='100';$('assessmentRemark').value='';$('assessmentDate').value=new Date().toISOString().slice(0,10);$('cancelAssessmentEdit').classList.add('hidden');$('saveAssessment').textContent='Save Assessment';}
  function editAssessment(id){const a=(data.assessments||[]).find(x=>x.id===id);if(!a)return;editingAssessment=id;$('assessmentId').value=id;$('assessmentStudent').value=a.studentId;$('assessmentType').value=a.type;$('assessmentDate').value=a.date||'';$('assessmentTitle').value=a.title||'';$('assessmentScore').value=a.score;$('assessmentMax').value=a.maxScore;$('assessmentRemark').value=a.remark||'';$('cancelAssessmentEdit').classList.remove('hidden');$('saveAssessment').textContent='Update Assessment';$('academicAssessments').scrollIntoView({behavior:'smooth'});}
  async function saveAssessment(){const payload={id:editingAssessment||undefined,studentId:$('assessmentStudent').value,type:$('assessmentType').value,date:$('assessmentDate').value,title:$('assessmentTitle').value.trim(),score:Number($('assessmentScore').value),maxScore:Number($('assessmentMax').value),remark:$('assessmentRemark').value.trim()};if(!payload.studentId||!payload.title){alert('Choose a student and enter the assessment title.');return;}const b=$('saveAssessment');b.disabled=true;try{await call('adminSaveAssessment',payload);resetAssessment();await load();alert('Assessment saved.');}catch(e){alert(SkyDreamFirebase.friendlyError(e));}finally{b.disabled=false;}}
  async function deleteAssessment(id){if(!confirm('Delete this assessment record?'))return;try{await call('adminDeleteAssessment',{id});await load();}catch(e){alert(SkyDreamFirebase.friendlyError(e));}}

  function resetTimetable(){editingTimetable='';$('timetableId').value='';$('timetableStart').value='';$('timetableEnd').value='';$('timetableRoom').value='';$('timetableTitle').value='';$('timetableFacilitator').value='';$('cancelTimetableEdit').classList.add('hidden');$('saveTimetable').textContent='Save Timetable Entry';}
  function editTimetable(id){const t=(data.timetable||[]).find(x=>x.id===id);if(!t)return;editingTimetable=id;$('timetableId').value=id;$('timetableDay').value=t.day;$('timetableCourse').value=t.course;$('timetableStart').value=t.startTime;$('timetableEnd').value=t.endTime;$('timetableRoom').value=t.room||'';$('timetableFacilitator').value=t.facilitatorId||'';$('timetableTitle').value=t.title||'';$('cancelTimetableEdit').classList.remove('hidden');$('saveTimetable').textContent='Update Timetable Entry';$('academicTimetable').scrollIntoView({behavior:'smooth'});}
  async function saveTimetable(){const payload={id:editingTimetable||undefined,day:$('timetableDay').value,course:$('timetableCourse').value,startTime:$('timetableStart').value,endTime:$('timetableEnd').value,room:$('timetableRoom').value.trim(),facilitatorId:$('timetableFacilitator').value,title:$('timetableTitle').value.trim()};const b=$('saveTimetable');b.disabled=true;try{await call('adminSaveTimetableEntry',payload);resetTimetable();await load();alert('Timetable saved.');}catch(e){alert(SkyDreamFirebase.friendlyError(e));}finally{b.disabled=false;}}
  async function deleteTimetable(id){if(!confirm('Delete this timetable entry?'))return;try{await call('adminDeleteTimetableEntry',{id});await load();}catch(e){alert(SkyDreamFirebase.friendlyError(e));}}

  async function runSearch(q){const host=$('adminGlobalResults');if(!q||q.trim().length<2){host.classList.add('hidden');host.innerHTML='';return;}try{const r=await call('adminGlobalSearch',{q:q.trim()});const rows=r.results||[];host.innerHTML=rows.length?rows.map(x=>`<button type="button" data-search-target="${esc(x.target||'#overview')}" data-search-query="${esc(x.query||'')}" style="display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px;border-bottom:1px solid #e5e7eb;cursor:pointer"><small class="badge">${esc(x.type)}</small><br><strong>${esc(x.title)}</strong><br><span class="hint">${esc(x.subtitle||'')}</span></button>`).join(''):'<p style="padding:10px">No matching records.</p>';host.classList.remove('hidden');}catch(e){host.innerHTML=`<p style="padding:10px">${esc(SkyDreamFirebase.friendlyError(e))}</p>`;host.classList.remove('hidden');}}
  function goSearchResult(btn){const target=document.querySelector(btn.dataset.searchTarget||'#overview');const q=btn.dataset.searchQuery||'';$('adminGlobalResults').classList.add('hidden');if(target)target.scrollIntoView({behavior:'smooth'});if(btn.dataset.searchTarget==='#studentProfiles'&&$('suiteStudentSearch')){$('suiteStudentSearch').value=q;$('suiteStudentSearch').dispatchEvent(new Event('input'));}if(btn.dataset.searchTarget==='#students'&&$('studentSearch')){$('studentSearch').value=q;$('studentSearch').dispatchEvent(new Event('input'));}}

  function bind(){
    $('saveAssessment').onclick=saveAssessment;$('cancelAssessmentEdit').onclick=resetAssessment;$('assessmentFilterStudent').onchange=renderAssessments;$('assessmentFilterType').onchange=renderAssessments;
    $('saveTimetable').onclick=saveTimetable;$('cancelTimetableEdit').onclick=resetTimetable;
    const global=$('adminGlobalSearch');if(global)global.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>runSearch(global.value),280);});
    document.addEventListener('click',e=>{const a=e.target.closest('[data-edit-assessment]');if(a){editAssessment(a.dataset.editAssessment);return;}const d=e.target.closest('[data-delete-assessment]');if(d){deleteAssessment(d.dataset.deleteAssessment);return;}const te=e.target.closest('[data-edit-timetable]');if(te){editTimetable(te.dataset.editTimetable);return;}const td=e.target.closest('[data-delete-timetable]');if(td){deleteTimetable(td.dataset.deleteTimetable);return;}const sr=e.target.closest('[data-search-target]');if(sr){goSearchResult(sr);return;}if($('adminGlobalResults')&&!e.target.closest('#adminGlobalResults')&&!e.target.closest('#adminGlobalSearch'))$('adminGlobalResults').classList.add('hidden');});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    inject();
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{
      if(!user)return;
      try{const token=await user.getIdTokenResult();if(token.claims.role==='admin')await load();}catch(e){console.warn('Academic admin tools could not load.',e);}
    });
  });
})();
