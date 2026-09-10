const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

function game(pointer = true, mobile = true) {
    let now = 1000;
    const b = createBrowser({ mobile, globals: {
        ...(pointer ? { PointerEvent: BrowserEvent } : {}),
        performance: { now: () => now }
    } });
    b.context.gameState = 'running';
    b.context.Module = { mobileBridge: { command() {} } };
    b.element('touchControls').style.display = mobile ? 'block' : 'none';
    b.advance = ms => { now += ms; };
    b.contact = (kind, id = 1, x = 500, y = 180, target = 'lookZone', extra = {}) => {
        const event = pointer
            ? new BrowserEvent({ start: 'pointerdown', move: 'pointermove', end: 'pointerup', cancel: 'pointercancel', lost: 'lostpointercapture' }[kind],
                { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: now, bubbles: true, ...extra })
            : new BrowserEvent('touch' + kind, { changedTouches: [{ identifier: id, clientX: x, clientY: y, target: b.element(target) }], timeStamp: now, bubbles: true, ...extra });
        b.element(target).dispatchEvent(event);
        return event;
    };
    b.fire = () => b.events.filter(e => /^(mousedown|mouseup)$/.test(e.type)).map(e => [e.type, e.buttons]);
    b.keys = () => b.events.filter(e => /^key/.test(e.type)).map(e => [e.type, e.code]);
    b.pulse = () => {
        assert.equal(b.timers.size, 1);
        assert.equal([...b.timers.values()][0].delay, 50, 'Only a 50 ms attack pulse');
        b.runTimers();
    };
    return b;
}
const down = ['mousedown', 1], up = ['mouseup', 0];

