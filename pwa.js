(() => {
  let deferredInstallPrompt = null;
  let installButton = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  function hideInstallButton() {
    if (installButton) installButton.hidden = true;
  }

  function showInstallButton() {
    if (installButton && !isStandalone()) installButton.hidden = false;
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
      .pwa-install-button[hidden]{display:none!important;}
      .pwa-install-button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
      @media(max-width:600px){
        .pwa-install-button{left:12px;bottom:12px;padding:10px 14px;font-size:.82rem;}
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
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') hideInstallButton();
        deferredInstallPrompt = null;
        return;
      }

      if (isIOS() && !isStandalone()) {
        window.alert('To install SkyDream on iPhone or iPad: tap the Share button in Safari, then choose “Add to Home Screen”.');
      }
    });

    document.body.appendChild(installButton);

    if (isIOS() && !isStandalone()) showInstallButton();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideInstallButton();
  });

  window.addEventListener('DOMContentLoaded', () => {
    createInstallButton();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .catch(error => console.warn('SkyDream service worker registration failed:', error));
    }
  });
})();