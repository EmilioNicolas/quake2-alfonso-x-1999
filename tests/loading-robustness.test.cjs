const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser } = require('./helpers/browser.cjs');

const settle = () => new Promise(setImmediate);
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function observe(promise) {
    const result = { state: 'pending' };
    promise.then(value => Object.assign(result, { state: 'fulfilled', value }),
        error => Object.assign(result, { state: 'rejected', error }));
    return result;
}
function fireDelay(browser, delay) {
    const timer = [...browser.timers].find(([, value]) => value.delay === delay);
    assert.ok(timer, `Expected a ${delay} ms timer`);
    browser.runTimer(timer[0]);
}
function assertTimedOut(result, filename = 'pak1.pak') {
    assert.equal(result.state, 'rejected', 'Timeout must settle the download even if the transport ignores abort');
    assert.match(result.error.message, new RegExp(`${filename.replace('.', '\\.')}.*Tiempo de espera agotado`));
}
function streamingResponse(reader) {
    return { ok: true, body: { getReader: () => reader } };
}
function virtualClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        globals: {
            setTimeout(callback, delay) {
                const id = nextId++;
                timers.set(id, { callback, at: now + delay });
                return id;
            },
            clearTimeout(id) { timers.delete(id); }
        },
        timers,
        async advance(milliseconds) {
            const end = now + milliseconds;
            for (;;) {
                const next = [...timers].filter(([, timer]) => timer.at <= end)
                    .sort((a, b) => a[1].at - b[1].at)[0];
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

test('a fetch that ignores AbortSignal still rejects at the connection deadline', async () => {
    const request = deferred();
    let signal;
    const browser = createBrowser({ globals: { fetch: (url, options) => {
        signal = options.signal;
        return request.promise;
    } } });
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    fireDelay(browser, 30000);
    await settle();
    assert.equal(signal.aborted, true);
    assertTimedOut(result);
    assert.equal(browser.context._downloaded, 0);
    assert.equal(browser.timers.size, 0);
});

test('a stuck read rejects and rolls back bytes even if reader cancellation also hangs', async () => {
    let reads = 0;
    let cancellations = 0;
    const reader = {
        read: () => ++reads === 1
            ? Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) })
            : new Promise(() => {}),
        cancel: () => { cancellations++; return new Promise(() => {}); },
        releaseLock() {}
    };
    const browser = createBrowser({ globals: { fetch: async () => streamingResponse(reader) } });
    browser.context._downloaded = 10;
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    await settle();
    assert.equal(browser.context._downloaded, 13);
    fireDelay(browser, 30000);
    await settle();
    assertTimedOut(result);
    assert.equal(browser.context._downloaded, 10);
    assert.equal(cancellations, 1);
    assert.equal(browser.timers.size, 0);
});

test('failed cleanup and a late read rejection cannot replace a timeout or leak a rejection', async () => {
    const read = deferred();
    let cancellations = 0;
    let releases = 0;
    const browser = createBrowser({ globals: { fetch: async () => streamingResponse({
        read: () => read.promise,
        cancel() {
            cancellations++;
            return Promise.reject(new Error('Cancellation failed'));
        },
        releaseLock() { releases++; throw new Error('Read still pending'); }
    }) } });
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    await settle();
    fireDelay(browser, 30000);
    await settle();
    assertTimedOut(result);
    assert.equal(cancellations, 1);
    assert.equal(releases, 1);
    read.reject(new Error('Late transport failure'));
    await settle();
    assertTimedOut(result);
    assert.equal(browser.timers.size, 0);
});

test('successful streaming releases its reader lock without cancelling the body', async () => {
    let reads = 0;
    let releases = 0;
    let cancellations = 0;
    const browser = createBrowser({ globals: { fetch: async () => streamingResponse({
        read: async () => ++reads === 1
            ? { done: false, value: new Uint8Array([1, 2]) } : { done: true },
        cancel() { cancellations++; },
        releaseLock() { releases++; }
    }) } });
    assert.deepEqual([...await browser.context.downloadOne('/pak1.pak', 0)], [1, 2]);
    assert.equal(releases, 1);
    assert.equal(cancellations, 0);
    assert.equal(browser.timers.size, 0);
});

test('the connection deadline remains effective without AbortController support', async () => {
    const browser = createBrowser({ globals: {
        AbortController: undefined,
        fetch: () => new Promise(() => {})
    } });
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    fireDelay(browser, 30000);
    await settle();
    assertTimedOut(result);
    assert.equal(browser.context._downloaded, 0);
    assert.equal(browser.timers.size, 0);
});

