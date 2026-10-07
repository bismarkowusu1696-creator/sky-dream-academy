(() => {
  let data=null,account=null,sessionReady=null,dashboardLoadPromise=null,loginInProgress=false;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[s]));
  const errorText=e=>window.SkyDreamFirebase?SkyDreamFirebase.friendlyError(e):(e.message||'Something went wrong.');
  function msg(text,type='info'){const el=$('facMessage');el.textContent=text;el.className=`notice notice-${type}`;el.classList.remove('hidden');}
  function clear(){ $('facMessage').classList.add('hidden'); }

  async function ensureTabSession(){
    if(!sessionReady){
      sessionReady=SkyDreamFirebase.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err=>{
        sessionReady=null;
        throw err;
      });
    }
    return sessionReady;
  }

  async function prepareLogin(){
    await ensureTabSession();
    try{
      if(SkyDreamFirebase.ensureAppCheckToken)await SkyDreamFirebase.ensureAppCheckToken();
    }catch(_){
      // The actual login request will show the friendly security error if App
      // Check is unavailable. This warm-up makes the first click faster.
    }
  }

  async function facCall(name,payload={}){
    await ensureTabSession();
    const user=SkyDreamFirebase.auth&&SkyDreamFirebase.auth.currentUser;
    if(!user)throw new Error('Facilitator session expired. Please sign in again.');
    const idToken=await user.getIdToken(true);
    return SkyDreamFirebase.call(name,{...payload,_facIdToken:idToken});
  }

  async function signInToken(token){
    await ensureTabSession();
    await SkyDreamFirebase.auth.signInWithCustomToken(token);
    await SkyDreamFirebase.auth.currentUser.getIdToken(true);
    await load();
  }

  async function login(e){
    e.preventDefault();
    if(loginInProgress)return;
    clear();
    const username=$('facUsername').value.trim(),pin=$('facLoginPassword').value.trim();
    if(!/^\d{4}$/.test(pin)){msg('Enter exactly 4 digits for your PIN.','error');return;}
    const b=e.target.querySelector('button');
    const normalText=b.dataset.normalText||(b.dataset.normalText=b.textContent||'Sign in');
    loginInProgress=true;b.disabled=true;b.textContent='Signing in…';
    try{
      await prepareLogin();
      const r=await SkyDreamFirebase.call('facilitatorLogin',{username,pin});
      account=r.account;
      if(!r.token)throw new Error('Sign-in could not be completed. Ask the administrator to reset your PIN.');
      b.textContent='Opening dashboard…';
      await signInToken(r.token);
    }catch(err){msg(errorText(err),'error');}
    finally{loginInProgress=false;b.disabled=false;b.textContent=normalText;}
  }

  async function load(){
    if(dashboardLoadPromise)return dashboardLoadPromise;
    dashboardLoadPromise=(async()=>{
      try{
        await ensureTabSession();
        data=await facCall('getFacilitatorDashboard');
        account=data.account;
        $('facLoginShell').classList.add('hidden');
        $('facDashboard').classList.remove('hidden');
        $('facIdentity').textContent=`${account.name} · @${account.username}`;
        populateCourses();setDefaultDate();render();
      }catch(err){
        $('facDashboard').classList.add('hidden');
        $('facLoginShell').classList.remove('hidden');
        msg(errorText(err),'error');
        throw err;
      }
    })();
    try{return await dashboardLoadPromise;}finally{dashboardLoadPromise=null;}
  }

  function populateCourses(){const sel=$('facCourse');sel.innerHTML=Object.entries(data.courses).map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join('')||'<option value="">No program assigned</option>';}
  function todayIso(){return new Date().toISOString().slice(0,10);}
  function allowedAttendanceDate(date,intake){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return false;
    const first=intake&&(intake.classesStartDate||intake.startDate);
    const last=intake&&intake.endDate;
    if(!first||!last||date<first||date>last||date>todayIso())return false;
    if(intake.breakStartDate&&intake.resumeDate&&date>=intake.breakStartDate&&date<intake.resumeDate)return false;
    const day=new Date(date+'T00:00:00Z').getUTCDay();
    return day===0||day===6;
  }
  function previousIso(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
  function setDefaultDate(){
    const input=$('facDate');if(!input)return;
    const intake=data&&data.intake||{};
    const first=intake.classesStartDate||intake.startDate||'';
    const last=intake.endDate||todayIso();
    if(first)input.min=first;
    input.max=todayIso()<last?todayIso():last;
    if(input.value&&allowedAttendanceDate(input.value,intake))return;
    let cursor=input.max;
    for(let i=0;i<400&&cursor&&(!first||cursor>=first);i++){
      if(allowedAttendanceDate(cursor,intake)){input.value=cursor;return;}
      cursor=previousIso(cursor);
    }
    input.value='';
  }
  function markFor(studentId){const course=$('facCourse').value,date=$('facDate').value;return data.attendance.find(r=>r.course===course&&r.date===date&&r.studentId===studentId);}
  function render(){const course=$('facCourse').value,date=$('facDate').value;const roster=data.students.filter(s=>s.course===course);let present=0,absent=0;const rows=roster.sort((a,b)=>a.fullName.localeCompare(b.fullName)).map(s=>{const rec=markFor(s.id);if(rec&&rec.status==='Present')present++;if(rec&&rec.status==='Absent')absent++;return `<tr><td>${esc(s.regNumber)}</td><td><strong>${esc(s.fullName)}</strong></td><td><div class="attendance-toggle"><button data-mark="Present" data-student="${esc(s.id)}" class="${rec&&rec.status==='Present'?'active-present':''}">Present</button><button data-mark="Absent" data-student="${esc(s.id)}" class="${rec&&rec.status==='Absent'?'active-absent':''}">Absent</button></div></td><td><input class="fac-note" data-note-for="${esc(s.id)}" value="${esc(rec&&rec.note||'')}" placeholder="Optional note"><button class="btn btn-outline btn-small" data-save-note="${esc(s.id)}">Save note</button></td><td><button class="btn btn-outline btn-small" data-message-student="${esc(s.id)}">Message</button></td></tr>`;}).join('');$('facRoster').innerHTML=rows||'<tr><td colspan="5">No students are registered for this program in the current intake.</td></tr>';$('facSummary').innerHTML=`<div class="stat"><b>${roster.length}</b><span>Roster</span></div><div class="stat"><b>${present}</b><span>Present</span></div><div class="stat"><b>${absent}</b><span>Absent</span></div><div class="stat"><b>${Math.max(0,roster.length-present-absent)}</b><span>Not marked</span></div>`;$('facDateLabel').textContent=date?new Date(date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'No completed class day yet';}
  async function saveMark(studentId,status,noteOverride){const course=$('facCourse').value,date=$('facDate').value;if(!course||!date){alert('Choose a program and a completed Saturday or Sunday class date.');return;}if(!allowedAttendanceDate(date,data.intake||{})){alert('Attendance can only be marked for a completed Saturday or Sunday class date in the active intake.');return;}const current=markFor(studentId);const noteInput=document.querySelector(`[data-note-for="${CSS.escape(studentId)}"]`);const note=noteOverride!==undefined?noteOverride:(noteInput?noteInput.value:'');const next=current&&current.status===status&&noteOverride===undefined?'':status;try{await facCall('markFacilitatorAttendance',{course,date,studentId,status:next,note});data=await facCall('getFacilitatorDashboard');render();}catch(err){alert(errorText(err));}}
  async function saveNote(studentId){const rec=markFor(studentId);if(!rec||!rec.status){alert('Mark the student Present or Absent before saving a note.');return;}const input=document.querySelector(`[data-note-for="${CSS.escape(studentId)}"]`);await saveMark(studentId,rec.status,input?input.value:'');}
  async function messageStudent(studentId){
    const student=(data.students||[]).find(s=>s.id===studentId);if(!student)return;
    const body=prompt(`Message to ${student.fullName}'s student portal:`);
    if(!body||!body.trim())return;
    await facCall('facilitatorSendStudentMessage',{studentId,message:body.trim()});
    alert('Message sent to the student portal.');
  }
  async function generateQr(){
    const course=$('facCourse').value;if(!course){alert('Choose a program first.');return;}
    const b=$('facGenerateQr');b.disabled=true;b.textContent='Generating…';
    try{
      const result=await facCall('facilitatorCreateQrAttendance',{course});
      const url=`https://skydream.academy/student-portal?checkin=${encodeURIComponent(result.token)}`;
      const qr=`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}`;
      const box=$('facQrBox');box.classList.remove('hidden');
      box.innerHTML=`<div class="dashboard-top"><div><h3 class="m-0">Attendance QR — ${esc(data.courses[course]||course)}</h3><p class="hint">Expires ${esc(new Date(result.expiresAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}</p></div></div><p><img src="${qr}" alt="Attendance QR code" width="280" height="280"></p><p class="hint">Students scan this code, sign in to their portal, and are marked Present automatically.</p><p><a href="${esc(url)}" target="_blank" rel="noopener">Open check-in link</a></p>`;
    }finally{b.disabled=false;b.textContent='Generate Attendance QR';}
  }
  function bind(){$('facLoginForm').addEventListener('submit',login);$('facCourse').addEventListener('change',()=>{render();const box=$('facQrBox');if(box)box.classList.add('hidden');});$('facDate').addEventListener('change',render);$('facGenerateQr').addEventListener('click',()=>generateQr().catch(err=>alert(errorText(err))));$('facLogout').addEventListener('click',async()=>{await ensureTabSession();await SkyDreamFirebase.auth.signOut();location.reload();});document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.mark)saveMark(b.dataset.student,b.dataset.mark);if(b.dataset.saveNote)saveNote(b.dataset.saveNote);if(b.dataset.messageStudent)messageStudent(b.dataset.messageStudent).catch(err=>alert(errorText(err)));});}
  document.addEventListener('DOMContentLoaded',async()=>{
    bind();
    try{await prepareLogin();}catch(err){msg(errorText(err),'error');return;}
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{
      if(!user)return;
      try{
        const t=await user.getIdTokenResult();
        if(t.claims.role==='facilitator')await load();
      }catch(err){msg(errorText(err),'error');}
    });
  });
})();
