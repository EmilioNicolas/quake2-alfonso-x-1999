const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

const finger = (identifier, clientX = 100, clientY = 100) => ({ identifier, clientX, clientY });
function touch(browser, id, type, changedTouches, touches = changedTouches) {
    const event = new BrowserEvent(type, { changedTouches, touches });
    (typeof id === 'string' ? browser.element(id) : id).dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
}
function keys(browser) { return browser.events.filter(event => event.type.startsWith('key')).map(event => [event.type, event.code]); }
function fire(browser) { return browser.events.filter(event => /^(mousedown|mouseup)$/.test(event.type)).map(event => [event.type, event.buttons]); }

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

test('fire remains held until all fingers on both buttons release', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'fireBtnLeft', 'touchstart', [finger(1), finger(2)]);
    touch(browser, 'fireBtnRight', 'touchstart', [finger(3)]);
    touch(browser, 'fireBtnLeft', 'touchend', [finger(1)]);
    touch(browser, 'fireBtnRight', 'touchcancel', [finger(3)]);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'fireBtnLeft', 'touchcancel', [finger(2)]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

test('a look tap timeout cannot release a held fire button', () => {
    const browser = createBrowser({ mobile: true });
    touch(browser, 'fireBtnLeft', 'touchstart', [finger(1)]);
    touch(browser, 'lookZone', 'touchstart', [finger(2)]);
    touch(browser, 'lookZone', 'touchend', [finger(2)]);
    browser.runTimers();
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'fireBtnLeft', 'touchend', [finger(1)]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

test('successive look taps extend the pulse without an earlier premature release', () => {
    const browser = createBrowser({ mobile: true });
    for (const id of [1, 2]) {
        touch(browser, 'lookZone', 'touchstart', [finger(id)]);
        touch(browser, 'lookZone', 'touchend', [finger(id)]);
    }
    assert.equal(browser.timers.size, 1);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    browser.runTimers();
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
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
    touch(browser, 'fireBtnLeft', 'touchstart', [finger(2)]);
    browser.context.resetTouchControls();
    browser.events.length = 0;
    touch(browser, 'moveZone', 'touchstart', [finger(3)]);
    touch(browser, 'moveZone', 'touchmove', [finger(3, 100, 60)]);
    touch(browser, 'fireBtnLeft', 'touchstart', [finger(4)]);
    touch(browser, 'moveZone', 'touchend', [finger(1)]);
    touch(browser, 'fireBtnLeft', 'touchcancel', [finger(2)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW']]);
    assert.deepEqual(fire(browser), [['mousedown', 1]]);
    touch(browser, 'moveZone', 'touchend', [finger(3)]);
    touch(browser, 'fireBtnLeft', 'touchend', [finger(4)]);
    assert.deepEqual(keys(browser), [['keydown', 'KeyW'], ['keyup', 'KeyW']]);
    assert.deepEqual(fire(browser), [['mousedown', 1], ['mouseup', 0]]);
});

for (const reason of ['blur', 'hidden', 'engine reset']) {
    test(`${reason} releases every held control and pending tap`, () => {
        const browser = createBrowser({ mobile: true });
        touch(browser, 'moveZone', 'touchstart', [finger(1)]);
        touch(browser, 'moveZone', 'touchmove', [finger(1, 140, 60)]);
        touch(browser, 'fireBtnRight', 'touchstart', [finger(2)]);
        touch(browser, 'jumpBtn', 'touchstart', [finger(3)]);
        touch(browser, browser.document.querySelectorAll('.weapon-btn')[0], 'touchstart', [finger(4)]);
        touch(browser, 'lookZone', 'touchstart', [finger(5)]);
        touch(browser, 'lookZone', 'touchend', [finger(5)]);
        if (reason === 'blur') browser.window.dispatchEvent(new BrowserEvent('blur'));
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
