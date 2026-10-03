(() => {
  const PROGRAMS = [
    ['household-chemicals','Household Chemicals Production','Learn to formulate, mix and package everyday cleaning and personal-care products.'],
    ['hair-dressing','Hair Dressing','Build practical salon skills in braiding, weaving, relaxing, styling and client care.'],
    ['cosmetology','Cosmetology','Study skin care, make-up application, facials, nail care, hygiene and sanitation.'],
    ['electricals','Electricals','Learn household wiring, circuit testing, fault-finding and safe installation practices.'],
    ['floral-decor','Floral Decor','Design bouquets, centrepieces and event installations using fresh and artificial flowers.'],
    ['fashion-design','Fashion Design','Learn pattern drafting, cutting, sewing, garment fitting and fabric selection.'],
    ['beading','Beading','Create jewellery and accessories, including waist beads, modern pieces and basic wire work.'],
    ['french','French Language','Build practical conversational and workplace French for travel, trade and further study.'],
    ['korean','Korean Language','Learn Hangul, everyday conversation, basic grammar and cultural etiquette.'],
    ['pastries','Pastries & Baking','Develop practical bread, cake, pastry and small bakery business skills.'],
    ['graphic-design','Graphic Design','Learn practical visual design skills for branding, print, social media and digital work.'],
    ['barbering','Barbering','Develop haircutting, grooming, hygiene, finishing and client service skills.'],
    ['accounting','Accounting','Build foundational bookkeeping, records, calculations and small-business accounting skills.']
  ];
  const names = Object.fromEntries(PROGRAMS.map(p => [p[0], p[1]]));
  let catalog = null;

  function $(id){ return document.getElementById(id); }
  function escapeHtml(value){ return String(value == null ? '' : value).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function showMessage(host, message, type='info'){
    if(!host) return;
    host.className = `notice notice-${type}`;
    host.textContent = message;
    host.classList.remove('hidden');
  }
  function hideMessage(host){ if(host) host.classList.add('hidden'); }
  function todayIso(){
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,10);
  }

  function initNav(){
    const toggle = $('navToggle');
    const links = $('navLinks');
    if(toggle && links) toggle.addEventListener('click', () => links.classList.toggle('open'));
    if(links) links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));
  }

  function initDob(){
    const dob = $('dob');
    if(!dob) return;
    dob.max = todayIso();
  }

  function formatDate(iso){
    if(!iso) return 'To be announced';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  }

  function registrationState(){
    if(catalog && catalog.registrationEnabled === false){
      return { open:false, known:true, message:'Online registration is currently paused. Please contact the academy for assistance.' };
    }
    if(!catalog || !catalog.intake) return { open:true, known:false, message:'' };
    const intake = catalog.intake || {};
    const today = todayIso();
    const openDate = intake.registrationOpenDate || '';
    const closeDate = intake.registrationCloseDate || intake.startDate || intake.classesStartDate || '';
    if(openDate && today < openDate){
      return { open:false, known:true, message:`Online registration opens on ${formatDate(openDate)}.` };
    }
    if(closeDate && today > closeDate){
      return { open:false, known:true, message:`Online registration for this intake closed on ${formatDate(closeDate)}. Please contact the academy if you need assistance.` };
    }
    return { open:true, known:true, message:closeDate ? `Online registration is open through ${formatDate(closeDate)}.` : '' };
  }

  function renderPrograms(){
    const host = $('programGrid');
    if(!host) return;
    const availability = catalog ? Object.fromEntries(catalog.programs.map(p => [p.id,p])) : {};
    const programs = catalog ? PROGRAMS.filter(([id]) => availability[id]) : PROGRAMS;
    const registration = registrationState();
    host.innerHTML = programs.map(([id,name,desc]) => {
      const live = availability[id];
      const availabilityText = !registration.open
        ? registration.message
        : (live ? (live.full ? 'Waitlist currently open' : `${live.available} place${live.available===1?'':'s'} currently available`) : 'Registration open');
      const action = registration.open
        ? `<a class="btn btn-outline" href="register.html?course=${encodeURIComponent(id)}">Register for this program</a>`
        : '<span class="btn btn-outline" aria-disabled="true">Registration unavailable</span>';
      return `<article class="card program-card">
        <div class="meta"><span>3 months</span><span data-registration-fee>GHS ${catalog ? catalog.registrationFee : 50} registration</span></div>
        <h3>${escapeHtml(name)}</h3>
        <p>${escapeHtml(desc)}</p>
        <div class="availability ${(!registration.open || (live && live.full)) ? 'full':''}">${escapeHtml(availabilityText)}</div>
        ${action}
      </article>`;
    }).join('');
  }

  function populateCourseSelect(){
    const select = $('course');
    if(!select) return;
    const availability = catalog ? Object.fromEntries(catalog.programs.map(p => [p.id,p])) : {};
    const programs = catalog ? PROGRAMS.filter(([id]) => availability[id]) : PROGRAMS;
    select.innerHTML = '<option value="">Select a program</option>' + programs.map(([id,name]) => {
      const live = availability[id];
      return `<option value="${id}">${escapeHtml(name)}${live && live.full ? ' — Full (waitlist)' : ''}</option>`;
    }).join('');
    const params = new URLSearchParams(location.search);
    const requested = params.get('course');
    if(requested && programs.some(([id]) => id === requested)) select.value = requested;
  }

  function applyRegistrationWindow(){
    const form = $('registrationForm');
    if(!form || !catalog) return;
    const submit = form.querySelector('button[type=submit]');
    const message = $('registrationMessage');
    const state = registrationState();
    if(!state.open){
      if(submit){
        submit.disabled = true;
        submit.dataset.windowClosed = '1';
        submit.textContent = catalog.registrationEnabled === false ? 'Registration Paused' : 'Registration Closed';
      }
      showMessage(message,state.message,'info');
    }else if(submit && submit.dataset.windowClosed === '1'){
      submit.disabled = false;
      delete submit.dataset.windowClosed;
      submit.textContent = 'Submit Registration';
      hideMessage(message);
    }
  }

  function applyCatalog(){
    if(!catalog) return;
    const intake = catalog.intake || {};
    document.querySelectorAll('[data-intake-label]').forEach(el => el.textContent = intake.label || 'Current intake');
    document.querySelectorAll('[data-intake-orientation]').forEach(el => el.textContent = formatDate(intake.startDate));
    document.querySelectorAll('[data-intake-classes]').forEach(el => el.textContent = formatDate(intake.classesStartDate));
    document.querySelectorAll('[data-intake-end]').forEach(el => el.textContent = formatDate(intake.endDate));
    document.querySelectorAll('[data-registration-fee]').forEach(el => el.textContent = `GHS ${catalog.registrationFee}`);
    const noticeHost = $('siteNotices');
    if(noticeHost){
      noticeHost.innerHTML = Array.isArray(catalog.notices) && catalog.notices.length
        ? catalog.notices.map(n => `<div class="notice notice-info">${escapeHtml(n.message)}</div>`).join('')
        : '';
    }
    renderPrograms();
    populateCourseSelect();
    applyRegistrationWindow();
  }

  function pageNeedsCatalog(){
    return !!document.querySelector('#programGrid, #course, #siteNotices, [data-intake-label], [data-intake-orientation], [data-intake-classes], [data-intake-end], [data-registration-fee]');
  }

  async function loadCatalog(){
    if(!window.SkyDreamFirebase || !pageNeedsCatalog()) return;
    try{
      catalog = await SkyDreamFirebase.call('publicCatalog');
      applyCatalog();
    }catch(err){
      console.warn('Could not load live course availability.', err);
      renderPrograms();
      populateCourseSelect();
    }
  }

  function initRegistration(){
    const form = $('registrationForm');
    if(!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const message = $('registrationMessage');
      hideMessage(message);
      const submit = form.querySelector('button[type=submit]');
      if(!window.SkyDreamFirebase){ showMessage(message,'The registration service is unavailable. Please try again later.','error'); return; }
      const windowState = registrationState();
      if(catalog && !windowState.open){ showMessage(message,windowState.message,'info'); return; }
      const dobValue = $('dob').value;
      if(dobValue && dobValue > todayIso()){
        showMessage(message,'Date of birth cannot be in the future.','error');
        $('dob').focus();
        return;
      }
      const payload = {
        fullName:$('fullName').value.trim(), dob:dobValue, gender:$('gender').value,
        ghanaCard:$('ghanaCard').value.trim(), gpsAddress:$('gpsAddress').value.trim(), address:$('address').value.trim(),
        mobile:$('mobile').value.trim(), whatsapp:$('whatsapp').value.trim(), email:$('email').value.trim(),
        emName:$('emName').value.trim(), emRel:$('emRel').value.trim(), emPhone:$('emPhone').value.trim(),
        course:$('course').value, consent:$('privacyConsent').checked, website:$('website').value
      };
      submit.disabled = true; submit.textContent = 'Submitting…';
      try{
        const result = await SkyDreamFirebase.call('registerStudent',payload);
        if(result.waitlisted){
          showMessage(message,`This program is currently full. You have been added to the ${result.courseName} waitlist and the academy will contact you if a place opens.`,'info');
        }else{
          form.reset();
          initDob();
          showMessage(message,`Registration successful. Your registration number is ${result.regNumber}. Keep this number safe — you will need it to check your status.`,'success');
          const resultHost = $('registrationSuccess');
          if(resultHost){
            resultHost.innerHTML = `<h3>Registration confirmed</h3><p><strong>${escapeHtml(result.fullName)}</strong></p><p>Program: ${escapeHtml(result.courseName)}</p><p>Registration number: <strong>${escapeHtml(result.regNumber)}</strong></p><p>Use your registration number and mobile number on the <a href="check-status.html">Check Status</a> page.</p>`;
            resultHost.classList.remove('hidden');
          }
          populateCourseSelect();
        }
      }catch(err){
        showMessage(message,SkyDreamFirebase.friendlyError(err),'error');
      }finally{
        if(submit.dataset.windowClosed !== '1'){
          submit.disabled = false;
          submit.textContent = 'Submit Registration';
        }
      }
    });
  }

  function initStatus(){
    const form = $('statusForm');
    if(!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const message = $('statusMessage');
      const resultHost = $('statusResult');
      hideMessage(message); if(resultHost) resultHost.classList.add('hidden');
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      try{
        const result = await SkyDreamFirebase.call('checkStudentStatus',{regNumber:$('regNumber').value.trim(),mobile:$('statusMobile').value.trim()});
        if(resultHost){
          resultHost.innerHTML = `<h3>Registration status</h3><div class="result-list">
            <div><span>Student</span><strong>${escapeHtml(result.fullName)}</strong></div>
            <div><span>Registration number</span><strong>${escapeHtml(result.regNumber)}</strong></div>
            <div><span>Program</span><strong>${escapeHtml(result.course)}</strong></div>
            <div><span>Status</span><strong>${escapeHtml(result.status)}</strong></div>
            <div><span>Payment</span><strong>${escapeHtml(result.paymentStatus)} — GHS ${Number(result.paid).toFixed(2)} paid</strong></div>
            <div><span>Balance</span><strong>GHS ${Number(result.balance).toFixed(2)}</strong></div>
            <div><span>Attendance</span><strong>${result.attendance.present} present / ${result.attendance.absent} absent</strong></div>
            <div><span>Intake</span><strong>${escapeHtml(formatDate(result.intakeStart))}</strong></div>
          </div>`;
          resultHost.classList.remove('hidden');
        }
      }catch(err){ showMessage(message,SkyDreamFirebase.friendlyError(err),'error'); }
      finally{ submit.disabled=false; }
    });
  }

  function initContact(){
    const form = $('contactForm');
    if(!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const message = $('contactMessage');
      const submit = form.querySelector('button[type=submit]');
      hideMessage(message); submit.disabled = true;
      try{
        await SkyDreamFirebase.call('submitContactMessage',{name:$('contactName').value.trim(),email:$('contactEmail').value.trim(),message:$('contactText').value.trim(),website:$('contactWebsite').value});
        form.reset(); showMessage(message,'Thank you. Your message has been received.','success');
      }catch(err){ showMessage(message,SkyDreamFirebase.friendlyError(err),'error'); }
      finally{ submit.disabled=false; }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initDob();
    renderPrograms();
    populateCourseSelect();
    initRegistration();
    initStatus();
    initContact();
    loadCatalog();
    document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  });
})();
