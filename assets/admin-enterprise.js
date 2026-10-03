(() => {
  let data = null;
  let importCsv = '';
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const date = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? (v || '') : d.toLocaleString('en-GB'); };
  const course = id => data && data.courses && data.courses[id] ? data.courses[id] : id || '';
  const call = (name, payload={}) => SkyDreamFirebase.call(name, payload);

  function nav(href,label,before='#account'){
    const host=document.querySelector('.dashboard-sidebar nav'); if(!host||host.querySelector(`a[href="${href}"]`))return;
    const a=document.createElement('a');a.href=href;a.textContent=label;host.insertBefore(a,host.querySelector(`a[href="${before}"]`)||host.querySelector('button')||null);
  }
  function section(id,title,html,before='account'){
    if($(id))return $(id); const s=document.createElement('section');s.id=id;s.className='dashboard-panel';s.innerHTML=`<h2>${title}</h2>${html}`;
    const main=document.querySelector('.dashboard-main'),b=$(before);main.insertBefore(s,b||null);return s;
  }

  function inject(){
    nav('#enterpriseSecurity','Security & Devices');
    nav('#notificationsCenter','Notifications');
    nav('#studentImport','Import & Duplicates');
    nav('#cohortArchive','Intake Archive');
    nav('#classSessions','Class Sessions');
    nav('#facPerformance','Facilitator Performance');
    nav('#internalNotes','Internal Notes');
    nav('#changeHistory','Change History');
    nav('#recycleBin','Recycle Bin');
    nav('#cloudBackups','Cloud Backups');

    section('enterpriseSecurity','Security & Devices',`
      <div class="grid grid-2"><div class="card"><h3>2-step verification</h3><p id="twoFactorStatus" class="hint">Loading…</p><div class="toolbar"><button id="enable2fa" class="btn btn-primary btn-small" type="button">Set up authenticator</button><button id="disable2fa" class="btn btn-outline btn-small" type="button">Disable</button></div><div id="twoFactorSetup" class="hidden" style="margin-top:12px"></div></div>
      <div class="card"><h3>Admin sessions</h3><p class="hint">Review signed-in devices and revoke access.</p><button id="signOutAllDevices" class="btn btn-outline btn-small" type="button">Sign out all my devices</button></div></div><div id="sessionList" class="grid" style="margin-top:16px"></div>`,'account');
    section('notificationsCenter','Notification Centre',`<p class="hint">New registrations, enquiries, capacity warnings, attendance warnings and deadlines appear here.</p><div id="notificationList" class="grid"></div>`,'account');
    section('studentImport','Student Import & Duplicate Control',`
      <div class="grid grid-2"><div class="card"><h3>Import CSV</h3><input id="csvFile" type="file" accept=".csv,text/csv"><p class="hint">Recommended columns: Full Name, Mobile, Program, Email, Ghana Card, WhatsApp, Address, DOB, Gender.</p><div class="toolbar"><button id="previewImport" class="btn btn-outline btn-small" type="button">Preview</button><button id="commitImport" class="btn btn-primary btn-small" type="button" disabled>Import valid rows</button></div><div id="importSummary" class="hint"></div></div><div class="card"><h3>Duplicate detection</h3><p class="hint">Find records sharing a mobile number, email or Ghana Card.</p><button id="findDuplicates" class="btn btn-outline btn-small" type="button">Find duplicates</button></div></div><div id="importPreview" class="table-wrap" style="margin-top:14px"></div><div id="duplicateList" style="margin-top:14px"></div>`,'account');
    section('cohortArchive','Intake / Cohort Archive',`<p class="hint">Archive completed intakes without deleting their student records.</p><div id="cohortList" class="grid grid-3"></div>`,'account');
    section('classSessions','Class Session Management',`
      <div class="card"><div class="form-grid"><div class="field"><label>Date</label><input id="classDate" type="date"></div><div class="field"><label>Program</label><select id="classCourse"></select></div><div class="field"><label>Facilitator</label><select id="classFacilitator"><option value="">Any assigned facilitator</option></select></div><div class="field"><label>Title</label><input id="classTitle" value="Class session"></div><div class="field full"><button id="createClassSession" class="btn btn-primary" type="button">Create Session</button></div></div></div><div style="margin:14px 0"><label><input id="sessionEnforcement" type="checkbox"> Require facilitators to use scheduled sessions when marking attendance</label></div><div id="classSessionList" class="grid"></div>`,'account');
    section('facPerformance','Facilitator Performance',`<div class="table-wrap"><table class="table"><thead><tr><th>Facilitator</th><th>Assigned students</th><th>Attendance marks</th><th>Sessions</th><th>Completed</th></tr></thead><tbody id="facPerformanceBody"></tbody></table></div>`,'account');
    section('internalNotes','Internal Admin Notes',`
      <div class="card"><div class="form-grid"><div class="field"><label>Target type</label><select id="noteType"><option value="student">Student</option><option value="facilitator">Facilitator</option><option value="intake">Intake</option></select></div><div class="field"><label>Target</label><select id="noteTarget"></select></div><div class="field full"><label>Private note</label><textarea id="noteText" rows="3" maxlength="1000"></textarea></div><div class="field full"><button id="addInternalNote" class="btn btn-primary" type="button">Add Note</button></div></div></div><div id="noteList" class="grid" style="margin-top:14px"></div>`,'account');
    section('changeHistory','Data Change History',`<p class="hint">Shows captured before/after changes for important administrative edits.</p><div id="historyList" class="admin-suite-log"></div>`,'account');
    section('recycleBin','Recycle Bin',`<p class="hint">Deleted records stay here for up to 30 days before the automated cleanup removes them permanently.</p><button id="refreshRecycle" class="btn btn-outline btn-small" type="button">Refresh</button><div id="recycleList" class="grid" style="margin-top:14px"></div>`,'account');
    section('cloudBackups','Automated Cloud Backups',`<div class="card"><h3>Daily backup</h3><p>Application data is backed up automatically each day at 2:30 AM Ghana time and retained for about 30 days.</p><button id="runBackup" class="btn btn-primary btn-small" type="button">Create Backup Now</button><p id="backupStatus" class="hint"></p></div>`,'account');
    bind();
  }

  async function refresh(){ data=await call('adminGetEnterpriseSnapshot'); render(); }
  function render(){ if(!data)return; renderSecurity();renderNotifications();renderCohorts();renderSessions();renderPerformance();renderNotes();renderHistory();populateSelectors(); }
  function populateSelectors(){
    if($('classCourse')) $('classCourse').innerHTML=Object.entries(data.courses||{}).map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('');
    if($('classFacilitator')) $('classFacilitator').innerHTML='<option value="">Any assigned facilitator</option>'+(data.facilitators||[]).map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    renderNoteTargets();
    if($('sessionEnforcement')) $('sessionEnforcement').checked=!!(data.settings&&data.settings.sessionEnforcement);
  }
  function renderSecurity(){
    $('twoFactorStatus').textContent=data.twoFactorEnabled?'Enabled — authenticator code is required at login.':'Not enabled.';
    $('enable2fa').classList.toggle('hidden',data.twoFactorEnabled);$('disable2fa').classList.toggle('hidden',!data.twoFactorEnabled);
    $('sessionList').innerHTML=(data.sessions||[]).map(s=>`<div class="card"><div class="dashboard-top"><strong>${esc(s.username)}</strong><span class="badge">${s.revoked?'Revoked':'Active'}</span></div><p><small>${esc(date(s.createdAt))}</small></p><p class="hint">${esc(s.userAgent||'Unknown device')}<br>${esc(s.ip||'IP unavailable')}</p>${!s.revoked?`<button class="btn btn-outline btn-small" data-revoke-session="${esc(s.id)}">Revoke</button>`:''}</div>`).join('')||'<p>No recorded sessions yet. Sign out and sign in again to create a device-bound session.</p>';
  }
  function renderNotifications(){ $('notificationList').innerHTML=(data.notifications||[]).map(n=>`<div class="card"><div class="dashboard-top"><strong>${esc(n.title)}</strong><small>${esc(date(n.date))}</small></div><p>${esc(n.message)}</p><button class="btn btn-outline btn-small" data-dismiss-notification="${esc(n.id)}">Dismiss</button></div>`).join('')||'<p>No notifications need your attention.</p>'; }
  function renderCohorts(){ $('cohortList').innerHTML=(data.cohorts||[]).map(c=>`<div class="card"><div class="dashboard-top"><h3>${esc(c.label||c.intakeStart)}</h3><span class="badge">${c.archived?'Archived':'Active'}</span></div><p>${Number(c.students)||0} student(s)</p>${/^\d{4}-/.test(c.intakeStart)?`<button class="btn btn-outline btn-small" data-cohort="${esc(c.intakeStart)}" data-archived="${c.archived?'true':'false'}">${c.archived?'Restore':'Archive'}</button>`:''}</div>`).join('')||'<p>No intake records yet.</p>'; }
  function renderSessions(){ $('classSessionList').innerHTML=(data.classSessions||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(s=>{const f=(data.facilitators||[]).find(x=>x.id===s.facilitatorId);return `<div class="card"><div class="dashboard-top"><strong>${esc(s.title||'Class session')}</strong><span class="badge">${esc(s.status||'Scheduled')}</span></div><p>${esc(s.date)} · ${esc(course(s.course))}</p><p class="hint">${esc(f?f.name:'Any assigned facilitator')}</p><div class="toolbar"><button class="btn btn-outline btn-small" data-session-status="${esc(s.id)}" data-status="Completed">Complete</button><button class="btn btn-outline btn-small" data-session-status="${esc(s.id)}" data-status="Cancelled">Cancel</button><button class="btn btn-danger btn-small" data-delete-class="${esc(s.id)}">Delete</button></div></div>`;}).join('')||'<p>No class sessions have been created.</p>'; }
  function renderPerformance(){ $('facPerformanceBody').innerHTML=(data.facilitatorPerformance||[]).map(f=>`<tr><td><strong>${esc(f.name)}</strong><br><small>@${esc(f.username)}</small></td><td>${f.assignedStudents}</td><td>${f.attendanceMarks}</td><td>${f.sessions}</td><td>${f.completedSessions}</td></tr>`).join('')||'<tr><td colspan="5">No facilitator data.</td></tr>'; }
  function renderNoteTargets(){const type=$('noteType')?$('noteType').value:'student';let rows=[];if(type==='student')rows=(data.students||[]).map(s=>[s.id,`${s.fullName} — ${s.regNumber}`]);else if(type==='facilitator')rows=(data.facilitators||[]).map(f=>[f.id,f.name]);else rows=(data.cohorts||[]).map(c=>[c.intakeStart,c.label||c.intakeStart]);$('noteTarget').innerHTML=rows.map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('');renderNotes();}
  function renderNotes(){if(!$('noteTarget'))return;const type=$('noteType').value,target=$('noteTarget').value;$('noteList').innerHTML=(data.internalNotes||[]).filter(n=>n.targetType===type&&n.targetId===target).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(n=>`<div class="card"><div class="dashboard-top"><strong>@${esc(n.createdBy)}</strong><small>${esc(date(n.date))}</small></div><p style="white-space:pre-wrap">${esc(n.text)}</p><button class="btn btn-danger btn-small" data-delete-note="${esc(n.id)}">Delete</button></div>`).join('')||'<p>No internal notes for this record.</p>';}
  function renderHistory(){ $('historyList').innerHTML=(data.changeHistory||[]).slice(0,100).map(h=>`<div class="admin-suite-log-item"><strong>${esc(h.action)}</strong><small>${esc(date(h.date))} · @${esc(h.admin)} · ${esc(h.entityType)} ${esc(h.entityId)}</small><details><summary>View before / after</summary><pre style="white-space:pre-wrap;overflow:auto">${esc(JSON.stringify({before:h.before,after:h.after},null,2))}</pre></details></div>`).join('')||'<p>No captured change history yet.</p>'; }

  async function loadRecycle(){const r=await call('adminGetRecycleBin');$('recycleList').innerHTML=(r.items||[]).map(i=>`<div class="card"><div class="dashboard-top"><strong>${esc(i.type)}</strong><small>${esc(date(i.deletedAt))}</small></div><p>${esc(i.record&&((i.record.fullName||i.record.name||i.record.username||i.record.message||i.record.id))||'Record')}</p><p class="hint">Deleted by @${esc(i.deletedBy)}</p><div class="toolbar"><button class="btn btn-primary btn-small" data-restore-bin="${esc(i.id)}">Restore</button><button class="btn btn-danger btn-small" data-purge-bin="${esc(i.id)}">Delete permanently</button></div></div>`).join('')||'<p>Recycle bin is empty.</p>';}
  async function previewImport(){if(!importCsv){alert('Choose a CSV file first.');return;}const r=await call('adminPreviewStudentImport',{csv:importCsv});$('importSummary').textContent=`${r.total} row(s): ${r.valid} clean, ${r.duplicates} possible duplicate(s).`;const rows=(r.rows||[]).slice(0,50);$('importPreview').innerHTML=`<table class="table"><thead><tr><th>Row</th><th>Name</th><th>Mobile</th><th>Program</th><th>Issues</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.row}</td><td>${esc(x.fullName)}</td><td>${esc(x.mobile)}</td><td>${esc(course(x.course))}</td><td>${esc((x.issues||[]).join(', ')||'Ready')}</td></tr>`).join('')}</tbody></table>`;$('commitImport').disabled=false;}
  async function findDuplicates(){const r=await call('adminFindDuplicateStudents');$('duplicateList').innerHTML=(r.groups||[]).map((g,gi)=>`<div class="card"><h3>Duplicate group ${gi+1}</h3>${g.map((s,i)=>`<label style="display:block;margin:8px 0"><input type="radio" name="keep${gi}" value="${esc(s.id)}" ${i===0?'checked':''}> Keep ${esc(s.fullName)} (${esc(s.regNumber)})</label>`).join('')}<label>Merge/remove <select data-merge-group="${gi}">${g.map(s=>`<option value="${esc(s.id)}">${esc(s.fullName)} — ${esc(s.regNumber)}</option>`).join('')}</select></label><button class="btn btn-primary btn-small" data-merge-run="${gi}" type="button" style="margin-top:8px">Merge selected duplicate</button></div>`).join('')||'<p>No duplicate groups found.</p>';}

  function bind(){
    $('enable2fa').onclick=async()=>{try{const r=await call('adminBeginTwoFactorSetup');$('twoFactorSetup').classList.remove('hidden');$('twoFactorSetup').innerHTML=`<p>Open Google Authenticator, Microsoft Authenticator or another TOTP app and choose <strong>Enter setup key</strong>.</p><p><strong>Account:</strong> SkyDream:${esc(data.account.username)}</p><p><strong>Setup key:</strong><br><code style="word-break:break-all">${esc(r.secret)}</code></p><div class="field"><label>6-digit code</label><input id="twoFactorCode" inputmode="numeric" maxlength="6"></div><button id="confirm2fa" class="btn btn-primary btn-small" type="button">Confirm & Enable</button>`;$('confirm2fa').onclick=async()=>{await call('adminConfirmTwoFactorSetup',{code:$('twoFactorCode').value});alert('2-step verification enabled.');await refresh();};}catch(e){alert(SkyDreamFirebase.friendlyError(e));}};
    $('disable2fa').onclick=async()=>{const code=prompt('Enter your current 6-digit authenticator code to disable 2-step verification:');if(code===null)return;try{await call('adminDisableTwoFactor',{code});alert('2-step verification disabled.');await refresh();}catch(e){alert(SkyDreamFirebase.friendlyError(e));}};
    $('signOutAllDevices').onclick=async()=>{if(!confirm('Sign out every session for your admin account?'))return;await call('adminRevokeAllSessions',{});await SkyDreamFirebase.auth.signOut();location.reload();};
    $('csvFile').onchange=e=>{const f=e.target.files&&e.target.files[0];importCsv='';$('commitImport').disabled=true;if(!f)return;const rd=new FileReader();rd.onload=()=>{importCsv=String(rd.result||'');$('importSummary').textContent=`Loaded ${f.name}. Click Preview.`;};rd.readAsText(f);};
    $('previewImport').onclick=()=>previewImport().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('commitImport').onclick=async()=>{if(!confirm('Import all valid rows and skip detected duplicates?'))return;const r=await call('adminCommitStudentImport',{csv:importCsv,skipDuplicates:true});alert(`${r.imported} imported; ${r.skipped} skipped.`);await refresh();};
    $('findDuplicates').onclick=()=>findDuplicates().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('createClassSession').onclick=async()=>{await call('adminCreateClassSession',{date:$('classDate').value,course:$('classCourse').value,facilitatorId:$('classFacilitator').value,title:$('classTitle').value});await refresh();};
    $('sessionEnforcement').onchange=async()=>{try{await call('adminSetSessionEnforcement',{enabled:$('sessionEnforcement').checked});}catch(e){$('sessionEnforcement').checked=!$('sessionEnforcement').checked;alert(SkyDreamFirebase.friendlyError(e));}};
    $('noteType').onchange=renderNoteTargets;$('noteTarget').onchange=renderNotes;
    $('addInternalNote').onclick=async()=>{const text=$('noteText').value.trim();if(!text)return;await call('adminAddInternalNote',{targetType:$('noteType').value,targetId:$('noteTarget').value,text});$('noteText').value='';await refresh();};
    $('refreshRecycle').onclick=()=>loadRecycle().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('runBackup').onclick=async()=>{const b=$('runBackup');b.disabled=true;$('backupStatus').textContent='Creating cloud backup…';try{const r=await call('adminRunManualBackup');$('backupStatus').textContent=`Backup created: ${r.path}`;}catch(e){$('backupStatus').textContent=SkyDreamFirebase.friendlyError(e);}finally{b.disabled=false;}};
    document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
      if(b.dataset.revokeSession){await call('adminRevokeSession',{id:b.dataset.revokeSession});await refresh();}
      else if(b.dataset.dismissNotification){await call('adminDismissNotification',{id:b.dataset.dismissNotification});await refresh();}
      else if(b.dataset.cohort){await call('adminSetCohortArchived',{intakeStart:b.dataset.cohort,archived:b.dataset.archived!=='true'});await refresh();}
      else if(b.dataset.sessionStatus){await call('adminUpdateClassSession',{id:b.dataset.sessionStatus,status:b.dataset.status});await refresh();}
      else if(b.dataset.deleteClass){if(confirm('Delete this class session?')){await call('adminDeleteClassSession',{id:b.dataset.deleteClass});await refresh();}}
      else if(b.dataset.deleteNote){if(confirm('Delete this internal note?')){await call('adminDeleteInternalNote',{id:b.dataset.deleteNote});await refresh();}}
      else if(b.dataset.restoreBin){await call('adminRestoreRecycleItem',{id:b.dataset.restoreBin});await loadRecycle();await refresh();}
      else if(b.dataset.purgeBin){if(confirm('Permanently delete this recycle item? This cannot be undone.')){await call('adminPurgeRecycleItem',{id:b.dataset.purgeBin});await loadRecycle();}}
      else if(b.dataset.mergeRun!==undefined){const gi=b.dataset.mergeRun,keep=document.querySelector(`input[name="keep${gi}"]:checked`),sel=document.querySelector(`[data-merge-group="${gi}"]`);if(!keep||!sel)return;if(keep.value===sel.value){alert('Choose a different record to merge/remove.');return;}if(confirm('Merge the selected duplicate into the record marked Keep?')){await call('adminMergeStudents',{keepId:keep.value,mergeId:sel.value});await findDuplicates();await refresh();}}
    }catch(err){alert(SkyDreamFirebase.friendlyError(err));}});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    inject();
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{if(!user)return;try{const t=await user.getIdTokenResult();if(t.claims.role==='admin'){await refresh();if((data.account&&data.account.role)==='owner')await loadRecycle();}}catch(e){console.warn('Enterprise admin tools could not load.',e);}});
  });
})();
