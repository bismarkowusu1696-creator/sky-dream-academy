(() => {
  let data = null;
  let importCsv = '';
  let recoveryStatus = null;
  let freshRecoveryCodes = [];
  let bulkPreview = null;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const date = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? (v || '') : d.toLocaleString('en-GB'); };
  const course = id => data && data.courses && data.courses[id] ? data.courses[id] : id || '';
  const call = (name, payload={}) => SkyDreamFirebase.call(name, payload);

  async function withBusy(button, busyText, task){
    if(!button || button.dataset.busy==='1') return;
    const normalText=button.textContent;
    button.dataset.busy='1';
    button.disabled=true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy','true');
    if(busyText) button.textContent=busyText;
    try{return await task();}
    finally{
      if(button.isConnected){
        button.disabled=false;
        button.classList.remove('is-busy');
        button.removeAttribute('aria-busy');
        delete button.dataset.busy;
        button.textContent=normalText;
      }
    }
  }

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
    nav('#bulkStudentCommunication','Bulk Communication');
    nav('#studentRiskCenter','AI Risk Centre');
    nav('#smartNotificationRules','Smart Rules');
    nav('#adminAssistant','Admin Assistant');
    nav('#studentImport','Import & Duplicates');
    nav('#cohortArchive','Intake Archive');
    nav('#classSessions','Class Sessions');
    nav('#facPerformance','Facilitator Performance');
    nav('#internalNotes','Internal Notes');
    nav('#changeHistory','Change History');
    nav('#recycleBin','Recycle Bin');
    nav('#cloudBackups','Cloud Backups');

    section('enterpriseSecurity','Security & Devices',`
      <div class="grid grid-2"><div class="card"><h3>2-step verification</h3><p id="twoFactorStatus" class="hint">Loading…</p><div class="toolbar"><button id="enable2fa" class="btn btn-primary btn-small" type="button">Set up authenticator</button><button id="disable2fa" class="btn btn-outline btn-small" type="button">Disable</button></div><div id="twoFactorSetup" class="hidden mt-12"></div></div>
      <div class="card"><h3>Admin sessions</h3><p class="hint">Review signed-in devices and revoke access.</p><button id="signOutAllDevices" class="btn btn-outline btn-small" type="button">Sign out all my devices</button></div></div>
      <div id="recoveryCodeCard" class="card mt-16 hidden"><div class="dashboard-top"><div><h3 class="m-0">Owner recovery codes</h3><p id="recoveryCodeStatus" class="hint">Loading…</p></div><button id="generateRecoveryCodes" class="btn btn-outline btn-small" type="button">Generate recovery codes</button></div><p class="hint">Recovery codes are one-time owner credentials for resetting a forgotten password. Generating a new set invalidates every previous code. Keep them offline and private. Password recovery does not disable authenticator 2-step verification.</p><div id="recoveryCodeOutput" class="hidden mt-12"></div></div>
      <div id="sessionList" class="grid mt-16"></div>`,'account');
    section('notificationsCenter','Notification Centre',`<p class="hint">New registrations, enquiries, capacity warnings, attendance warnings and deadlines appear here.</p><div id="notificationList" class="grid"></div>`,'account');
    section('bulkStudentCommunication','Bulk Student Communication',`
      <p class="hint">Send one private Student Portal message to a selected audience. Students who enabled phone notifications will also receive a generic “You have a new SkyDream message” push alert.</p>
      <div id="webPushSetupCard" class="card hidden"><h3>Web Push setup</h3><p id="webPushSetupStatus" class="hint">Loading…</p><div class="form-grid"><div class="field full"><label>Firebase Web Push public key</label><input id="webPushVapidKey" autocomplete="off" spellcheck="false" placeholder="Paste the public VAPID key from Firebase Cloud Messaging"></div><div class="field full"><button id="saveWebPushVapidKey" class="btn btn-outline btn-small" type="button">Save Web Push Key</button></div></div></div>
      <div class="card mt-14"><div class="form-grid">
        <div class="field"><label>Audience</label><select id="bulkTarget"><option value="course">Whole program — current intake</option><option value="intake">Specific intake</option><option value="owing-fees">Students owing fees — current intake</option><option value="low-attendance">Low-attendance students — current intake</option></select></div>
        <div id="bulkCourseField" class="field"><label>Program</label><select id="bulkCourse"></select></div>
        <div id="bulkIntakeField" class="field hidden"><label>Intake</label><select id="bulkIntake"></select></div>
        <div id="bulkAttendanceField" class="field hidden"><label>Attendance below</label><input id="bulkAttendanceThreshold" type="number" min="40" max="95" value="70"><span class="hint">Students need at least 3 recorded attendance sessions.</span></div>
        <div class="field full"><label>Portal message</label><textarea id="bulkMessage" rows="4" maxlength="1500" placeholder="Type the message students should see in their portal."></textarea></div>
      </div><div class="toolbar"><button id="previewBulkMessage" class="btn btn-outline" type="button">Preview Recipients</button><button id="sendBulkMessage" class="btn btn-primary" type="button" disabled>Send Message</button></div></div>
      <div id="bulkPreviewResult" class="mt-14"></div>`,'account');
    section('studentRiskCenter','AI Student Risk Centre',`
      <p class="hint">Explainable risk scoring uses attendance, consecutive absences, inactivity and outstanding fees. It does not make final decisions for you.</p>
      <div id="riskSummary" class="admin-suite-grid"></div>
      <div class="toolbar mt-16"><label>Show <select id="riskLevelFilter"><option value="">All risk levels</option><option>High</option><option>Medium</option><option>Low</option></select></label></div>
      <div class="table-wrap mt-14"><table class="table"><thead><tr><th>Student</th><th>Program</th><th>Score</th><th>Level</th><th>Attendance</th><th>Balance</th><th>Why</th><th></th></tr></thead><tbody id="riskTableBody"></tbody></table></div>`,'account');
    section('smartNotificationRules','Smart Notification Rules',`
      <p class="hint">These rules create private Student Portal alerts automatically. Automation is off by default and uses a cooldown to avoid repeated messages.</p>
      <div class="card"><div class="form-grid">
        <div class="field full"><label><input id="smartRulesEnabled" type="checkbox"> Enable automatic student notifications</label></div>
        <div class="field"><label><input id="smartAttendanceEnabled" type="checkbox"> Low attendance rule</label><input id="smartAttendanceThreshold" type="number" min="40" max="95"><span class="hint">Alert below this attendance %</span></div>
        <div class="field"><label>Minimum attendance records</label><input id="smartAttendanceMinMarks" type="number" min="1" max="20"></div>
        <div class="field"><label><input id="smartFeeEnabled" type="checkbox"> Outstanding fee rule</label><input id="smartFeeGraceDays" type="number" min="0" max="180"><span class="hint">Grace days after classes start</span></div>
        <div class="field"><label>Minimum balance (GHS)</label><input id="smartFeeMinBalance" type="number" min="0" step="1"></div>
        <div class="field"><label><input id="smartInactiveEnabled" type="checkbox"> Inactivity rule</label><input id="smartInactiveDays" type="number" min="7" max="90"><span class="hint">Days without attendance activity</span></div>
        <div class="field"><label><input id="smartHighRiskEnabled" type="checkbox"> High-risk rule</label><input id="smartHighRiskThreshold" type="number" min="35" max="95"><span class="hint">Risk score threshold</span></div>
        <div class="field"><label>Cooldown between repeat alerts</label><input id="smartCooldownDays" type="number" min="1" max="30"><span class="hint">Days</span></div>
      </div><div class="toolbar mt-14"><button id="saveSmartRules" class="btn btn-primary" type="button">Save Rules</button><button id="previewSmartRules" class="btn btn-outline" type="button">Preview Alerts</button><button id="runSmartRules" class="btn btn-outline" type="button">Run Now</button></div></div>
      <div id="smartRulePreview" class="mt-14"></div>`,'account');
    section('adminAssistant','Private Admin Assistant',`
      <p class="hint">Ask questions in normal language. Answers are calculated from SkyDream's own protected data and are not sent to an external AI provider.</p>
      <div class="card"><div class="field"><label>Ask SkyDream</label><textarea id="adminAssistantQuestion" rows="3" maxlength="400" placeholder="Example: Which students have attendance below 70%?"></textarea></div>
      <div class="toolbar"><button id="askAdminAssistant" class="btn btn-primary" type="button">Ask Assistant</button>
      <button class="btn btn-outline btn-small" type="button" data-assistant-question="Give me an overall summary">Summary</button>
      <button class="btn btn-outline btn-small" type="button" data-assistant-question="Show me the high-risk students">High risk</button>
      <button class="btn btn-outline btn-small" type="button" data-assistant-question="Who has attendance below 70%">Low attendance</button>
      <button class="btn btn-outline btn-small" type="button" data-assistant-question="Who owes fees">Outstanding fees</button></div></div>
      <div id="adminAssistantResult" class="mt-14"></div>`,'account');
    section('studentImport','Student Import & Duplicate Control',`
      <div class="grid grid-2"><div class="card"><h3>Import CSV</h3><input id="csvFile" type="file" accept=".csv,text/csv"><p class="hint">Recommended columns: Full Name, Mobile, Program, Email, Ghana Card, WhatsApp, Address, DOB, Gender.</p><div class="toolbar"><button id="previewImport" class="btn btn-outline btn-small" type="button">Preview</button><button id="commitImport" class="btn btn-primary btn-small" type="button" disabled>Import valid rows</button></div><div id="importSummary" class="hint"></div></div><div class="card"><h3>Duplicate detection</h3><p class="hint">Find records sharing a mobile number, email or Ghana Card.</p><button id="findDuplicates" class="btn btn-outline btn-small" type="button">Find duplicates</button></div></div><div id="importPreview" class="table-wrap mt-14"></div><div id="duplicateList" class="mt-14"></div>`,'account');
    section('cohortArchive','Intake / Cohort Archive',`<p class="hint">Archive completed intakes without deleting their student records.</p><div id="cohortList" class="grid grid-3"></div>`,'account');
    section('classSessions','Class Session Management',`
      <div class="card"><div class="form-grid"><div class="field"><label>Date</label><input id="classDate" type="date"></div><div class="field"><label>Program</label><select id="classCourse"></select></div><div class="field"><label>Facilitator</label><select id="classFacilitator"><option value="">Any assigned facilitator</option></select></div><div class="field"><label>Title</label><input id="classTitle" value="Class session"></div><div class="field full"><button id="createClassSession" class="btn btn-primary" type="button">Create Session</button></div></div></div><div class="my-14"><label><input id="sessionEnforcement" type="checkbox"> Require facilitators to use scheduled sessions when marking attendance</label></div><div id="classSessionList" class="grid"></div>`,'account');
    section('facPerformance','Facilitator Performance',`<div class="table-wrap"><table class="table"><thead><tr><th>Facilitator</th><th>Assigned students</th><th>Attendance marks</th><th>Sessions</th><th>Completed</th></tr></thead><tbody id="facPerformanceBody"></tbody></table></div>`,'account');
    section('internalNotes','Internal Admin Notes',`
      <div class="card"><div class="form-grid"><div class="field"><label>Target type</label><select id="noteType"><option value="student">Student</option><option value="facilitator">Facilitator</option><option value="intake">Intake</option></select></div><div class="field"><label>Target</label><select id="noteTarget"></select></div><div class="field full"><label>Private note</label><textarea id="noteText" rows="3" maxlength="1000"></textarea></div><div class="field full"><button id="addInternalNote" class="btn btn-primary" type="button">Add Note</button></div></div></div><div id="noteList" class="grid mt-14"></div>`,'account');
    section('changeHistory','Data Change History',`<p class="hint">Shows captured before/after changes for important administrative edits.</p><div id="historyList" class="admin-suite-log"></div>`,'account');
    section('recycleBin','Recycle Bin',`<p class="hint">Deleted records stay here for up to 30 days before the automated cleanup removes them permanently.</p><button id="refreshRecycle" class="btn btn-outline btn-small" type="button">Refresh</button><div id="recycleList" class="grid mt-14"></div>`,'account');
    section('cloudBackups','Automated Cloud Backups',`<div class="card"><h3>Daily backup</h3><p>Application data is backed up automatically each day at 2:30 AM Ghana time and retained for about 30 days.</p><button id="runBackup" class="btn btn-primary btn-small" type="button">Create Backup Now</button><p id="backupStatus" class="hint"></p></div>`,'account');
    bind();
  }

  async function refresh(){ data=await call('adminGetEnterpriseSnapshot'); render(); if(data.account&&data.account.role==='owner')loadRecoveryStatus().catch(e=>console.warn('Recovery status could not load',e)); }
  function queueRefresh(){setTimeout(()=>refresh().catch(e=>console.warn('Background enterprise refresh failed',e)),1600);}
  function queueRecycle(){setTimeout(()=>loadRecycle().catch(e=>console.warn('Background recycle refresh failed',e)),1600);}
  function render(){ if(!data)return; renderSecurity();renderNotifications();renderRisk();renderSmartRules();renderWebPushSetup();renderCohorts();renderSessions();renderPerformance();renderNotes();renderHistory();populateSelectors(); }
  function populateSelectors(){
    if($('classCourse')) $('classCourse').innerHTML=Object.entries(data.courses||{}).map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('');
    if($('bulkCourse')) $('bulkCourse').innerHTML=Object.entries(data.courses||{}).map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('');
    if($('bulkIntake')) $('bulkIntake').innerHTML=(data.cohorts||[]).map(c=>`<option value="${esc(c.intakeStart)}">${esc(c.label||c.intakeStart)} (${Number(c.students)||0})</option>`).join('');
    if($('classFacilitator')) $('classFacilitator').innerHTML='<option value="">Any assigned facilitator</option>'+(data.facilitators||[]).map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    renderNoteTargets();
    if($('sessionEnforcement')) $('sessionEnforcement').checked=!!(data.settings&&data.settings.sessionEnforcement);
  }
  function renderSecurity(){
    $('twoFactorStatus').textContent=data.twoFactorEnabled?'Enabled — authenticator code is required at login.':'Not enabled.';
    $('enable2fa').classList.toggle('hidden',data.twoFactorEnabled);$('disable2fa').classList.toggle('hidden',!data.twoFactorEnabled);
    $('sessionList').innerHTML=(data.sessions||[]).map(s=>`<div class="card"><div class="dashboard-top"><strong>${esc(s.username)}</strong><span class="badge">${s.revoked?'Revoked':'Active'}</span></div><p><small>${esc(date(s.createdAt))}</small></p><p class="hint">${esc(s.userAgent||'Unknown device')}<br>${esc(s.ip||'IP unavailable')}</p>${!s.revoked?`<button class="btn btn-outline btn-small" data-revoke-session="${esc(s.id)}">Revoke</button>`:''}</div>`).join('')||'<p>No recorded sessions yet. Sign out and sign in again to create a device-bound session.</p>';
  }

  function renderRecoveryStatus(){
    const card=$('recoveryCodeCard'),status=$('recoveryCodeStatus');if(!card||!status)return;
    const owner=data&&data.account&&data.account.role==='owner';card.classList.toggle('hidden',!owner);if(!owner)return;
    if(!recoveryStatus){status.textContent='No recovery codes configured yet.';return;}
    status.textContent=recoveryStatus.configured
      ? `${Number(recoveryStatus.remaining)||0} unused recovery code(s) remaining${recoveryStatus.generatedAt?' · generated '+date(recoveryStatus.generatedAt):''}.`
      : 'No recovery codes configured yet.';
  }
  async function loadRecoveryStatus(){
    if(!(data&&data.account&&data.account.role==='owner'))return;
    recoveryStatus=await call('adminGetRecoveryCodeStatus');
    renderRecoveryStatus();
  }
  function recoveryCodesText(){
    return ['SkyDream Skills Training Academy — OWNER RECOVERY CODES','Generated: '+new Date().toLocaleString('en-GB'),'','Store these codes offline. Each code works once. Generating a new set invalidates this set.','',...freshRecoveryCodes].join('\n');
  }
  function showRecoveryCodes(codes){
    freshRecoveryCodes=Array.isArray(codes)?codes:[];
    const host=$('recoveryCodeOutput');if(!host)return;
    host.classList.remove('hidden');
    host.innerHTML=`<div class="notice notice-info"><strong>Save these codes now.</strong> They will not be shown again after you leave or refresh this page.</div><pre class="pre-wrap-overflow">${esc(freshRecoveryCodes.join('\n'))}</pre><div class="toolbar"><button id="copyRecoveryCodes" class="btn btn-outline btn-small" type="button">Copy codes</button><button id="downloadRecoveryCodes" class="btn btn-primary btn-small" type="button">Download .txt</button></div>`;
    $('copyRecoveryCodes').onclick=async()=>{try{await navigator.clipboard.writeText(recoveryCodesText());alert('Recovery codes copied.');}catch(_){alert('Copy failed. Use the Download button instead.');}};
    $('downloadRecoveryCodes').onclick=()=>{const blob=new Blob([recoveryCodesText()],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SkyDream-owner-recovery-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  }
  async function generateRecoveryCodes(){
    if(!confirm('Generate a new set of owner recovery codes? Any older recovery codes will stop working immediately.'))return;
    const b=$('generateRecoveryCodes');await withBusy(b,'Generating…',async()=>{
      const result=await call('adminGenerateRecoveryCodes');
      recoveryStatus={configured:true,remaining:result.remaining,generatedAt:result.generatedAt,lastUsedAt:''};
      renderRecoveryStatus();showRecoveryCodes(result.codes||[]);
    });
  }

  function renderNotifications(){ $('notificationList').innerHTML=(data.notifications||[]).map(n=>`<div class="card" data-notification-card="${esc(n.id)}"><div class="dashboard-top"><strong>${esc(n.title)}</strong><small>${esc(date(n.date))}</small></div><p>${esc(n.message)}</p><button class="btn btn-outline btn-small" data-dismiss-notification="${esc(n.id)}">Dismiss</button></div>`).join('')||'<p>No notifications need your attention.</p>'; }

  function renderWebPushSetup(){
    const card=$('webPushSetupCard'),status=$('webPushSetupStatus'),input=$('webPushVapidKey');
    if(!card||!status||!input)return;
    const owner=data&&data.account&&data.account.role==='owner';
    card.classList.toggle('hidden',!owner);
    if(!owner)return;
    const key=data.settings&&data.settings.webPushVapidKey||'';
    input.value=key;
    status.textContent=key?'Configured — students can enable push notifications on supported browsers.':'Not configured — Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate Key Pair, then paste the public key here.';
  }
  async function saveWebPushVapidKey(){
    const key=$('webPushVapidKey').value.trim();
    if(!key){alert('Paste the public Web Push key first.');return;}
    const b=$('saveWebPushVapidKey');await withBusy(b,'Saving…',async()=>{
      await call('adminSetWebPushVapidKey',{vapidKey:key});
      data.settings=data.settings||{};data.settings.webPushVapidKey=key;renderWebPushSetup();
      alert('SkyDream Web Push is configured.');
    });
  }

  function updateBulkTargetFields(){
    if(!$('bulkTarget'))return;
    const target=$('bulkTarget').value;
    $('bulkCourseField').classList.toggle('hidden',target!=='course');
    $('bulkIntakeField').classList.toggle('hidden',target!=='intake');
    $('bulkAttendanceField').classList.toggle('hidden',target!=='low-attendance');
    bulkPreview=null;$('sendBulkMessage').disabled=true;$('bulkPreviewResult').innerHTML='';
  }
  function bulkPayload(){
    const target=$('bulkTarget').value;
    return{
      target,
      value:target==='course'?$('bulkCourse').value:(target==='intake'?$('bulkIntake').value:''),
      attendanceThreshold:Number($('bulkAttendanceThreshold').value)||70,
      minAttendanceMarks:3
    };
  }
  function renderBulkPreview(result){
    bulkPreview={...bulkPayload(),count:Number(result.count)||0};
    const sample=result.sample||[],host=$('bulkPreviewResult');
    host.innerHTML=`<div class="card"><strong>${bulkPreview.count} student(s) selected</strong><p class="hint">Recipient selection is recalculated again when you press Send.</p></div>`+
      (sample.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Reg no.</th><th>Program</th><th>Intake</th></tr></thead><tbody>${sample.map(s=>`<tr><td>${esc(s.fullName)}</td><td>${esc(s.regNumber)}</td><td>${esc(s.courseName)}</td><td>${esc(s.intakeStart||'')}</td></tr>`).join('')}</tbody></table></div>`:'');
    $('sendBulkMessage').disabled=bulkPreview.count<1;
  }
  async function previewBulkMessage(){
    const b=$('previewBulkMessage');await withBusy(b,'Checking…',async()=>{const result=await call('adminPreviewBulkStudentMessage',bulkPayload());renderBulkPreview(result);});
  }
  async function sendBulkMessage(){
    const body=$('bulkMessage').value.trim();if(!body){alert('Enter the portal message first.');return;}
    const preview=await call('adminPreviewBulkStudentMessage',bulkPayload());
    if(!preview.count){renderBulkPreview(preview);alert('No students match this audience.');return;}
    renderBulkPreview(preview);
    if(!confirm(`Send this private portal message to ${preview.count} student(s)?`))return;
    const b=$('sendBulkMessage');await withBusy(b,'Sending…',async()=>{
      const result=await call('adminSendBulkStudentMessage',{...bulkPayload(),message:body});
      const pushed=result.push&&result.push.sent||0;
      alert(`Message sent to ${result.recipients||0} student(s). Push notification delivered to ${pushed} subscribed device(s).`);
      $('bulkMessage').value='';bulkPreview=null;$('sendBulkMessage').disabled=true;$('bulkPreviewResult').innerHTML='';
      queueRefresh();
    });
  }


  function renderRisk(){
    if(!$('riskTableBody'))return;
    const rows=data.riskAnalysis||[],summary=data.riskSummary||{high:0,medium:0,low:0,total:0},filter=$('riskLevelFilter')&&$('riskLevelFilter').value;
    $('riskSummary').innerHTML=`<div class="admin-suite-kpi"><b>${summary.high||0}</b><span>High risk</span></div><div class="admin-suite-kpi"><b>${summary.medium||0}</b><span>Medium risk</span></div><div class="admin-suite-kpi"><b>${summary.low||0}</b><span>Low risk</span></div><div class="admin-suite-kpi"><b>${summary.total||0}</b><span>Students analysed</span></div>`;
    const shown=rows.filter(r=>!filter||r.level===filter);
    $('riskTableBody').innerHTML=shown.length?shown.map(r=>`<tr><td><strong>${esc(r.fullName)}</strong><br><small>${esc(r.regNumber)}</small></td><td>${esc(course(r.course))}</td><td><strong>${Number(r.score)||0}/100</strong></td><td><span class="badge">${esc(r.level)}</span></td><td>${Number(r.attendance)||0}%</td><td>GHS ${Number(r.balance||0).toFixed(2)}</td><td>${esc((r.reasons||[]).join('; ')||'No major risk signals')}</td><td><button class="btn btn-outline btn-small" type="button" data-risk-student="${esc(r.id)}">Profile</button></td></tr>`).join(''):'<tr><td colspan="8">No students match this risk level.</td></tr>';
  }
  function renderSmartRules(){
    const r=data.smartNotificationRules||{};
    if(!$('smartRulesEnabled'))return;
    $('smartRulesEnabled').checked=!!r.enabled;
    $('smartAttendanceEnabled').checked=r.attendance?.enabled!==false;$('smartAttendanceThreshold').value=r.attendance?.threshold??70;$('smartAttendanceMinMarks').value=r.attendance?.minMarks??3;
    $('smartFeeEnabled').checked=r.feeBalance?.enabled!==false;$('smartFeeGraceDays').value=r.feeBalance?.graceDays??14;$('smartFeeMinBalance').value=r.feeBalance?.minBalance??1;
    $('smartInactiveEnabled').checked=r.inactivity?.enabled!==false;$('smartInactiveDays').value=r.inactivity?.days??14;
    $('smartHighRiskEnabled').checked=r.highRisk?.enabled!==false;$('smartHighRiskThreshold').value=r.highRisk?.threshold??65;
    $('smartCooldownDays').value=r.cooldownDays??7;
  }
  function smartRulesPayload(){
    return{enabled:$('smartRulesEnabled').checked,attendance:{enabled:$('smartAttendanceEnabled').checked,threshold:Number($('smartAttendanceThreshold').value),minMarks:Number($('smartAttendanceMinMarks').value)},feeBalance:{enabled:$('smartFeeEnabled').checked,graceDays:Number($('smartFeeGraceDays').value),minBalance:Number($('smartFeeMinBalance').value)},inactivity:{enabled:$('smartInactiveEnabled').checked,days:Number($('smartInactiveDays').value)},highRisk:{enabled:$('smartHighRiskEnabled').checked,threshold:Number($('smartHighRiskThreshold').value)},cooldownDays:Number($('smartCooldownDays').value)};
  }
  function renderSmartPreview(result){
    const host=$('smartRulePreview');if(!host)return;const rows=result.alerts||[];
    host.innerHTML=`<div class="card"><strong>${Number(result.eligible)||0} alert(s) currently eligible</strong><p class="hint">${Number(result.total)||0} rule match(es) before cooldown filtering.</p></div>`+(rows.length?rows.slice(0,30).map(a=>`<div class="card"><div class="dashboard-top"><strong>${esc(a.studentName)}</strong><span class="badge">${esc(a.rule)}</span></div><p>${esc(a.message)}</p></div>`).join(''):'');
  }
  async function saveSmartRules(){
    const b=$('saveSmartRules');await withBusy(b,'Saving…',async()=>{const r=await call('adminSaveSmartNotificationRules',{rules:smartRulesPayload()});data.smartNotificationRules=r.rules;renderSmartRules();alert(r.rules.enabled?'Smart notifications enabled.':'Rules saved. Automatic notifications remain off.');});
  }
  async function previewSmartRules(){
    const b=$('previewSmartRules');await withBusy(b,'Checking…',async()=>{const r=await call('adminPreviewSmartNotificationRules',{rules:smartRulesPayload()});renderSmartPreview(r);});
  }
  async function runSmartRules(){
    if(!$('smartRulesEnabled').checked){alert('Enable automatic student notifications and save the rules first.');return;}
    if(!confirm('Run the saved smart rules now and send eligible Student Portal alerts?'))return;
    const b=$('runSmartRules');await withBusy(b,'Running…',async()=>{const r=await call('adminRunSmartNotificationRules');alert(r.disabled?'Automation is disabled.':`${r.sent||0} Student Portal alert(s) sent.`);queueRefresh();});
  }
  function renderAssistantResult(result){
    const host=$('adminAssistantResult');if(!host)return;const rows=result.rows||[];
    let table='';
    if(rows.length){const cols=Object.keys(rows[0]);table=`<div class="table-wrap"><table class="table"><thead><tr>${cols.map(k=>`<th>${esc(k.replace(/([A-Z])/g,' $1'))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${cols.map(k=>`<td>${esc(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
    host.innerHTML=`<div class="card"><div class="dashboard-top"><strong>SkyDream Assistant</strong><small>${esc(date(result.asOf))}</small></div><p class="pre-wrap">${esc(result.answer||'')}</p></div>`+table;
  }
  async function askAssistant(question){
    const q=(question||$('adminAssistantQuestion').value||'').trim();if(!q)return;
    $('adminAssistantQuestion').value=q;const b=$('askAdminAssistant');await withBusy(b,'Thinking…',async()=>{const r=await call('adminAskAssistant',{question:q});renderAssistantResult(r);});
  }
  function openRiskStudent(id){
    const s=(data.students||[]).find(x=>x.id===id);if(!s)return;
    const search=document.getElementById('suiteStudentSearch');if(search){search.value=s.regNumber||s.fullName;search.dispatchEvent(new Event('input'));location.hash='studentProfiles';}
  }

  function renderCohorts(){ $('cohortList').innerHTML=(data.cohorts||[]).map(c=>`<div class="card"><div class="dashboard-top"><h3>${esc(c.label||c.intakeStart)}</h3><span class="badge">${c.archived?'Archived':'Active'}</span></div><p>${Number(c.students)||0} student(s)</p>${/^\d{4}-/.test(c.intakeStart)?`<button class="btn btn-outline btn-small" data-cohort="${esc(c.intakeStart)}" data-archived="${c.archived?'true':'false'}">${c.archived?'Restore':'Archive'}</button>`:''}</div>`).join('')||'<p>No intake records yet.</p>'; }
  function renderSessions(){ $('classSessionList').innerHTML=(data.classSessions||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(s=>{const f=(data.facilitators||[]).find(x=>x.id===s.facilitatorId);return `<div class="card"><div class="dashboard-top"><strong>${esc(s.title||'Class session')}</strong><span class="badge">${esc(s.status||'Scheduled')}</span></div><p>${esc(s.date)} · ${esc(course(s.course))}</p><p class="hint">${esc(f?f.name:'Any assigned facilitator')}</p><div class="toolbar"><button class="btn btn-outline btn-small" data-session-status="${esc(s.id)}" data-status="Completed">Complete</button><button class="btn btn-outline btn-small" data-session-status="${esc(s.id)}" data-status="Cancelled">Cancel</button><button class="btn btn-danger btn-small" data-delete-class="${esc(s.id)}">Delete</button></div></div>`;}).join('')||'<p>No class sessions have been created.</p>'; }
  function renderPerformance(){ $('facPerformanceBody').innerHTML=(data.facilitatorPerformance||[]).map(f=>`<tr><td><strong>${esc(f.name)}</strong><br><small>@${esc(f.username)}</small></td><td>${f.assignedStudents}</td><td>${f.attendanceMarks}</td><td>${f.sessions}</td><td>${f.completedSessions}</td></tr>`).join('')||'<tr><td colspan="5">No facilitator data.</td></tr>'; }
  function renderNoteTargets(){const type=$('noteType')?$('noteType').value:'student';let rows=[];if(type==='student')rows=(data.students||[]).map(s=>[s.id,`${s.fullName} — ${s.regNumber}`]);else if(type==='facilitator')rows=(data.facilitators||[]).map(f=>[f.id,f.name]);else rows=(data.cohorts||[]).map(c=>[c.intakeStart,c.label||c.intakeStart]);$('noteTarget').innerHTML=rows.map(([id,n])=>`<option value="${esc(id)}">${esc(n)}</option>`).join('');renderNotes();}
  function renderNotes(){if(!$('noteTarget'))return;const type=$('noteType').value,target=$('noteTarget').value;$('noteList').innerHTML=(data.internalNotes||[]).filter(n=>n.targetType===type&&n.targetId===target).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(n=>`<div class="card"><div class="dashboard-top"><strong>@${esc(n.createdBy)}</strong><small>${esc(date(n.date))}</small></div><p class="pre-wrap">${esc(n.text)}</p><button class="btn btn-danger btn-small" data-delete-note="${esc(n.id)}">Delete</button></div>`).join('')||'<p>No internal notes for this record.</p>';}
  function renderHistory(){ $('historyList').innerHTML=(data.changeHistory||[]).slice(0,100).map(h=>`<div class="admin-suite-log-item"><strong>${esc(h.action)}</strong><small>${esc(date(h.date))} · @${esc(h.admin)} · ${esc(h.entityType)} ${esc(h.entityId)}</small><details><summary>View before / after</summary><pre class="pre-wrap-overflow">${esc(JSON.stringify({before:h.before,after:h.after},null,2))}</pre></details></div>`).join('')||'<p>No captured change history yet.</p>'; }

  async function loadRecycle(){const r=await call('adminGetRecycleBin');$('recycleList').innerHTML=(r.items||[]).map(i=>`<div class="card"><div class="dashboard-top"><strong>${esc(i.type)}</strong><small>${esc(date(i.deletedAt))}</small></div><p>${esc(i.record&&((i.record.fullName||i.record.name||i.record.username||i.record.message||i.record.id))||'Record')}</p><p class="hint">Deleted by @${esc(i.deletedBy)}</p><div class="toolbar"><button class="btn btn-primary btn-small" data-restore-bin="${esc(i.id)}">Restore</button><button class="btn btn-danger btn-small" data-purge-bin="${esc(i.id)}">Delete permanently</button></div></div>`).join('')||'<p>Recycle bin is empty.</p>';}
  async function previewImport(){if(!importCsv){alert('Choose a CSV file first.');return;}const r=await call('adminPreviewStudentImport',{csv:importCsv});$('importSummary').textContent=`${r.total} row(s): ${r.valid} clean, ${r.duplicates} possible duplicate(s).`;const rows=(r.rows||[]).slice(0,50);$('importPreview').innerHTML=`<table class="table"><thead><tr><th>Row</th><th>Name</th><th>Mobile</th><th>Program</th><th>Issues</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.row}</td><td>${esc(x.fullName)}</td><td>${esc(x.mobile)}</td><td>${esc(course(x.course))}</td><td>${esc((x.issues||[]).join(', ')||'Ready')}</td></tr>`).join('')}</tbody></table>`;$('commitImport').disabled=false;}
  async function findDuplicates(){const r=await call('adminFindDuplicateStudents');$('duplicateList').innerHTML=(r.groups||[]).map((g,gi)=>`<div class="card"><h3>Duplicate group ${gi+1}</h3>${g.map((s,i)=>`<label class="block-my-8"><input type="radio" name="keep${gi}" value="${esc(s.id)}" ${i===0?'checked':''}> Keep ${esc(s.fullName)} (${esc(s.regNumber)})</label>`).join('')}<label>Merge/remove <select data-merge-group="${gi}">${g.map(s=>`<option value="${esc(s.id)}">${esc(s.fullName)} — ${esc(s.regNumber)}</option>`).join('')}</select></label><button class="btn btn-primary btn-small mt-8" data-merge-run="${gi}" type="button">Merge selected duplicate</button></div>`).join('')||'<p>No duplicate groups found.</p>';}

  function bind(){
    $('enable2fa').onclick=async()=>{try{const r=await call('adminBeginTwoFactorSetup');$('twoFactorSetup').classList.remove('hidden');$('twoFactorSetup').innerHTML=`<p>Open Google Authenticator, Microsoft Authenticator or another TOTP app and choose <strong>Enter setup key</strong>.</p><p><strong>Account:</strong> SkyDream:${esc(data.account.username)}</p><p><strong>Setup key:</strong><br><code class="break-all">${esc(r.secret)}</code></p><div class="field"><label>6-digit code</label><input id="twoFactorCode" inputmode="numeric" maxlength="6"></div><button id="confirm2fa" class="btn btn-primary btn-small" type="button">Confirm & Enable</button>`;$('confirm2fa').onclick=async()=>{await call('adminConfirmTwoFactorSetup',{code:$('twoFactorCode').value});data.twoFactorEnabled=true;renderSecurity();alert('2-step verification enabled.');queueRefresh();};}catch(e){alert(SkyDreamFirebase.friendlyError(e));}};
    $('disable2fa').onclick=async()=>{const code=prompt('Enter your current 6-digit authenticator code to disable 2-step verification:');if(code===null)return;try{await call('adminDisableTwoFactor',{code});data.twoFactorEnabled=false;renderSecurity();alert('2-step verification disabled.');queueRefresh();}catch(e){alert(SkyDreamFirebase.friendlyError(e));}};
    $('signOutAllDevices').onclick=async()=>{if(!confirm('Sign out every session for your admin account?'))return;await call('adminRevokeAllSessions',{});await SkyDreamFirebase.auth.signOut();location.reload();};
    $('generateRecoveryCodes').onclick=()=>generateRecoveryCodes().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('saveWebPushVapidKey').onclick=()=>saveWebPushVapidKey().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('bulkTarget').onchange=updateBulkTargetFields;
    $('bulkCourse').onchange=updateBulkTargetFields;
    $('bulkIntake').onchange=updateBulkTargetFields;
    $('bulkAttendanceThreshold').oninput=updateBulkTargetFields;
    $('previewBulkMessage').onclick=()=>previewBulkMessage().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('sendBulkMessage').onclick=()=>sendBulkMessage().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    updateBulkTargetFields();
    $('csvFile').onchange=e=>{const f=e.target.files&&e.target.files[0];importCsv='';$('commitImport').disabled=true;if(!f)return;const rd=new FileReader();rd.onload=()=>{importCsv=String(rd.result||'');$('importSummary').textContent=`Loaded ${f.name}. Click Preview.`;};rd.readAsText(f);};
    $('previewImport').onclick=()=>previewImport().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('commitImport').onclick=async()=>{if(!confirm('Import all valid rows and skip detected duplicates?'))return;const b=$('commitImport');await withBusy(b,'Importing…',async()=>{const r=await call('adminCommitStudentImport',{csv:importCsv,skipDuplicates:true});alert(`${r.imported} imported; ${r.skipped} skipped.`);queueRefresh();});};
    $('findDuplicates').onclick=()=>findDuplicates().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('createClassSession').onclick=async()=>{const b=$('createClassSession');await withBusy(b,'Creating…',async()=>{await call('adminCreateClassSession',{date:$('classDate').value,course:$('classCourse').value,facilitatorId:$('classFacilitator').value,title:$('classTitle').value});alert('Class session created.');queueRefresh();});};
    $('sessionEnforcement').onchange=async()=>{try{await call('adminSetSessionEnforcement',{enabled:$('sessionEnforcement').checked});}catch(e){$('sessionEnforcement').checked=!$('sessionEnforcement').checked;alert(SkyDreamFirebase.friendlyError(e));}};
    $('noteType').onchange=renderNoteTargets;$('noteTarget').onchange=renderNotes;
    $('addInternalNote').onclick=async()=>{const text=$('noteText').value.trim();if(!text)return;const b=$('addInternalNote');await withBusy(b,'Adding…',async()=>{await call('adminAddInternalNote',{targetType:$('noteType').value,targetId:$('noteTarget').value,text});$('noteText').value='';alert('Note added.');queueRefresh();});};
    $('refreshRecycle').onclick=()=>loadRecycle().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('runBackup').onclick=async()=>{const b=$('runBackup');b.disabled=true;$('backupStatus').textContent='Creating cloud backup…';try{const r=await call('adminRunManualBackup');$('backupStatus').textContent=`Backup created: ${r.path}`;}catch(e){$('backupStatus').textContent=SkyDreamFirebase.friendlyError(e);}finally{b.disabled=false;}};
    $('riskLevelFilter').onchange=renderRisk;
    $('saveSmartRules').onclick=()=>saveSmartRules().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('previewSmartRules').onclick=()=>previewSmartRules().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('runSmartRules').onclick=()=>runSmartRules().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('askAdminAssistant').onclick=()=>askAssistant().catch(e=>alert(SkyDreamFirebase.friendlyError(e)));
    $('adminAssistantQuestion').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();askAssistant().catch(err=>alert(SkyDreamFirebase.friendlyError(err)));}});

    document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.dataset.busy==='1')return;try{
      if(b.dataset.assistantQuestion){await askAssistant(b.dataset.assistantQuestion);}
      else if(b.dataset.riskStudent){openRiskStudent(b.dataset.riskStudent);}
      else if(b.dataset.revokeSession){await withBusy(b,'Revoking…',async()=>{const id=b.dataset.revokeSession;await call('adminRevokeSession',{id});const row=(data.sessions||[]).find(s=>s.id===id);if(row)row.revoked=true;renderSecurity();queueRefresh();});}
      else if(b.dataset.dismissNotification){
        const id=b.dataset.dismissNotification;
        const previous=(data.notifications||[]).slice();
        data.notifications=previous.filter(n=>n.id!==id);
        renderNotifications();
        try{await call('adminDismissNotification',{id});}
        catch(err){data.notifications=previous;renderNotifications();throw err;}
      }
      else if(b.dataset.cohort){await withBusy(b,b.dataset.archived==='true'?'Restoring…':'Archiving…',async()=>{const intakeStart=b.dataset.cohort,archived=b.dataset.archived!=='true';await call('adminSetCohortArchived',{intakeStart,archived});const row=(data.cohorts||[]).find(x=>x.intakeStart===intakeStart);if(row)row.archived=archived;renderCohorts();queueRefresh();});}
      else if(b.dataset.sessionStatus){await withBusy(b,'Saving…',async()=>{const id=b.dataset.sessionStatus,status=b.dataset.status;await call('adminUpdateClassSession',{id,status});const row=(data.classSessions||[]).find(x=>x.id===id);if(row)row.status=status;renderSessions();queueRefresh();});}
      else if(b.dataset.deleteClass){if(confirm('Delete this class session?'))await withBusy(b,'Deleting…',async()=>{const id=b.dataset.deleteClass;await call('adminDeleteClassSession',{id});data.classSessions=(data.classSessions||[]).filter(x=>x.id!==id);renderSessions();queueRefresh();});}
      else if(b.dataset.deleteNote){if(confirm('Delete this internal note?'))await withBusy(b,'Deleting…',async()=>{const id=b.dataset.deleteNote;await call('adminDeleteInternalNote',{id});data.internalNotes=(data.internalNotes||[]).filter(x=>x.id!==id);renderNotes();queueRefresh();});}
      else if(b.dataset.restoreBin){await withBusy(b,'Restoring…',async()=>{await call('adminRestoreRecycleItem',{id:b.dataset.restoreBin});alert('Item restored.');queueRecycle();queueRefresh();});}
      else if(b.dataset.purgeBin){if(confirm('Permanently delete this recycle item? This cannot be undone.'))await withBusy(b,'Deleting…',async()=>{await call('adminPurgeRecycleItem',{id:b.dataset.purgeBin});queueRecycle();});}
      else if(b.dataset.mergeRun!==undefined){const gi=b.dataset.mergeRun,keep=document.querySelector(`input[name="keep${gi}"]:checked`),sel=document.querySelector(`[data-merge-group="${gi}"]`);if(!keep||!sel)return;if(keep.value===sel.value){alert('Choose a different record to merge/remove.');return;}if(confirm('Merge the selected duplicate into the record marked Keep?'))await withBusy(b,'Merging…',async()=>{await call('adminMergeStudents',{keepId:keep.value,mergeId:sel.value});alert('Duplicate records merged.');setTimeout(()=>findDuplicates().catch(e=>console.warn('Background duplicate refresh failed',e)),1600);queueRefresh();});}
    }catch(err){alert(SkyDreamFirebase.friendlyError(err));}});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    inject();
    window.addEventListener('skydream-owner-session-ready',async()=>{
      try {
        await refresh();
        if(data.account&&data.account.role==='owner')await loadRecycle();
      } catch(e) {
        console.warn('Enterprise admin tools could not load.',e);
      }
    });
  });
})();
