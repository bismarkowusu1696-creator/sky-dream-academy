(() => {
  function formatDate(iso) {
    if (!iso) return 'To be announced';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  async function syncSchedule() {
    if (!window.SkyDreamFirebase) return;
    try {
      const catalog = await SkyDreamFirebase.call('publicCatalog');
      const intake = catalog && catalog.intake || {};
      const dates = [
        intake.startDate,
        intake.classesStartDate,
        intake.breakStartDate,
        intake.resumeDate,
        intake.endDate,
        intake.thanksgivingDate
      ];
      document.querySelectorAll('.schedule-row time').forEach((el, i) => {
        const value = dates[i];
        if (value) {
          el.dateTime = value;
          el.textContent = formatDate(value);
        } else {
          el.removeAttribute('datetime');
          el.textContent = 'To be announced';
        }
      });
      const title = document.getElementById('scheduleTitle');
      if (title && intake.label) title.textContent = `${intake.label} schedule`;
      const intro = document.getElementById('scheduleIntro');
      if (intro && intake.startDate && intake.classesStartDate) {
        intro.innerHTML = `Orientation and the first teaching day are different dates. Orientation is on <strong>${formatDate(intake.startDate)}</strong>; classes begin on <strong>${formatDate(intake.classesStartDate)}</strong>.`;
      }
    } catch (err) {
      console.warn('Could not load the live intake schedule.', err);
    }
  }

  document.addEventListener('DOMContentLoaded', syncSchedule);
})();
