// Real WebAssembly/WebGL checks. Node 22+; launch your own isolated Chromium + HTTP server.
// CDP_PORT=9366 GAME_URL=http://127.0.0.1:8766/ node tests/mobile-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { connect } = require('./helpers/cdp.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = path.resolve(process.env.EVIDENCE_DIR || 'evidence/mobile-ux');
const url = process.env.GAME_URL || 'http://127.0.0.1:8766/';
const report = { engine: 'Bundled Quake II WASM + WebGL, Chromium CDP, SwiftShader', cases: [], limitations: [
    'Desktop Chromium touch emulation, not physical Android/iOS or Safari.',
    'Insets are CSS fixtures, not actual OS safe-area reports. Fullscreen is rejected during fixed-size cases.',
    'Software WebGL demonstrates functionality, not phone GPU speed, heat, memory use, audio or finger ergonomics.',
    'give all/give health are test-only native console fixtures; production startup does not enable cheats or supply inventory.'
] };
let c;
async function until(expression, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await c.evaluate(expression)) return;
        await delay(200);
    }
    throw new Error('Timed out: ' + expression);
}
async function check(name, run) {
    try {
        const evidence = await run();
        report.cases.push({ name, passed: true, evidence });
        console.log('PASS', name, evidence || '');
    } catch (error) {
        report.cases.push({ name, passed: false, error: error.message });
        console.error('FAIL', name, error.message);
        await c.screenshot(path.join(directory, 'failure-' + report.cases.length + '.png'));
        throw error;
    }
}
async function viewport(width, height, mobile = true, dpr = 1) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    await c.send('Emulation.setUserAgentOverride', { userAgent: mobile
        ? 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36'
        : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36' });
}
async function boot(mobile) {
    const fresh = new URL(url); fresh.searchParams.set('cdp-review', String(Date.now()));
    await c.send('Page.navigate', { url: fresh.href });
    await until(`location.href === ${JSON.stringify(fresh.href)} && document.readyState === 'complete' && typeof startGame === 'function' && gameState === 'idle'`);
    if (!mobile) await c.evaluate(`window.originalInitEngine=initEngine;initEngine=function(){originalInitEngine();Module.attachGameAPI=function(imports,exports){window.desktopProbe=createQuakeMobileBridge(()=>HEAPU8.buffer,imports,exports,(index,text)=>{const saved=stackSave();try{getWasmTableEntry(index)(stringToUTF8OnStack(text));}finally{stackRestore(saved);}});};};true`);
    await c.evaluate('document.documentElement.requestFullscreen = () => Promise.reject(new Error("Fixed viewport test")); startGame(); true');
    await until('typeof Module !== "undefined" && gameState === "running" && output.value.includes("Map: alfonsox")', 150000);
    if (mobile) await until('mobileHudActive && document.getElementById("mobileHud").style.display === "grid"');
    await delay(400);
}
async function command(text) {
    await c.evaluate(`(Module.mobileBridge || window.desktopProbe).command(${JSON.stringify(text + '\n')}); true`);
    await delay(300);
}
async function stats() { return c.evaluate('(Module.mobileBridge || window.desktopProbe).readStats()'); }
async function position() {
    const start = await c.evaluate('output.value.length');
    await command('viewpos');
    await until(`output.value.slice(${start}).includes('position: ')`);
    return c.evaluate('output.value.match(/position: .*/g).slice(-1)[0]');
}
async function samplePositions() {
    // Sample inside the page so slow software-renderer frames cannot hide a short jump arc.
    return c.evaluate(`(async()=>{const start=output.value.length;for(let i=0;i<20;i++){Module.mobileBridge.command('viewpos\\n');await new Promise(r=>setTimeout(r,70));}return output.value.slice(start).match(/position: .*/g)||[]})()`);
}

const points = new Map();
async function touch(type, id, x, y) {
    if (type === 'touchEnd') points.delete(id);
    else if (type === 'touchCancel') points.clear();
    else points.set(id, { id, x, y });
    await c.send('Input.dispatchTouchEvent', { type, touchPoints: [...points.values()] });
}
async function tap(id) {
    const p = await c.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await touch('touchStart', 8, p.x, p.y);
    await touch('touchEnd', 8);
}
async function layout() {
    return c.evaluate(`(() => {
        const rect = el => el.getBoundingClientRect().toJSON();
        const controls = document.getElementById('touchControls');
        const hud = document.getElementById('mobileHud');
        return { viewport: [innerWidth, innerHeight], buffer: [canvas.width, canvas.height],
            canvas: rect(canvas), safe: rect(controls), hud: rect(hud),
            numbers: ['hudHealth','hudAmmo','hudArmor'].map(id => {const e=document.getElementById(id);return {id,text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),clipped:e.scrollWidth>e.clientWidth};}),
            crosshair: rect(document.getElementById('mobileCrosshair')),
            buttons: [...controls.querySelectorAll('button')].map(e => { const box=rect(e);return {id:e.id,box,hit:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===e}; }) };
    })()`);
}
function overlaps(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
function verifyLayout(l) {
    assert.deepEqual(l.buffer, [Math.round(l.safe.width), Math.round(l.safe.height)]);
    assert(l.hud.left >= l.safe.left && l.hud.right <= l.safe.right && l.hud.top >= l.safe.top);
    for (const n of l.numbers) { assert(n.font >= 24); assert(!n.clipped, n.id + ' clips'); }
    for (const a of l.buttons) {
        assert(a.box.width >= 44 && a.box.height >= 44, a.id + ' target');
        assert(a.box.left >= l.safe.left && a.box.right <= l.safe.right && a.box.top >= l.safe.top && a.box.bottom <= l.safe.bottom, a.id + ' safe area');
        assert(a.hit, a.id + ' hit test');
        assert(!overlaps(a.box, l.hud), a.id + ' overlaps HUD');
        assert(!overlaps(a.box, l.crosshair), a.id + ' overlaps crosshair');
        for (const b of l.buttons) if (a !== b) assert(!overlaps(a.box, b.box), a.id + ' overlaps ' + b.id);
    }
    assert(Math.abs(l.crosshair.x + l.crosshair.width/2 - (l.canvas.x + l.canvas.width/2)) < 1);
    assert(Math.abs(l.crosshair.y + l.crosshair.height/2 - (l.canvas.y + l.canvas.height/2)) < 1);
}
(async () => {
    await fs.mkdir(directory, { recursive: true });
    c = await connect(Number(process.env.CDP_PORT || 9366));
    await viewport(844, 390);
    await boot(true);
    await check('live HUD at fresh spawn', async () => {
        const initial = await stats();
        assert.deepEqual(initial, { health: 100, ammo: null, armor: 0 });
        assert.equal(await c.evaluate('document.getElementById("hudAmmo").textContent'), '∞');
        await c.screenshot(path.join(directory, 'spawn-844x390.png'));
        return initial;
    });
    await command('give all\nuse Machinegun');
    await delay(700);
    await c.evaluate(`window.inputEvidence=[];for(const type of ['mousedown','mouseup','mousemove','keydown','keyup'])canvas.addEventListener(type,e=>inputEvidence.push({type:e.type,code:e.code,dx:e.movementX,dy:e.movementY,buttons:e.buttons}));window.trustedTouches=[];document.getElementById('touchControls').addEventListener('touchstart',e=>trustedTouches.push({trusted:e.isTrusted,count:e.touches.length}));true`);
    await check('native jump, crouch and weapon cycling respond to their touch buttons', async () => {
        const before = await position();
        const z = text => Number(text.match(/position: [^ ]+ [^ ]+ ([^,]+)/)[1]);
        await touch('touchStart', 7, 788, 254);
        const jumpSamples = await samplePositions();
        const jumped = jumpSamples.reduce((a,b)=>z(a)>z(b)?a:b, before);
        await touch('touchEnd', 7);
        assert(z(jumped) > z(before), 'JUMP raises the actual view position');
        await delay(900);
        const standing = await position();
        await touch('touchStart', 7, 762, 98);
        const crouchSamples = await samplePositions();
        const crouched = crouchSamples.reduce((a,b)=>z(a)<z(b)?a:b, standing);
        await touch('touchEnd', 7);
        assert(z(crouched) < z(standing), 'BAJAR lowers the actual view position');
        await tap('weaponPrev');
        await until('Module.mobileBridge.readStats()?.ammo === 100');
        await tap('weaponNext');
        await until('Module.mobileBridge.readStats()?.ammo === 200');
        return {before, jumped, standing, crouched, jumpSamples, crouchSamples, weaponCycle: 'Machinegun → Super Shotgun (100 shells) → Machinegun (200 bullets)'};
    });
    await check('look taps, jitter and drag never fire; real camera yaw changes', async () => {
        const before = await stats();
        const posBefore = await position();
        await touch('touchStart', 2, 520, 190);
        await touch('touchEnd', 2);
        await touch('touchStart', 2, 520, 190);
        await touch('touchMove', 2, 524, 192);
        await touch('touchEnd', 2);
        await touch('touchStart', 2, 520, 190);
        await touch('touchMove', 2, 550, 190);
        await touch('touchEnd', 2);
        await delay(400);
        assert.equal((await stats()).ammo, before.ammo);
        assert.equal(await c.evaluate('inputEvidence.filter(e=>e.type==="mousedown").length'), 0);
        const posAfter = await position();
        assert.notEqual(posAfter.split('angles:')[1], posBefore.split('angles:')[1], 'Actual camera must turn');
        return { before: posBefore, after: posAfter, ammo: before.ammo };
    });
    await check('three real contacts simultaneously move, look and hold fire', async () => {
        const before = await stats();
        const posBefore = await position();
        await touch('touchStart', 1, 90, 300);
        await touch('touchStart', 2, 530, 190);
        await touch('touchStart', 3, 788, 328);
        await touch('touchMove', 1, 125, 300); // strafe, avoid the nearby map exit
        await touch('touchMove', 2, 550, 196);
        await delay(600);
        const held = await stats();
        const posHeld = await position();
        assert(held.ammo < before.ammo, 'Native weapon consumes ammo');
        assert.notEqual(posHeld.split(', angles:')[0], posBefore.split(', angles:')[0], 'Native player moves');
        assert.notEqual(posHeld.split('angles:')[1], posBefore.split('angles:')[1], 'Native camera turns');
        assert.equal(await c.evaluate('document.getElementById("fireBtnRight").classList.contains("pressed")'), true);
        await c.screenshot(path.join(directory, 'three-fingers-844x390.png'));
        await touch('touchEnd', 2); // releasing look must not release held fire
        await delay(300);
        const afterLookRelease = await stats();
        assert(afterLookRelease.ammo < held.ammo);
        await touch('touchEnd', 3);
        await touch('touchEnd', 1);
        await delay(350); // finish queued weapon frames
        const released = await stats();
        await delay(500);
        assert.equal((await stats()).ammo, released.ammo, 'No firing after release');
        const trusted = await c.evaluate('trustedTouches');
        assert(trusted.some(t => t.trusted && t.count === 3));
        return { before, held, afterLookRelease, released, posBefore, posHeld, trusted };
    });
    await check('touchcancel and pause release held controls', async () => {
        await touch('touchStart', 1, 90, 300);
        await touch('touchMove', 1, 125, 300);
        await touch('touchStart', 3, 788, 328);
        await touch('touchCancel');
        await delay(350);
        const stopped = await stats();
        await delay(400);
        assert.equal((await stats()).ammo, stopped.ammo);
        assert.equal(await c.evaluate('document.querySelectorAll(".pressed").length'), 0);
        await touch('touchStart', 3, 788, 328);
        await c.evaluate('window.dispatchEvent(new Event("blur"));true');
        await touch('touchCancel');
        await delay(400);
        assert.equal(await c.evaluate('mobilePaused'), true);
        assert.equal(await c.evaluate('document.querySelectorAll(".pressed").length'), 0);
        await c.screenshot(path.join(directory, 'pause-844x390.png'));
        await tap('resumeBtn');
        await until('!mobilePaused && document.getElementById("mobileHud").style.display === "grid"');
        return { canceledAmmo: stopped.ammo, blur: 'synthetic browser blur, native engine pause' };
    });
    await check('live health, armor and finite ammo match native state', async () => {
        await command('give health 18');
        await until('Module.mobileBridge.readStats()?.health === 18 && document.getElementById("hudHealth").textContent === "18"');
        const live = await stats();
        assert.equal(live.health, 18);
        assert.equal(live.armor, 200);
        assert.equal(await c.evaluate('document.getElementById("hudHealth").textContent'), '18');
        assert.equal(await c.evaluate('document.getElementById("hudArmor").textContent'), '200');
        assert.equal(await c.evaluate('document.getElementById("hudAmmo").textContent'), String(live.ammo));
        assert.equal(await c.evaluate('document.getElementById("mobileHud").classList.contains("low-health")'), true);
        await c.screenshot(path.join(directory, 'live-low-health-844x390.png'));
        await command('give health 100');
        await until('Module.mobileBridge.readStats()?.health === 100');
        return live;
    });
    const sizes = [
        { width: 320, height: 568, safe: [0,0,0,0] },
        { width: 390, height: 664, safe: [47,0,34,0], dpr: 3 },
        { width: 430, height: 932, safe: [59,0,34,0] },
        { width: 568, height: 320, safe: [0,0,0,0] },
        { width: 667, height: 375, safe: [0,0,21,0] },
        { width: 844, height: 390, safe: [0,47,21,47] },
        { width: 932, height: 430, safe: [0,59,21,59] },
        { width: 768, height: 1024, safe: [24,0,20,0] }
    ];
    for (const size of sizes) await check(`real game ${size.width}x${size.height} DPR ${size.dpr || 1} safe ${size.safe}`, async () => {
        await viewport(size.width, size.height, true, size.dpr || 1);
        await c.evaluate(`['top','right','bottom','left'].forEach((edge,i)=>document.documentElement.style.setProperty('--safe-'+edge,${JSON.stringify(size.safe)}[i]+'px'));resizeMobileGame();true`);
        await until('canvas.width === mobileViewport().width && canvas.height === mobileViewport().height && document.getElementById("mobileHud").style.display === "grid"', 45000);
        await delay(400);
        const l = await layout();
        verifyLayout(l);
        await c.screenshot(path.join(directory, `game-${size.width}x${size.height}.png`));
        return l;
    });
    await check('container-only height changes resize the native buffer', async () => {
        const previous = await c.evaluate('({innerHeight,bufferHeight:canvas.height})');
        await c.evaluate('document.body.style.height="calc(100dvh - 40px)";true');
        await until(`canvas.height === ${previous.bufferHeight - 40}`);
        assert.equal(await c.evaluate('innerHeight'), previous.innerHeight, 'No window resize was needed');
        await c.evaluate('document.body.style.height="";true');
        await until(`canvas.height === ${previous.bufferHeight}`);
        return previous;
    });
    await check('rotate with held fire cancels input and keeps the current map', async () => {
        await tap('weaponNext');
        const fire = await c.evaluate('(() => {let r=document.getElementById("fireBtnRight").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
        await touch('touchStart', 3, fire.x, fire.y);
        await viewport(844, 390);
        await touch('touchCancel');
        await until('canvas.width === mobileViewport().width && canvas.height === mobileViewport().height');
        assert.equal(await c.evaluate('document.querySelectorAll(".pressed").length'), 0);
        await delay(400);
        const after = await stats();
        await delay(400);
        assert.equal((await stats()).ammo, after.ammo);
        return after;
    });
    // Save full native observations before navigating away from the mobile game.
    await fs.writeFile(path.join(directory, 'input-events.json'), JSON.stringify(await c.evaluate('inputEvidence'), null, 2));
    const mobileTarget = c.targetId;
    const desktopTarget = await c.send('Target.createTarget', {url: 'about:blank'});
    c.close();
    c = await connect(Number(process.env.CDP_PORT || 9366), desktopTarget.targetId);
    await c.send('Target.closeTarget', {targetId: mobileTarget});
    await viewport(1440, 900, false);
    await boot(false);
    await check('desktop native HUD, keyboard movement, mouse fire and pointer capture', async () => {
        assert.equal(await c.evaluate('isMobile'), false);
        assert.equal(await c.evaluate('getComputedStyle(document.getElementById("touchControls")).display'), 'none');
        assert.equal(await c.evaluate('getComputedStyle(document.getElementById("mobileHud")).display'), 'none');
        await until('window.desktopProbe && desktopProbe.readStats() !== null');
        await command('give all\nuse Machinegun');
        await until('desktopProbe.readStats()?.ammo === 200');
        const before = await stats();
        const posBefore = await position();
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 720, y: 450, button: 'left', clickCount: 1 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 720, y: 450, button: 'left', clickCount: 1 });
        await delay(200);
        const pointerLocked = await c.evaluate('document.pointerLockElement === canvas');
        assert(pointerLocked, 'Canvas should capture the desktop pointer');
        await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
        await delay(250);
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 750, y: 450 });
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 750, y: 450, button: 'left', clickCount: 1 });
        await delay(600);
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 750, y: 450, button: 'left', clickCount: 1 });
        await delay(300);
        const after = await stats();
        const posAfter = await position();
        assert(after.ammo < before.ammo, 'Desktop mouse fire consumes ammo');
        assert.notEqual(posBefore.split(', angles:')[0], posAfter.split(', angles:')[0], 'Desktop WASD moves the player');
        assert.notEqual(posBefore.split('angles:')[1], posAfter.split('angles:')[1], 'Desktop mouse turns the camera');
        await c.screenshot(path.join(directory, 'desktop-1440x900.png'));
        await c.evaluate('document.exitPointerLock();true');
        return { pointerLocked, before, after, posBefore, posAfter, buffer: await c.evaluate('[canvas.width,canvas.height]') };
    });
    await c.send('Page.navigate', { url: new URL('tests/responsive.html', url).href });
    await until('window.layoutTestResults && window.layoutTestResults.done');
    await check('browser layout harness (engine blocked)', async () => {
        const result = await c.evaluate('layoutTestResults');
        assert.equal(result.failed, 0, JSON.stringify(result));
        return result;
    });
    for (const name of await fs.readdir(directory)) if (/^failure-\d+\.png$/.test(name)) await fs.unlink(path.join(directory, name));
})().catch(error => {
    console.error(error); process.exitCode = 1;
    if (!report.cases.some(result => !result.passed)) report.cases.push({ name: 'browser setup or navigation', passed: false, error: error.message });
}).finally(async () => {
    report.passed = report.cases.filter(c => c.passed).length;
    report.failed = report.cases.filter(c => !c.passed).length;
    report.date = new Date().toISOString();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
    if (c) c.close();
});
