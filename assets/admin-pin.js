(() => {
  function loadAsset(tag, attrs) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => el[k] = v);
    document.head.appendChild(el);
    return el;
  }

  if (!document.querySelector('link[href="assets/admin-suite.css"]')) {
    loadAsset('link', { rel: 'stylesheet', href: 'assets/admin-suite.css' });
  }
  if (!document.querySelector('script[src="assets/admin-suite.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/admin-suite.js';
    script.async = false;
    document.body.appendChild(script);
  }
  if (!document.querySelector('script[src="assets/admin-extra-actions.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/admin-extra-actions.js';
    script.async = false;
    document.body.appendChild(script);
  }

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

  document.addEventListener('click', event => {
    const pinBtn = event.target.closest('[data-set-fac-pin]');
    if (pinBtn) setPin(pinBtn.dataset.setFacPin);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('facilitatorList');
    if (list) {
      addPinButtons();
      new MutationObserver(addPinButtons).observe(list, { childList: true, subtree: true });
    }
  });
})();
