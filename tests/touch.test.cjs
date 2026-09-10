const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBrowser: baseBrowser, BrowserEvent } = require('./helpers/browser.cjs');

function createBrowser(options) {
    const browser = baseBrowser(options);
    browser.context.gameState = 'running';
    browser.element('touchControls').style.display = 'block';
    return browser;
}

const finger = (identifier, clientX = 100, clientY = 100) => ({ identifier, clientX, clientY });
function touch(browser, id, type, changedTouches, touches = changedTouches) {
    const target = typeof id === 'string' ? browser.element(id) : id;
    const event = new BrowserEvent(type, {
        changedTouches: changedTouches.map(t => ({ ...t, target: t.target || target })),
        touches, timeStamp: browser.context.performance.now()
    });
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
}
function keys(browser) { return browser.events.filter(event => event.type.startsWith('key')).map(event => [event.type, event.code]); }
function fire(browser) { return browser.events.filter(event => /^(mousedown|mouseup)$/.test(event.type)).map(event => [event.type, event.buttons]); }

test('only the right fire target exists and moving on the left cannot fire', () => {
    const browser = createBrowser({ mobile: true });
    assert.equal(browser.element('fireBtnLeft'), null);
    assert(browser.element('fireBtnRight'));
    touch(browser, 'moveZone', 'touchstart', [finger(1, 36, 110)]);
    touch(browser, 'moveZone', 'touchmove', [finger(1, 70, 110)]);
    touch(browser, 'moveZone', 'touchend', [finger(1)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyD'], ['keyup', 'KeyD']]);
    assert.deepEqual(fire(browser), []);
});

test('previous/next controls use the actual packaged weapon bindings, and use activates inventory', () => {
    const runtime = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const data = fs.readFileSync(path.join(__dirname, '../index.data'));
    const [, start, end] = runtime.match(/filename:"\/baseq2\/config.cfg",start:(\d+),end:(\d+)/);
    const config = data.subarray(Number(start), Number(end)).toString();
    for (const [id, code, key, command] of [
        ['weaponPrev', 'KeyR', 'r', 'weapprev'],
        ['weaponNext', 'KeyF', 'f', 'weapnext'],
        ['useBtn', 'KeyE', 'e', 'invuse']
    ]) {
        assert.match(config, new RegExp('^bind ' + key + ' "' + command + '"$', 'm'));
        const browser = createBrowser({ mobile: true });
        touch(browser, id, 'touchstart', [finger(1)]);
        touch(browser, id, 'touchend', [finger(1)]);
        assert.deepEqual(keys(browser), [['keydown', code], ['keyup', code]]);
        assert.deepEqual(fire(browser), []);
    }
});

test('movement follows its own finger even when a look finger arrived first', () => {
    const browser = createBrowser({ mobile: true });
    const look = finger(1, 600, 200);
    touch(browser, 'lookZone', 'touchstart', [look]);
    touch(browser, 'moveZone', 'touchstart', [finger(2)], [look, finger(2)]);
    touch(browser, 'moveZone', 'touchmove', [finger(2, 100, 60)], [look, finger(2, 100, 60)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW']]);
    touch(browser, 'moveZone', 'touchstart', [finger(3, 200, 200)]);
    touch(browser, 'moveZone', 'touchmove', [finger(3, 260, 200)]);
    touch(browser, 'moveZone', 'touchend', [finger(3)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW']]);
    assert.equal(browser.element('joystickIndicator').style.display, 'block');
    touch(browser, 'moveZone', 'touchcancel', [finger(2)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW'], ['keyup', 'KeyW']]);
    assert.equal(browser.element('joystickIndicator').style.display, 'none');
});

test('look cancellation does not shoot and frees the next look gesture', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'lookZone', 'touchstart', [finger(1)]);
    touch(browser, 'lookZone', 'touchcancel', [finger(1)]);
    assert.deepEqual(fire(browser), []);
    touch(browser, 'lookZone', 'touchstart', [finger(2)]);
    touch(browser, 'lookZone', 'touchmove', [finger(2, 105, 110)]);
    const movement = browser.events.find(event => event.type === 'mousemove');
    assert.equal(movement.movementX, 40);
    assert.equal(movement.movementY, 80);
    touch(browser, 'lookZone', 'touchend', [finger(2)]);
    assert.deepEqual(fire(browser), []);
});

test('the single right fire button stays held until its last finger releases', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'fireBtnRight', 'touchstart', [finger(1), finger(2)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(3)]);
    touch(browser, 'fireBtnRight', 'touchend', [finger(1)]);
    touch(browser, 'fireBtnRight', 'touchcancel', [finger(3)]);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'fireBtnRight', 'touchcancel', [finger(2)]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

test('a look tap cannot release a held fire button', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'fireBtnRight', 'touchstart', [finger(1)]);
    touch(browser, 'lookZone', 'touchstart', [finger(2)]);
    touch(browser, 'lookZone', 'touchend', [finger(2)]);
    browser.runTimers();
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'fireBtnRight', 'touchend', [finger(1)]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

test('relative look reports held fire until the last right-button finger releases', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'lookZone', 'touchstart', [finger(1, 500, 200)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(2), finger(3)]);
    touch(browser, 'lookZone', 'touchmove', [finger(1, 505, 202)]);
    touch(browser, 'fireBtnRight', 'touchend', [finger(2)]);
    touch(browser, 'lookZone', 'touchmove', [finger(1, 508, 199)]);
    touch(browser, 'fireBtnRight', 'touchcancel', [finger(3)]);
    touch(browser, 'lookZone', 'touchmove', [finger(1, 510, 200)]);
    assert.deepEqual(browser.events.filter(e => e.type === 'mousemove').map(e => [e.movementX, e.movementY, e.buttons]), [
        [40, 16, 1], [24, -24, 1], [16, 8, 0]
    ]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

test('successive look taps each send one bounded fire pulse', () => {
    const browser = createBrowser({ mobile: true });
    for (const id of [1, 2]) {
        touch(browser, 'lookZone', 'touchstart', [finger(id)]);
        touch(browser, 'lookZone', 'touchend', [finger(id)]);
        assert.equal(browser.timers.size, 1);
        browser.runTimers();
    }
    assert.equal(browser.timers.size, 0);
    browser.runTimers();
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0], ['mousedown', 1], ['mouseup', 0]]);
});

test('jump tracks fingers and releases on cancellation', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'jumpBtn', 'touchstart', [finger(1), finger(2)]);
    touch(browser, 'jumpBtn', 'touchend', [finger(1)]);
    assert.deepEqual(keys(browser), [['keydown', 'Space']]);
    touch(browser, 'jumpBtn', 'touchcancel', [finger(2)]);
    assert.deepEqual(keys(browser), [['keydown', 'Space'], ['keyup', 'Space']]);
});

test('late events from before a reset cannot release a new gesture', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'moveZone', 'touchstart', [finger(1)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(2)]);
    browser.context.resetTouchControls();
    browser.events.length = 0;
    touch(browser, 'moveZone', 'touchstart', [finger(3)]);
    touch(browser, 'moveZone', 'touchmove', [finger(3, 100, 60)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(4)]);
    touch(browser, 'moveZone', 'touchend', [finger(1)]);
    touch(browser, 'fireBtnRight', 'touchcancel', [finger(2)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW']]);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'moveZone', 'touchend', [finger(3)]);
    touch(browser, 'fireBtnRight', 'touchend', [finger(4)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW'], ['keyup', 'KeyW']]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

for (const reason of ['blur', 'hidden', 'engine reset', 'resize', 'orientationchange', 'fullscreenchange', 'pagehide']) {
    test(`${reason} releases every held control`, () => {
        const browser = createBrowser({ mobile: true });
        touch(browser, 'moveZone', 'touchstart', [finger(1)]);
        touch(browser, 'moveZone', 'touchmove', [finger(1, 140, 60)]);
        touch(browser, 'fireBtnRight', 'touchstart', [finger(2)]);
        touch(browser, 'jumpBtn', 'touchstart', [finger(3)]);
        touch(browser, browser.element('weaponNext'), 'touchstart', [finger(4)]);
        touch(browser, 'lookZone', 'touchstart', [finger(5)]);
        touch(browser, 'lookZone', 'touchend', [finger(5)]);
        if (['blur', 'resize', 'orientationchange', 'pagehide'].includes(reason)) browser.window.dispatchEvent(new BrowserEvent(reason));
        else if (reason === 'fullscreenchange') browser.document.dispatchEvent(new BrowserEvent(reason));
        else if (reason === 'hidden') {
            browser.document.hidden = true;
            browser.document.dispatchEvent(new BrowserEvent('visibilitychange'));
        } else browser.context.resetTouchControls();
        const pressed = new Set();
        for (const [type, key] of keys(browser)) {
            if (type === 'keydown') pressed.add(key);
            else pressed.delete(key);
        }
        assert.equal(pressed.size, 0);
        assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
        assert.equal(browser.timers.size, 0);
        assert.equal(browser.element('joystickIndicator').style.display, 'none');
        browser.context.resetTouchControls();
        assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
    });
}

test('movement, look, fire, jump and weapon changes retain independent owners', () => {
    const browser = createBrowser({ mobile: true });
    const weapon = browser.element('weaponNext');
    const fingers = [finger(1), finger(2, 600, 200), finger(3), finger(4), finger(5)];
    for (const [i, target] of ['moveZone', 'lookZone', 'fireBtnRight', 'jumpBtn', weapon].entries()) {
        touch(browser, target, 'touchstart', [fingers[i]], fingers.slice(0, i + 1));
    }
    touch(browser, 'moveZone', 'touchmove', [finger(1, 140, 60)], fingers);
    touch(browser, 'lookZone', 'touchmove', [finger(2, 620, 205)], fingers);
    touch(browser, weapon, 'touchend', [fingers[4]], fingers.slice(0, 4));
    touch(browser, 'lookZone', 'touchcancel', [fingers[1]], [fingers[0], fingers[2], fingers[3]]);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    assert.equal(browser.element('fireBtnRight').classList.contains('pressed'), true);
    assert.equal(browser.element('jumpBtn').classList.contains('pressed'), true);
    assert.equal(weapon.classList.contains('pressed'), false);
    assert.deepEqual(keys(browser), [
        ['keydown', 'Space'], ['keydown', 'KeyF'], ['keydown', 'KeyW'], ['keydown', 'KeyD'], ['keyup', 'KeyF']
    ]);
    touch(browser, 'jumpBtn', 'touchend', [fingers[3]], [fingers[0], fingers[2]]);
    touch(browser, 'fireBtnRight', 'touchend', [fingers[2]], [fingers[0]]);
    assert.equal(browser.element('joystickIndicator').style.display, 'block');
    touch(browser, 'moveZone', 'touchend', [fingers[0]], []);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
    assert.equal(browser.element('fireBtnRight').classList.contains('pressed'), false);
    assert.equal(browser.element('jumpBtn').classList.contains('pressed'), false);
    assert.equal(browser.element('joystickIndicator').style.display, 'none');
});

test('a brief look tap tolerates sub-threshold finger jitter and retains relative aiming', () => {
    let now = 1000;
    const browser = createBrowser({ mobile: true, globals: { performance: { now: () => now } } });
    touch(browser, 'lookZone', 'touchstart', [finger(1)]);
    touch(browser, 'lookZone', 'touchmove', [finger(1, 106, 105)]);
    now += 200;
    touch(browser, 'lookZone', 'touchend', [finger(1, 106, 105)], []);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    assert.deepEqual(browser.events.filter(e => e.type === 'mousemove').map(e => [e.movementX, e.movementY]), [[48, 40]]);
    browser.runTimers();
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

for (const gesture of ['long hold', 'out and back', 'distant release']) {
    test(`${gesture} in the look zone does not fire`, () => {
        let now = 1000;
        const browser = createBrowser({ mobile: true, globals: { performance: { now: () => now } } });
        touch(browser, 'lookZone', 'touchstart', [finger(1)]);
        if (gesture === 'long hold') now += 500;
        if (gesture === 'out and back') {
            touch(browser, 'lookZone', 'touchmove', [finger(1, 120, 100)]);
            touch(browser, 'lookZone', 'touchmove', [finger(1)]);
        }
        touch(browser, 'lookZone', 'touchend', [finger(1, gesture === 'distant release' ? 120 : 100, 100)], []);
        assert.deepEqual(fire(browser), []);
        assert.equal(browser.timers.size, 0);
    });
}

test('joystick feedback stays under its finger when controls are inset for a notch', () => {
    const browser = createBrowser({ mobile: true });
    browser.element('touchControls').bounds = { left: 47, top: 20, width: 750, height: 370 };
    touch(browser, 'moveZone', 'touchstart', [finger(1, 150, 200)]);
    assert.equal(browser.element('joystickIndicator').style.left, '53px');
    assert.equal(browser.element('joystickIndicator').style.top, '130px');
    touch(browser, 'moveZone', 'touchmove', [finger(1, 150, 170)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW']]);
});

test('visual viewport resize releases controls and clears pressed feedback', () => {
    let resize;
    const browser = createBrowser({ mobile: true, globals: {
        visualViewport: { addEventListener: (type, callback) => { if (type === 'resize') resize = callback; } }
    } });
    touch(browser, 'fireBtnRight', 'touchstart', [finger(1)]);
    touch(browser, 'jumpBtn', 'touchstart', [finger(2)]);
    resize();
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
    assert.deepEqual(keys(browser), [['keydown', 'Space'], ['keyup', 'Space']]);
    assert.equal(browser.element('fireBtnRight').classList.contains('pressed'), false);
    assert.equal(browser.element('jumpBtn').classList.contains('pressed'), false);
});

for (const [id, key] of [['crouchBtn', 'ShiftLeft'], ['useBtn', 'KeyE'], ['weaponPrev', 'KeyR'], ['weaponNext', 'KeyF']]) {
    test(`${id} owns its hold and releases on cancellation`, () => {
        const browser = createBrowser({ mobile: true });
        touch(browser, id, 'touchstart', [finger(1)]);
        touch(browser, id, 'touchstart', [finger(2)]);
        touch(browser, id, 'touchend', [finger(1)]);
        assert.deepEqual(keys(browser), [['keydown', key]]);
        touch(browser, id, 'touchcancel', [finger(2)]);
        assert.deepEqual(keys(browser), [['keydown', key], ['keyup', key]]);
    });
}

test('pause releases movement, look and fire; stale events cannot act behind the dialog', () => {
    const browser = createBrowser({ mobile: true });
    browser.context.Module = { mobileBridge: { command() {} } };
    touch(browser, 'moveZone', 'touchstart', [finger(1)]);
    touch(browser, 'moveZone', 'touchmove', [finger(1, 140, 60)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(2)]);
    touch(browser, 'lookZone', 'touchstart', [finger(3)]);
    browser.context.setMobilePaused(true);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
    browser.events.length = 0;
    touch(browser, 'lookZone', 'touchmove', [finger(3, 150, 150)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(4)]);
    touch(browser, 'moveZone', 'touchstart', [finger(5)]);
    touch(browser, 'moveZone', 'touchmove', [finger(5, 140, 60)]);
    assert.deepEqual(browser.events, []);
    browser.context.setMobilePaused(false);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(6)]);
    touch(browser, 'fireBtnRight', 'touchend', [finger(2), finger(4)]);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'fireBtnRight', 'touchend', [finger(6)]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

for (const state of ['idle', 'downloading', 'starting', 'ended', 'failed']) {
    test(`${state} ignores new control presses`, () => {
        const browser = createBrowser({ mobile: true });
        browser.context.gameState = state;
        touch(browser, 'fireBtnRight', 'touchstart', [finger(1)]);
        touch(browser, 'moveZone', 'touchstart', [finger(2)]);
        touch(browser, 'moveZone', 'touchmove', [finger(2, 140, 60)]);
        assert.deepEqual(browser.events, []);
    });
}

test('joystick feedback stays inside the safe rectangle near its edges', () => {
    const browser = createBrowser({ mobile: true });
    browser.element('touchControls').bounds = { left: 47, top: 20, width: 474, height: 280 };
    touch(browser, 'moveZone', 'touchstart', [finger(1, 48, 299)]);
    assert.equal(browser.element('joystickIndicator').style.left, '0px');
    assert.equal(browser.element('joystickIndicator').style.top, '180px');
    touch(browser, 'moveZone', 'touchmove', [finger(1, 80, 260)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW'], ['keydown', 'KeyD']]);
});

test('the entire joystick knob stays within its safe ring on diagonal edge drags', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'moveZone', 'touchstart', [finger(1)]);
    for (const [x, y] of [[-500, -500], [800, 800], [800, -500], [-500, 800]]) {
        touch(browser, 'moveZone', 'touchmove', [finger(1, x, y)]);
        const knob = browser.element('joystickKnob');
        const dx = parseFloat(knob.style.left) - 50;
        const dy = parseFloat(knob.style.top) - 50;
        assert(Math.hypot(dx, dy) <= 30.001);
        assert(Math.abs(dx) + 18 <= 50 && Math.abs(dy) + 18 <= 50);
    }
});
