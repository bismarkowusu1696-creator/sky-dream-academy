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
    renderOverview();
    renderReports();
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
      render();
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
  function exportCsv(all = false) {
    if (!workspace) return;
    const selected = all ? workspace.students : filtered();
    downloadCsv(all ? 'SkyDream-All-Registrations.csv' : 'SkyDream-Filtered-Registrations.csv', [
      ['Registration Number','Student','Program','Mobile','Email','Status','Intake','Registration Date'],
      ...selected.map(s => [s.regNumber,s.fullName,labelCourse(s.course),s.mobile,s.email,s.status,s.intakeStart,s.regDate])
    ]);
  }
  function exportSummaryCsv() {
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
    downloadCsv('SkyDream-Registration-Summary.csv', rows);
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
  document.addEventListener('DOMContentLoaded', () => {
    ['registrationStaffSearch','registrationStaffCourse','registrationStaffIntake','registrationStaffStatus','registrationStaffDateFilter']
      .forEach(id => $(id).addEventListener(id === 'registrationStaffSearch' ? 'input' : 'change', render));
    $('registrationStaffExport').addEventListener('click', () => exportCsv(false));
    $('registrationStaffExportAll').addEventListener('click', () => exportCsv(true));
    $('registrationStaffReportsExport').addEventListener('click', exportSummaryCsv);
    $('registrationStaffClearFilters').addEventListener('click', clearFilters);
    const reload = () => refresh().catch(err => notice(SkyDreamFirebase.friendlyError(err), 'error'));
    $('registrationStaffRefresh').addEventListener('click', reload);
    $('registrationStaffOverviewRefresh').addEventListener('click', reload);
    $('registrationStaffOverview').addEventListener('click', event => {
      const button = event.target.closest('button[data-registration-shortcut]');
      if (button) openShortcut(button.dataset.registrationShortcut);
    });
    $('registrationStaffLogout').addEventListener('click', async () => {
      await SkyDreamFirebase.auth.signOut();
      location.reload();
    });
    $('registrationStaffBody').addEventListener('click', event => {
      const button = event.target.closest('button[data-registration-status]');
      if (button) changeStatus(button.dataset.registrationId, button.dataset.registrationStatus, button);
    });
  });
  window.SkyDreamRegistrationWorkspace = { open: refresh };
})();