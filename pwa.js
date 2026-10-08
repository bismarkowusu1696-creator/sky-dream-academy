(() => {
  let deferredInstallPrompt = null;
  let installButton = null;
  let serviceWorkerError = '';

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isChromium = () => /Chrome|Chromium|Edg\//i.test(window.navigator.userAgent);
  const isAndroid = () => /Android/i.test(window.navigator.userAgent);
  const isSamsung = () => /SamsungBrowser/i.test(window.navigator.userAgent);
  const isFirefox = () => /Firefox|FxiOS/i.test(window.navigator.userAgent);
  const isSafari = () => /Safari/i.test(window.navigator.userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|FxiOS|OPR|SamsungBrowser/i.test(window.navigator.userAgent);

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
    const available = Boolean(deferredInstallPrompt);
    const label = installButton.querySelector('span');
    if (label) label.textContent = available ? 'Install SkyDream' : 'How to Install';
    installButton.setAttribute('aria-label', available ? 'Install SkyDream app' : 'How to install SkyDream app');
    installButton.title = available ? 'Install SkyDream' : 'How to install SkyDream on this device';
  }

  function showInstallHelp(reason = '') {
    closeInstallHelp();
    const panel = document.createElement('div');
    panel.id = 'pwaInstallHelp';
    panel.className = 'pwa-install-help';
    const body = document.createElement('div');

    if (isIOS()) {
      body.innerHTML = isSafari()
        ? '<p>On iPhone or iPad, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</p>'
        : '<p>On iPhone or iPad, open <strong>skydream.academy</strong> in <strong>Safari</strong>, tap <strong>Share → Add to Home Screen → Add</strong>.</p>';
    } else if (isAndroid() && isSamsung()) {
      body.innerHTML = '<p>In Samsung Internet, open the browser menu and choose <strong>Add page to → Home screen</strong> or <strong>Install app</strong> when available.</p>';
    } else if (isAndroid() && isChromium()) {
      body.innerHTML = '<p>In Chrome on Android, open <strong>⋮ → Add to Home screen → Install</strong> (or <strong>Create shortcut</strong>, if installation is not offered).</p>';
    } else if (isAndroid() && isFirefox()) {
      body.innerHTML = '<p>In Firefox on Android, open the browser menu and choose <strong>Install</strong> or <strong>Add to Home screen</strong>, when available.</p>';
    } else if (isChromium()) {
      body.innerHTML = '<p>In Chrome or Edge on your computer, look for the <strong>Install</strong> icon at the right of the address bar. You can also open the browser <strong>⋮ menu</strong> and look for <strong>Install SkyDream</strong> or <strong>Install this site as an app</strong>.</p>';
    } else if (isSafari()) {
      body.innerHTML = '<p>In Safari on a Mac, use <strong>File → Add to Dock</strong> (supported macOS versions), or use your browser\'s available website shortcut option.</p>';
    } else {
      body.innerHTML = '<p>Open your browser menu and look for <strong>Install app</strong> or <strong>Add to Home Screen</strong>. Not all browsers support website app installation.</p>';
    }

    const dialog = document.createElement('div');
    dialog.className = 'pwa-install-help-card';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pwaInstallHelpTitle');
    dialog.innerHTML = '<button type="button" class="pwa-install-help-close" aria-label="Close installation help">×</button>' +
      '<h3 id="pwaInstallHelpTitle">Install SkyDream</h3>';
    dialog.appendChild(body);
    const tip = document.createElement('p');
    tip.className = 'pwa-install-help-note';
    tip.textContent = reason || 'The browser controls when a native install prompt appears. If no install option is shown, check that the website is not already installed, avoid private browsing, or try Chrome/Edge.';
    dialog.appendChild(tip);
    panel.appendChild(dialog);

    panel.addEventListener('click', event => {
      if (event.target === panel || event.target.closest('.pwa-install-help-close')) {
        closeInstallHelp();
        installButton?.focus();
      }
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeInstallHelp();
        installButton?.focus();
      }
    });
    document.body.appendChild(panel);
    dialog.querySelector('.pwa-install-help-close')?.focus();
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
      showInstallHelp(serviceWorkerError ||
        'The browser has not offered a native installation prompt for this tab. Follow the steps above to install it manually.');
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
    if (!('serviceWorker' in navigator)) {
      serviceWorkerError = 'This browser does not support the offline app service. Try opening SkyDream in Chrome, Edge, Safari or Samsung Internet.';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('SkyDream service worker registration failed:', error);
      serviceWorkerError = 'The offline app service could not start. Try reloading SkyDream, or open the site in a normal (non-private) browser window.';
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    createInstallButton();
    await registerServiceWorker();
    updateInstallButton();
  });
})();
