(() => {
  function addPinButtons() {
    const list = document.getElementById('facilitatorList');
    if (!list) return;
    list.querySelectorAll('[data-delete-fac]').forEach(removeBtn => {
      const id = removeBtn.dataset.deleteFac;
      const card = removeBtn.closest('.card');
      if (!card || card.querySelector('[data-set-fac-pin]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-small';
      btn.dataset.setFacPin = id;
      btn.textContent = 'Set PIN';
      btn.style.marginRight = '8px';
      removeBtn.parentNode.insertBefore(btn, removeBtn);
    });
  }

  async function setPin(id) {
    const pin = prompt('Enter a new 4-digit PIN for this facilitator:');
    if (pin === null) return;
    if (!/^\d{4}$/.test(pin)) {
      alert('The PIN must be exactly 4 digits.');
      return;
    }
    try {
      await SkyDreamFirebase.call('adminSetFacilitatorPin', { id, pin });
      alert('Facilitator PIN updated. Existing facilitator sessions have been revoked.');
    } catch (err) {
      alert(SkyDreamFirebase.friendlyError(err));
    }
  }

  function ensureAnnouncementUi() {
    const main = document.querySelector('.dashboard-main');
    if (!main || document.getElementById('announcements')) return;

    const nav = document.querySelector('.dashboard-sidebar nav');
    if (nav && !nav.querySelector('a[href="#announcements"]')) {
      const link = document.createElement('a');
      link.href = '#announcements';
      link.textContent = 'Announcements';
      const messagesLink = nav.querySelector('a[href="#messages"]');
      nav.insertBefore(link, messagesLink || nav.firstChild);
    }

    const section = document.createElement('section');
    section.id = 'announcements';
    section.className = 'dashboard-panel';
    section.innerHTML = `
      <div class="dashboard-top">
        <div>
          <h2>Website announcements</h2>
          <p class="hint">Post a notice that will appear on the public website. The latest active notices are shown to visitors.</p>
        </div>
      </div>
      <form id="announcementForm" class="card" style="margin-bottom:20px">
        <div class="field">
          <label for="announcementText">Announcement message</label>
          <textarea id="announcementText" rows="3" maxlength="500" required placeholder="Example: Registration for the next intake is now open."></textarea>
          <span class="hint"><span id="announcementCount">0</span>/500 characters</span>
        </div>
        <p style="margin-bottom:0"><button class="btn btn-primary" type="submit">Post Announcement</button></p>
      </form>
      <div id="announcementList" class="grid"></div>`;

    const messages = document.getElementById('messages');
    main.insertBefore(section, messages || null);

    const text = document.getElementById('announcementText');
    const count = document.getElementById('announcementCount');
    text.addEventListener('input', () => { count.textContent = String(text.value.length); });
    document.getElementById('announcementForm').addEventListener('submit', postAnnouncement);
  }

  function friendlyDate(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB');
  }

  function renderAnnouncements(list) {
    const host = document.getElementById('announcementList');
    if (!host) return;
    host.innerHTML = '';
    const notices = Array.isArray(list) ? list.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : [];
    if (!notices.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No announcements have been posted yet.';
      host.appendChild(empty);
      return;
    }

    notices.forEach(notice => {
      const card = document.createElement('div');
      card.className = 'card';

      const status = document.createElement('div');
      status.className = 'toolbar';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = notice.active === false ? 'Hidden' : 'Live';
      status.appendChild(badge);
      if (notice.date) {
        const when = document.createElement('small');
        when.className = 'hint';
        when.textContent = friendlyDate(notice.date);
        status.appendChild(when);
      }

      const message = document.createElement('p');
      message.style.whiteSpace = 'pre-wrap';
      message.textContent = notice.message || '';

      const actions = document.createElement('div');
      actions.className = 'toolbar';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn btn-outline btn-small';
      toggle.dataset.announcementToggle = notice.id;
      toggle.dataset.active = notice.active === false ? 'false' : 'true';
      toggle.textContent = notice.active === false ? 'Show' : 'Hide';
      actions.appendChild(toggle);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger btn-small';
      remove.dataset.announcementDelete = notice.id;
      remove.textContent = 'Delete';
      actions.appendChild(remove);

      card.append(status, message, actions);
      host.appendChild(card);
    });
  }

  async function loadAnnouncements() {
    const host = document.getElementById('announcementList');
    if (!host || !SkyDreamFirebase.auth.currentUser) return;
    try {
      const snapshot = await SkyDreamFirebase.call('getAdminSnapshot');
      renderAnnouncements(snapshot.broadcasts || []);
    } catch (err) {
      host.textContent = SkyDreamFirebase.friendlyError(err);
    }
  }

  async function postAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.getElementById('announcementText');
    const message = input.value.trim();
    if (!message) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await SkyDreamFirebase.call('adminCreateBroadcast', { message });
      form.reset();
      document.getElementById('announcementCount').textContent = '0';
      await loadAnnouncements();
      alert('Announcement posted on the website.');
    } catch (err) {
      alert(SkyDreamFirebase.friendlyError(err));
    } finally {
      button.disabled = false;
    }
  }

  async function toggleAnnouncement(id, currentlyActive, button) {
    button.disabled = true;
    try {
      await SkyDreamFirebase.call('adminSetBroadcastActive', { id, active: !currentlyActive });
      await loadAnnouncements();
    } catch (err) {
      alert(SkyDreamFirebase.friendlyError(err));
    } finally {
      button.disabled = false;
    }
  }

  async function deleteAnnouncement(id, button) {
    if (!confirm('Delete this website announcement?')) return;
    button.disabled = true;
    try {
      await SkyDreamFirebase.call('adminDeleteBroadcast', { id });
      await loadAnnouncements();
    } catch (err) {
      alert(SkyDreamFirebase.friendlyError(err));
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener('click', event => {
    const pinBtn = event.target.closest('[data-set-fac-pin]');
    if (pinBtn) {
      setPin(pinBtn.dataset.setFacPin);
      return;
    }

    const toggleBtn = event.target.closest('[data-announcement-toggle]');
    if (toggleBtn) {
      toggleAnnouncement(toggleBtn.dataset.announcementToggle, toggleBtn.dataset.active === 'true', toggleBtn);
      return;
    }

    const deleteBtn = event.target.closest('[data-announcement-delete]');
    if (deleteBtn) deleteAnnouncement(deleteBtn.dataset.announcementDelete, deleteBtn);
  });

  document.addEventListener('DOMContentLoaded', () => {
    ensureAnnouncementUi();

    const list = document.getElementById('facilitatorList');
    if (list) {
      addPinButtons();
      new MutationObserver(addPinButtons).observe(list, { childList: true, subtree: true });
    }

    SkyDreamFirebase.auth.onAuthStateChanged(async user => {
      if (!user) return;
      try {
        const token = await user.getIdTokenResult();
        if (token.claims.role === 'admin') await loadAnnouncements();
      } catch (_) {}
    });
  });
})();
