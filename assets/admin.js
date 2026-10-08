(() => {
  let data = null;
  let account = null;
  let dashboardPromise = null;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const courseName = id => data && data.courses && data.courses[id] ? data.courses[id] : id;

  function message(text,type='info'){
    const el=$('adminMessage'); if(!el)return; el.textContent=text; el.className=`notice notice-${type}`; el.classList.remove('hidden');
  }
  function clearMessage(){ const el=$('adminMessage'); if(el)el.classList.add('hidden'); }
  function errText(err){ return window.SkyDreamFirebase ? SkyDreamFirebase.friendlyError(err) : (err.message||'Something went wrong.'); }

  async function withBusy(button,busyText,task){
    if(!button||button.dataset.busy==='1')return;
    const normal=button.textContent;
    button.dataset.busy='1';
    button.disabled=true;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy','true');
    if(busyText)button.textContent=busyText;
    try{return await task();}
    finally{
      if(button.isConnected){
        button.disabled=false;
        button.classList.remove('is-busy');
        button.removeAttribute('aria-busy');
        delete button.dataset.busy;
        button.textContent=normal;
      }
    }
  }

  async function signInToken(token){
    await SkyDreamFirebase.auth.signInWithCustomToken(token);
    await loadDashboard();
  }

  async function handleLogin(e){
    e.preventDefault(); clearMessage();
    const username=$('adminUsername').value.trim(); const password=$('adminPassword').value;
    const btn=e.target.querySelector('button[type=submit]'); btn.disabled=true;
    try{
      const res=await SkyDreamFirebase.call('adminLogin',{username,password});
      account=res.account;
      await signInToken(res.token);
    }catch(err){ message(errText(err),'error'); }
    finally{ btn.disabled=false; }
  }

  async function loadDashboard(){
    if (dashboardPromise) return dashboardPromise;
    dashboardPromise = (async () => {
      clearMessage();
      try {
        // Authoritative role is read from Firebase's stored admin account,
        // never from a potentially stale browser ID-token claim.
        const workspace = await SkyDreamFirebase.call('adminGetRegistrationWorkspace');
        if (!workspace || !workspace.account || !workspace.account.username) {
          throw new Error('Administrator role verification failed. Please sign in again.');
        }
        account = {
          username: workspace.account.username,
          role: workspace.account.role || 'staff'
        };
        window.SkyDreamAdminOwnerVerified = account.role === 'owner';
        if (!window.SkyDreamAdminOwnerVerified) {
          if (!window.SkyDreamRegistrationWorkspace) {
            throw new Error('Registration dashboard is not ready. Refresh the page and try again.');
          }
          await window.SkyDreamRegistrationWorkspace.open(workspace);
          return;
        }
        data = await SkyDreamFirebase.call('getAdminSnapshot');
        $('registrationStaffShell').classList.add('hidden');
        $('loginShell').classList.add('hidden');
        $('dashboardShell').classList.remove('hidden');
        $('adminIdentity').textContent = '@' + account.username + ' · Main administrator';
        renderAll();
        window.dispatchEvent(new Event('skydream-owner-session-ready'));
      } catch(err) {
        window.SkyDreamAdminOwnerVerified = false;
        await SkyDreamFirebase.auth.signOut();
        $('dashboardShell').classList.add('hidden');
        $('registrationStaffShell').classList.add('hidden');
        $('loginShell').classList.remove('hidden');
        $('adminLoginPanel').classList.remove('hidden');
        message(errText(err),'error');
      }
    })();
    try { return await dashboardPromise; }
    finally { dashboardPromise = null; }
  }

  function renderAll(){ renderStats(); renderStudents(); renderCapacities(); renderFacilitators(); renderAdmins(); renderContacts(); renderWaitlist(); }
  function renderStats(){
    const current=data.intake&&data.intake.startDate;
    const currentStudents=data.students.filter(s=>(s.intakeStart||'2026-09-26')===current&&s.status!=='Cancelled');
    const paid=data.students.reduce((sum,s)=>sum+(Number(s.feePaid)||0),0);
    $('adminStats').innerHTML=`<div class="stat"><b>${currentStudents.length}</b><span>Current students</span></div><div class="stat"><b>${data.facilitators.length}</b><span>Facilitators</span></div><div class="stat"><b>${data.waitlist.length}</b><span>Waitlist</span></div><div class="stat"><b>GHS ${paid.toLocaleString()}</b><span>Payments recorded</span></div>`;
    $('intakeSummary').textContent=`${data.intake.label||'Current intake'} · Orientation ${data.intake.startDate||''} · Classes ${data.intake.classesStartDate||''}`;
  }

  function filteredStudents(){
    const q=($('studentSearch').value||'').toLowerCase().trim(); const course=$('studentCourseFilter').value;
    return data.students.filter(s=>(!course||s.course===course)&&(!q||[s.fullName,s.regNumber,s.mobile,s.ghanaCard].some(v=>String(v||'').toLowerCase().includes(q))));
  }
  function renderCourseFilter(){
    const select=$('studentCourseFilter'); if(select.dataset.ready)return;
    select.innerHTML='<option value="">All programs</option>'+Object.entries(data.courses).map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join(''); select.dataset.ready='1';
  }
  function renderStudents(){
    renderCourseFilter(); const rows=filteredStudents();
    $('studentCount').textContent=`${rows.length} record${rows.length===1?'':'s'}`;
    $('studentsBody').innerHTML=rows.length?rows.slice().sort((a,b)=>String(b.regDate||'').localeCompare(String(a.regDate||''))).map(s=>{
      const paid=Number(s.feePaid)||0;
      return `<tr><td>${esc(s.regNumber)}</td><td><strong>${esc(s.fullName)}</strong><br><small>${esc(s.mobile||'')}</small></td><td>${esc(courseName(s.course))}</td><td><span class="badge">${esc(s.status||'Registered')}</span></td><td>GHS ${paid.toFixed(2)}</td><td><div class="toolbar"><button class="btn btn-outline btn-small" data-edit="${esc(s.id)}">Edit</button><button class="btn btn-outline btn-small" data-pay="${esc(s.id)}">Payment</button><button class="btn btn-outline btn-small" data-portal-message="${esc(s.id)}">Message</button>${account.role==='owner'?`<button class="btn btn-danger btn-small" data-delete="${esc(s.id)}">Delete</button>`:''}</div></td></tr>`;
    }).join(''):'<tr><td colspan="6">No matching students.</td></tr>';
  }

  function openStudent(id){
    const s=data.students.find(x=>x.id===id); if(!s)return;
    $('editStudentId').value=s.id; $('editFullName').value=s.fullName||''; $('editMobile').value=s.mobile||''; $('editWhatsapp').value=s.whatsapp||''; $('editEmail').value=s.email||''; $('editAddress').value=s.address||''; $('editStatus').value=s.status||'Registered';
    $('editCourse').innerHTML=Object.entries(data.courses).map(([cid,name])=>`<option value="${cid}">${esc(name)}</option>`).join(''); $('editCourse').value=s.course;
    $('studentModal').classList.remove('hidden');
  }
  async function saveStudent(e){
    e.preventDefault(); const id=$('editStudentId').value; const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
    try{
      await SkyDreamFirebase.call('adminUpdateStudent',{id,patch:{fullName:$('editFullName').value,mobile:$('editMobile').value,whatsapp:$('editWhatsapp').value,email:$('editEmail').value,address:$('editAddress').value,status:$('editStatus').value,course:$('editCourse').value}});
      $('studentModal').classList.add('hidden'); await refresh('Student record updated.');
    }catch(err){alert(errText(err));}finally{btn.disabled=false;}
  }
  async function addPayment(id,button){
    const s=data.students.find(x=>x.id===id); if(!s)return;
    const amount=prompt(`Payment amount for ${s.fullName} (GHS):`); if(amount===null)return;
    const note=prompt('Payment note (optional):','')||'';
    try{await withBusy(button,'Saving…',async()=>{await SkyDreamFirebase.call('adminAddPayment',{id,amount:Number(amount),note});await refresh('Payment recorded.');});}catch(err){alert(errText(err));}
  }
  async function deleteStudent(id,button){
    const s=data.students.find(x=>x.id===id); if(!s||!confirm(`Delete ${s.fullName} (${s.regNumber})? This cannot be undone.`))return;
    try{await withBusy(button,'Deleting…',async()=>{await SkyDreamFirebase.call('adminDeleteStudent',{id});await refresh('Registration deleted.');});}catch(err){alert(errText(err));}
  }
  async function sendPortalMessage(id,button){
    const s=data.students.find(x=>x.id===id); if(!s)return;
    const body=prompt(`Message to ${s.fullName}'s student portal:`);
    if(!body||!body.trim())return;
    try{
      await withBusy(button,'Sending…',async()=>{
        await SkyDreamFirebase.call('adminSendStudentMessage',{studentId:s.id,message:body.trim()});
        alert('Message sent to the student portal.');
      });
    }catch(err){alert(errText(err));}
  }

  function renderCapacities(){
    $('capacityGrid').innerHTML=Object.entries(data.courses).map(([id,name])=>`<div class="card"><h3>${esc(name)}</h3><div class="field"><label>Capacity</label><input type="number" min="1" max="500" value="${Number(data.capacities[id])||25}" data-capacity-input="${id}"></div><button class="btn btn-primary btn-small" data-save-capacity="${id}">Save</button></div>`).join('');
  }
  async function saveCapacity(id,button){
    const input=document.querySelector(`[data-capacity-input="${CSS.escape(id)}"]`); try{await withBusy(button,'Saving…',async()=>{await SkyDreamFirebase.call('adminSetCapacity',{course:id,capacity:Number(input.value)});await refresh('Program capacity updated.');});}catch(err){alert(errText(err));}
  }

  function renderFacilitators(){
    $('facilitatorList').innerHTML=data.facilitators.length?data.facilitators.map(f=>`<div class="card"><h3>${esc(f.name)}</h3><p>@${esc(f.username)} · ${esc(f.phone||'No phone')}</p><p>${esc((f.courses||[]).map(courseName).join(', ')||'No programs assigned')}</p>${account.role==='owner'?`<button class="btn btn-danger btn-small" data-delete-fac="${esc(f.id)}">Remove</button>`:''}</div>`).join(''):'<p>No facilitators yet.</p>';
    $('facCourseChoices').innerHTML=Object.entries(data.courses).map(([id,name])=>`<label class="check-row"><input type="checkbox" value="${id}"><span>${esc(name)}</span></label>`).join('');
    $('facilitatorCreatePanel').classList.toggle('hidden',account.role!=='owner');
  }
  async function createFacilitator(e){
    e.preventDefault(); const courses=Array.from($('facCourseChoices').querySelectorAll('input:checked')).map(x=>x.value); const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
    try{await SkyDreamFirebase.call('adminCreateFacilitator',{name:$('facName').value,username:$('facUsername').value,phone:$('facPhone').value,password:$('facPassword').value,courses});e.target.reset();await refresh('Facilitator account created.');}catch(err){alert(errText(err));}finally{btn.disabled=false;}
  }
  async function deleteFacilitator(id,button){if(!confirm('Remove this facilitator account?'))return;try{await withBusy(button,'Removing…',async()=>{await SkyDreamFirebase.call('adminDeleteFacilitator',{id});await refresh('Facilitator removed.');});}catch(err){alert(errText(err));}}

  function renderAdmins(){
    $('adminUsersList').innerHTML=data.admins.map(a=>`<div class="card"><h3>${esc(a.name||a.username)}</h3><p>@${esc(a.username)} · ${a.role==='owner'?'Main administrator (strong password)':'Staff administrator (4-digit PIN)'}</p>${account.role==='owner'&&a.role!=='owner'&&a.username!==account.username?`<div class="toolbar"><button type="button" class="btn btn-outline btn-small" data-set-admin-pin="${esc(a.id)}">Set / Reset PIN</button><button class="btn btn-danger btn-small" data-delete-admin="${esc(a.id)}">Remove</button></div>`:''}</div>`).join('');
    $('adminCreatePanel').classList.toggle('hidden',account.role!=='owner');
  }
  async function createAdmin(e){e.preventDefault();const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;try{await SkyDreamFirebase.call('adminCreateAdmin',{name:$('newAdminName').value,username:$('newAdminUsername').value,pin:$('newAdminPin').value});e.target.reset();await refresh('Administrator created.');}catch(err){alert(errText(err));}finally{btn.disabled=false;}}
  async function setStaffPin(id,button){
    if(account.role!=='owner')return;
    const member=data.admins.find(a=>a.id===id);
    if(!member||member.role==='owner')return;
    const pin=prompt('Set a NEW 4-digit PIN for @'+member.username+':');
    if(pin===null)return;
    if(!/^[0-9]{4}$/.test(pin)){alert('Staff PINs must contain exactly four digits.');return;}
    if(!confirm('Replace the PIN for @'+member.username+' and sign out all of their active sessions?'))return;
    try{
      await withBusy(button,'Saving…',async()=>{
        await SkyDreamFirebase.call('adminSetStaffPin',{id,pin});
        alert('Staff PIN updated. The administrator must sign in using their new 4-digit PIN.');
      });
    }catch(err){alert(errText(err));}
  }
  async function deleteAdmin(id,button){if(!confirm('Remove this administrator account?'))return;try{await withBusy(button,'Removing…',async()=>{await SkyDreamFirebase.call('adminDeleteAdmin',{id});await refresh('Administrator removed.');});}catch(err){alert(errText(err));}}

  function renderContacts(){
    $('contactList').innerHTML=data.contactMessages.length?data.contactMessages.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(m=>`<div class="card"><h3>${esc(m.name)}</h3><p><a href="mailto:${esc(m.email)}">${esc(m.email)}</a> · ${esc(new Date(m.date).toLocaleString())}</p><p>${esc(m.message)}</p></div>`).join(''):'<p>No contact messages.</p>';
  }
  function renderWaitlist(){
    $('waitlistBody').innerHTML=data.waitlist.length?data.waitlist.map(w=>`<tr><td>${esc(w.fullName)}</td><td>${esc(courseName(w.course))}</td><td>${esc(w.mobile)}</td><td>${esc(w.whatsapp||'')}</td><td>${esc(w.email||'')}</td></tr>`).join(''):'<tr><td colspan="5">No one is currently on the waitlist.</td></tr>';
  }

  async function changePassword(e){
    e.preventDefault(); const a=$('currentPassword').value,b=$('newPassword').value,c=$('newPassword2').value;if(b!==c){alert('New passwords do not match.');return;}const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
    try{await SkyDreamFirebase.call('adminChangePassword',{currentPassword:a,newPassword:b});e.target.reset();alert('Password changed.');}catch(err){alert(errText(err));}finally{btn.disabled=false;}
  }
  function exportCsv(){
    const rows=[['Registration Number','Name','Program','Mobile','Status','Fee Paid'],...filteredStudents().map(s=>[s.regNumber,s.fullName,courseName(s.course),s.mobile,s.status,Number(s.feePaid)||0])];
    const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n'); const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='SkyDream-Students.csv';a.click();URL.revokeObjectURL(url);
  }
  async function refresh(msg){if(msg)message(msg,'success');data=await SkyDreamFirebase.call('getAdminSnapshot');renderAll();}

  function bindEvents(){
    $('adminLoginForm').addEventListener('submit',handleLogin); $('editStudentForm').addEventListener('submit',saveStudent); $('createFacilitatorForm').addEventListener('submit',createFacilitator); $('createAdminForm').addEventListener('submit',createAdmin); $('changePasswordForm').addEventListener('submit',changePassword);
    $('studentSearch').addEventListener('input',renderStudents);$('studentCourseFilter').addEventListener('change',renderStudents);$('exportStudents').addEventListener('click',exportCsv);$('closeStudentModal').addEventListener('click',()=>$('studentModal').classList.add('hidden'));
    $('logoutBtn').addEventListener('click',async()=>{await SkyDreamFirebase.auth.signOut();location.reload();});
    document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.dataset.busy==='1')return;if(b.dataset.edit)openStudent(b.dataset.edit);if(b.dataset.pay)addPayment(b.dataset.pay,b);if(b.dataset.portalMessage)sendPortalMessage(b.dataset.portalMessage,b);if(b.dataset.delete)deleteStudent(b.dataset.delete,b);if(b.dataset.saveCapacity)saveCapacity(b.dataset.saveCapacity,b);if(b.dataset.deleteFac)deleteFacilitator(b.dataset.deleteFac,b);if(b.dataset.setAdminPin)setStaffPin(b.dataset.setAdminPin,b);if(b.dataset.deleteAdmin)deleteAdmin(b.dataset.deleteAdmin,b);});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    bindEvents();
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{
      if(!user)return;
      try{const t=await user.getIdTokenResult();if(t.claims.role==='admin')await loadDashboard();else await SkyDreamFirebase.auth.signOut();}catch(_){await SkyDreamFirebase.auth.signOut();}
    });
  });
})();