test('a late read from a timed out attempt cannot alter a completed retry', async () => {
    const lateRead = deferred();
    let requests = 0;
    let reads = 0;
    const reader = {
        read() {
            if (++reads === 1) return Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) });
            if (reads === 2) return lateRead.promise;
            return Promise.resolve({ done: true });
        },
        cancel: () => Promise.resolve(),
        releaseLock() {}
    };
    const browser = createBrowser({ globals: { fetch: async () => ++requests === 1
        ? streamingResponse(reader) : new Response(new Uint8Array([7, 8])) } });
    browser.context._downloaded = 10;
    const result = observe(browser.context.downloadOne('/pak1.pak', 1));
    await settle();
    fireDelay(browser, 30000);
    await settle();
    assert.equal(browser.context._downloaded, 10);
    fireDelay(browser, 2000);
    await settle();
    assert.equal(result.state, 'fulfilled');
    assert.deepEqual([...result.value], [7, 8]);
    const status = browser.element('statusText').textContent;
    const progress = browser.element('progressFill').style.width;
    lateRead.resolve({ done: false, value: new Uint8Array([9, 9, 9]) });
    await settle();
    assert.equal(browser.context._downloaded, 12);
    assert.equal(browser.element('statusText').textContent, status);
    assert.equal(browser.element('progressFill').style.width, progress);
    assert.equal(requests, 2);
    assert.equal(reads, 2, 'A timed out reader must not be read again');
    assert.equal(browser.timers.size, 0);
});

test('a late fetch response is cancelled without reading it or changing retry progress', async () => {
    const lateFetch = deferred();
    let requests = 0;
    let cancellations = 0;
    let reads = 0;
    const browser = createBrowser({ globals: { fetch: () => ++requests === 1
        ? lateFetch.promise : Promise.resolve(new Response(new Uint8Array([7, 8]))) } });
    const result = observe(browser.context.downloadOne('/pak1.pak', 1));
    fireDelay(browser, 30000);
    await settle();
    fireDelay(browser, 2000);
    await settle();
    assert.equal(result.state, 'fulfilled');
    const status = browser.element('statusText').textContent;
    lateFetch.resolve({ ok: true, body: {
        cancel: () => { cancellations++; return Promise.resolve(); },
        getReader: () => { reads++; throw new Error('Late response must not be read'); }
    } });
    await settle();
    assert.equal(cancellations, 1);
    assert.equal(reads, 0);
    assert.equal(browser.context._downloaded, 2);
    assert.equal(browser.element('statusText').textContent, status);
    assert.equal(browser.timers.size, 0);
});

test('three abort-insensitive attempts return startup to a retryable error screen', async () => {
    const signals = [];
    const browser = createBrowser({ globals: { fetch: (url, { signal }) => {
        signals.push(signal);
        return new Promise(() => {});
    } } });
    const result = observe(browser.context.startGame());
    for (let attempt = 0; attempt < 3; attempt++) {
        fireDelay(browser, 30000);
        await settle();
        if (attempt < 2) {
            assert.equal(browser.context.gameState, 'downloading');
            fireDelay(browser, 2000 * (attempt + 1));
            await settle();
        }
    }
    assert.equal(result.state, 'fulfilled');
    assert.equal(signals.length, 3);
    assert.ok(signals.every(signal => signal.aborted));
    assert.equal(browser.context.gameState, 'failed');
    assert.equal(browser.element('landing').style.display, 'flex');
    assert.equal(browser.element('gameView').style.display, 'none');
    assert.equal(browser.element('playBtn').disabled, false);
    assert.equal(browser.element('playBtn').textContent, 'REINTENTAR');
    assert.match(browser.element('statusText').textContent, /pak0_chunk_aa.*Tiempo de espera agotado/);
    assert.equal(browser.document.body.children.length, 0);
    assert.equal(browser.timers.size, 0);
    browser.context.fetch = async () => new Response(new Uint8Array([1]));
    await browser.context.startGame();
    assert.equal(browser.context.gameState, 'starting');
    assert.equal(browser.document.body.children.length, 1);
    browser.context.Module.hideConsole();
    assert.equal(browser.timers.size, 0);
});

for (const bytes of [1, 64 * 1024]) {
    test(`${bytes} downloaded bytes display nonzero progress before the stream finishes`, async () => {
        const nextRead = deferred();
        let reads = 0;
        const browser = createBrowser({ globals: { fetch: async () => streamingResponse({
            read: () => ++reads === 1
                ? Promise.resolve({ done: false, value: new Uint8Array(bytes) }) : nextRead.promise,
            releaseLock() {}
        }) } });
        const download = browser.context.downloadOne('/pak1.pak', 0);
        await settle();
        const status = browser.element('statusText').textContent;
        const fill = browser.element('progressFill').style.width;
        nextRead.resolve({ done: true });
        await download;
        assert.equal(browser.context._downloaded, bytes);
        assert.ok(Number.parseFloat(fill) > 0, `Progress fill must be positive for ${bytes} bytes, got ${fill}`);
        assert.equal(browser.element('progressBar').style.display, 'block');
        assert.doesNotMatch(status, /^0(?:[.,]0+)?\s*\/\s*~?188\s*MB$/);
        assert.match(status, bytes === 1 ? /\b1\s*(?:B|bytes?)/i : /(?:\b64(?:[.,]0+)?\s*(?:K|k)|0[.,]0*[1-9]\d*\s*MB)/);
    });
}

