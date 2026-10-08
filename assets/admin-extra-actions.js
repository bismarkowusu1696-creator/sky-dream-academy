(() => {
  let timer = null;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const friendly = v => { const d=new Date(v||''); return Number.isNaN(d.getTime())?'':d.toLocaleString('en-GB'); };

  function ensureHost() {
    const list = document.getElementById('suiteScheduledList');
    if (!list) return null;
    let host = document.getElementById('suiteAnnouncementControls');
    if (!host) {
      host = document.createElement('div');
      host.id = 'suiteAnnouncementControls';
      host.className = 'mt-18';
      list.parentNode.appendChild(host);
    }
    return host;
  }

  function state(n) {
    const now=Date.now();
    if(n.active===false)return'Hidden';
    if(n.startsAt&&new Date(n.startsAt).getTime()>now)return'Scheduled';
    if(n.expiresAt&&new Date(n.expiresAt).getTime()<=now)return'Expired';
    return'Live';
  }

  async function renderControls() {
    const host = ensureHost();
    if (!host || !SkyDreamFirebase.auth.currentUser) return;
    if (window.SkyDreamAdminOwnerVerified !== true) return;
    try {
      const snap = await SkyDreamFirebase.call('adminGetSuiteSnapshot');
      const notices = (snap.broadcasts || []).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,30);
      host.innerHTML = `<h3>Manage announcements</h3>${notices.length ? notices.map(n=>`<div class="card announcement-card-spacing"><div class="dashboard-top"><span class="badge">${state(n)}</span><small>${esc(friendly(n.date))}</small></div><p>${esc(n.message||'')}</p><div class="toolbar"><button class="btn btn-outline btn-small" type="button" data-extra-toggle="${esc(n.id)}" data-extra-active="${n.active===false?'false':'true'}">${n.active===false?'Show':'Hide'}</button><button class="btn btn-danger btn-small" type="button" data-extra-delete="${esc(n.id)}">Delete</button></div></div>`).join('') : '<p>No announcements.</p>'}`;
    } catch (err) {
      host.textContent = SkyDreamFirebase.friendlyError(err);
    }
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(renderControls, 250);
  }

  document.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-extra-toggle]');
    if (toggle) {
      toggle.disabled = true;
      try {
        await SkyDreamFirebase.call('adminSetBroadcastActive', { id: toggle.dataset.extraToggle, active: toggle.dataset.extraActive !== 'true' });
        await renderControls();
      } catch (err) { alert(SkyDreamFirebase.friendlyError(err)); }
      finally { toggle.disabled = false; }
      return;
    }
    const remove = event.target.closest('[data-extra-delete]');
    if (remove) {
      if (!confirm('Delete this announcement?')) return;
      remove.disabled = true;
      try {
        await SkyDreamFirebase.call('adminDeleteBroadcast', { id: remove.dataset.extraDelete });
        await renderControls();
      } catch (err) { alert(SkyDreamFirebase.friendlyError(err)); }
      finally { remove.disabled = false; }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const waitForSuite = setInterval(() => {
      const list = document.getElementById('suiteScheduledList');
      if (!list) return;
      clearInterval(waitForSuite);
      new MutationObserver(scheduleRefresh).observe(list, { childList: true, subtree: true });
      scheduleRefresh();
    }, 100);

    window.addEventListener('skydream-owner-session-ready', scheduleRefresh);
  });
})();
