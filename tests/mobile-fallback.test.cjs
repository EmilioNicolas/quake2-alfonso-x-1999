const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

const disableNative = 'set r_hudscale 0\nset crosshair 0\nset viewsize 100\n';
const restoreNative = 'set r_hudscale -1\nset crosshair 1\n';

function game() {
    const frames = [], commands = [];
    const browser = createBrowser({ mobile: true, globals: {
        requestAnimationFrame: callback => frames.push(callback)
    } });
    const state = {
        read: () => ({ health: 20, ammo: 12, armor: 25 }),
        command() {}
    };
    const bridge = {
        readStats: () => state.read(),
        command(text) { commands.push(text); return state.command(text); }
    };
    browser.context.initEngine();
    browser.context.Module.hideConsole();
    browser.context.createQuakeMobileBridge = () => bridge;
    browser.context.attachMobileGameAPI(0, 0);
    let time = 0;
    return { ...browser, state, commands, bridge,
        tick() {
            const frame = frames.shift();
            assert.equal(typeof frame, 'function', 'HUD update remains scheduled');
            assert.doesNotThrow(() => frame(time += 100));
        }
    };
}

function assertCleared(g) {
    assert.equal(g.element('mobileHud').style.display, 'none');
    assert.equal(g.element('mobileCrosshair').style.display, 'none');
    for (const id of ['hudHealth', 'hudAmmo', 'hudArmor']) assert.equal(g.element(id).textContent, '—');
    assert.equal(g.element('hudAmmo').getAttribute('aria-label'), null);
    assert.equal(g.element('mobileHud').classList.contains('low-health'), false);
}

const failures = {
    'null stats': g => { g.state.read = () => null; },
    'readStats exception': g => { g.state.read = () => { throw new RangeError('Detached heap'); }; },
    'missing bridge': g => { delete g.context.Module.mobileBridge; },
    'missing reader': g => { g.context.Module.mobileBridge = {}; },
    'missing stat field': g => { g.state.read = () => ({ health: 20, ammo: 12 }); },
    'non-finite stat': g => { g.state.read = () => ({ health: NaN, ammo: 12, armor: 25 }); }
};

for (const [name, invalidate] of Object.entries(failures)) {
    test(`${name} restores native indicators and clears stale HUD after activation`, () => {
        const g = game();
        g.tick();
        assert.equal(g.element('hudHealth').textContent, '20');
        assert.equal(g.element('mobileCrosshair').style.display, 'block');
        assert.deepEqual(g.commands, [disableNative]);
        invalidate(g);
        g.tick();
        assertCleared(g);
        assert.equal(g.context.mobileHudActive, false);
        assert.equal(g.context.gameState, 'running');
        assert.deepEqual(g.commands, [disableNative, restoreNative]);
        assert.equal(g.timers.size, 0, 'cancel pending resize that could use the invalid bridge');
        g.tick();
        assert.deepEqual(g.commands, [disableNative, restoreNative], 'do not spam restore commands');
    });
}

test('unavailable initial stats leave native HUD enabled; valid stats recover after a later failure', () => {
    const g = game();
    g.state.read = () => null;
    g.tick();
    assertCleared(g);
    assert.deepEqual(g.commands, []);
    g.state.read = () => ({ health: 100, ammo: null, armor: 0 });
    g.tick();
    assert.equal(g.element('hudAmmo').textContent, '∞');
    g.state.read = () => null;
    g.tick();
    g.state.read = () => ({ health: 90, ammo: 9, armor: 5 });
    g.tick();
    assert.equal(g.element('hudHealth').textContent, '90');
    assert.equal(g.element('hudAmmo').textContent, '9');
    assert.deepEqual(g.commands, [disableNative, restoreNative, disableNative]);
});

test('a failed native disable command restores both indicators instead of publishing mobile stats', () => {
    const g = game();
    g.state.command = text => { if (text === disableNative) throw new Error('Command interrupted'); };
    g.tick();
    assertCleared(g);
    assert.equal(g.context.mobileHudActive, false);
    assert.equal(g.context.gameState, 'running');
    assert.deepEqual(g.commands, [disableNative, restoreNative]);
});

for (const mode of ['throw', 'reject']) {
    test(`native restore ${mode} uses the recovery screen instead of leaving play without indicators`, () => {
        const g = game();
        g.tick();
        g.state.read = () => null;
        g.state.command = () => { if (mode === 'throw') throw new Error('Lost transport'); return false; };
        g.tick();
        assertCleared(g);
        assert.equal(g.context.gameState, 'failed');
        assert.equal(g.element('gameView').style.display, 'none');
        assert.equal(g.element('touchControls').style.display, 'none');
        assert.match(g.element('statusText').textContent, /restaurar el HUD/);
        assert.equal(g.timers.size, 0);
    });
}

for (const mode of ['missing bridge', 'missing command', 'throw', 'reject']) {
    test(`pause ${mode} releases held input without claiming the engine is paused`, () => {
        const g = game();
        g.tick();
        const dialog = g.element('mobilePause').style.display;
        g.element('fireBtnRight').dispatchEvent(new BrowserEvent('touchstart', { changedTouches: [{ identifier: 1 }] }));
        if (mode === 'missing bridge') delete g.context.Module.mobileBridge;
        if (mode === 'missing command') g.context.Module.mobileBridge = {};
        if (mode === 'throw') g.state.command = () => { throw new Error('Command failed'); };
        if (mode === 'reject') g.state.command = () => false;
        assert.equal(g.context.setMobilePaused(true), false);
        assert.equal(g.context.mobilePaused, false);
        assert.equal(g.element('mobilePause').style.display, dialog);
        assert.equal(g.element('touchControls').style.display, 'block');
        assert.equal(g.element('mobileHud').style.display, 'grid');
        assert.deepEqual(g.events.filter(e => /^(mousedown|mouseup)$/.test(e.type)).map(e => e.type), ['mousedown', 'mouseup']);
    });
}

test('pause/resume UI changes only after command acceptance, and failed resume keeps pause state', () => {
    const g = game();
    g.tick();
    g.state.command = text => {
        assert.equal(text, 'set paused 1\n');
        assert.equal(g.context.mobilePaused, false);
        assert.equal(g.element('touchControls').style.display, 'block');
    };
    assert.equal(g.context.setMobilePaused(true), true);
    assert.equal(g.context.mobilePaused, true);
    assert.equal(g.element('mobilePause').style.display, 'flex');
    assertCleared(g);
    g.state.command = () => { throw new Error('Resume failed'); };
    assert.equal(g.context.setMobilePaused(false), false);
    assert.equal(g.context.mobilePaused, true);
    assert.equal(g.element('mobilePause').style.display, 'flex');
    assert.equal(g.element('touchControls').style.display, 'none');
    g.state.command = text => {
        assert.equal(text, 'set paused 0\n');
        assert.equal(g.context.mobilePaused, true);
        assert.equal(g.element('mobilePause').style.display, 'flex');
    };
    assert.equal(g.context.setMobilePaused(false), true);
    assert.equal(g.context.mobilePaused, false);
    assert.equal(g.element('mobilePause').style.display, 'none');
    g.tick();
    assert.equal(g.element('mobileHud').style.display, 'grid');
});