for (const pointer of [true, false]) {
    const mode = pointer ? 'pointer' : 'touch fallback';
    for (const [start, end, processingDelay, accepted] of [
        [0, 221, 0, false], [100, 600, 5, false], [100, 180, 500, true],
        [0, 220, 500, true], [100, 99, 0, false]
    ]) test(`${mode}: event timestamps ${start}→${end} ms survive ${processingDelay} ms of handler delay`, () => {
        const b = game(pointer);
        b.contact('start', 1, 500, 180, 'lookZone', { timeStamp: start });
        b.advance(processingDelay);
        b.contact('end', 1, 500, 180, 'lookZone', { timeStamp: end });
        if (accepted) b.pulse();
        assert.deepEqual(b.fire(), accepted ? [down, up] : []);
        assert.equal(b.timers.size, 0);
    });

    for (const [ms, x, y, accepted] of [
        [0, 0, 0, true], [219.999, 7.999, 0, true], [220, 8, 0, true],
        [220.001, 0, 0, false], [1000, 0, 0, false], [100, 8.001, 0, false],
        [220, 0, -8, true], [220, -4.5, 6, true], [100, 6, 6, false]
    ]) test(`${mode}: tap boundary ${ms} ms / (${x}, ${y}) px = ${accepted}`, () => {
        const b = game(pointer);
        b.contact('start');
        assert.deepEqual(b.fire(), [], 'Never fire on contact down');
        b.advance(ms);
        b.contact('end', 1, 500 + x, 180 + y);
        if (accepted) { assert.deepEqual(b.fire(), [down]); b.pulse(); }
        assert.deepEqual(b.fire(), accepted ? [down, up] : []);
        assert.equal(b.timers.size, 0);
    });

    for (const distance of [8, 8.001, 80]) test(`${mode}: maximum ${distance} px excursion survives return to origin`, () => {
        const b = game(pointer);
        b.contact('start');
        b.contact('move', 1, 500 + distance, 180);
        b.contact('move');
        b.advance(100);
        b.contact('end');
        b.runTimers();
        assert.deepEqual(b.fire(), distance <= 8 ? [down, up] : []);
        const moves = b.events.filter(e => e.type === 'mousemove');
        assert.equal(moves.length, 2);
        assert(Math.abs(moves[0].movementX - distance * 8) < 1e-9);
        assert(Math.abs(moves[1].movementX + distance * 8) < 1e-9);
        assert.equal(b.document.pointerLockElement, null);
        assert.equal(b.context.Module.touchRelativeMouse, true);
    });

    test(`${mode}: a look tap fires while another finger keeps the joystick moving`, () => {
        const b = game(pointer);
        b.contact('start', 2, 100, 180, 'moveZone');
        b.contact('move', 2, 140, 140, 'moveZone');
        b.contact('start');
        b.advance(70);
        b.contact('end');
        b.pulse();
        assert.deepEqual(b.fire(), [down, up]);
        assert.deepEqual(b.keys(), [['keydown', 'KeyW'], ['keydown', 'KeyD']]);
        assert.equal(b.element('joystickIndicator').style.display, 'block');
        b.contact('end', 2, 140, 140, 'moveZone');
        assert.deepEqual(b.keys().slice(2), [['keyup', 'KeyW'], ['keyup', 'KeyD']]);
    });

    test(`${mode}: extra look fingers cannot fire or end the current owner's gesture`, () => {
        const b = game(pointer);
        b.contact('start');
        b.contact('start', 2);
        b.contact('move', 2, 700, 180);
        b.contact('end', 2);
        assert.deepEqual(b.fire(), []);
        assert.equal(b.events.length, 0);
        b.contact('end');
        b.pulse();
        assert.deepEqual(b.fire(), [down, up]);
    });

    test(`${mode}: two rapid taps own two pulses without leaving an old release timer`, () => {
        const b = game(pointer);
        b.contact('start'); b.contact('end');
        b.advance(20);
        b.contact('start', 2); b.contact('end', 2);
        assert.deepEqual(b.fire(), [down, up, down]);
        b.pulse();
        assert.deepEqual(b.fire(), [down, up, down, up]);
    });

    test(`${mode}: holding DISPARAR during a tap pulse survives that pulse's release`, () => {
        const b = game(pointer);
        b.contact('start'); b.contact('end');
        b.contact('start', 2, 700, 300, 'fireBtnRight');
        b.pulse();
        assert.deepEqual(b.fire(), [down]);
        b.contact('start', 3); b.contact('move', 3, 520, 180);
        assert.equal(b.events.filter(e => e.type === 'mousemove').at(-1).buttons, 1);
        b.contact('cancel', 3);
        assert.deepEqual(b.fire(), [down]);
        b.contact('end', 2, 700, 300, 'fireBtnRight');
        assert.deepEqual(b.fire(), [down, up]);
    });

    test(`${mode}: taps during DISPARAR neither release nor extend the independent hold`, () => {
        const b = game(pointer);
        b.contact('start', 2, 700, 300, 'fireBtnRight');
        b.contact('start'); b.contact('end');
        assert.deepEqual(b.fire(), [down]);
        assert.equal(b.timers.size, 0);
        b.contact('end', 2, 700, 300, 'fireBtnRight');
        assert.deepEqual(b.fire(), [down, up]);
    });

    for (const kind of pointer ? ['cancel', 'lost'] : ['cancel']) test(`${mode}: ${kind} discards a tap, preserves held fire and frees a new look`, () => {
        const b = game(pointer);
        b.contact('start', 2, 700, 300, 'fireBtnRight');
        b.contact('start'); b.contact(kind); b.contact('end');
        assert.deepEqual(b.fire(), [down]);
        assert.equal(b.timers.size, 0);
        b.contact('end', 2, 700, 300, 'fireBtnRight');
        b.contact('start', 3); b.contact('end', 3); b.pulse();
        assert.deepEqual(b.fire(), [down, up, down, up]);
    });

    for (const phase of ['candidate', 'pulse']) for (const reason of ['pause', 'blur', 'hidden', 'reset', 'resize', 'orientationchange', 'fullscreenchange', 'pagehide']) {
        test(`${mode}: ${reason} cancels a ${phase}, and stale input cannot fire after resume`, () => {
            const b = game(pointer);
            b.contact('start');
            if (phase === 'pulse') b.contact('end');
            if (reason === 'pause') b.context.setMobilePaused(true);
            else if (reason === 'reset') b.context.resetTouchControls();
            else if (reason === 'hidden') {
                b.document.hidden = true;
                b.document.dispatchEvent(new BrowserEvent('visibilitychange'));
            } else if (reason === 'fullscreenchange') b.document.dispatchEvent(new BrowserEvent(reason));
            else b.window.dispatchEvent(new BrowserEvent(reason));
            b.document.hidden = false;
            b.context.setMobilePaused(false);
            b.contact('move', 1, 501, 180); b.contact('end');
            assert([...b.timers.values()].every(timer => timer.delay !== 50), 'No stale fire timer');
            b.runTimers(); // A resize may still have its independent 250 ms renderer timer.
            assert.equal(b.timers.size, 0);
            assert.deepEqual(b.fire(), phase === 'pulse' ? [down, up] : []);
            if (pointer) assert.equal(b.element('lookZone').capturedPointers.size, 0);
            b.events.length = 0;
            b.contact('start', 3); b.contact('end'); // stale id must not release id 3
            assert.deepEqual(b.fire(), []);
            b.contact('end', 3); b.pulse();
            assert.deepEqual(b.fire(), [down, up]);
        });
    }

    for (const state of ['idle', 'starting', 'downloading', 'ended', 'failed', 'paused', 'hidden']) {
        test(`${mode}: ${state} rejects look taps`, () => {
            const b = game(pointer);
            if (state === 'paused') b.context.setMobilePaused(true);
            else if (state === 'hidden') b.document.hidden = true;
            else b.context.gameState = state;
            b.contact('start'); b.contact('end'); b.runTimers();
            assert.deepEqual(b.fire(), []);
            assert.equal(b.timers.size, 0);
        });
    }

    test(`${mode}: buttons, HUD, menus and canvas are excluded from tap recognition`, () => {
        const b = game(pointer);
        for (const target of ['jumpBtn', 'weaponPrev', 'weaponNext', 'crouchBtn', 'useBtn', 'pauseBtn', 'resumeBtn', 'mobileHud', 'playBtn', 'victoryOverlay', 'canvas']) {
            b.contact('start', 2, 500, 180, target);
            b.contact('end', 2, 500, 180, target);
            b.element(target).click();
        }
        assert.deepEqual(b.fire(), []);
        assert.equal(b.timers.size, 0);
        b.contact('start', 1, 500, 180, 'lookZone', { target: b.element('jumpBtn') });
        b.contact('end');
        assert.deepEqual(b.fire(), [], 'Bubbling UI contacts cannot become look taps');
    });

    test(`${mode}: compatibility mouse/click events on a look tap produce no duplicate attack`, () => {
        const b = game(pointer);
        b.contact('start'); b.contact('end'); b.pulse();
        let bubbled = 0;
        for (const type of ['mousedown', 'mouseup', 'click']) {
            b.document.addEventListener(type, () => bubbled++);
            const e = new BrowserEvent(type, { bubbles: true });
            b.element('lookZone').dispatchEvent(e);
            assert.equal(e.defaultPrevented, true);
        }
        assert.equal(bubbled, 0);
        assert.deepEqual(b.fire(), [down, up]);
    });
}

