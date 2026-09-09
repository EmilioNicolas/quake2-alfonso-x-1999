const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuakeMobileBridge } = require('../mobile-runtime.js');
const { createBrowser, BrowserEvent } = require('./helpers/browser.cjs');

function fixture() {
    let buffer = new ArrayBuffer(4096);
    const imports = 64, exports = 256, edicts = 512, stride = 512, client = 2048;
    const data = new DataView(buffer);
    const int = (offset, value) => data.setInt32(offset, value, true);
    int(exports, 3);
    int(imports + 168, 42);
    int(exports + 64, edicts);
    int(exports + 68, stride);
    int(exports + 72, 2);
    int(edicts + stride + 84, client);
    int(edicts + stride + 88, 1);
    const stat = (index, value) => new DataView(buffer).setInt16(client + 120 + index * 2, value, true);
    stat(0, 9); stat(1, 100); stat(2, 7); stat(3, 50); stat(5, 25);
    const commands = [];
    return { data, int, stat, imports, exports,
        create: () => createQuakeMobileBridge(() => buffer, imports, exports, (...args) => commands.push(args)),
        grow() { const next = new ArrayBuffer(8192); new Uint8Array(next).set(new Uint8Array(buffer)); buffer = next; },
        commands
    };
}

test('HUD reads live signed stats, unbounded blaster ammo, and replacement memory after growth', () => {
    const f = fixture();
    const bridge = f.create();
    assert.deepEqual(bridge.readStats(), { health: 100, ammo: 50, armor: 25 });
    f.stat(1, 19); f.stat(3, 0); f.stat(5, 0);
    assert.deepEqual(bridge.readStats(), { health: 19, ammo: 0, armor: 0 });
    f.grow(); f.stat(1, -12); f.stat(2, 0);
    assert.deepEqual(bridge.readStats(), { health: -12, ammo: null, armor: 0 });
});

test('uninitialized, disconnected and out-of-bounds players never supply fabricated stats', () => {
    const f = fixture();
    const bridge = f.create();
    f.int(512 + 512 + 88, 0);
    assert.equal(bridge.readStats(), null);
    f.int(512 + 512 + 88, 1);
    f.int(512 + 512 + 84, 4092);
    assert.equal(bridge.readStats(), null);
    f.int(f.exports + 64, 0);
    assert.equal(bridge.readStats(), null);
});

test('incompatible API fails before calling a table function; commands use gi.AddCommandString', () => {
    const f = fixture();
    f.create().command('set paused 1\n');
    assert.deepEqual(f.commands, [[42, 'set paused 1\n']]);
    f.int(f.exports, 4);
    assert.throws(f.create, /Unsupported/);
    assert.throws(() => createQuakeMobileBridge(() => new ArrayBuffer(80), 4, 8), /Unsupported/);
});

test('mobile resizes coalesce and request a renderer restart without changing game state', () => {
    const browser = createBrowser({ mobile: true });
    browser.context.initEngine();
    browser.context.Module.hideConsole();
    const commands = [];
    browser.context.Module.mobileBridge = { command: text => commands.push(text) };
    browser.element('canvas').width = 800;
    browser.element('canvas').height = 400;
    browser.context.innerWidth = 390;
    browser.context.innerHeight = 844;
    for (let i = 0; i < 3; i++) browser.window.dispatchEvent(new BrowserEvent('resize'));
    assert.equal(browser.timers.size, 1);
    browser.runTimers();
    assert.deepEqual(commands, ['set r_customwidth 390\nset r_customheight 844\nset r_mode -1\nvid_restart\n']);
    assert.equal(browser.context.gameState, 'running');
    browser.element('canvas').width = 390;
    browser.element('canvas').height = 844;
    browser.window.dispatchEvent(new BrowserEvent('resize'));
    browser.runTimers();
    assert.equal(commands.length, 1);
});

test('viewport uses safe insets and preserves aspect below the engine minimum', () => {
    const browser = createBrowser({ mobile: true, globals: {
        innerWidth: 568, innerHeight: 260,
        getComputedStyle: () => ({ paddingLeft: '47px', paddingRight: '47px', paddingTop: '0px', paddingBottom: '34px' })
    } });
    const size = browser.context.mobileViewport();
    assert.equal(size.height, 240);
    assert.ok(Math.abs(size.width / size.height - 474 / 226) < .005);
});

test('the bundled SDL bridge selects relative touch input without changing desktop pointer lock', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
    const start = source.indexOf('var fillPointerlockChangeEventData=');
    const end = source.indexOf(';var registerPointerlockChangeEventCallback', start);
    assert.ok(start >= 0 && end > start);
    const canvas = { id: 'canvas', nodeName: 'CANVAS' };
    const memory = new Int8Array(512);
    const context = { Module: { canvas }, document: { pointerLockElement: null }, HEAP8: memory,
        JSEvents: { getNodeNameForTarget: node => node?.nodeName || '' }, stringToUTF8() {} };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    context.fillPointerlockChangeEventData(0);
    assert.equal(memory[0], 0);
    context.Module.touchRelativeMouse = true;
    context.fillPointerlockChangeEventData(0);
    assert.equal(memory[0], 1);
    assert.equal(context.document.pointerLockElement, null);
    context.Module.touchRelativeMouse = false;
    context.document.pointerLockElement = canvas;
    context.fillPointerlockChangeEventData(0);
    assert.equal(memory[0], 1);
});

test('the native viewport follows the rendered dynamic-height surface, even if innerHeight is stale', () => {
    const browser = createBrowser({ mobile: true, globals: { innerWidth: 390, innerHeight: 844 } });
    browser.element('gameView').clientWidth = 390;
    browser.element('gameView').clientHeight = 664;
    const size = browser.context.mobileViewport();
    assert.equal(size.width, 390);
    assert.equal(size.height, 664);
});
