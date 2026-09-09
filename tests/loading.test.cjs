const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

const settle = () => new Promise(setImmediate);
function response(bytes = [1]) {
    return new Response(new Uint8Array(bytes));
}
function loadingBrowser(globals = {}) {
    const browser = createBrowser({ globals: { fetch: async () => response(), ...globals } });
    browser.element('landing').style.display = 'flex';
    browser.element('gameView').style.display = 'none';
    browser.element('touchControls').style.display = 'none';
    return browser;
}
function runDelay(browser, delay) {
    const timer = [...browser.timers].find(([, value]) => value.delay === delay);
    assert.ok(timer, `Expected a ${delay} ms timer`);
    browser.runTimer(timer[0]);
}
function assertFailed(browser, pattern, reload = true) {
    assert.equal(browser.context.gameState, 'failed');
    assert.equal(browser.element('landing').style.display, 'flex');
    assert.equal(browser.element('gameView').style.display, 'none');
    assert.equal(browser.element('playBtn').disabled, false);
    assert.equal(browser.element('playBtn').textContent, reload ? 'RECARGAR' : 'REINTENTAR');
    assert.match(browser.element('statusText').textContent, pattern);
}

test('starting immediately shows connection status and ignores duplicate starts', async () => {
    let finishFetch;
    let requests = 0;
    const browser = loadingBrowser({ fetch: () => {
        requests++;
        return new Promise(resolve => { finishFetch = resolve; });
    } });
    const first = browser.context.startGame();
    assert.equal(browser.element('statusText').textContent, 'Conectando... · Archivo 1/5');
    assert.equal(browser.element('progressBar').style.display, 'block');
    assert.equal(browser.element('progressBar').getAttribute('aria-valuenow'), null);
    assert.equal(browser.element('playBtn').disabled, true);
    await browser.context.startGame();
    assert.equal(requests, 1);
    finishFetch(new Response('', { status: 404 }));
    await first;
    assertFailed(browser, /pak0_chunk_aa: HTTP 404/, false);
});

test('downloaded chunks are assembled and loading remains visible until the game opens', async () => {
    let requests = 0;
    const writes = [];
    const browser = loadingBrowser({
        fetch: async () => response([++requests]),
        FS: {
            open: name => name,
            write: (name, bytes, offset, length) => { writes.push([name, [...bytes]]); return length; },
            close() {}
        }
    });
    await browser.context.startGame();
    assert.equal(requests, 5);
    assert.equal(browser.context.gameState, 'starting');
    assert.equal(browser.element('landing').style.display, 'flex');
    assert.equal(browser.document.body.children.length, 1);
    browser.context.Module.onRuntimeInitialized();
    assert.deepEqual(writes, [
        ['/baseq2/pak0.pak', [1, 2, 3, 4]],
        ['/baseq2/pak1.pak', [5]]
    ]);
    assert.equal(browser.context._pakFiles, undefined);
    assert.equal(browser.element('landing').style.display, 'flex');
    browser.context.Module.hideConsole();
    assert.equal(browser.context.gameState, 'running');
    assert.equal(browser.element('landing').style.display, 'none');
    assert.equal(browser.element('gameView').style.display, 'block');
    assert.equal(browser.document.activeElement, browser.element('canvas'));
    assert.equal(browser.timers.size, 0);
});

test('permanent HTTP errors fail without retries and allow a fresh download attempt', async () => {
    let requests = 0;
    const browser = loadingBrowser({ fetch: async () => {
        requests++;
        return new Response('', { status: 403 });
    } });
    await browser.context.startGame();
    assertFailed(browser, /HTTP 403/, false);
    assert.equal(requests, 1);
    assert.equal(browser.timers.size, 0);
    browser.context.fetch = async () => response();
    await browser.context.startGame();
    assert.equal(browser.context.gameState, 'starting');
    assert.equal(browser.document.body.children.length, 1);
});

test('a failed partial stream rolls back byte progress before retrying', async () => {
    let requests = 0;
    let reads = 0;
    const browser = loadingBrowser({ fetch: async () => {
        if (++requests > 1) return response([7, 8]);
        return { ok: true, body: { getReader: () => ({ read: async () => {
            if (++reads === 1) return { done: false, value: new Uint8Array([1, 2, 3]) };
            throw new Error('Connection interrupted');
        } }) } };
    } });
    browser.context._downloaded = 10;
    const download = browser.context.downloadOne('/pak1.pak', 1);
    await settle();
    assert.equal(browser.context._downloaded, 10);
    runDelay(browser, 2000);
    assert.deepEqual([...await download], [7, 8]);
    assert.equal(browser.context._downloaded, 12);
    assert.equal(requests, 2);
    assert.equal(browser.timers.size, 0);
});

test('a stalled fetch is aborted with a useful filename and timeout message', async () => {
    const browser = loadingBrowser({ fetch: (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    }) });
    const download = browser.context.downloadOne('/pak1.pak', 0);
    const rejected = assert.rejects(download, /pak1.pak: Tiempo de espera agotado/);
    runDelay(browser, 30000);
    await rejected;
    assert.equal(browser.context._downloaded, 0);
    assert.equal(browser.timers.size, 0);
});

