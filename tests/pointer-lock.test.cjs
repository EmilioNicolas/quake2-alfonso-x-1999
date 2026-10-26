const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

// Regression: on Chrome Android the engine's deferred SDL pointer-lock request ran
// inside the joystick's synthetic keydown. Once the canvas held the lock, every
// setPointerCapture threw InvalidStateError and all touch controls stopped.
function game(mobile) {
    const b = createBrowser({ mobile, globals: { PointerEvent: BrowserEvent } });
    const canvas = b.element('canvas');
    // Model the real browser: the native method grants the lock (Chrome Android
    // does), and pointer capture is invalid while any element holds the lock.
    Object.getPrototypeOf(canvas).requestPointerLock = function() {
        b.document.pointerLockElement = this;
        return Promise.resolve();
    };
    const capture = Object.getPrototypeOf(canvas).setPointerCapture;
    for (const id of ['moveZone', 'lookZone', 'fireBtnRight']) {
        b.element(id).setPointerCapture = function(pointerId) {
            if (b.document.pointerLockElement) throw new Error('InvalidStateError');
            return capture.call(this, pointerId);
        };
    }
    b.context.initEngine();
    b.context.gameState = 'running';
    b.context.Module.mobileBridge = { command() {} };
    b.element('touchControls').style.display = 'block';
    // Emscripten runs queued requestPointerLock calls from its window key handler.
    b.window.addEventListener('keydown', () => canvas.requestPointerLock());
    b.contact = (type, id, x, y, target) => b.element(target).dispatchEvent(new BrowserEvent(type,
        { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: 1000, bubbles: true }));
    b.kinds = () => b.events.filter(e => /^(key|mouse(down|up))/.test(e.type)).map(e => e.type + (e.code ? ':' + e.code : ''));
    return b;
}

test('mobile: joystick forward cannot obtain a pointer lock that disables later touches', () => {
    const b = game(true);
    b.contact('pointerdown', 1, 120, 300, 'moveZone');
    b.contact('pointermove', 1, 120, 220, 'moveZone');
    b.contact('pointerup', 1, 120, 220, 'moveZone');
    assert.equal(b.document.pointerLockElement, null, 'Synthetic joystick keys must not lock the pointer');
    b.contact('pointerdown', 2, 756, 302, 'fireBtnRight');
    b.contact('pointerup', 2, 756, 302, 'fireBtnRight');
    b.contact('pointerdown', 3, 120, 300, 'moveZone');
    b.contact('pointermove', 3, 170, 300, 'moveZone');
    b.contact('pointerup', 3, 170, 300, 'moveZone');
    assert.deepEqual(b.kinds(), ['keydown:KeyW', 'keyup:KeyW', 'mousedown', 'mouseup', 'keydown:KeyD', 'keyup:KeyD']);
});

test('desktop keeps the native pointer lock', () => {
    const b = game(false);
    assert.equal(Object.prototype.hasOwnProperty.call(b.element('canvas'), 'requestPointerLock'), false);
    b.element('canvas').requestPointerLock();
    assert.equal(b.document.pointerLockElement, b.element('canvas'));
});