test('touch fallback: batched contacts retain their original zone/button target', () => {
    const b = game(false);
    const targets = ['moveZone', 'lookZone', 'fireBtnRight', 'jumpBtn'];
    const contacts = targets.map((target, i) => ({
        identifier: i + 1, clientX: i ? 500 : 100, clientY: 180, target: b.element(target)
    }));
    // changedTouches can contain contacts from other targets in the same update.
    for (const target of targets) b.contact('start', 0, 0, 0, target, { changedTouches: contacts });
    assert.deepEqual(b.fire(), [down]);
    assert.deepEqual(b.keys(), [['keydown', 'Space']]);
    b.contact('move', 1, 140, 180, 'moveZone');
    b.contact('move', 2, 530, 180, 'lookZone');
    assert.deepEqual(b.keys().at(-1), ['keydown', 'KeyD']);
    assert.deepEqual(b.events.filter(e => e.type === 'mousemove').map(e => e.movementX), [240]);
    b.contact('end', 3, 500, 180, 'fireBtnRight');
    b.contact('end', 4, 500, 180, 'jumpBtn');
    assert.deepEqual(b.fire(), [down, up], 'Other zones cannot keep the fire button held');
    assert.deepEqual(b.keys().at(-1), ['keyup', 'Space']);
    b.contact('end', 2, 530, 180, 'lookZone');
    b.contact('end', 1, 140, 180, 'moveZone');
    assert.equal(b.timers.size, 0, 'The look drag cannot turn into a tap for another finger');
    assert.deepEqual(b.keys().at(-1), ['keyup', 'KeyD']);
});

