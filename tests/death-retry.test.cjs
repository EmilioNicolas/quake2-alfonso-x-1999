const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
// The test DOM does not wire inline handlers: run the one declared in the markup.
const retryHandler = /id="retryBtn" onclick="([A-Za-z]+)\(\)"/.exec(html)[1];

// In single player, any attack while dead opens Quake II's native LOAD GAME menu,
// which cannot be navigated by touch and keeps the game paused. Mobile replaces it
// with a "Has muerto" dialog that reloads the level-entry autosave.
const HUD_ON = 'set r_hudscale 0\nset crosshair 0\nset viewsize 100\n';

function game({ mobile = true, map = 'alfonsox' } = {}) {
    const frames = [], commands = [];
    const b = createBrowser({ mobile, globals: {
        PointerEvent: BrowserEvent,
        requestAnimationFrame: callback => frames.push(callback)
    } });
    const state = { health: 100 };
    const bridge = {
        readStats: () => ({ health: state.health, ammo: 50, armor: 0 }),
        command(text) { commands.push(text); }
    };
    b.context.initEngine();
    b.context.Module.hideConsole();
    if (map) b.context.Module.print('Map: ' + map);
    b.context.createQuakeMobileBridge = () => bridge;
    b.context.attachMobileGameAPI(0, 0);
    let time = 0;
    return Object.assign(b, { state, commands, frames,
        tick() {
            const frame = frames.shift();
            assert.equal(typeof frame, 'function', 'HUD update remains scheduled');
            frame(time += 100);
        },
        print: text => b.context.Module.print(text),
        sent: () => commands.filter(c => c !== HUD_ON && !c.includes('vid_restart')),
        visible: () => b.element('mobileDeath').style.display === 'flex',
        controls: () => b.element('touchControls').style.display,
        canvasKinds: () => b.events.filter(e => /^(key|mouse(down|up))/.test(e.type)).map(e => e.type + (e.code ? ':' + e.code : '')),
        touch: (type, id, target, x = 756, y = 302) => b.element(target).dispatchEvent(new BrowserEvent(type,
            { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: 1000, bubbles: true })),
        die() { state.health = 0; b.tick(); b.runTimers(); /* flush the HUD's 250 ms resize */ },
        retry() { b.context[retryHandler](); }
    });
}

