(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
  const clean = value => String(value == null ? '' : value);
  let workspace = null;
  let loading = null;

  function labelCourse(value) {
    return clean(value).replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  }
  function notice(text, type = 'info') {
    const el = $('registrationStaffNotice');
    el.textContent = text;
    el.className = 'notice notice-' + type;
    el.classList.remove('hidden');
  }
  function isWithinRegistrationPeriod(value, period) {
    if (!period) return true;
    const t = Date.parse(clean(value));
    if (!Number.isFinite(t)) return false;
    const now = Date.now();
    if (t > now + 86400000) return false;
    if (period === 'today') return new Date(t).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    if (period === 'week') return now - t < 7 * 86400000;
    if (period === 'month') return now - t < 30 * 86400000;
    return true;
  }
  function asDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? clean(value).slice(0, 10) :
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' });
  }
  function registrationsBy(field, list) {
    const counts = {};
    for (const s of list) {
      const key = clean(s[field] || 'Unspecified');
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  function overviewStats() {
    const all = workspace.students || [];
    const currentDate = workspace.intakeStart || '';
    const current = currentDate ? all.filter(s => s.intakeStart === currentDate) : all;
    const valid = current.filter(s => s.status !== 'Cancelled');
    const cancelled = current.filter(s => s.status === 'Cancelled');
    const thisWeek = all.filter(s => isWithinRegistrationPeriod(s.regDate, 'week'));
    return { currentDate, current, valid, cancelled, thisWeek };
  }
  function statCard(value, label, detail) {
    return '<div class="card"><p class="hint">' + esc(label) + '</p><h3>' + esc(value) +
      '</h3><p class="hint">' + esc(detail) + '</p></div>';
  }
  function renderOverview() {
    const summary = overviewStats();
    $('registrationStaffOverviewMeta').textContent = 'Current intake: ' + (summary.currentDate || 'All records') +
      ' · Updated ' + new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra' });
    $('registrationStaffKpis').innerHTML =
      statCard(summary.current.length, 'Current intake records', 'Including cancelled registrations') +
      statCard(summary.valid.length, 'Not cancelled', 'Current intake') +
      statCard(summary.cancelled.length, 'Cancelled', 'Current intake') +
      statCard(summary.thisWeek.length, 'New this week', 'All intakes · past 7 days');
    const recent = (workspace.students || []).filter(s => Number.isFinite(Date.parse(s.regDate || '')))
      .slice().sort((a, b) => Date.parse(b.regDate) - Date.parse(a.regDate)).slice(0, 6);
    $('registrationStaffRecent').innerHTML = recent.length
      ? '<table class="table"><thead><tr><th>Date</th><th>Student</th><th>Program</th><th>Status</th></tr></thead><tbody>' +
        recent.map(s => '<tr><td>' + esc(asDate(s.regDate)) + '</td><td>' + esc(s.fullName) +
        '</td><td>' + esc(labelCourse(s.course)) + '</td><td>' + esc(s.status) + '</td></tr>').join('') +
        '</tbody></table>'
      : '<p class="hint">No dated registrations yet.</p>';
  }
  function reportBars(id, groups, labeler) {
    const host = $(id);
    if (!host) return;
    const max = Math.max(1, ...groups.map(entry => entry[1]));
    host.innerHTML = groups.length
      ? groups.map(([key, count]) => {
        const label = labeler ? labeler(key) : key;
        return '<div class="my-12"><div class="dashboard-top"><span>' + esc(label) +
          '</span><strong>' + count + '</strong></div><progress class="admin-suite-progress" max="' + max +
          '" value="' + count + '" aria-label="' + esc(label) + ' registrations">' + count +
          '</progress></div>';
      }).join('')
      : '<p class="hint">No registration data yet.</p>';
  }
  function renderReports() {
    if (!workspace) return;
    const summary = overviewStats();
    reportBars('registrationStaffProgramBars', registrationsBy('course', summary.current), labelCourse);
    reportBars('registrationStaffIntakeBars', registrationsBy('intakeStart', workspace.students), asDate);
    reportBars('registrationStaffStatusBars', registrationsBy('status', summary.current));
  }
  function clearFilters() {
    $('registrationStaffSearch').value = '';
    $('registrationStaffCourse').value = '';
    $('registrationStaffIntake').value = '';
    $('registrationStaffStatus').value = '';
    $('registrationStaffDateFilter').value = '';
    render();
  }
  function openShortcut(kind) {
    clearFilters();
    if (kind === 'current' && workspace.intakeStart) $('registrationStaffIntake').value = workspace.intakeStart;
    if (kind === 'today') $('registrationStaffDateFilter').value = 'today';
    if (kind === 'week' || kind === 'recent') $('registrationStaffDateFilter').value = 'week';
    if (kind === 'cancelled') $('registrationStaffStatus').value = 'Cancelled';
    render();
    location.hash = 'registrationStaff';
  }
  function filtered() {
    if (!workspace) return [];
    const q = $('registrationStaffSearch').value.trim().toLowerCase();
    const course = $('registrationStaffCourse').value;
    const intake = $('registrationStaffIntake').value;
    const status = $('registrationStaffStatus').value;
    const period = $('registrationStaffDateFilter').value;
    return workspace.students.filter(s =>
      (!course || s.course === course) &&
      (!intake || s.intakeStart === intake) &&
      (!status || s.status === status) &&
      isWithinRegistrationPeriod(s.regDate, period) &&
      (!q || [s.fullName, s.regNumber, s.mobile, s.email].some(v => clean(v).toLowerCase().includes(q)))
    );
  }
  function populateFacilitatorPrograms() {
    const host = $('registrationFacilitatorCourses');
    const courses = workspace && workspace.courses || {};
    host.innerHTML = Object.entries(courses).map(([id,name]) =>
      '<label class="check-row"><input type="checkbox" value="' + esc(id) + '"><span>' +
      esc(name) + '</span></label>'
    ).join('') || '<p class="hint">No programs configured.</p>';
  }
  function renderFacilitators() {
    const facilitators = workspace && Array.isArray(workspace.facilitators) ? workspace.facilitators : [];
    $('registrationFacilitatorCount').textContent = facilitators.length + ' facilitator(s)';
    $('registrationFacilitatorList').innerHTML = facilitators.length ? facilitators.slice()
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
      .map(f => '<div class="card"><strong>' + esc(f.name) +
        '</strong><p class="hint">@' + esc(f.username) + ' · ' + esc(f.phone) +
        '</p><p>' + esc((f.courses || []).map(course => workspace.courses[course] || labelCourse(course)).join(', ') || 'No assigned programs') +
        '</p><span class="badge">' + (f.active ? 'Active' : 'Inactive') + '</span></div>')
      .join('') : '<p class="hint">No facilitator accounts yet.</p>';
  }
  async function createFacilitator(event) {
    event.preventDefault();
    const button = $('registrationFacilitatorSubmit');
    const msg = $('registrationFacilitatorMessage');
    msg.classList.add('hidden');
    const pin = $('registrationFacilitatorPin').value;
    const courses = Array.from($('registrationFacilitatorCourses').querySelectorAll('input:checked'))
      .map(input => input.value);
    if (!/^[0-9]{4}$/.test(pin) || !courses.length) {
      msg.textContent = 'Enter a 4-digit PIN and select at least one program.';
      msg.className = 'notice notice-error mt-14';
      return;
    }
    const payload = {
      name: $('registrationFacilitatorName').value.trim(),
      username: $('registrationFacilitatorUsername').value.trim(),
      phone: $('registrationFacilitatorPhone').value.trim(),
      pin,
      courses
    };
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const created = await SkyDreamFirebase.call('adminDeskCreateFacilitator',payload);
      $('registrationFacilitatorForm').reset();
      await refresh();
      const name = created && created.facilitator && created.facilitator.name || payload.name;
      msg.textContent = name + ' was added successfully. Share the 4-digit PIN privately with the facilitator.';
      msg.className = 'notice notice-success mt-14';
    } catch (error) {
      msg.textContent = SkyDreamFirebase.friendlyError(error);
      msg.className = 'notice notice-error mt-14';
    } finally {
      button.disabled = false;
      button.textContent = 'Create facilitator';
    }
  }

  function populateFilters() {
    const keepCourse = $('registrationStaffCourse').value;
    const keepIntake = $('registrationStaffIntake').value;
    const courses = [...new Set(workspace.students.map(s => s.course).filter(Boolean))].sort();
    const intakes = [...new Set([workspace.intakeStart, ...workspace.students.map(s => s.intakeStart)].filter(Boolean))].sort().reverse();
    $('registrationStaffCourse').innerHTML = '<option value="">All programs</option>' +
      courses.map(id => '<option value="' + esc(id) + '">' + esc(labelCourse(id)) + '</option>').join('');
    $('registrationStaffIntake').innerHTML = '<option value="">All intakes</option>' +
      intakes.map(date => '<option value="' + esc(date) + '">' + esc(date) + '</option>').join('');
    $('registrationStaffCourse').value = courses.includes(keepCourse) ? keepCourse : '';
    $('registrationStaffIntake').value = intakes.includes(keepIntake) ? keepIntake : '';
  }
  function render() {
    if (!workspace) return;
    renderOverview();
    renderReports();
    renderFacilitators();
    const rows = filtered();
    $('registrationStaffCount').textContent = rows.length + ' registration(s) shown · ' + workspace.students.length + ' total';
    $('registrationStaffBody').innerHTML = rows.length ? rows.map(s =>
      '<tr><td>' + esc(s.regNumber) + '</td><td><strong>' + esc(s.fullName) +
      '</strong><br><small>' + esc(s.mobile) + '</small><br><button type="button" class="btn btn-outline btn-small" data-edit-registration="' + esc(s.id) + '">Edit</button></td><td>' + esc(labelCourse(s.course)) +
      '</td><td>' + esc(s.intakeStart || '—') + '</td><td><span class="badge">' +
      esc(s.status) + '</span></td></tr>'
    ).join('') : '<tr><td colspan="5">No matching registrations.</td></tr>';
  }
  function openRegistrationEditor(id) {
    const s = workspace && workspace.students.find(row => row.id === id);
    if (!s) return;
    $('registrationStaffEditForm').reset();
    $('registrationEditError').classList.add('hidden');
    $('registrationEditId').value = s.id;
    $('registrationEditVersion').value = s.registrationVersion || '';
    $('registrationEditIdentity').textContent = s.fullName + ' · ' + s.regNumber;
    $('registrationEditName').value = s.fullName || '';
    $('registrationEditMobile').value = s.mobile || '';
    $('registrationEditWhatsapp').value = s.whatsapp || '';
    $('registrationEditEmail').value = s.email || '';
    $('registrationEditAddress').value = s.address || '';
    const courseNames = workspace.courses || {};
    const available = { ...courseNames };
    if (s.course && !available[s.course]) available[s.course] = labelCourse(s.course);
    $('registrationEditCourse').innerHTML = Object.entries(available)
      .map(([course,name]) => '<option value="' + esc(course) + '">' + esc(name) + '</option>').join('');
    $('registrationEditCourse').value = s.course;
    const statusEditable = ['Registered','Cancelled'].includes(s.status || 'Registered');
    $('registrationEditStatusField').classList.toggle('hidden',!statusEditable);
    $('registrationEditStatus').disabled = !statusEditable;
    if (statusEditable) $('registrationEditStatus').value = s.status || 'Registered';
    $('registrationStaffEditModal').classList.remove('hidden');
    $('registrationEditName').focus();
  }
  function closeRegistrationEditor() {
    $('registrationStaffEditForm').reset();
    $('registrationStaffEditModal').classList.add('hidden');
  }
  async function saveRegistrationEdit(event) {
    event.preventDefault();
    const id = $('registrationEditId').value;
    const original = workspace && workspace.students.find(row => row.id === id);
    if (!original) return;
    const patch = {
      fullName: $('registrationEditName').value.trim(),
      mobile: $('registrationEditMobile').value.trim(),
      whatsapp: $('registrationEditWhatsapp').value.trim(),
      email: $('registrationEditEmail').value.trim(),
      address: $('registrationEditAddress').value.trim(),
      course: $('registrationEditCourse').value
    };
    if (!$('registrationEditStatus').disabled) patch.status = $('registrationEditStatus').value;
    if (patch.course !== original.course &&
        !confirm('Changing the program may issue a NEW registration number for this student. Continue?')) return;
    const button = $('registrationEditSubmit');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const response = await SkyDreamFirebase.call('adminEditRegistration', {
        id,
        registrationVersion: $('registrationEditVersion').value,
        patch
      });
      closeRegistrationEditor();
      await refresh();
      const updated = response && response.registrationNumberChanged
        ? ' Notify the student of their NEW registration number: ' + response.regNumber + '.'
        : '';
      notice((response && response.changed ? 'Registration updated successfully.' : 'No registration changes were needed.') + updated,'success');
    } catch (err) {
      const node = $('registrationEditError');
      node.textContent = SkyDreamFirebase.friendlyError(err);
      node.className = 'notice notice-error';
    } finally {
      button.disabled = false;
      button.textContent = 'Save registration';
    }
  }

  async function refresh(verifiedWorkspace = null) {
    if (loading) return loading;
    loading = (async () => {
      workspace = verifiedWorkspace || await SkyDreamFirebase.call('adminGetRegistrationWorkspace');
      if (!workspace || !workspace.account || workspace.account.role === 'owner') {
        throw new Error('Registration-only workspace is not available for this account.');
      }
      $('registrationStaffIdentity').textContent = '@' + workspace.account.username + ' · Registration staff (' + workspace.account.role + ')';
      $('loginShell').classList.add('hidden');
      $('dashboardShell').classList.add('hidden');
      $('registrationStaffShell').classList.remove('hidden');
      populateFilters();
      populateFacilitatorPrograms();
      render();
      window.dispatchEvent(new CustomEvent('skydream-registration-workspace-ready', {detail: workspace}));
      if (location.hash === '#registrationStaffPassword') location.hash = 'registrationStaffOverview';
    })();
    try { return await loading; } finally { loading = null; }
  }
  function csvCell(value) {
    let v = clean(value).replace(/^\s+/, '');
    if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function downloadCsv(filename, rows) {
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function exportCsv(all = false) {
    if (!workspace) return;
    const selected = all ? workspace.students : filtered();
    await SkyDreamFirebase.call('adminDeskLogExport', {kind:all ? 'all' : 'filtered'});
    downloadCsv(all ? 'SkyDream-All-Registrations.csv' : 'SkyDream-Filtered-Registrations.csv', [
      ['Registration Number','Student','Program','Mobile','Email','Status','Intake','Registration Date'],
      ...selected.map(s => [s.regNumber,s.fullName,labelCourse(s.course),s.mobile,s.email,s.status,s.intakeStart,s.regDate])
    ]);
  }
  async function exportSummaryCsv() {
    if (!workspace) return;
    const summary = overviewStats();
    const rows = [['Category', 'Name', 'Count']];
    for (const [field, list, labeler, category] of [
      ['course', summary.current, labelCourse, 'Program / Current intake'],
      ['intakeStart', workspace.students, asDate, 'Intake / All records'],
      ['status', summary.current, null, 'Status / Current intake']
    ]) {
      for (const [key, count] of registrationsBy(field, list)) {
        rows.push([category, labeler ? labeler(key) : key, count]);
      }
    }
    await SkyDreamFirebase.call('adminDeskLogExport', {kind:'summary'});
    downloadCsv('SkyDream-Registration-Summary.csv', rows);
  }
  document.addEventListener('DOMContentLoaded', () => {
    ['registrationStaffSearch','registrationStaffCourse','registrationStaffIntake','registrationStaffStatus','registrationStaffDateFilter']
      .forEach(id => $(id).addEventListener(id === 'registrationStaffSearch' ? 'input' : 'change', render));
    const exportError = error => notice(SkyDreamFirebase.friendlyError(error),'error');
    $('registrationStaffExport').addEventListener('click', () => exportCsv(false).catch(exportError));
    $('registrationStaffExportAll').addEventListener('click', () => exportCsv(true).catch(exportError));
    $('registrationStaffReportsExport').addEventListener('click', () => exportSummaryCsv().catch(exportError));
    $('registrationStaffClearFilters').addEventListener('click', clearFilters);
    const reload = () => refresh().catch(err => notice(SkyDreamFirebase.friendlyError(err), 'error'));
    $('registrationStaffRefresh').addEventListener('click', reload);
    $('registrationStaffOverviewRefresh').addEventListener('click', reload);
    $('registrationStaffOverview').addEventListener('click', event => {
      const button = event.target.closest('button[data-registration-shortcut]');
      if (button) openShortcut(button.dataset.registrationShortcut);
    });
    $('registrationStaffBody').addEventListener('click', event => {
      const button = event.target.closest('button[data-edit-registration]');
      if (button) openRegistrationEditor(button.dataset.editRegistration);
    });
    $('registrationEditClose').addEventListener('click',closeRegistrationEditor);
    $('registrationStaffEditForm').addEventListener('submit',saveRegistrationEdit);
    document.addEventListener('keydown',event=>{
      if (event.key==='Escape' && !$('registrationStaffEditModal').classList.contains('hidden')) closeRegistrationEditor();
    });
    $('registrationFacilitatorForm').addEventListener('submit', createFacilitator);
    $('registrationFacilitatorRefresh').addEventListener('click', () => refresh()
      .catch(error => { const msg = $('registrationFacilitatorMessage'); msg.textContent = SkyDreamFirebase.friendlyError(error); msg.className = 'notice notice-error mt-14'; }));
    $('registrationStaffLogout').addEventListener('click', async () => {
      await SkyDreamFirebase.auth.signOut();
      location.reload();
    });
  });
  window.SkyDreamRegistrationWorkspace = { open: refresh };
})();