test('empty downloads are rejected before initializing the engine', async () => {
    const browser = loadingBrowser({ fetch: async () => response([]) });
    await assert.rejects(browser.context.downloadOne('/empty.pak', 0), /empty.pak: Archivo vacio/);
    assert.equal(browser.document.body.children.length, 0);
});

test('a stream that stalls after receiving bytes is aborted and rolls back progress', async () => {
    const browser = loadingBrowser({ fetch: async (url, { signal }) => {
        let reads = 0;
        return { ok: true, body: { getReader: () => ({ read: () => {
            if (++reads === 1) return Promise.resolve({ done: false, value: new Uint8Array([1, 2]) });
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
            });
        } }) } };
    } });
    const download = browser.context.downloadOne('/pak1.pak', 0);
    const rejected = assert.rejects(download, /Tiempo de espera agotado/);
    await settle();
    assert.equal(browser.context._downloaded, 2);
    assert.equal(browser.timers.size, 1);
    runDelay(browser, 30000);
    await rejected;
    assert.equal(browser.context._downloaded, 0);
});

test('mobile fullscreen is requested during the play gesture before downloading', async () => {
    const calls = [];
    const browser = createBrowser({ mobile: true, globals: { fetch: async () => {
        calls.push('fetch');
        return response();
    } } });
    browser.document.documentElement.requestFullscreen = () => {
        calls.push('fullscreen');
        return Promise.resolve();
    };
    // Fullscreen may exist without the orientation-lock API.
    browser.context.screen.orientation = undefined;
    await browser.context.startGame();
    assert.deepEqual(calls.slice(0, 2), ['fullscreen', 'fetch']);
    assert.equal(browser.element('touchControls').style.display, undefined);
    browser.context.Module.hideConsole();
    assert.equal(browser.element('touchControls').style.display, 'block');
});

test('script load failure offers reload without injecting a second runtime', async () => {
    let reloads = 0;
    const browser = loadingBrowser({ location: { reload: () => reloads++ } });
    await browser.context.startGame();
    browser.document.body.children[0].dispatchEvent(new BrowserEvent('error'));
    assertFailed(browser, /index\.js/);
    assert.equal(browser.context._pakFiles, undefined);
    browser.context.Module.hideConsole();
    assert.equal(browser.element('landing').style.display, 'flex');
    await browser.context.startGame();
    assert.equal(reloads, 1);
    assert.equal(browser.document.body.children.length, 1);
});

for (const failure of ['abort', 'rejection', 'exception', 'timeout', 'early exit']) {
    test(`asynchronous startup ${failure} returns to a visible error`, async () => {
        const browser = loadingBrowser();
        await browser.context.startGame();
        if (failure === 'abort') browser.context.Module.onAbort('Wasm failed');
        if (failure === 'rejection') browser.window.dispatchEvent(new BrowserEvent('unhandledrejection', { reason: new Error('index.data failed') }));
        if (failure === 'exception') browser.window.dispatchEvent(new BrowserEvent('error', { error: new Error('Renderer failed') }));
        if (failure === 'timeout') runDelay(browser, 120000);
        if (failure === 'early exit') browser.context.Module.print('----------- shutting down ----------');
        assertFailed(browser, /Error:/);
        assert.equal(browser.context.Module.noInitialRun, true);
        assert.equal(browser.timers.size, 0);
    });
}

for (const shortWrite of [false, true]) {
    test(`archive ${shortWrite ? 'short write' : 'write exception'} stops startup and closes the file`, async () => {
        let closed = 0;
        const browser = loadingBrowser({ FS: {
            open: () => 42,
            write: () => { if (shortWrite) return 0; throw new Error('Out of memory'); },
            close: () => closed++
        } });
        await browser.context.startGame();
        assert.throws(() => browser.context.Module.onRuntimeInitialized());
        assertFailed(browser, /No se pudo cargar \/baseq2\/pak0.pak/);
        assert.equal(closed, 1);
        assert.equal(browser.context._pakFiles, undefined);
    });
}

test('WebGL loss restores the error screen and releases desktop pointer lock', async () => {
    const browser = loadingBrowser();
    await browser.context.startGame();
    browser.context.Module.hideConsole();
    browser.document.pointerLockElement = browser.element('canvas');
    let released = 0;
    let paused = 0;
    browser.context.Module.pauseMainLoop = () => paused++;
    browser.document.exitPointerLock = () => { released++; browser.document.pointerLockElement = null; };
    const event = new BrowserEvent('webglcontextlost');
    browser.element('canvas').dispatchEvent(event);
    assertFailed(browser, /WebGL/);
    assert.equal(event.defaultPrevented, true);
    assert.equal(released, 1);
    assert.equal(paused, 1);
});

test('normal exit clears overlays and prevents a delayed victory overlay', async () => {
    const browser = loadingBrowser();
    await browser.context.startGame();
    browser.context.Module.hideConsole();
    browser.context.Module.print('Map: final');
    browser.context.Module.onExit(0);
    browser.runTimers();
    assert.equal(browser.context.gameState, 'ended');
    assert.equal(browser.element('endScreen').style.display, 'flex');
    assert.equal(browser.element('victoryOverlay').style.display, 'none');
    assert.equal(browser.element('touchControls').style.display, 'none');
});
