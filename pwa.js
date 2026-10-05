(() => {
  let deferredInstallPrompt = null;
  let installButton = null;
  let promptReadyResolver = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  function applyResponsiveLayoutPolish() {
    if (document.getElementById('skydreamResponsivePolish')) return;
    const style = document.createElement('style');
    style.id = 'skydreamResponsivePolish';
    style.textContent = `
      .site-header .container.nav{
        width:calc(100% - 48px) !important;
        max-width:none !important;
      }
      .site-header .brand{
        flex:0 0 360px !important;
        max-width:360px !important;
      }
      .site-header .brand span{
        overflow-wrap:normal !important;
        word-break:normal !important;
      }
      .site-header .nav-links{
        display:flex;
        flex:1 1 auto;
        justify-content:flex-end;
        align-items:center;
        gap:6px;
        min-width:0;
      }
      .site-header .nav-links a{
        flex:0 0 auto !important;
        min-width:max-content !important;
        white-space:nowrap !important;
        overflow-wrap:normal !important;
        word-break:keep-all !important;
        padding:10px 10px;
        font-size:.95rem;
        line-height:1.2;
      }
      .site-header .nav-links a.btn{padding:11px 18px;}

      @media(max-width:1450px){
        .site-header .container.nav{
          width:min(1180px,calc(100% - 32px)) !important;
          max-width:1180px !important;
        }
        .site-header .nav-toggle{display:block !important;}
        .site-header .brand{
          flex:1 1 auto !important;
          max-width:none !important;
        }
        .site-header .nav-links{
          display:none !important;
          position:absolute;
          left:0;
          right:0;
          top:70px;
          z-index:70;
          flex-direction:column;
          align-items:stretch;
          justify-content:flex-start;
          gap:4px;
          background:#fff;
          border:1px solid var(--line);
          border-radius:14px;
          padding:10px;
          box-shadow:var(--shadow);
          max-height:calc(100dvh - 88px);
          overflow-y:auto;
          -webkit-overflow-scrolling:touch;
        }
        .site-header .nav-links.open{display:flex !important;}
        .site-header .nav-links a{
          width:100%;
          min-width:0 !important;
          white-space:normal !important;
          padding:11px 12px;
          font-size:1rem;
        }
        .site-header .nav-links a.btn{padding:11px 14px;}
      }

      @media(max-width:620px){
        .site-header .container.nav{width:calc(100% - 24px) !important;}
      }
    `;
    document.head.appendChild(style);
  }

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

    const style = document.createElement('style');
    style.textContent = `
      .pwa-install-button{
        position:fixed;left:18px;bottom:18px;z-index:190;
        display:inline-flex;align-items:center;gap:8px;
        border:0;border-radius:999px;padding:11px 16px;
        background:#1F3A93;color:#fff;font:600 .88rem 'IBM Plex Sans',sans-serif;
        box-shadow:0 10px 28px rgba(31,58,147,.24);cursor:pointer;
      }
      .pwa-install-button:hover{background:#152A6E;}
      .pwa-install-button:disabled{opacity:.65;cursor:wait;}
      .pwa-install-button[hidden]{display:none!important;}
      .pwa-install-button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
      .pwa-install-help{position:fixed;inset:0;z-index:300;background:rgba(8,20,48,.52);display:grid;place-items:center;padding:20px;}
      .pwa-install-help-card{position:relative;width:min(520px,100%);background:#fff;color:#17233c;border-radius:18px;padding:24px;box-shadow:0 22px 60px rgba(0,0,0,.24);}
      .pwa-install-help-card h3{margin:0 36px 10px 0;color:#1F3A93;font-size:1.35rem;}
      .pwa-install-help-card p{margin:10px 0;line-height:1.6;}
      .pwa-install-help-note{font-size:.9rem;color:#5b6780;}
      .pwa-install-help-close{position:absolute;right:12px;top:10px;border:0;background:transparent;font-size:1.8rem;line-height:1;cursor:pointer;color:#44506a;}
      @media(max-width:600px){
        .pwa-install-button{left:12px;bottom:12px;padding:10px 14px;font-size:.82rem;}
        .pwa-install-help-card{padding:20px;}
      }
      @media(display-mode:standalone){.pwa-install-button{display:none!important;}}
    `;
    document.head.appendChild(style);

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

  applyResponsiveLayoutPolish();

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
