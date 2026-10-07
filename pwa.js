(() => {
  let deferredInstallPrompt = null;
  let installButton = null;
  let promptReadyResolver = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  function hideInstallButton() {
    if (installButton) installButton.hidden = true;
  }

  function updateInstallButton() {
    if (!installButton) return;
    installButton.hidden = isStandalone();
    installButton.dataset.ready = deferredInstallPrompt ? 'true' : 'false';
    installButton.title = deferredInstallPrompt
      ? 'Install SkyDream'
      : 'Install SkyDream or show installation steps';
  }

  function closeInstallHelp() {
    document.getElementById('pwaInstallHelp')?.remove();
  }

  function showInstallHelp() {
    closeInstallHelp();
    const panel = document.createElement('div');
    panel.id = 'pwaInstallHelp';
    panel.className = 'pwa-install-help';

    const body = isIOS()
      ? '<p>On iPhone/iPad, open this site in <strong>Safari</strong>, tap the <strong>Share</strong> button, then choose <strong>Add to Home Screen</strong>.</p>'
      : '<p>Chrome has not offered the native install window yet. Use the browser menu <strong>⋮ → Install SkyDream</strong> or the install icon in the address bar. If you dismissed the install prompt earlier, Chrome may temporarily hide it.</p>';

    panel.innerHTML = `
      <div class="pwa-install-help-card" role="dialog" aria-modal="true" aria-label="Install SkyDream">
        <button type="button" class="pwa-install-help-close" aria-label="Close">×</button>
        <h3>Install SkyDream</h3>
        ${body}
        <p class="pwa-install-help-note">The blue Install App button will use the browser's native installer automatically whenever Chrome makes it available.</p>
      </div>
    `;

    panel.addEventListener('click', event => {
      if (event.target === panel || event.target.closest('.pwa-install-help-close')) closeInstallHelp();
    });
    document.body.appendChild(panel);
  }

  function waitForNativePrompt(timeoutMs = 2200) {
    if (deferredInstallPrompt) return Promise.resolve(deferredInstallPrompt);
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        if (promptReadyResolver === finish) promptReadyResolver = null;
        resolve(value);
      };
      promptReadyResolver = finish;
      window.setTimeout(() => finish(null), timeoutMs);
    });
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

    if (!deferredInstallPrompt && 'serviceWorker' in navigator) {
      try { await navigator.serviceWorker.ready; } catch (_) {}
    }

    const promptEvent = deferredInstallPrompt || await waitForNativePrompt();
    if (!promptEvent) {
      showInstallHelp();
      updateInstallButton();
      return;
    }

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      deferredInstallPrompt = null;
      if (choice && choice.outcome === 'accepted') hideInstallButton();
      else updateInstallButton();
    } catch (err) {
      console.warn('SkyDream install prompt failed:', err);
      deferredInstallPrompt = null;
      showInstallHelp();
      updateInstallButton();
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
      const label = installButton.querySelector('span');
      const old = label ? label.textContent : '';
      if (label) label.textContent = deferredInstallPrompt ? 'Opening…' : 'Checking…';
      try { await installApp(); }
      finally {
        installButton.disabled = false;
        if (label) label.textContent = old || 'Install App';
      }
    });

    document.body.appendChild(installButton);
    updateInstallButton();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (promptReadyResolver) {
      const resolve = promptReadyResolver;
      promptReadyResolver = null;
      resolve(event);
    }
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
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    } catch (error) {
      console.warn('SkyDream service worker registration failed:', error);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    createInstallButton();
    registerServiceWorker();
  });
})();
