(() => {
  let deferredInstallPrompt = null;
  let installButton = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isChromium = () => /Chrome|Chromium|Edg\//i.test(window.navigator.userAgent);

  function closeInstallHelp() {
    document.getElementById('pwaInstallHelp')?.remove();
  }

  function hideInstallButton() {
    if (installButton) installButton.hidden = true;
  }

  function updateInstallButton() {
    if (!installButton) return;
    if (isStandalone()) {
      installButton.hidden = true;
      return;
    }
    installButton.hidden = false;
    installButton.dataset.ready = deferredInstallPrompt ? 'true' : 'false';
    const label = installButton.querySelector('span');
    if (label) label.textContent = deferredInstallPrompt ? 'Install App' : 'Install App';
    installButton.title = deferredInstallPrompt
      ? 'Install SkyDream'
      : 'Show installation options';
  }

  function showInstallHelp(reason = '') {
    closeInstallHelp();
    const panel = document.createElement('div');
    panel.id = 'pwaInstallHelp';
    panel.className = 'pwa-install-help';

    let body;
    if (isIOS()) {
      body = '<p>On iPhone or iPad, open SkyDream in <strong>Safari</strong>, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.</p>';
    } else if (isChromium()) {
      body = '<p>Chrome has not made the native install prompt available on this tab yet. Try the <strong>Install</strong> icon in the address bar, or open <strong>⋮ → Cast, save and share → Install SkyDream</strong>.</p><p>If SkyDream was already installed before, Chrome will not offer a second install prompt.</p>';
    } else {
      body = '<p>Your browser did not provide a native PWA install prompt. Use the browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong> if available.</p>';
    }

    panel.innerHTML = `
      <div class="pwa-install-help-card" role="dialog" aria-modal="true" aria-label="Install SkyDream">
        <button type="button" class="pwa-install-help-close" aria-label="Close">×</button>
        <h3>Install SkyDream</h3>
        ${body}
        ${reason ? `<p class="pwa-install-help-note">${reason}</p>` : ''}
      </div>
    `;

    panel.addEventListener('click', event => {
      if (event.target === panel || event.target.closest('.pwa-install-help-close')) closeInstallHelp();
    });
    document.body.appendChild(panel);
  }

  async function installApp() {
    if (isStandalone()) {
      hideInstallButton();
      return;
    }

    if (isIOS()) {
      showInstallHelp();
      return;
    }

    if (!deferredInstallPrompt) {
      showInstallHelp('The website is ready for installation, but the browser controls when the native install prompt becomes available.');
      return;
    }

    const promptEvent = deferredInstallPrompt;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      deferredInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') hideInstallButton();
      else updateInstallButton();
    } catch (error) {
      console.warn('SkyDream install prompt failed:', error);
      deferredInstallPrompt = null;
      updateInstallButton();
      showInstallHelp('The browser could not open the native installer. Try the browser install icon or menu.');
    }
  }

  function createInstallButton() {
    if (document.getElementById('pwaInstallButton')) return;
    installButton = document.createElement('button');
    installButton.id = 'pwaInstallButton';
    installButton.className = 'pwa-install-button';
    installButton.type = 'button';
    installButton.hidden = true;
    installButton.setAttribute('aria-label', 'Install SkyDream app');
    installButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/>
        <path d="M5 18v2h14v-2"/>
      </svg>
      <span>Install App</span>
    `;
    installButton.addEventListener('click', async () => {
      if (installButton.disabled) return;
      installButton.disabled = true;
      try { await installApp(); }
      finally { installButton.disabled = false; }
    });
    document.body.appendChild(installButton);
    updateInstallButton();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeInstallHelp();
    hideInstallButton();
  });

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallButton);

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      await registration.update().catch(() => {});
      await navigator.serviceWorker.ready;
    } catch (error) {
      console.warn('SkyDream service worker registration failed:', error);
      showInstallHelp('The browser could not register the offline app service. Refresh the page and try again.');
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    createInstallButton();
    await registerServiceWorker();
    updateInstallButton();
  });
})();