test('markup: Spanish modal dialog with a labelled Reintentar button', () => {
    assert.match(html, /<div id="mobileDeath" role="dialog" aria-modal="true" aria-labelledby="mobileDeathTitle"/);
    assert.match(html, /<h2 id="mobileDeathTitle">Has muerto<\/h2>/);
    assert.match(html, /<button type="button" id="retryBtn" onclick="retryFromDeath\(\)">Reintentar<\/button>/);
    assert.match(html, /#resumeBtn, #retryBtn \{ min-height: 48px; min-width: 48px;/);
});

test('mobile: overlay appears at health <= 0, hides controls and blocks fire', () => {
    const g = game();
    g.tick();
    g.runTimers();
    assert.equal(g.visible(), false);
    assert.equal(g.controls(), 'block');
    g.touch('pointerdown', 1, 'fireBtnRight');
    g.die();
    assert.equal(g.visible(), true);
    assert.equal(g.context.mobileDead, true);
    assert.equal(g.controls(), 'none');
    assert.equal(g.document.activeElement, g.element('retryBtn'));
    assert.deepEqual(g.canvasKinds(), ['mousedown', 'mouseup'], 'A held fire button is released on death');
    // Any attack press while dead would open the native LOAD GAME menu.
    g.context.sendMouseButton(true);
    g.touch('pointerup', 1, 'fireBtnRight');
    g.touch('pointerdown', 2, 'fireBtnRight');
    g.touch('pointerup', 2, 'fireBtnRight');
    g.touch('pointerdown', 3, 'lookZone', 500, 180);
    g.touch('pointerup', 3, 'lookZone', 500, 180);
    g.runTimers();
    assert.deepEqual(g.canvasKinds().filter(k => k === 'mousedown'), ['mousedown']);
    // Pause must not take the engine pause cvar while the death dialog owns the screen.
    g.context.setMobilePaused(true);
    assert.equal(g.context.mobilePaused, false);
    for (const health of [-40, 0]) { g.state.health = health; g.tick(); assert.equal(g.visible(), true); }
    assert.equal(g.element('hudHealth').textContent, '0');
});

test('Reintentar queries "paused" then loads save0 when no native menu is open', () => {
    const g = game();
    g.tick();
    g.die();
    g.retry();
    assert.deepEqual(g.sent(), ['paused\n']);
    assert.equal(g.element('retryBtn').disabled, true);
    assert.equal(g.element('retryBtn').getAttribute('aria-busy'), 'true');
    g.retry();
    assert.deepEqual(g.sent(), ['paused\n'], 'A second tap while busy is ignored');
    g.print('"paused" is "0"');
    assert.deepEqual(g.sent(), ['paused\n', 'load save0\n']);
    assert.equal(g.canvasKinds().some(k => k.includes('Escape')), false, 'No Escape without a native menu');
    g.state.health = 100;
    g.tick();
    assert.equal(g.visible(), false);
    assert.equal(g.context.mobileDead, false);
    assert.equal(g.controls(), 'block');
    assert.equal(g.element('retryBtn').disabled, false);
    assert.equal(g.element('retryBtn').getAttribute('aria-busy'), null);
    assert.equal(g.timers.size, 0, 'The retry timeout is cancelled');
    assert.equal(g.document.pointerLockElement, null);
    // Controls work again.
    g.touch('pointerdown', 4, 'fireBtnRight');
    g.touch('pointerup', 4, 'fireBtnRight');
    assert.deepEqual(g.canvasKinds().slice(-2), ['mousedown', 'mouseup']);
});

test('Reintentar closes an open native menu with Escape, re-checks, then loads save0', () => {
    const g = game();
    g.tick();
    g.die();
    g.retry();
    g.print('"paused" is "1"');
    assert.deepEqual(g.canvasKinds().filter(k => k.includes('Escape')), ['keydown:Escape', 'keyup:Escape']);
    const escape = g.events.find(e => e.code === 'Escape');
    assert.equal(escape.keyCode, 27);
    g.print('"paused" is "1"');
    assert.equal(g.canvasKinds().filter(k => k.includes('Escape')).length, 2, 'Duplicate replies do not send extra Escapes');
    assert.equal(g.timers.size, 1);
    g.runTimers();
    assert.deepEqual(g.sent(), ['paused\n', 'paused\n']);
    g.print('"paused" is "0"');
    assert.deepEqual(g.sent(), ['paused\n', 'paused\n', 'load save0\n']);
    g.state.health = 100;
    g.tick();
    assert.equal(g.visible(), false);
});

test('a menu that never closes stops after four Escapes and still restarts', () => {
    const g = game();
    g.tick();
    g.die();
    g.retry();
    for (let i = 0; i < 5; i++) {
        g.print('"paused" is "1"');
        if (g.sent().at(-1) !== 'paused\n') break;
        g.runTimers();
    }
    assert.equal(g.canvasKinds().filter(k => k === 'keydown:Escape').length, 4);
    assert.equal(g.sent().at(-1), 'load save0\n');
});

test('no reply to "paused" still restarts after 1.5 s', () => {
    const g = game();
    g.tick();
    g.die();
    g.retry();
    assert.deepEqual([...g.timers.values()].map(t => t.delay), [1500]);
    g.runTimers();
    assert.deepEqual(g.sent(), ['paused\n', 'load save0\n']);
});

for (const error of ['No such savegame: save/save0/server.ssv', 'Savegame from an older version.']) {
    test(`map fallback after "${error.slice(0, 20)}"`, () => {
        const g = game();
        g.tick();
        g.die();
        g.retry();
        g.print('"paused" is "0"');
        g.print(error);
        assert.deepEqual(g.sent(), ['paused\n', 'load save0\n', 'map alfonsox\n']);
        g.print(error);
        assert.equal(g.sent().length, 3, 'The fallback runs once');
        g.state.health = 100;
        g.tick();
        assert.equal(g.visible(), false);
    });
}

test('a retry that never revives re-enables the button and the next one uses the map', () => {
    const g = game();
    g.tick();
    g.die();
    g.retry();
    g.print('"paused" is "0"');
    assert.deepEqual([...g.timers.values()].map(t => t.delay), [15000]);
    g.runTimers();
    assert.equal(g.element('retryBtn').disabled, false);
    assert.equal(g.visible(), true);
    g.retry();
    g.print('"paused" is "0"');
    assert.equal(g.sent().at(-1), 'map alfonsox\n');
    g.state.health = 100;
    g.tick();
    g.die();
    g.retry();
    g.print('"paused" is "0"');
    assert.equal(g.sent().at(-1), 'load save0\n', 'A revival resets the fallback');
});

test('without a known map the fallback keeps loading the autosave', () => {
    const g = game({ map: null });
    g.tick();
    g.die();
    g.retry();
    g.print('"paused" is "0"');
    g.print('No such savegame: save0');
    assert.deepEqual(g.sent(), ['paused\n', 'load save0\n', 'load save0\n']);
});

test('the last "Map:" line is tracked across level changes', () => {
    const g = game();
    g.print('Map: boss2');
    g.tick();
    g.die();
    g.retry();
    g.print('"paused" is "0"');
    g.print('No such savegame');
    assert.equal(g.sent().at(-1), 'map boss2\n');
});

test('console lines are parsed even when the engine batches them in one print', () => {
    const g = game({ map: null });
    // Real engine output: lines may be separated by a bare carriage return.
    g.print('Server does not have this file.\nMap: base1\rMod_LoadTexinfo: Couldn\'t load None');
    g.tick();
    g.die();
    g.retry();
    g.print('Loading...\n"paused" is "0"\n');
    assert.deepEqual(g.sent(), ['paused\n', 'load save0\n']);
    g.print('Loading game...\nNo such savegame: /qwasm2/baseq2/save/save0/server.ssv\n');
    assert.deepEqual(g.sent(), ['paused\n', 'load save0\n', 'map base1\n']);
});

test('map names are sanitised before reaching a console command', () => {
    const g = game();
    const safe = g.context.safeMapName;
    assert.equal(safe('alfonsox'), 'alfonsox');
    assert.equal(safe('*boss2'), 'boss2');
    assert.equal(safe('base1$start'), 'base1');
    assert.equal(safe('city-3_b.bsp'), 'city-3_b');
    for (const bad of ['a;quit', 'a\nquit', 'a b', '"x"', 'maps/../x', '', null, 'x'.repeat(64), 'ñ']) {
        assert.equal(safe(bad), null, JSON.stringify(bad));
    }
    g.print('Map: evil;quit');
    g.print('Map: ok;quit\nMap: a"b');
    g.tick();
    g.die();
    g.retry();
    g.print('"paused" is "0"');
    g.print('No such savegame');
    assert.equal(g.sent().at(-1), 'map alfonsox\n', 'Unsafe names never replace the last safe map');
});

test('paused game: death waits for resume; error screen clears the dialog', () => {
    const g = game();
    g.tick();
    g.context.setMobilePaused(true);
    g.die();
    assert.equal(g.visible(), false);
    g.context.setMobilePaused(false);
    g.tick();
    assert.equal(g.visible(), true);
    g.retry();
    g.context.showGameError(new Error('boom'));
    assert.equal(g.visible(), false);
    assert.equal(g.context.mobileDead, false);
    assert.equal(g.timers.size, 0);
});

test('desktop never shows the dialog nor blocks fire', () => {
    const g = game({ mobile: false });
    g.state.health = 0;
    g.tick();
    g.context.setMobileDead(true);
    g.print('"paused" is "1"');
    assert.notEqual(g.element('mobileDeath').style.display, 'flex');
    assert.equal(g.context.mobileDead, false);
    g.context.sendMouseButton(true);
    assert.deepEqual(g.canvasKinds(), ['mousedown']);
    assert.equal(g.canvasKinds().some(k => k.includes('Escape')), false);
});
