(() => {
  let portal = null;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const friendlyDate = value => {const d=new Date((value||'').length===10?value+'T00:00:00':value||'');return Number.isNaN(d.getTime())?(value||''):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});};
  function message(text,type='info'){const el=$('portalMessage');el.textContent=text;el.className=`notice notice-${type}`;el.classList.remove('hidden');}
  function clearMessage(){$('portalMessage').classList.add('hidden');}

  async function login(event){
    event.preventDefault();clearMessage();const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
    try{
      const result=await SkyDreamFirebase.call('studentPortalLogin',{regNumber:$('portalReg').value.trim(),mobile:$('portalMobile').value.trim()});
      await SkyDreamFirebase.auth.signInWithCustomToken(result.token);
      await load();
    }catch(err){message(SkyDreamFirebase.friendlyError(err),'error');}
    finally{button.disabled=false;}
  }
  async function load(){
    try{
      portal=await SkyDreamFirebase.call('getStudentPortalDashboard');
      $('portalLogin').classList.add('hidden');$('portalDashboard').classList.remove('hidden');render();
    }catch(err){await SkyDreamFirebase.auth.signOut();$('portalDashboard').classList.add('hidden');$('portalLogin').classList.remove('hidden');message(SkyDreamFirebase.friendlyError(err),'error');}
  }
  function render(){
    const s=portal.student,p=portal.payment,a=portal.attendance,progress=portal.progress;
    $('portalIdentity').textContent=`${s.fullName} · ${s.regNumber}`;
    $('portalStats').innerHTML=`<div class="portal-stat"><span>Program</span><b class="portal-stat-program">${esc(s.courseName)}</b></div><div class="portal-stat"><span>Status</span><b>${esc(s.status)}</b></div><div class="portal-stat"><span>Attendance</span><b>${a.percentage}%</b></div><div class="portal-stat"><span>Assessment progress</span><b>${progress.average}%</b></div>`;
    $('portalProfile').innerHTML=`<div><span>Student</span><strong>${esc(s.fullName)}</strong></div><div><span>Registration number</span><strong>${esc(s.regNumber)}</strong></div><div><span>Program</span><strong>${esc(s.courseName)}</strong></div><div><span>Intake</span><strong>${esc(friendlyDate(s.intakeStart))}</strong></div><div><span>Mobile</span><strong>${esc(s.mobile||'—')}</strong></div><div><span>Email</span><strong>${esc(s.email||'—')}</strong></div><div><span>Payment</span><strong>${esc(p.status)} — GHS ${Number(p.paid).toFixed(2)} paid</strong></div><div><span>Balance</span><strong>GHS ${Number(p.balance).toFixed(2)}</strong></div>`;
    $('portalAttendanceSummary').innerHTML=`<div class="portal-grid"><div class="portal-stat"><span>Present</span><b>${a.present}</b></div><div class="portal-stat"><span>Absent</span><b>${a.absent}</b></div><div class="portal-stat"><span>Marked sessions</span><b>${a.marked}</b></div><div class="portal-stat"><span>Attendance rate</span><b>${a.percentage}%</b></div></div>`;
    $('portalAttendanceBody').innerHTML=(a.records||[]).length?(a.records||[]).map(r=>`<tr><td>${esc(friendlyDate(r.date))}</td><td>${esc(s.courseName)}</td><td><span class="badge">${esc(r.status||'')}</span></td><td>${esc(r.note||'—')}</td></tr>`).join(''):'<tr><td colspan="4">No attendance has been recorded yet.</td></tr>';
    $('portalProgress').innerHTML=`<p><strong>Overall assessment progress: ${progress.average}%</strong> from ${progress.totalAssessments} assessment${progress.totalAssessments===1?'':'s'}.</p><progress class="portal-progress" max="100" value="${Math.max(0,Math.min(100,progress.average))}" aria-label="Assessment progress">${Math.max(0,Math.min(100,progress.average))}%</progress>`;
    $('portalAssessmentBody').innerHTML=(portal.assessments||[]).length?(portal.assessments||[]).map(r=>{const pct=Number(r.maxScore)?Math.round(Number(r.score)/Number(r.maxScore)*100):0;return `<tr><td>${esc(friendlyDate(r.date))}</td><td><strong>${esc(r.title)}</strong><br><small>${esc(r.type)}</small></td><td>${Number(r.score)} / ${Number(r.maxScore)}</td><td><span class="badge">${pct}%</span></td><td>${esc(r.remark||'—')}</td></tr>`;}).join(''):'<tr><td colspan="5">No assessments have been recorded yet.</td></tr>';
    const order={Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6,Sunday:7};
    const timetable=(portal.timetable||[]).slice().sort((x,y)=>(order[x.day]||99)-(order[y.day]||99)||String(x.startTime).localeCompare(String(y.startTime)));
    $('portalTimetableBody').innerHTML=timetable.length?timetable.map(t=>`<tr><td>${esc(t.day)}</td><td>${esc(t.startTime)}–${esc(t.endTime)}</td><td><strong>${esc(t.title||s.courseName)}</strong></td><td>${esc(t.room||'To be announced')}</td></tr>`).join(''):'<tr><td colspan="4">Your timetable has not been published yet.</td></tr>';
    $('portalNoticeList').innerHTML=(portal.notices||[]).length?(portal.notices||[]).map(n=>`<div class="card"><small class="hint">${esc(friendlyDate(n.date))}</small><p class="pre-wrap">${esc(n.message)}</p></div>`).join(''):'<p>No current announcements.</p>';
  }

  document.addEventListener('DOMContentLoaded',()=>{
    $('portalLoginForm').addEventListener('submit',login);
    $('portalLogout').addEventListener('click',async()=>{await SkyDreamFirebase.auth.signOut();location.reload();});
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{
      if(!user)return;
      try{const token=await user.getIdTokenResult();if(token.claims.role==='student')await load();else await SkyDreamFirebase.auth.signOut();}catch(_){await SkyDreamFirebase.auth.signOut();}
    });
  });
})();
