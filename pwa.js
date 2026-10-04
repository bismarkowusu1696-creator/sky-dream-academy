(() => {
  let deferredInstallPrompt = null;
  let installButton = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isMobile = () => /android|iphone|ipad|ipod/i.test(window.navigator.userAgent);

  function applyResponsiveLayoutPolish() {
    if (document.getElementById('skydreamResponsivePolish')) return;
    const style = document.createElement('style');
    style.id = 'skydreamResponsivePolish';
    style.textContent = `
      /* Keep the desktop navigation clean and prevent words breaking letter-by-letter. */
      .site-header .container.nav{
        width:min(1480px,calc(100% - 40px));
      }
      .site-header .brand{
        flex:0 1 360px;
      }
      .site-header .brand span{
        overflow-wrap:normal;
        word-break:normal;
      }
      .site-header .nav-links{
        flex:1 1 auto;
        justify-content:flex-end;
        gap:4px;
        min-width:0;
      }
      .site-header .nav-links a{
        white-space:nowrap;
        overflow-wrap:normal;
        word-break:normal;
        padding:10px 9px;
        font-size:.96rem;
      }
      .site-header .nav-links a.btn{
        padding:10px 16px;
      }

      /* Switch to the hamburger before the links become cramped on laptops/tablets. */
      @media(max-width:1180px){
        .site-header .nav-toggle{display:block;}
        .site-header .nav-links{
          display:none;
          position:absolute;
          left:0;
          right:0;
          top:70px;
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
        .site-header .nav-links.open{display:flex;}
        .site-header .nav-links a{
          width:100%;
          white-space:normal;
          padding:11px 12px;
          font-size:1rem;
        }
        .site-header .nav-links a.btn{padding:11px 14px;}
        .site-header .brand{flex:1 1 auto;}
      }

      @media(max-width:620px){
        .site-header .container.nav{width:calc(100% - 24px);}
      }
    `;
    document.head.appendChild(style);
  }

  function hideInstallButton() {
    if (installButton) installButton.hidden = true;
  }

  function showInstallButton() {
    if (installButton && !isStandalone()) installButton.hidden = false;
  }

  function fallbackInstallHelp() {
    if (isIOS()) {
      window.alert('To install SkyDream on iPhone or iPad: open this website in Safari, tap the Share button, then choose “Add to Home Screen”.');
      return;
    }

    if (isMobile()) {
      window.alert('If the install window does not open yet, stay on the site briefly, then tap the browser menu (⋮) and choose “Install app” or “Add to Home screen”.');
      return;
    }

    window.alert('If the install window does not open yet, use your browser menu and choose “Install SkyDream” or “Install app”. Chrome may also show an install icon at the right side of the address bar.');
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

      fallbackInstallHelp();
    });

    document.body.appendChild(installButton);

    // Keep an install entry visible in normal browser mode. When Chromium has
    // finished its installability checks, the same button opens the native
    // install prompt. Before that, it gives clear manual-install instructions.
    if (!isStandalone()) showInstallButton();
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

  applyResponsiveLayoutPolish();

  window.addEventListener('DOMContentLoaded', () => {
    createInstallButton();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' })
        .catch(error => console.warn('SkyDream service worker registration failed:', error));
    }
  });
})();
