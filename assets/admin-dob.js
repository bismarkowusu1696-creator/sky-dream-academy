(() => {
  if (!window.SkyDreamFirebase) return;

  let latestSnapshot = null;
  const originalCall = window.SkyDreamFirebase.call.bind(window.SkyDreamFirebase);

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function ageFromDob(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number);
    const now = new Date();
    let age = now.getFullYear() - year;
    const beforeBirthday =
      now.getMonth() + 1 < month ||
      (now.getMonth() + 1 === month && now.getDate() < day);
    if (beforeBirthday) age -= 1;
    return age >= 0 && age <= 130 ? age : null;
  }

  function updateAge() {
    const dob = document.getElementById('editDob');
    const age = document.getElementById('editAge');
    if (!dob || !age) return;
    const years = ageFromDob(dob.value);
    age.value = years == null ? 'Not available' : `${years} year${years === 1 ? '' : 's'}`;
  }

  function installDobFields() {
    const grid = document.querySelector('#editStudentForm .form-grid');
    const fullNameField = document.getElementById('editFullName')?.closest('.field');
    if (!grid || !fullNameField || document.getElementById('editDob')) return;

    const dobField = document.createElement('div');
    dobField.className = 'field';
    dobField.innerHTML = '<label for="editDob">Date of birth</label><input id="editDob" type="date"><span class="hint">You can correct the date if the student entered it incorrectly.</span>';

    const ageField = document.createElement('div');
    ageField.className = 'field';
    ageField.innerHTML = '<label for="editAge">Age</label><input id="editAge" type="text" value="Not available" readonly aria-readonly="true"><span class="hint">Calculated automatically from the date of birth.</span>';

    fullNameField.after(dobField, ageField);
    const dob = document.getElementById('editDob');
    dob.max = todayIso();
    dob.addEventListener('input', updateAge);
    dob.addEventListener('change', updateAge);
  }

  function fillDobForStudent(id) {
    installDobFields();
    const dob = document.getElementById('editDob');
    if (!dob) return;
    const student = latestSnapshot && Array.isArray(latestSnapshot.students)
      ? latestSnapshot.students.find(item => String(item.id) === String(id))
      : null;
    dob.value = student && student.dob ? student.dob : '';
    updateAge();
  }

  window.SkyDreamFirebase.call = async function(name, data = {}) {
    let payload = data;

    if (name === 'adminUpdateStudent' && data && data.patch) {
      const dob = document.getElementById('editDob');
      if (dob) {
        payload = {
          ...data,
          patch: {
            ...data.patch,
            dob: dob.value || ''
          }
        };
      }
    }

    const result = await originalCall(name, payload);
    if (name === 'getAdminSnapshot' && result && Array.isArray(result.students)) {
      latestSnapshot = result;
    }
    return result;
  };

  document.addEventListener('DOMContentLoaded', installDobFields);

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-edit]');
    if (!button) return;
    queueMicrotask(() => fillDobForStudent(button.dataset.edit));
  });
})();