test('pointer: coalesced out-and-back movement permanently rejects the tap and preserves relative aim', () => {
    const b = game();
    b.contact('start');
    b.contact('move', 1, 500, 180, 'lookZone', { getCoalescedEvents: () => [
        new BrowserEvent('pointermove', { pointerId: 1, clientX: 509, clientY: 180 }),
        new BrowserEvent('pointermove', { pointerId: 1, clientX: 500, clientY: 180 })
    ] });
    b.contact('end');
    assert.deepEqual(b.fire(), []);
    assert.deepEqual(b.events.filter(e => e.type === 'mousemove').map(e => e.movementX), [72, -72, 0]);
});

test('pointer: companion touch events cannot duplicate or release pointer-owned fire', () => {
    const b = game();
    for (const target of ['lookZone', 'fireBtnRight']) {
        b.contact('start', 1, 500, 180, target);
        for (const type of ['touchstart', 'touchend', 'touchcancel']) {
            const e = new BrowserEvent(type, { changedTouches: [{ identifier: 1, clientX: 500, clientY: 180 }] });
            b.element(target).dispatchEvent(e);
            assert.equal(e.defaultPrevented, true);
        }
        b.contact('end', 1, 500, 180, target);
        b.runTimers();
    }
    assert.deepEqual(b.fire(), [down, up, down, up]);
});

for (const kind of ['cancel', 'lost']) test(`pointer: ${kind} on one DISPARAR finger leaves the other finger held`, () => {
    const b = game();
    b.contact('start', 1, 700, 300, 'fireBtnRight');
    b.contact('start', 2, 700, 300, 'fireBtnRight');
    b.contact(kind, 1, 700, 300, 'fireBtnRight');
    assert.deepEqual(b.fire(), [down]);
    b.contact('end', 2, 700, 300, 'fireBtnRight');
    assert.deepEqual(b.fire(), [down, up]);
});

test('pointer: capture failure does not start a tap or held action', () => {
    const b = game();
    for (const target of ['lookZone', 'fireBtnRight']) {
        b.element(target).setPointerCapture = () => { throw new Error('No active pointer'); };
        b.contact('start', 1, 500, 180, target);
        b.contact('end', 1, 500, 180, target);
    }
    assert.deepEqual(b.fire(), []);
});

test('pointer: five simultaneous contacts retain move/look/fire/jump/weapon ownership', () => {
    const b = game();
    for (const [i, target] of ['moveZone', 'lookZone', 'fireBtnRight', 'jumpBtn', 'weaponNext'].entries()) {
        b.contact('start', i + 1, 100, 180, target);
        assert(b.element(target).hasPointerCapture(i + 1));
    }
    b.contact('move', 1, 140, 140, 'moveZone');
    b.contact('move', 2, 150, 190);
    b.contact('lost', 2);
    assert.deepEqual(b.fire(), [down]);
    assert.deepEqual(b.keys(), [['keydown', 'Space'], ['keydown', 'KeyF'], ['keydown', 'KeyW'], ['keydown', 'KeyD']]);
    b.context.resetTouchControls();
    assert.deepEqual(b.fire(), [down, up]);
    for (const target of ['moveZone', 'lookZone', 'fireBtnRight', 'jumpBtn', 'weaponNext']) {
        assert.equal(b.element(target).capturedPointers.size, 0);
        assert.equal(b.element(target).classList.contains('pressed'), false);
    }
});

test('pointer: mouse and pen contacts never synthesize mobile tap fire', () => {
    const b = game();
    for (const pointerType of ['mouse', 'pen']) {
        b.contact('start', 1, 500, 180, 'lookZone', { pointerType });
        b.contact('end', 1, 500, 180, 'lookZone', { pointerType });
    }
    assert.deepEqual(b.fire(), []);
});

test('desktop: taps install no mobile input; native mouse down/up remain untouched', () => {
    const b = game(true, false);
    b.contact('start'); b.contact('end');
    assert.deepEqual(b.fire(), []);
    for (const type of ['mousedown', 'mouseup', 'click']) {
        const e = new BrowserEvent(type, { button: 0, buttons: type === 'mousedown' ? 1 : 0, bubbles: true });
        b.element('canvas').dispatchEvent(e);
        assert.equal(e.defaultPrevented, false);
    }
    assert.deepEqual(b.fire(), [down, up]);
    assert.equal(b.timers.size, 0);
});
