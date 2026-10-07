(() => {
  let suite = null;
  let selectedStudentId = null;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const courseName = id => suite && suite.courses && suite.courses[id] ? suite.courses[id] : id || '';
  const friendlyDate = value => { const d = new Date(value || ''); return Number.isNaN(d.getTime()) ? (value || '') : d.toLocaleString('en-GB'); };
  const can = permission => !suite || !Array.isArray(suite.permissions) || suite.permissions.includes('*') || suite.permissions.includes(permission);

  function addNavLink(href, label, beforeHref) {
    const nav = document.querySelector('.dashboard-sidebar nav');
    if (!nav || nav.querySelector(`a[href="${href}"]`)) return;
    const a = document.createElement('a'); a.href = href; a.textContent = label;
    const before = beforeHref ? nav.querySelector(`a[href="${beforeHref}"]`) : null;
    nav.insertBefore(a, before || nav.querySelector('button') || null);
  }

  function injectUi() {
    const main = document.querySelector('.dashboard-main');
    if (!main || $('adminAnalytics')) return;
    addNavLink('#adminAnalytics', 'Analytics', '#students');
    addNavLink('#studentProfiles', 'Student Profiles', '#capacity');
    addNavLink('#attendanceReports', 'Attendance Reports', '#facilitators');
    addNavLink('#facilitatorManagement', 'Facilitator Management', '#admins');
    addNavLink('#adminRoles', 'Roles & Permissions', '#messages');
    addNavLink('#reportsBackup', 'Reports & Backup', '#messages');
    addNavLink('#registrationSettings', 'Registration Settings', '#messages');
    addNavLink('#scheduledAnnouncements', 'Schedule Notices', '#messages');
    addNavLink('#activityLog', 'Activity Log', '#account');

    const overview = $('overview');
    const analytics = document.createElement('section');
    analytics.id = 'adminAnalytics'; analytics.className = 'dashboard-panel';
    analytics.innerHTML = `<h2>Dashboard analytics</h2><div id="suiteKpis" class="admin-suite-grid"></div><div class="card mt-18"><h3>Registrations by program</h3><div id="suiteProgramBars"></div></div>`;
    overview.parentNode.insertBefore(analytics, overview.nextSibling);

    const students = $('students');
    const profiles = document.createElement('section');
    profiles.id = 'studentProfiles'; profiles.className = 'dashboard-panel';
    profiles.innerHTML = `<div class="dashboard-top"><div><h2>Student profiles & bulk actions</h2><p class="hint">Open a complete student record, print an ID card, or update several students at once.</p></div></div>
      <div class="admin-suite-toolbar mb-14"><div class="field"><label>Search</label><input id="suiteStudentSearch" placeholder="Name, registration number or phone"></div><div class="field"><label>Bulk status</label><select id="suiteBulkStatus"><option value="">No status change</option><option>Registered</option><option>Active</option><option>Completed</option><option>Deferred</option><option>Cancelled</option></select></div><div class="field"><label>Bulk program</label><select id="suiteBulkCourse"><option value="">No program change</option></select></div><button id="suiteBulkApply" class="btn btn-primary btn-small" type="button">Apply to selected</button></div>
      <div class="admin-suite-profile"><div><div class="admin-suite-list" id="suiteStudentList"></div></div><div id="suiteStudentProfile" class="admin-suite-profile-card"><p class="admin-suite-muted">Choose a student to view the full profile.</p></div></div>`;
    students.parentNode.insertBefore(profiles, students.nextSibling);

    const attendance = document.createElement('section');
    attendance.id = 'attendanceReports'; attendance.className = 'dashboard-panel';
    attendance.innerHTML = `<h2>Attendance reports</h2><div class="admin-suite-toolbar"><div class="field"><label>Program</label><select id="suiteAttendanceCourse"><option value="">All programs</option></select></div><div class="field"><label>From</label><input id="suiteAttendanceFrom" type="date"></div><div class="field"><label>To</label><input id="suiteAttendanceTo" type="date"></div><button id="suiteAttendanceRefresh" type="button" class="btn btn-outline btn-small">Refresh</button></div><div id="suiteAttendanceSummary" class="admin-suite-grid mt-16"></div><div class="table-wrap mt-16"><table class="table"><thead><tr><th>Student</th><th>Program</th><th>Present</th><th>Absent</th><th>Marked</th><th>Attendance %</th></tr></thead><tbody id="suiteAttendanceBody"></tbody></table></div>`;
    const facilitatorsSection = $('facilitators');
    facilitatorsSection.parentNode.insertBefore(attendance, facilitatorsSection);

    const facManage = document.createElement('section');
    facManage.id = 'facilitatorManagement'; facManage.className = 'dashboard-panel';
    facManage.innerHTML = `<h2>Facilitator management</h2><p class="hint">Edit facilitator details, assigned programs, and temporarily disable access.</p><div id="suiteFacilitatorCards" class="grid grid-3"></div><div id="suiteFacEditor" class="card admin-suite-hidden mt-18"><h3>Edit facilitator</h3><input id="suiteFacId" type="hidden"><div class="form-grid"><div class="field"><label>Name</label><input id="suiteFacName"></div><div class="field"><label>Phone</label><input id="suiteFacPhone"></div><div class="field full"><label><input id="suiteFacActive" type="checkbox"> Account active</label></div><div class="field full"><label>Assigned programs</label><div id="suiteFacCourses" class="grid grid-3"></div></div><div class="field full"><button id="suiteFacSave" type="button" class="btn btn-primary">Save Facilitator</button></div></div></div>`;
    facilitatorsSection.parentNode.insertBefore(facManage, facilitatorsSection.nextSibling);

    const admins = $('admins');
    const roles = document.createElement('section');
    roles.id = 'adminRoles'; roles.className = 'dashboard-panel';
    roles.innerHTML = `<h2>Admin roles & permissions</h2><p class="hint">Owner has full control. Manager can manage students, attendance, facilitators, announcements and settings. Registration staff can manage students and attendance. Finance and Viewer are report-focused.</p><div id="suiteRoleList" class="grid"></div>`;
    admins.parentNode.insertBefore(roles, admins.nextSibling);

    const messages = $('messages');
    const reports = document.createElement('section');
    reports.id = 'reportsBackup'; reports.className = 'dashboard-panel';
    reports.innerHTML = `<h2>Reports & backup</h2><p class="hint">Export academy records for reporting and backup. “Print report” opens a printable report that can be saved as PDF from your browser.</p><div class="admin-suite-report-actions"><button id="suiteCsv" class="btn btn-outline" type="button">Students CSV</button><button id="suiteExcel" class="btn btn-outline" type="button">Excel report</button><button id="suitePrintReport" class="btn btn-outline" type="button">Print / Save PDF</button><button id="suiteBackup" class="btn btn-primary" type="button">Download JSON Backup</button></div>`;
    messages.parentNode.insertBefore(reports, messages);

    const settings = document.createElement('section');
    settings.id = 'registrationSettings'; settings.className = 'dashboard-panel';
    settings.innerHTML = `<h2>Registration settings</h2><div class="card"><div class="form-grid"><div class="field"><label><input id="suiteRegistrationEnabled" type="checkbox"> Online registration enabled</label></div><div class="field"><label>Registration fee (GHS)</label><input id="suiteRegistrationFee" type="number" min="0" max="10000" step="1"></div><div class="field"><label>Registration opens</label><input id="suiteRegistrationOpen" type="date"></div><div class="field"><label>Registration closes</label><input id="suiteRegistrationClose" type="date"></div><div class="field full"><label>Programs visible for registration</label><div id="suiteVisibleCourses" class="grid grid-3"></div></div><div class="field full"><button id="suiteSaveSettings" type="button" class="btn btn-primary">Save Registration Settings</button></div></div></div>`;
    messages.parentNode.insertBefore(settings, messages);

    const scheduled = document.createElement('section');
    scheduled.id = 'scheduledAnnouncements'; scheduled.className = 'dashboard-panel';
    scheduled.innerHTML = `<h2>Scheduled announcements</h2><p class="hint">Create a notice that starts and/or expires automatically. Leave both times blank to post immediately with no expiry.</p><div class="card"><div class="field"><label>Message</label><textarea id="suiteNoticeText" maxlength="500" rows="3" placeholder="Announcement message"></textarea></div><div class="admin-suite-schedule"><div class="field"><label>Start time (optional)</label><input id="suiteNoticeStart" type="datetime-local"></div><div class="field"><label>Expiry time (optional)</label><input id="suiteNoticeEnd" type="datetime-local"></div></div><button id="suiteNoticePost" type="button" class="btn btn-primary">Post / Schedule Announcement</button></div><div id="suiteScheduledList" class="grid mt-16"></div>`;
    messages.parentNode.insertBefore(scheduled, messages);

    const accountSection = $('account');
    const log = document.createElement('section');
    log.id = 'activityLog'; log.className = 'dashboard-panel';
    log.innerHTML = `<h2>Activity log</h2><p class="hint">Recent administrative actions are recorded here for accountability.</p><div id="suiteActivityLog" class="admin-suite-log"></div>`;
    accountSection.parentNode.insertBefore(log, accountSection);

    bindUi();
  }

  async function loadSuite() {
    suite = await SkyDreamFirebase.call('adminGetSuiteSnapshot');
    renderAll();
  }
  function queueLoadSuite(){setTimeout(()=>loadSuite().catch(e=>console.warn('Background suite refresh failed',e)),1600);}

  function renderAll() {
    if (!suite) return;
    populateCourseSelects();
    renderAnalytics();
    renderStudentList();
    renderAttendance();
    renderFacilitators();
    renderRoles();
    renderSettings();
    renderScheduledNotices();
    renderActivity();
    applyPermissions();
  }

  function applyPermissions() {
    const map = [
      ['#facilitatorManagement','facilitators'], ['#adminRoles','settings'], ['#registrationSettings','settings'],
      ['#scheduledAnnouncements','announcements'], ['#reportsBackup','reports'], ['#studentProfiles','students'], ['#attendanceReports','attendance']
    ];
    map.forEach(([sel, perm]) => { const el = document.querySelector(sel); if (el) el.classList.toggle('admin-suite-hidden', !can(perm)); });
  }

  function populateCourseSelects() {
    const options = Object.entries(suite.courses || {}).map(([id,name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    ['suiteBulkCourse','suiteAttendanceCourse'].forEach(id => { const el=$(id); if(!el)return; const first = id==='suiteBulkCourse'?'<option value="">No program change</option>':'<option value="">All programs</option>'; el.innerHTML=first+options; });
  }

  function renderAnalytics() {
    const students = suite.students || [];
    const current = suite.intake && suite.intake.startDate;
    const currentStudents = students.filter(s => s.status !== 'Cancelled' && (!current || (s.intakeStart || '') === current));
    const attendance = suite.attendance || [];
    const marked = attendance.filter(a => a.status === 'Present' || a.status === 'Absent');
    const present = marked.filter(a => a.status === 'Present').length;
    const rate = marked.length ? Math.round((present / marked.length) * 100) : 0;
    const activeFac = (suite.facilitators || []).filter(f => f.active !== false).length;
    $('suiteKpis').innerHTML = `<div class="admin-suite-kpi"><b>${currentStudents.length}</b><span>Current students</span></div><div class="admin-suite-kpi"><b>${activeFac}</b><span>Active facilitators</span></div><div class="admin-suite-kpi"><b>${rate}%</b><span>Attendance rate</span></div><div class="admin-suite-kpi"><b>${students.length}</b><span>Total registrations</span></div>`;
    const counts = {};
    students.forEach(s => { if (s.status !== 'Cancelled') counts[s.course] = (counts[s.course] || 0) + 1; });
    const max = Math.max(1, ...Object.values(counts));
    $('suiteProgramBars').innerHTML = Object.entries(suite.courses || {}).map(([id,name]) => { const n=counts[id]||0; return `<div class="my-12"><div class="dashboard-top"><span>${esc(name)}</span><b>${n}</b></div><progress class="admin-suite-progress" max="100" value="${Math.round(n/max*100)}" aria-label="${esc(name)} registrations">${Math.round(n/max*100)}%</progress></div>`; }).join('');
  }

  function filteredStudents() {
    const q = (($('suiteStudentSearch') && $('suiteStudentSearch').value) || '').toLowerCase().trim();
    return (suite.students || []).filter(s => !q || [s.fullName,s.regNumber,s.mobile,s.email].some(v => String(v || '').toLowerCase().includes(q)));
  }

  function renderStudentList() {
    const host = $('suiteStudentList'); if (!host) return;
    const rows = filteredStudents();
    host.innerHTML = rows.length ? rows.map(s => `<button type="button" data-suite-student="${esc(s.id)}" class="${selectedStudentId===s.id?'active':''}"><label class="flex-gap-8-start"><input type="checkbox" data-suite-select="${esc(s.id)}"><span><strong>${esc(s.fullName)}</strong><br><small>${esc(s.regNumber)} · ${esc(courseName(s.course))}</small></span></label></button>`).join('') : '<p class="p-14">No students found.</p>';
    if (selectedStudentId && !rows.some(s => s.id === selectedStudentId)) selectedStudentId = null;
    if (selectedStudentId) renderStudentProfile(selectedStudentId);
  }

  function attendanceForStudent(id) { return (suite.attendance || []).filter(a => a.studentId === id); }
  function renderStudentProfile(id) {
    selectedStudentId = id;
    const s = (suite.students || []).find(x => x.id === id); if (!s) return;
    document.querySelectorAll('[data-suite-student]').forEach(b => b.classList.toggle('active', b.dataset.suiteStudent===id));
    const att = attendanceForStudent(id); const p=att.filter(a=>a.status==='Present').length, a=att.filter(x=>x.status==='Absent').length; const marked=p+a; const pct=marked?Math.round(p/marked*100):0;
    const payments = Array.isArray(s.payments) ? s.payments : [];
    $('suiteStudentProfile').innerHTML = `<div class="dashboard-top"><div><h3 class="m-0">${esc(s.fullName)}</h3><span class="admin-suite-tag">${esc(s.status || 'Registered')}</span></div></div><div class="admin-suite-profile-grid"><div><small>Registration number</small><strong>${esc(s.regNumber)}</strong></div><div><small>Program</small><strong>${esc(courseName(s.course))}</strong></div><div><small>Mobile</small><strong>${esc(s.mobile || '')}</strong></div><div><small>WhatsApp</small><strong>${esc(s.whatsapp || '')}</strong></div><div><small>Email</small><strong>${esc(s.email || '—')}</strong></div><div><small>Ghana Card</small><strong>${esc(s.ghanaCard || '—')}</strong></div><div><small>Date of birth</small><strong>${esc(s.dob || '—')}</strong></div><div><small>Address</small><strong>${esc(s.address || '—')}</strong></div><div><small>Emergency contact</small><strong>${esc(s.emName || '—')} ${s.emPhone?`· ${esc(s.emPhone)}`:''}</strong></div><div><small>Attendance</small><strong>${p} present / ${a} absent (${pct}%)</strong></div></div><h4 class="mt-18">Payment history</h4><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead><tbody>${payments.length?payments.map(x=>`<tr><td>${esc(friendlyDate(x.date))}</td><td>GHS ${Number(x.amount||0).toFixed(2)}</td><td>${esc(x.note||'')}</td></tr>`).join(''):'<tr><td colspan="3">No payments recorded.</td></tr>'}</tbody></table></div><div class="admin-suite-actions"><button type="button" class="btn btn-outline btn-small" data-suite-idcard="${esc(s.id)}">Print Student ID</button><button type="button" class="btn btn-outline btn-small" data-suite-profile-print="${esc(s.id)}">Print Profile</button></div>`;
  }

  function renderAttendance() {
    if (!$('suiteAttendanceBody')) return;
    const course = $('suiteAttendanceCourse').value;
    const from = $('suiteAttendanceFrom').value;
    const to = $('suiteAttendanceTo').value;
    const records = (suite.attendance || []).filter(r => (!course || r.course===course) && (!from || r.date>=from) && (!to || r.date<=to));
    const stats = new Map();
    records.forEach(r => { const x=stats.get(r.studentId)||{present:0,absent:0}; if(r.status==='Present')x.present++; if(r.status==='Absent')x.absent++; stats.set(r.studentId,x); });
    const students = (suite.students || []).filter(s => !course || s.course===course);
    const rows = students.map(s => { const x=stats.get(s.id)||{present:0,absent:0}; const marked=x.present+x.absent; return {s,...x,marked,pct:marked?Math.round(x.present/marked*100):0}; }).filter(x => x.marked>0);
    const presentTotal=rows.reduce((n,x)=>n+x.present,0), absentTotal=rows.reduce((n,x)=>n+x.absent,0), marks=presentTotal+absentTotal; const pct=marks?Math.round(presentTotal/marks*100):0;
    $('suiteAttendanceSummary').innerHTML=`<div class="admin-suite-kpi"><b>${rows.length}</b><span>Students marked</span></div><div class="admin-suite-kpi"><b>${presentTotal}</b><span>Present marks</span></div><div class="admin-suite-kpi"><b>${absentTotal}</b><span>Absent marks</span></div><div class="admin-suite-kpi"><b>${pct}%</b><span>Overall attendance</span></div>`;
    $('suiteAttendanceBody').innerHTML=rows.length?rows.sort((a,b)=>a.s.fullName.localeCompare(b.s.fullName)).map(x=>`<tr><td>${esc(x.s.fullName)}</td><td>${esc(courseName(x.s.course))}</td><td>${x.present}</td><td>${x.absent}</td><td>${x.marked}</td><td>${x.pct}%</td></tr>`).join(''):'<tr><td colspan="6">No attendance records for this filter.</td></tr>';
  }

  function renderFacilitators() {
    const host=$('suiteFacilitatorCards'); if(!host)return;
    host.innerHTML=(suite.facilitators||[]).map(f=>`<div class="card"><h3>${esc(f.name)}</h3><p>@${esc(f.username)} · ${esc(f.phone)}</p><p>${esc((f.courses||[]).map(courseName).join(', ')||'No programs assigned')}</p><p><span class="badge">${f.active===false?'Disabled':'Active'}</span></p><button type="button" class="btn btn-outline btn-small" data-suite-edit-fac="${esc(f.id)}">Edit</button></div>`).join('')||'<p>No facilitators.</p>';
  }
  function editFacilitator(id){const f=(suite.facilitators||[]).find(x=>x.id===id);if(!f)return;$('suiteFacEditor').classList.remove('admin-suite-hidden');$('suiteFacId').value=f.id;$('suiteFacName').value=f.name||'';$('suiteFacPhone').value=f.phone||'';$('suiteFacActive').checked=f.active!==false;$('suiteFacCourses').innerHTML=Object.entries(suite.courses||{}).map(([cid,name])=>`<label class="check-row"><input type="checkbox" value="${esc(cid)}" ${(f.courses||[]).includes(cid)?'checked':''}><span>${esc(name)}</span></label>`).join('');$('suiteFacEditor').scrollIntoView({behavior:'smooth',block:'center'});}
  async function saveFacilitator(){const id=$('suiteFacId').value;const courses=Array.from($('suiteFacCourses').querySelectorAll('input:checked')).map(x=>x.value);const name=$('suiteFacName').value,phone=$('suiteFacPhone').value,active=$('suiteFacActive').checked;await SkyDreamFirebase.call('adminUpdateFacilitator',{id,name,phone,courses,active});const row=(suite.facilitators||[]).find(f=>f.id===id);if(row){row.name=name;row.phone=phone;row.courses=courses;row.active=active;}renderFacilitators();renderAnalytics();alert('Facilitator updated. Existing sessions were refreshed for security.');queueLoadSuite();}

  function renderRoles(){const host=$('suiteRoleList');if(!host)return;host.innerHTML=(suite.admins||[]).map(a=>{const owner=a.role==='owner';return `<div class="card admin-suite-role"><div class="flex-1"><strong>${esc(a.name||a.username)}</strong><br><small>@${esc(a.username)}</small></div>${owner?'<span class="badge">Owner</span>':`<select data-suite-role-select="${esc(a.id)}">${['manager','staff','registration','finance','viewer'].map(r=>`<option value="${r}" ${a.role===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select><button type="button" class="btn btn-outline btn-small" data-suite-save-role="${esc(a.id)}">Save Role</button>`}</div>`;}).join('');}
  async function saveRole(id){const select=document.querySelector(`[data-suite-role-select="${CSS.escape(id)}"]`);if(!select)return;const role=select.value;await SkyDreamFirebase.call('adminSetAdminRole',{id,role});const row=(suite.admins||[]).find(a=>a.id===id);if(row)row.role=role;renderRoles();alert('Administrator role updated. They will need to sign in again.');queueLoadSuite();}

  function renderSettings(){const s={registrationEnabled:true,registrationFee:50,hiddenCourses:[],...(suite.settings||{})};$('suiteRegistrationEnabled').checked=s.registrationEnabled!==false;$('suiteRegistrationFee').value=Number(s.registrationFee)||0;$('suiteRegistrationOpen').value=(suite.intake&&suite.intake.registrationOpenDate)||'';$('suiteRegistrationClose').value=(suite.intake&&suite.intake.registrationCloseDate)||'';const hidden=new Set(s.hiddenCourses||[]);$('suiteVisibleCourses').innerHTML=Object.entries(suite.courses||{}).map(([id,name])=>`<label class="check-row"><input type="checkbox" value="${esc(id)}" ${hidden.has(id)?'':'checked'}><span>${esc(name)}</span></label>`).join('');}
  async function saveSettings(){const visible=new Set(Array.from($('suiteVisibleCourses').querySelectorAll('input:checked')).map(x=>x.value));const hidden=Object.keys(suite.courses||{}).filter(id=>!visible.has(id));const registrationEnabled=$('suiteRegistrationEnabled').checked,registrationFee=Number($('suiteRegistrationFee').value),registrationOpenDate=$('suiteRegistrationOpen').value,registrationCloseDate=$('suiteRegistrationClose').value;await SkyDreamFirebase.call('adminSaveRegistrationSettings',{registrationEnabled,registrationFee,registrationOpenDate,registrationCloseDate,hiddenCourses:hidden});suite.settings={...(suite.settings||{}),registrationEnabled,registrationFee,hiddenCourses:hidden};suite.intake={...(suite.intake||{}),registrationOpenDate,registrationCloseDate};alert('Registration settings saved.');queueLoadSuite();}

  function noticeState(n){const now=Date.now();if(n.active===false)return'Hidden';if(n.startsAt&&new Date(n.startsAt).getTime()>now)return'Scheduled';if(n.expiresAt&&new Date(n.expiresAt).getTime()<=now)return'Expired';return'Live';}
  function renderScheduledNotices(){const host=$('suiteScheduledList');if(!host)return;const list=(suite.broadcasts||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,20);host.innerHTML=list.length?list.map(n=>`<div class="card"><div class="dashboard-top"><span class="badge">${noticeState(n)}</span><small>${esc(friendlyDate(n.date))}</small></div><p>${esc(n.message)}</p>${n.startsAt?`<small>Starts: ${esc(friendlyDate(n.startsAt))}</small><br>`:''}${n.expiresAt?`<small>Expires: ${esc(friendlyDate(n.expiresAt))}</small>`:''}</div>`).join(''):'<p>No announcements.</p>';}
  async function postScheduledNotice(){const message=$('suiteNoticeText').value.trim();if(!message){alert('Enter an announcement message.');return;}const start=$('suiteNoticeStart').value,end=$('suiteNoticeEnd').value;const result=await SkyDreamFirebase.call('adminCreateBroadcast',{message,startsAt:start?new Date(start).toISOString():'',expiresAt:end?new Date(end).toISOString():''});$('suiteNoticeText').value='';$('suiteNoticeStart').value='';$('suiteNoticeEnd').value='';if(result&&result.notice){suite.broadcasts=[...(suite.broadcasts||[]),result.notice];renderScheduledNotices();}alert('Announcement saved.');queueLoadSuite();}

  function renderActivity(){const host=$('suiteActivityLog');if(!host)return;const list=suite.audit||[];host.innerHTML=list.length?list.map(x=>`<div class="admin-suite-log-item"><strong>${esc(x.action)}</strong>${x.target?` · ${esc(x.target)}`:''}<br><small>${esc(x.admin)} · ${esc(friendlyDate(x.date))}${x.detail?` · ${esc(x.detail)}`:''}</small></div>`).join(''):'<p>No activity has been recorded yet.</p>';}

  function selectedStudentIds(){return Array.from(document.querySelectorAll('[data-suite-select]:checked')).map(x=>x.dataset.suiteSelect);}
  async function applyBulk(){const ids=selectedStudentIds();if(!ids.length){alert('Select at least one student.');return;}const status=$('suiteBulkStatus').value,course=$('suiteBulkCourse').value;if(!status&&!course){alert('Choose a status or program change.');return;}if(!confirm(`Apply this change to ${ids.length} selected student(s)?`))return;const result=await SkyDreamFirebase.call('adminBulkUpdateStudents',{ids,status,course});(suite.students||[]).forEach(s=>{if(ids.includes(s.id)){if(status)s.status=status;if(course)s.course=course;}});renderStudentList();renderAnalytics();alert(`${result.changed||ids.length} student record(s) updated.`);queueLoadSuite();}

  function download(name, content, type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function csvEscape(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}
  function exportCsv(){const rows=[['Registration Number','Name','Program','Mobile','Email','Status','Attendance %'],...(suite.students||[]).map(s=>{const a=attendanceForStudent(s.id),p=a.filter(x=>x.status==='Present').length,ab=a.filter(x=>x.status==='Absent').length,m=p+ab;return[s.regNumber,s.fullName,courseName(s.course),s.mobile,s.email,s.status,m?Math.round(p/m*100):0];})];download('SkyDream-Students-Report.csv',rows.map(r=>r.map(csvEscape).join(',')).join('\n'),'text/csv;charset=utf-8');}
  function exportExcel(){const rows=(suite.students||[]).map(s=>`<tr><td>${esc(s.regNumber)}</td><td>${esc(s.fullName)}</td><td>${esc(courseName(s.course))}</td><td>${esc(s.mobile||'')}</td><td>${esc(s.status||'')}</td></tr>`).join('');const html=`<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>Registration Number</th><th>Name</th><th>Program</th><th>Mobile</th><th>Status</th></tr>${rows}</table></body></html>`;download('SkyDream-Students-Report.xls',html,'application/vnd.ms-excel');}
  function finishPrintWindow(w,delay=200){w.document.close();setTimeout(()=>{try{w.focus();w.print();}catch(_){}},delay);}
  function printReport(){const w=window.open('','_blank');if(!w)return;const counts={};(suite.students||[]).forEach(s=>counts[s.course]=(counts[s.course]||0)+1);w.document.write(`<html><head><title>SkyDream Admin Report</title><link rel="stylesheet" href="/assets/print.css"></head><body class="print-report"><h1>SkyDream Skills Training Academy</h1><h2>Administration Report</h2><p>Generated ${new Date().toLocaleString()}</p><p>Total students: ${(suite.students||[]).length} · Facilitators: ${(suite.facilitators||[]).length}</p><table><tr><th>Program</th><th>Students</th></tr>${Object.entries(suite.courses||{}).map(([id,name])=>`<tr><td>${esc(name)}</td><td>${counts[id]||0}</td></tr>`).join('')}</table><h2>Students</h2><table><tr><th>Reg no.</th><th>Name</th><th>Program</th><th>Status</th></tr>${(suite.students||[]).map(s=>`<tr><td>${esc(s.regNumber)}</td><td>${esc(s.fullName)}</td><td>${esc(courseName(s.course))}</td><td>${esc(s.status||'')}</td></tr>`).join('')}</table></body></html>`);finishPrintWindow(w);}
  function backupJson(){download(`SkyDream-Backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({generatedAt:new Date().toISOString(),students:suite.students,facilitators:suite.facilitators,attendance:suite.attendance,admins:suite.admins,capacities:suite.capacities,intake:suite.intake,broadcasts:suite.broadcasts,settings:suite.settings,audit:suite.audit},null,2),'application/json');}

  function printStudentProfile(id){const s=(suite.students||[]).find(x=>x.id===id);if(!s)return;const w=window.open('','_blank');if(!w)return;w.document.write(`<html><head><title>${esc(s.fullName)}</title><link rel="stylesheet" href="/assets/print.css"></head><body class="print-profile"><h1>Student Profile</h1><h2>${esc(s.fullName)}</h2><dl><dt>Registration number</dt><dd>${esc(s.regNumber)}</dd><dt>Program</dt><dd>${esc(courseName(s.course))}</dd><dt>Mobile</dt><dd>${esc(s.mobile||'')}</dd><dt>Email</dt><dd>${esc(s.email||'')}</dd><dt>Address</dt><dd>${esc(s.address||'')}</dd><dt>Status</dt><dd>${esc(s.status||'')}</dd></dl></body></html>`);finishPrintWindow(w);}
  function printStudentId(id){const s=(suite.students||[]).find(x=>x.id===id);if(!s)return;const verify=`https://skydream.academy/check-status.html?reg=${encodeURIComponent(s.regNumber||'')}`;const qr=`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(verify)}`;const w=window.open('','_blank','width=700,height=500');if(!w)return;w.document.write(`<html><head><title>Student ID - ${esc(s.fullName)}</title><link rel="stylesheet" href="/assets/print.css"></head><body class="print-id"><div class="card"><div class="top"><img class="logo" src="https://skydream.academy/logo.png" alt="SkyDream logo"><div><strong>SkyDream Skills Training Academy</strong><br><span class="small">Student Identification Card</span></div></div><div class="grid"><div><div class="name">${esc(s.fullName)}</div><p><strong>Reg No:</strong> ${esc(s.regNumber)}</p><p><strong>Program:</strong> ${esc(courseName(s.course))}</p><p><strong>Status:</strong> ${esc(s.status||'Registered')}</p></div><div><img class="qr" src="${qr}" alt="Student verification QR code"><div class="small">Scan to open status verification</div></div></div></div></body></html>`);finishPrintWindow(w,650);}

  function bindUi(){
    $('suiteStudentSearch').addEventListener('input',renderStudentList);$('suiteBulkApply').addEventListener('click',()=>safe(applyBulk));$('suiteAttendanceRefresh').addEventListener('click',renderAttendance);['suiteAttendanceCourse','suiteAttendanceFrom','suiteAttendanceTo'].forEach(id=>$(id).addEventListener('change',renderAttendance));$('suiteFacSave').addEventListener('click',()=>safe(saveFacilitator));$('suiteSaveSettings').addEventListener('click',()=>safe(saveSettings));$('suiteNoticePost').addEventListener('click',()=>safe(postScheduledNotice));$('suiteCsv').addEventListener('click',exportCsv);$('suiteExcel').addEventListener('click',exportExcel);$('suitePrintReport').addEventListener('click',printReport);$('suiteBackup').addEventListener('click',backupJson);
    document.addEventListener('click',e=>{if(e.target.closest('[data-suite-select]'))return;const b=e.target.closest('button');if(!b)return;if(b.dataset.suiteStudent)renderStudentProfile(b.dataset.suiteStudent);if(b.dataset.suiteEditFac)editFacilitator(b.dataset.suiteEditFac);if(b.dataset.suiteSaveRole)safe(()=>saveRole(b.dataset.suiteSaveRole));if(b.dataset.suiteIdcard)printStudentId(b.dataset.suiteIdcard);if(b.dataset.suiteProfilePrint)printStudentProfile(b.dataset.suiteProfilePrint);});
  }
  async function safe(fn){try{await fn();}catch(err){alert(SkyDreamFirebase.friendlyError(err));}}

  document.addEventListener('DOMContentLoaded',()=>{
    injectUi();
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{if(!user)return;try{const token=await user.getIdTokenResult();if(token.claims.role==='admin')await loadSuite();}catch(err){console.warn('Admin suite failed to load',err);}});
  });
})();
