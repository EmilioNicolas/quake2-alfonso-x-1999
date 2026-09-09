const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers/browser.cjs');

const settle = () => new Promise(setImmediate);

function fakeClock() {
    let now = Date.parse('2026-09-09T20:00:00Z');
    let nextId = 0;
    const timers = new Map();
    class ClockDate extends Date { static now() { return now; } }
    return {
        globals: {
            Date: ClockDate,
            setTimeout(callback, delay) {
                const id = ++nextId;
                timers.set(id, { callback, at: now + delay });
                return id;
            },
            clearTimeout: id => timers.delete(id)
        },
        timers,
        async advance(ms) {
            const end = now + ms;
            for (;;) {
                const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                now = next[1].at;
                timers.delete(next[0]);
                next[1].callback();
                await settle();
            }
            now = end;
            await settle();
        }
    };
}

test('waiting for headers and first bytes stays visible without inventing a percentage', async () => {
    let headers;
    let firstRead;
    const browser = createBrowser({ globals: { fetch: () => new Promise(resolve => { headers = resolve; }) } });
    const download = browser.context.downloadOne('/pak1.pak', 0);
    const bar = browser.element('progressBar');
    assert.match(browser.element('statusText').textContent, /Conectando/);
    assert.equal(bar.style.display, 'block');
    assert.equal(bar.classList.contains('indeterminate'), true);
    assert.equal(bar.getAttribute('aria-valuenow'), null);
    let reads = 0;
    headers({ ok: true, body: { getReader: () => ({
        read: () => ++reads === 1 ? new Promise(resolve => { firstRead = resolve; }) : Promise.resolve({ done: true }),
        releaseLock() {}
    }) } });
    await settle();
    assert.match(browser.element('statusText').textContent, /Esperando datos/);
    assert.equal(bar.getAttribute('aria-valuenow'), null);
    firstRead({ done: false, value: new Uint8Array(1024) });
    await download;
    assert.match(browser.element('statusText').textContent, /Descargando: 1\.0 KB \/ ~188 MB/);
    assert.equal(bar.classList.contains('indeterminate'), false);
    assert.ok(Number.parseFloat(browser.element('progressFill').style.width) > 0);
    assert.equal(browser.timers.size, 0);
});

test('engine initialization has a separate indefinite stage after all five downloads', async () => {
    let requests = 0;
    const browser = createBrowser({ globals: { fetch: async () => {
        requests++;
        return new Response(new Uint8Array([1]));
    } } });
    await browser.context.startGame();
    assert.equal(requests, 5);
    assert.match(browser.element('statusText').textContent, /Descarga completa.*Iniciando motor/);
    assert.equal(browser.element('progressBar').getAttribute('aria-valuenow'), null);
    browser.context.Module.setStatus('Preparing...');
    assert.match(browser.element('statusText').textContent, /Descarga completa/);
    browser.context.Module.hideConsole();
    assert.equal(browser.element('landing').style.display, 'none');
    assert.equal(browser.timers.size, 0);
});

for (const [status, header, wait] of [
    [429, '8', 8000],
    [503, 'Wed, 09 Sep 2026 20:00:10 GMT', 10000],
    [429, '120', 120000],
    [429, '0', 2000],
    [429, 'Wed, 09 Sep 2026 19:59:00 GMT', 2000],
    [429, null, 2000],
    [503, 'invalid', 2000],
    [429, '1.5', 2000],
    [429, '-3', 2000]
]) {
    test(`HTTP ${status} with Retry-After ${header} waits ${wait} ms without early retry`, async () => {
        const clock = fakeClock();
        let requests = 0;
        const browser = createBrowser({ globals: { ...clock.globals, fetch: async () => {
            if (++requests === 1) return new Response('', { status, headers: header === null ? {} : { 'Retry-After': header } });
            return new Response(new Uint8Array([7, 8]));
        } } });
        const download = browser.context.downloadOne('/pak1.pak', 1);
        await settle();
        assert.match(browser.element('statusText').textContent, new RegExp(`Reintentando en ${wait / 1000} s`));
        await clock.advance(wait - 1);
        assert.equal(requests, 1);
        assert.equal(browser.context._downloaded, 0);
        await clock.advance(1);
        assert.deepEqual([...await download], [7, 8]);
        assert.equal(requests, 2);
        assert.equal(clock.timers.size, 0);
    });
}

test('a cooldown over two minutes stops automatic retries and gates the manual retry', async () => {
    const clock = fakeClock();
    let requests = 0;
    const browser = createBrowser({ globals: { ...clock.globals, fetch: async () => {
        if (++requests === 1) return new Response('', { status: 429, headers: { 'Retry-After': '300' } });
        return new Response(new Uint8Array([1]));
    } } });
    await browser.context.startGame();
    assert.equal(browser.context.gameState, 'failed');
    assert.equal(requests, 1);
    assert.equal(clock.timers.size, 0, 'Long cooldowns must not leave an automatic retry pending');
    assert.match(browser.element('statusText').textContent, /servidor ocupado.*300 s/);
    await clock.advance(299999);
    await browser.context.startGame();
    assert.equal(requests, 1, 'REINTENTAR must not bypass the observed cooldown');
    assert.match(browser.element('statusText').textContent, /Espera 1 s/);
    await clock.advance(1);
    await browser.context.startGame();
    assert.equal(requests, 6);
    assert.equal(browser.context.gameState, 'starting');
    browser.context.Module.hideConsole();
    assert.equal(clock.timers.size, 0);
});

test('rate limiting still stops after the existing two retries and honors the last cooldown', async () => {
    const clock = fakeClock();
    let requests = 0;
    const browser = createBrowser({ globals: { ...clock.globals, fetch: async () => {
        requests++;
        return new Response('', { status: 429, headers: { 'Retry-After': '5' } });
    } } });
    const start = browser.context.startGame();
    await settle();
    await clock.advance(10000);
    await start;
    assert.equal(requests, 3);
    assert.equal(browser.context.gameState, 'failed');
    assert.equal(clock.timers.size, 0);
    await browser.context.startGame();
    assert.equal(requests, 3);
    assert.match(browser.element('statusText').textContent, /Espera 5 s/);
});
