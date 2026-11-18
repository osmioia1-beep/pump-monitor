const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

test('manifest icons have the declared PNG sizes and a standalone launch URL', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest')));
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    for (const icon of manifest.icons) {
        const png = fs.readFileSync(path.join(root, icon.src));
        assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
    }
});

function installPage({ standalone = false, ios = false } = {}) {
    const handlers = {};
    const elements = {
        installBtn: { addEventListener: (name, action) => { handlers[name] = action; } },
        installDialog: {
            open: false,
            showModal() { this.open = true; },
            close() { this.open = false; }
        },
        installInstructions: {}
    };
    let registration = null;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'install.js'), 'utf8'), {
        window: {
            matchMedia: () => ({ matches: standalone }),
            addEventListener: (name, action) => { handlers[name] = action; }
        },
        navigator: {
            userAgent: ios ? 'iPhone' : 'Chrome',
            serviceWorker: { register: async (...args) => { registration = args; } }
        },
        document: { getElementById: id => elements[id] }, console
    });
    return { handlers, elements, registration };
}

test('install uses the native browser prompt and hides after installation', async () => {
    const { handlers, elements, registration } = installPage();
    assert.equal(registration[0], '/sw.js');
    let prevented = false;
    let prompted = false;
    handlers.beforeinstallprompt({
        preventDefault() { prevented = true; },
        async prompt() { prompted = true; },
        userChoice: Promise.resolve({ outcome: 'accepted' })
    });
    await handlers.click();
    assert.equal(prevented, true);
    assert.equal(prompted, true);
    handlers.appinstalled();
    assert.equal(elements.installBtn.hidden, true);
    assert.equal(installPage({ standalone: true }).elements.installBtn.hidden, true);
});

test('iPhone installation instructions are available without a native prompt', async () => {
    const { handlers, elements } = installPage({ ios: true });
    await handlers.click();
    assert.equal(elements.installDialog.open, true);
    assert.match(elements.installInstructions.textContent, /Add to Home Screen/);
});

test('offline launches fall back to the connection page while data requests bypass caching', async () => {
    const handlers = {};
    const fallback = new Response('Connection needed');
    const context = {
        self: {
            location: { origin: 'https://pump.example' },
            addEventListener: (name, action) => { handlers[name] = action; }
        },
        caches: { match: async () => fallback },
        fetch: async () => { throw new Error('Offline'); },
        URL
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
    let result;
    handlers.fetch({
        request: { mode: 'navigate', method: 'GET', url: 'https://pump.example/' },
        respondWith: promise => { result = promise; }
    });
    assert.equal(await result, fallback);
    for (const url of ['https://db.example/rest/v1/pump_events', 'https://pump.example/dashboard.js']) {
        handlers.fetch({
            request: { mode: 'cors', method: 'GET', url },
            respondWith() { assert.fail('Live data or dashboard scripts must bypass the offline cache'); }
        });
    }
});
