(() => {
  let portal = null;
  let loadPromise = null;
  let qrHandled = false;
  let serviceWorkerRegistration = null;
  let pushStatus = { enabled:false, devices:0 };
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const friendlyDate = value => {const d=new Date((value||'').length===10?value+'T00:00:00':value||'');return Number.isNaN(d.getTime())?(value||''):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});};
  function message(text,type='info'){const el=$('portalMessage');el.textContent=text;el.className=`notice notice-${type}`;el.classList.remove('hidden');}
  function clearMessage(){$('portalMessage').classList.add('hidden');}
  function setBadge(id,count){const el=$(id);if(!el)return;el.textContent=String(count||'');el.classList.toggle('hidden',!count);}

  function showLoadingDashboard(){
    $('portalLogin').classList.add('hidden');
    $('portalDashboard').classList.remove('hidden');
    $('portalIdentity').textContent='Loading your portal…';
    $('portalStats').innerHTML='<div class="portal-stat"><span>Status</span><b>Loading…</b></div>';
  }

  async function login(event){
    event.preventDefault();clearMessage();const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
    try{
      const result=await SkyDreamFirebase.call('studentPortalLogin',{regNumber:$('portalReg').value.trim(),mobile:$('portalMobile').value.trim()});
      showLoadingDashboard();
      await SkyDreamFirebase.auth.signInWithCustomToken(result.token);
      await load();
    }catch(err){
      $('portalDashboard').classList.add('hidden');$('portalLogin').classList.remove('hidden');
      message(SkyDreamFirebase.friendlyError(err),'error');
    }finally{button.disabled=false;}
  }

  async function load(){
    if(loadPromise)return loadPromise;
    showLoadingDashboard();
    loadPromise=(async()=>{
      try{
        portal=await SkyDreamFirebase.call('getStudentPortalDashboard');
        render();
        loadPushStatus().catch(err=>console.warn('Push status could not load.',err));
        if(location.hash==='#portalMessages')await markMessagesRead();
        await processQrCheckIn();
      }catch(err){
        await SkyDreamFirebase.auth.signOut();
        $('portalDashboard').classList.add('hidden');$('portalLogin').classList.remove('hidden');
        message(SkyDreamFirebase.friendlyError(err),'error');
        throw err;
      }
    })();
    try{return await loadPromise;}finally{loadPromise=null;}
  }

  function progressCard(label,value,detail=''){
    const pct=Math.max(0,Math.min(100,Number(value)||0));
    return `<div class="card"><div class="dashboard-top"><strong>${esc(label)}</strong><b>${pct}%</b></div><progress class="portal-progress" max="100" value="${pct}" aria-label="${esc(label)}">${pct}%</progress>${detail?`<p class="hint">${esc(detail)}</p>`:''}</div>`;
  }

  function render(){
    const s=portal.student,p=portal.payment,a=portal.attendance,progress=portal.progress||{};
    $('portalIdentity').textContent=`${s.fullName} · ${s.regNumber}`;
    $('portalStats').innerHTML=`<div class="portal-stat"><span>Program</span><b class="portal-stat-program">${esc(s.courseName)}</b></div><div class="portal-stat"><span>Status</span><b>${esc(s.status)}</b></div><div class="portal-stat"><span>Attendance</span><b>${a.percentage}%</b></div><div class="portal-stat"><span>Overall progress</span><b>${Number(progress.overall)||0}%</b></div>`;
    $('portalProfile').innerHTML=`<div><span>Student</span><strong>${esc(s.fullName)}</strong></div><div><span>Registration number</span><strong>${esc(s.regNumber)}</strong></div><div><span>Program</span><strong>${esc(s.courseName)}</strong></div><div><span>Intake</span><strong>${esc(friendlyDate(s.intakeStart))}</strong></div><div><span>Mobile</span><strong>${esc(s.mobile||'—')}</strong></div><div><span>Email</span><strong>${esc(s.email||'—')}</strong></div><div><span>Payment</span><strong>${esc(p.status)} — GHS ${Number(p.paid).toFixed(2)} paid</strong></div><div><span>Balance</span><strong>GHS ${Number(p.balance).toFixed(2)}</strong></div>`;
    $('portalProgressDashboard').innerHTML=`<div class="portal-grid">${progressCard('Overall progress',progress.overall,'Combined course timeline, attendance and fee completion')}${progressCard('Course timeline',progress.course,progress.startDate&&progress.endDate?`${friendlyDate(progress.startDate)} – ${friendlyDate(progress.endDate)}`:'Course dates unavailable')}${progressCard('Attendance',progress.attendance,`${a.present} present · ${a.absent} absent`)}${progressCard('Fee completion',progress.fees,`GHS ${Number(p.paid).toFixed(2)} of GHS ${Number(p.fee).toFixed(2)}`)}</div>`;
    $('portalAttendanceSummary').innerHTML=`<div class="portal-grid"><div class="portal-stat"><span>Present</span><b>${a.present}</b></div><div class="portal-stat"><span>Absent</span><b>${a.absent}</b></div><div class="portal-stat"><span>Marked sessions</span><b>${a.marked}</b></div><div class="portal-stat"><span>Attendance rate</span><b>${a.percentage}%</b></div></div>`;
    $('portalAttendanceBody').innerHTML=(a.records||[]).length?(a.records||[]).map(r=>`<tr><td>${esc(friendlyDate(r.date))}</td><td>${esc(s.courseName)}</td><td><span class="badge">${esc(r.status||'')}</span></td><td>${esc(r.note||'—')}</td></tr>`).join(''):'<tr><td colspan="4">No attendance has been recorded yet.</td></tr>';
    const notifications=portal.notifications||[];
    $('portalNotificationList').innerHTML=notifications.length?notifications.map(n=>`<div class="card"><div class="dashboard-top"><strong>${esc(n.title||'Notification')}</strong><span class="badge">${esc(n.type||'info')}</span></div><p class="pre-wrap">${esc(n.message||'')}</p>${n.date?`<small class="hint">${esc(friendlyDate(n.date))}</small>`:''}${n.target?`<p><a href="${esc(n.target)}">Open</a></p>`:''}</div>`).join(''):'<p>No notifications right now.</p>';
    $('portalMessageList').innerHTML=(portal.messages||[]).length?(portal.messages||[]).map(m=>`<div class="card"><div class="dashboard-top"><strong>${esc(m.from||'SkyDream')}</strong><span class="badge">${m.readAt?'Read':'New'}</span></div><small class="hint">${esc(friendlyDate(m.date))}</small><p class="pre-wrap">${esc(m.message)}</p></div>`).join(''):'<p>No private messages yet.</p>';
    $('portalNoticeList').innerHTML=(portal.notices||[]).length?(portal.notices||[]).map(n=>`<div class="card"><small class="hint">${esc(friendlyDate(n.date))}</small><p class="pre-wrap">${esc(n.message)}</p></div>`).join(''):'<p>No current announcements.</p>';
    setBadge('portalMessageBadge',Number(portal.unreadMessages)||0);
    setBadge('portalNotificationBadge',notifications.length);
  }

  function renderPushStatus(){
    const status=$('portalPushStatus'),enable=$('portalEnablePush'),disable=$('portalDisablePush');
    if(!status||!enable||!disable)return;
    const supported=('Notification' in window)&&('serviceWorker' in navigator)&&SkyDreamFirebase&&SkyDreamFirebase.messaging;
    if(!supported){status.textContent='Push notifications are not supported in this browser.';enable.classList.add('hidden');disable.classList.add('hidden');return;}
    if(pushStatus.enabled){
      status.textContent='Enabled on '+(pushStatus.devices||1)+' device(s).';
      disable.classList.remove('hidden');
      enable.classList.toggle('hidden',Notification.permission==='granted');
    }else{
      status.textContent=Notification.permission==='denied'?'Notifications are blocked in this browser. Allow them in site settings first.':'Notifications are not enabled for your account.';
      enable.classList.remove('hidden');disable.classList.add('hidden');
    }
  }

  async function loadPushStatus(){
    if(!SkyDreamFirebase.auth.currentUser)return;
    pushStatus=await SkyDreamFirebase.call('studentGetPushStatus');
    renderPushStatus();
  }

  async function enablePush(){
    if(!('Notification' in window)||!('serviceWorker' in navigator)||!SkyDreamFirebase.messaging)throw new Error('Push notifications are not supported in this browser.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){renderPushStatus();throw new Error('Notifications were not enabled. Allow them in your browser/site settings and try again.');}
    const registration=(await ensurePortalServiceWorker())||await navigator.serviceWorker.ready;
    const token=await SkyDreamFirebase.getPushToken(registration);
    await SkyDreamFirebase.call('studentRegisterPushToken',{token});
    await loadPushStatus();
    alert('SkyDream message notifications are enabled.');
  }

  async function disablePush(){
    if(!confirm('Disable SkyDream push notifications for all devices connected to your student account?'))return;
    await SkyDreamFirebase.call('studentUnregisterPushToken',{});
    pushStatus={enabled:false,devices:0};renderPushStatus();
    alert('SkyDream push notifications are disabled.');
  }

  async function markMessagesRead(){
    if(!portal)return;
    const ids=(portal.messages||[]).filter(m=>!m.readAt).map(m=>m.id).filter(Boolean);
    if(!ids.length)return;
    try{
      const result=await SkyDreamFirebase.call('studentMarkMessagesRead',{ids});
      const readAt=result.readAt||new Date().toISOString();
      (portal.messages||[]).forEach(m=>{if(ids.includes(m.id))m.readAt=readAt;});
      portal.unreadMessages=0;
      portal.notifications=(portal.notifications||[]).filter(n=>!String(n.id||'').startsWith('message:'));
      render();
    }catch(err){console.warn('Could not mark portal messages as read.',err);}
  }

  async function processQrCheckIn(){
    const token=new URLSearchParams(location.search).get('checkin');
    if(!token||qrHandled)return;
    qrHandled=true;
    try{
      const result=await SkyDreamFirebase.call('studentQrCheckIn',{token});
      const url=new URL(location.href);url.searchParams.delete('checkin');history.replaceState({},'',url.pathname+url.search+url.hash);
      alert(`Attendance recorded for ${result.course} on ${friendlyDate(result.date)}.`);
      portal=await SkyDreamFirebase.call('getStudentPortalDashboard');
      render();
    }catch(err){
      alert(SkyDreamFirebase.friendlyError(err));
    }
  }

  async function ensurePortalServiceWorker(){
    if(!('serviceWorker' in navigator))return null;
    if(serviceWorkerRegistration)return serviceWorkerRegistration;
    try{
      serviceWorkerRegistration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/'});
      serviceWorkerRegistration.update().catch(()=>{});
      return serviceWorkerRegistration;
    }catch(err){
      console.warn('Portal service worker registration failed',err);
      return null;
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    ensurePortalServiceWorker();
    $('portalLoginForm').addEventListener('submit',login);
    $('portalLogout').addEventListener('click',async()=>{await SkyDreamFirebase.auth.signOut();location.reload();});
    $('portalEnablePush').addEventListener('click',()=>enablePush().catch(err=>alert(SkyDreamFirebase.friendlyError(err))));
    $('portalDisablePush').addEventListener('click',()=>disablePush().catch(err=>alert(SkyDreamFirebase.friendlyError(err))));
    document.addEventListener('click',event=>{if(event.target.closest('a[href="#portalMessages"]'))markMessagesRead();});
    window.addEventListener('hashchange',()=>{if(location.hash==='#portalMessages')markMessagesRead();});
    if(SkyDreamFirebase.onPushMessage){
      SkyDreamFirebase.onPushMessage(async()=>{
        message('You have a new SkyDream message.','info');
        try{portal=await SkyDreamFirebase.call('getStudentPortalDashboard');render();}catch(_){}
      });
    }
    SkyDreamFirebase.auth.onAuthStateChanged(async user=>{
      if(!user)return;
      try{const token=await user.getIdTokenResult();if(token.claims.role==='student')await load();else await SkyDreamFirebase.auth.signOut();}catch(_){await SkyDreamFirebase.auth.signOut();}
    });
  });
})();