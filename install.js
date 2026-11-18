'use strict';
(() => {
    const button = document.getElementById('installBtn');
    const dialog = document.getElementById('installDialog');
    const instructions = document.getElementById('installInstructions');
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let installPrompt = null;
    button.hidden = standalone();

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPrompt = event;
        button.hidden = standalone();
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        button.hidden = true;
        if (dialog.open) dialog.close();
    });
    button.addEventListener('click', async () => {
        if (installPrompt) {
            const prompt = installPrompt;
            installPrompt = null;
            try {
                await prompt.prompt();
                await prompt.userChoice;
                return;
            } catch {
                // Browser-menu instructions also work when the native prompt is unavailable.
            }
        }
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        instructions.textContent = ios
            ? 'In Safari, open the Share menu and choose Add to Home Screen. Turn on Open as Web App if shown, then tap Add.'
            : 'Open your browser menu and choose Install Pump Monitor, Install app, or Add to Home screen. If installation is unavailable, open this page in Chrome, Edge, or Safari.';
        dialog.showModal();
    });
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
            console.warn('Pump Monitor offline launch support could not be registered.');
        });
    }
})();
