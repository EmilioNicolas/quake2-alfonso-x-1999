const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers/browser.cjs');

for (const [name, navigator, width, coarse, mobile] of [
    ['landscape iPhone', { userAgent: 'iPhone' }, 932, false, true],
    ['iPad desktop user agent', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }, 1366, false, true],
    ['large coarse pointer device', { userAgent: 'Desktop' }, 1280, true, true],
    ['desktop with a secondary touchscreen', { userAgent: 'Desktop', platform: 'Win32', maxTouchPoints: 10 }, 1440, false, false],
    ['small desktop window', { userAgent: 'Desktop' }, 600, false, false]
]) {
    test(`${name} selects the appropriate controls and rendering defaults`, () => {
        const browser = createBrowser({ globals: { navigator, innerWidth: width, matchMedia: () => ({ matches: coarse }) } });
        assert.equal(browser.context.isMobile, mobile);
        assert.equal(browser.document.documentElement.classList.contains('touch-device'), mobile);
        browser.context.initEngine();
        browser.context.Module.hideConsole();
        assert.equal(browser.element('touchControls').style.display === 'block', mobile);
        assert.equal(browser.element('canvas').style.width, '100%');
        assert.equal(browser.element('canvas').style.height, '100%');
        const canvas = browser.element('canvas');
        canvas.width = 932;
        canvas.height = 430;
        canvas.style.width = '932px';
        canvas.style.height = '430px';
        browser.context.Module.winResized();
        assert.equal(canvas.style.width, '100%', 'Runtime resizes must preserve the CSS fit inside safe areas');
        assert.equal(canvas.style.height, '100%');
        assert.equal(canvas.width, 932, 'The runtime retains ownership of the drawing buffer');
        assert.equal(canvas.height, 430);
        const args = browser.context.Module.arguments;
        const setting = name => args[args.indexOf(name) + 1];
        assert.equal(setting('gl_msaa_samples'), mobile ? '0' : '16');
        assert.equal(setting('gl_anisotropic'), mobile ? '4' : '16');
        assert.equal(setting('gl_texturemode'), 'GL_LINEAR_MIPMAP_LINEAR');
        assert.equal(setting('gl_shadows'), '1');
        assert.equal(setting('gl_modulate'), '2');
    });
}

for (const failure of ['unsupported', 'fullscreen rejection', 'orientation rejection']) {
    test(`${failure} still permits mobile startup in the current orientation`, async () => {
        const browser = createBrowser({ mobile: true, globals: { fetch: async () => new Response(new Uint8Array([1])) } });
        if (failure !== 'unsupported') {
            browser.document.documentElement.requestFullscreen = () => failure === 'fullscreen rejection'
                ? Promise.reject(new Error('Denied')) : Promise.resolve();
            browser.context.screen.orientation.lock = () => Promise.reject(new Error('Unsupported orientation'));
        }
        await browser.context.startGame();
        browser.context.Module.hideConsole();
        assert.equal(browser.context.gameState, 'running');
        assert.equal(browser.element('touchControls').style.display, 'block');
        assert.equal(browser.element('canvas').style.height, '100%');
        await new Promise(setImmediate);
    });
}
