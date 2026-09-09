const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

function desktop() {
    const browser = createBrowser({ mobile: false });
    browser.context.initEngine();
    browser.context.gameState = 'running';
    browser.document.pointerLockElement = null;
    return { ...browser, canvas: browser.element('canvas'), module: browser.context.Module };
}

test('pointer lock tolerates unsupported APIs and only recognizes the game canvas', () => {
    const { module, canvas, document } = desktop();
    assert.equal(module._attemptPointerLock(), false);
    delete document.pointerLockElement;
    assert.equal(module._attemptPointerLock(), false);

    let requests = 0;
    canvas.requestPointerLock = () => { requests++; };
    document.pointerLockElement = {};
    assert.equal(module._attemptPointerLock(), false);
    assert.equal(requests, 0);

    document.pointerLockElement = canvas;
    assert.equal(module._attemptPointerLock(), true);
    assert.equal(requests, 0);

    document.pointerLockElement = null;
    assert.equal(module._attemptPointerLock(), false);
    assert.equal(requests, 1);
});

test('pointer lock catches synchronous exceptions and rejected browser promises', async () => {
    const { module, canvas } = desktop();
    canvas.requestPointerLock = () => { throw new Error('Denied'); };
    assert.equal(module._attemptPointerLock(), false);

    canvas.requestPointerLock = () => Promise.reject(new Error('Gesture required'));
    assert.equal(module._attemptPointerLock(), false);
    // node:test reports any unhandled rejection occurring during this turn.
    await new Promise(setImmediate);
});

test('click retries a failed request and recaptures the canvas after unlock', () => {
    const { module, canvas, document, context } = desktop();
    let requests = 0;
    canvas.requestPointerLock = () => { requests++; };
    module.captureMouse();
    assert.equal(requests, 1);
    assert.equal(module._canLockPointer, false);

    canvas.requestPointerLock = () => {
        requests++;
        document.pointerLockElement = canvas;
    };
    canvas.dispatchEvent(new BrowserEvent('click'));
    assert.equal(requests, 2);
    assert.equal(module._canLockPointer, true);
    assert.equal(document.pointerLockElement, canvas);
    assert.equal(document.activeElement, canvas);

    document.pointerLockElement = null;
    canvas.dispatchEvent(new BrowserEvent('click'));
    assert.equal(requests, 3);

    context.gameState = 'error';
    document.pointerLockElement = null;
    canvas.dispatchEvent(new BrowserEvent('click'));
    assert.equal(requests, 3);
});

test('keyboard fallback retries after failure and Escape never requests a lock', () => {
    const { module, canvas, document } = desktop();
    let requests = 0;
    canvas.requestPointerLock = () => { requests++; };
    module.captureMouse();
    document.dispatchEvent(new BrowserEvent('keydown', { key: 'w' }));
    assert.equal(requests, 2);

    document.dispatchEvent(new BrowserEvent('keydown', { key: 'Escape' }));
    assert.equal(requests, 2);
    assert.equal(module._canLockPointer, true);
    document.dispatchEvent(new BrowserEvent('keydown', { key: 'w' }));
    assert.equal(requests, 2);
});

test('touch devices never request desktop pointer lock', () => {
    const { context, element } = createBrowser({ mobile: true });
    context.initEngine();
    context.gameState = 'running';
    let requests = 0;
    element('canvas').requestPointerLock = () => { requests++; };
    context.Module.captureMouse();
    element('canvas').dispatchEvent(new BrowserEvent('click'));
    assert.equal(requests, 0);
});
