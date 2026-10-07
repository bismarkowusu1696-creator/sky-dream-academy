(() => {
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const input = (id, label, type='date', value='', required=true) => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value)}" ${type==='date' ? '' : 'maxlength="100"'} ${required ? 'required' : ''}></div>`;

  async function installIntakePanel(user) {
    const overview = document.getElementById('overview');
    if (!overview || document.getElementById('intakeManagementCard')) return;
    const token = await user.getIdTokenResult();
    if (token.claims.role !== 'admin' || token.claims.adminRole !== 'owner') return;

    try { await SkyDreamFirebase.call('getAdminSnapshot'); }
    catch (_) { return; }

    const card = document.createElement('div');
    card.id = 'intakeManagementCard';
    card.className = 'card mt-20';
    card.innerHTML = `<h3>Start the next intake</h3>
      <p class="hint">This archives the current intake, starts fresh capacity counting for the new cohort, clears the old waitlist, and keeps all existing student/payment/attendance history.</p>
      <p class="hint">Orientation, classes start and training/graduation dates are required. Registration closing defaults to the orientation date if left blank. Break/resume must either both be filled or both be left blank.</p>
      <form id="nextIntakeForm"><div class="form-grid">
        ${input('nextIntakeLabel','Intake label (optional)','text','',false)}
        ${input('nextRegistrationOpen','Registration opens (optional)','date','',false)}
        ${input('nextRegistrationClose','Registration closes (optional)','date','',false)}
        ${input('nextIntakeStart','Orientation / intake start')}
        ${input('nextClassesStart','Classes start')}
        ${input('nextBreakStart','Break starts (optional)','date','',false)}
        ${input('nextResume','Classes resume (optional)','date','',false)}
        ${input('nextEnd','Training / graduation date')}
        ${input('nextThanksgiving','Thanksgiving / closing date (optional)','date','',false)}
        <div class="field full"><button class="btn btn-primary" type="submit">Start Next Intake</button></div>
      </div></form>`;
    overview.appendChild(card);

    document.getElementById('nextIntakeForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        label: document.getElementById('nextIntakeLabel').value.trim(),
        registrationOpenDate: document.getElementById('nextRegistrationOpen').value,
        registrationCloseDate: document.getElementById('nextRegistrationClose').value,
        startDate: document.getElementById('nextIntakeStart').value,
        classesStartDate: document.getElementById('nextClassesStart').value,
        breakStartDate: document.getElementById('nextBreakStart').value,
        resumeDate: document.getElementById('nextResume').value,
        endDate: document.getElementById('nextEnd').value,
        thanksgivingDate: document.getElementById('nextThanksgiving').value
      };

      if (payload.classesStartDate < payload.startDate || payload.endDate < payload.classesStartDate) {
        alert('Please check the dates. Classes must start on or after orientation, and the training end date must be after classes begin.');
        return;
      }
      const effectiveRegistrationClose = payload.registrationCloseDate || payload.startDate;
      if (payload.registrationOpenDate && payload.registrationOpenDate > effectiveRegistrationClose) {
        alert('Registration cannot open after it closes.');
        return;
      }
      if (effectiveRegistrationClose > payload.classesStartDate) {
        alert('Registration must close on or before the first class date.');
        return;
      }
      if (!!payload.breakStartDate !== !!payload.resumeDate) {
        alert('Enter both the break start and resume dates, or leave both blank.');
        return;
      }
      if (payload.breakStartDate && (payload.breakStartDate < payload.classesStartDate || payload.resumeDate <= payload.breakStartDate || payload.resumeDate > payload.endDate)) {
        alert('Please check the break dates. The break must be during the training period and the resume date must be after the break starts.');
        return;
      }
      if (payload.thanksgivingDate && payload.thanksgivingDate < payload.endDate) {
        alert('The Thanksgiving / closing date cannot be before the training end date.');
        return;
      }

      if (!confirm(`Start ${payload.label || payload.startDate} as the new active intake? Existing students will remain in their current cohort.`)) return;
      const button = e.target.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        await SkyDreamFirebase.call('adminStartNextIntake', payload);
        alert('The new intake is now active.');
        location.reload();
      } catch (err) {
        alert(SkyDreamFirebase.friendlyError(err));
        button.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.SkyDreamFirebase || !SkyDreamFirebase.auth) return;
    SkyDreamFirebase.auth.onAuthStateChanged(user => {
      if (user) installIntakePanel(user).catch(console.error);
    });
  });
})();