test('slow active fetch and reads receive fresh idle deadlines, allowing a transfer over 30 seconds', async () => {
    const clock = virtualClock();
    const request = deferred();
    let pendingRead = deferred();
    let signal;
    const browser = createBrowser({ globals: { ...clock.globals, fetch: (url, options) => {
        signal = options.signal;
        return request.promise;
    } } });
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    await clock.advance(29000);
    request.resolve(streamingResponse({ read: () => pendingRead.promise, releaseLock() {} }));
    await settle();
    await clock.advance(29000);
    assert.equal(signal.aborted, false, 'Response headers must renew the connection deadline for the first read');
    for (const value of [1, 2]) {
        const ready = pendingRead;
        pendingRead = deferred();
        ready.resolve({ done: false, value: new Uint8Array([value]) });
        await settle();
        await clock.advance(29000);
        assert.equal(signal.aborted, false, 'Received bytes must renew the stream idle deadline');
        assert.equal(result.state, 'pending');
    }
    pendingRead.resolve({ done: true });
    await settle();
    assert.equal(result.state, 'fulfilled');
    assert.deepEqual([...result.value], [1, 2]);
    assert.equal(clock.timers.size, 0);
});

test('empty stream chunks do not keep an idle transfer alive', async () => {
    const clock = virtualClock();
    let pendingRead = deferred();
    const browser = createBrowser({ globals: { ...clock.globals, fetch: async () => streamingResponse({
        read: () => pendingRead.promise,
        cancel: () => Promise.resolve(),
        releaseLock() {}
    }) } });
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    await settle();
    await clock.advance(29000);
    const emptyRead = pendingRead;
    pendingRead = deferred();
    emptyRead.resolve({ done: false, value: new Uint8Array(0) });
    await settle();
    await clock.advance(1000);
    assertTimedOut(result);
    assert.equal(browser.context._downloaded, 0);
    assert.equal(clock.timers.size, 0);
});

for (const body of [null, undefined, {}, { getReader: false }]) {
    test(`a response without usable streaming support uses arrayBuffer (${JSON.stringify(body)})`, async () => {
        let buffers = 0;
        const browser = createBrowser({ globals: { fetch: async () => ({
            ok: true,
            body,
            arrayBuffer: async () => { buffers++; return new Uint8Array([1, 2, 3]).buffer; }
        }) } });
        const data = await browser.context.downloadOne('/pak1.pak', 0);
        assert.deepEqual([...data], [1, 2, 3]);
        assert.equal(buffers, 1);
        assert.equal(browser.context._downloaded, 3);
        assert.equal(browser.timers.size, 0);
    });
}

test('a buffered response has a bounded 120 second deadline without inventing byte progress', async () => {
    const clock = virtualClock();
    const buffer = deferred();
    let signal;
    const browser = createBrowser({ globals: { ...clock.globals, fetch: async (url, options) => {
        signal = options.signal;
        return { ok: true, body: null, arrayBuffer: () => buffer.promise };
    } } });
    browser.context._downloaded = 10;
    const result = observe(browser.context.downloadOne('/pak1.pak', 0));
    await settle();
    await clock.advance(30000);
    assert.equal(result.state, 'pending', 'A buffered transfer has no observable intermediate bytes and needs its own deadline');
    assert.equal(signal.aborted, false);
    assert.equal(browser.context._downloaded, 10);
    assert.match(browser.element('statusText').textContent, /pak1\.pak/);
    await clock.advance(90000);
    assertTimedOut(result);
    assert.equal(signal.aborted, true);
    assert.equal(browser.context._downloaded, 10);
    const status = browser.element('statusText').textContent;
    buffer.resolve(new Uint8Array([1, 2, 3]).buffer);
    await settle();
    assert.equal(browser.context._downloaded, 10);
    assert.equal(browser.element('statusText').textContent, status);
    assert.equal(clock.timers.size, 0);
});

test('an empty buffered response is rejected before the engine starts', async () => {
    const browser = createBrowser({ globals: { fetch: async () => ({
        ok: true, body: null, arrayBuffer: async () => new ArrayBuffer(0)
    }) } });
    await assert.rejects(browser.context.downloadOne('/empty.pak', 0), /empty\.pak: Archivo vacio/);
    assert.equal(browser.context._downloaded, 0);
    assert.equal(browser.document.body.children.length, 0);
    assert.equal(browser.timers.size, 0);
});
