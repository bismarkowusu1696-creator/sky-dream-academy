(() => {
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const input = (id, label, type='date', value='') => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value)}" ${type==='date' ? '' : 'maxlength="100"'} required></div>`;

  async function installIntakePanel(user) {
    const overview = document.getElementById('overview');
    if (!overview || document.getElementById('intakeManagementCard')) return;
    const token = await user.getIdTokenResult();
    if (token.claims.role !== 'admin' || token.claims.adminRole !== 'owner') return;

    let snapshot;
    try { snapshot = await SkyDreamFirebase.call('getAdminSnapshot'); }
    catch (_) { return; }
    const current = snapshot.intake || {};
    const card = document.createElement('div');
    card.id = 'intakeManagementCard';
    card.className = 'card';
    card.style.marginTop = '20px';
    card.innerHTML = `<h3>Start the next intake</h3>
      <p class="hint">This archives the current intake, starts fresh capacity counting for the new cohort, clears the old waitlist, and keeps all existing student/payment/attendance history.</p>
      <form id="nextIntakeForm"><div class="form-grid">
        ${input('nextIntakeLabel','Intake label','text','')}
        ${input('nextIntakeStart','Orientation / intake start')}
        ${input('nextClassesStart','Classes start')}
        ${input('nextBreakStart','Break starts')}
        ${input('nextResume','Classes resume')}
        ${input('nextEnd','Training / graduation date')}
        ${input('nextThanksgiving','Thanksgiving / closing date')}
        <div class="field full"><button class="btn btn-primary" type="submit">Start Next Intake</button></div>
      </div></form>`;
    overview.appendChild(card);

    document.getElementById('nextIntakeForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        label: document.getElementById('nextIntakeLabel').value.trim(),
        startDate: document.getElementById('nextIntakeStart').value,
        classesStartDate: document.getElementById('nextClassesStart').value,
        breakStartDate: document.getElementById('nextBreakStart').value,
        resumeDate: document.getElementById('nextResume').value,
        endDate: document.getElementById('nextEnd').value,
        thanksgivingDate: document.getElementById('nextThanksgiving').value
      };
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
