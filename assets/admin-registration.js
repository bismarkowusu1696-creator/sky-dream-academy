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
  function filtered() {
    if (!workspace) return [];
    const q = $('registrationStaffSearch').value.trim().toLowerCase();
    const course = $('registrationStaffCourse').value;
    const intake = $('registrationStaffIntake').value;
    const status = $('registrationStaffStatus').value;
    return workspace.students.filter(s =>
      (!course || s.course === course) &&
      (!intake || s.intakeStart === intake) &&
      (!status || s.status === status) &&
      (!q || [s.fullName, s.regNumber, s.mobile, s.email].some(v => clean(v).toLowerCase().includes(q)))
    );
  }
  function populateFilters() {
    const keepCourse = $('registrationStaffCourse').value;
    const keepIntake = $('registrationStaffIntake').value;
    const courses = [...new Set(workspace.students.map(s => s.course).filter(Boolean))].sort();
    const intakes = [...new Set(workspace.students.map(s => s.intakeStart).filter(Boolean))].sort().reverse();
    $('registrationStaffCourse').innerHTML = '<option value="">All programs</option>' +
      courses.map(id => '<option value="' + esc(id) + '">' + esc(labelCourse(id)) + '</option>').join('');
    $('registrationStaffIntake').innerHTML = '<option value="">All intakes</option>' +
      intakes.map(date => '<option value="' + esc(date) + '">' + esc(date) + '</option>').join('');
    $('registrationStaffCourse').value = courses.includes(keepCourse) ? keepCourse : '';
    $('registrationStaffIntake').value = intakes.includes(keepIntake) ? keepIntake : '';
  }
  function render() {
    if (!workspace) return;
    const rows = filtered();
    $('registrationStaffCount').textContent = rows.length + ' registration(s) shown · ' + workspace.students.length + ' total';
    $('registrationStaffBody').innerHTML = rows.length ? rows.map(s => {
      const action = s.status === 'Cancelled'
        ? '<button class="btn btn-primary btn-small" type="button" data-registration-id="' + esc(s.id) + '" data-registration-status="Registered">Mark Registered</button>'
        : '<button class="btn btn-outline btn-small" type="button" data-registration-id="' + esc(s.id) + '" data-registration-status="Cancelled">Cancel registration</button>';
      return '<tr><td>' + esc(s.regNumber) + '</td><td><strong>' + esc(s.fullName) +
        '</strong><br><small>' + esc(s.mobile) + '</small></td><td>' + esc(labelCourse(s.course)) +
        '</td><td>' + esc(s.intakeStart || '—') + '</td><td><span class="badge">' +
        esc(s.status) + '</span></td><td>' + action + '</td></tr>';
    }).join('') : '<tr><td colspan="6">No matching registrations.</td></tr>';
  }
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      workspace = await SkyDreamFirebase.call('adminGetRegistrationWorkspace');
      $('registrationStaffIdentity').textContent = '@' + workspace.account.username + ' · Registration-only administrator';
      $('loginShell').classList.add('hidden');
      $('dashboardShell').classList.add('hidden');
      $('registrationStaffShell').classList.remove('hidden');
      populateFilters();
      render();
    })();
    try { return await loading; } finally { loading = null; }
  }
  function csvCell(value) {
    let v = clean(value).replace(/^\s+/, '');
    if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    if (!workspace) return;
    const rows = [
      ['Registration Number','Student','Program','Mobile','Email','Status','Intake','Registration Date'],
      ...filtered().map(s => [s.regNumber,s.fullName,labelCourse(s.course),s.mobile,s.email,s.status,s.intakeStart,s.regDate])
    ];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'SkyDream-Registrations.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function changeStatus(id, status, button) {
    const s = workspace && workspace.students.find(x => x.id === id);
    if (!s || !['Registered','Cancelled'].includes(status)) return;
    if (!confirm('Change ' + s.fullName + ' (' + s.regNumber + ') to ' + status + '?')) return;
    button.disabled = true;
    try {
      await SkyDreamFirebase.call('adminSetRegistrationStatus', { id, status });
      await refresh();
      notice('Registration updated to ' + status + '.', 'success');
    } catch (err) {
      notice(SkyDreamFirebase.friendlyError(err), 'error');
    } finally { if (button.isConnected) button.disabled = false; }
  }
  async function changePassword(event) {
    event.preventDefault();
    const currentPassword = $('registrationStaffCurrentPassword').value;
    const newPassword = $('registrationStaffNewPassword').value;
    if (newPassword !== $('registrationStaffConfirmPassword').value ||
        newPassword.length < 12 || !/[a-z]/.test(newPassword) ||
        !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      notice('New passwords must match and contain 12+ characters with uppercase, lowercase and a number.', 'error');
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await SkyDreamFirebase.call('adminChangePassword', { currentPassword, newPassword });
      event.currentTarget.reset();
      notice('Your own password was updated.', 'success');
    } catch(err) { notice(SkyDreamFirebase.friendlyError(err), 'error'); }
    finally { button.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['registrationStaffSearch','registrationStaffCourse','registrationStaffIntake','registrationStaffStatus']
      .forEach(id => $(id).addEventListener(id === 'registrationStaffSearch' ? 'input' : 'change', render));
    $('registrationStaffExport').addEventListener('click', exportCsv);
    $('registrationStaffRefresh').addEventListener('click', () => refresh().catch(err => notice(SkyDreamFirebase.friendlyError(err), 'error')));
    $('registrationStaffLogout').addEventListener('click', async () => {
      await SkyDreamFirebase.auth.signOut();
      location.reload();
    });
    $('registrationStaffPasswordForm').addEventListener('submit', changePassword);
    $('registrationStaffBody').addEventListener('click', event => {
      const button = event.target.closest('button[data-registration-status]');
      if (button) changeStatus(button.dataset.registrationId, button.dataset.registrationStatus, button);
    });
  });
  window.SkyDreamRegistrationWorkspace = { open: refresh };
})();