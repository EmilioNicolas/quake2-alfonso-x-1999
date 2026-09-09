# Mobile FPS UX review

Changes are based on the clean `d944fa2` checkout, including its loading feedback, retry/cooldown handling, streaming/memory improvements and safe-area work. No commits or pushes were made.

## Behavior

- Health, ammo and armor come from the live local single-player game's `player_state_t.stats`. Zero armor is explicit; the blaster shows `∞`. The HUD uses 26 CSS px numbers, 10 px labels, tabular figures, a dark panel and a distinct low-health color. It sits above the movement/look zones and action targets.
- The high-contrast crosshair is centered on the safe game surface. It is a fixed reticle; there is no target detection, aim correction or automatic attack. It disappears when dead or paused.
- The left half below the HUD is a floating movement joystick, with an idle thumb-position hint, a dead zone and bounded feedback. The right half is drag-look. A touch keeps its original owner when it crosses another control.
- Both explicit FIRE buttons share a held attack state. Each finger owns its press; releasing one source cannot release another. Movement, look, held fire, jump and secondary actions can run concurrently.
- Brief look taps, jitter, stationary holds, drags and canceled gestures never fire. Explicit fire was chosen because tap shooting conflates camera repositioning with an attack. The left FIRE target supports an index finger while both thumbs move/look; physical comfort remains to be assessed on phones.
- JUMP, weapon previous/next, crouch and use have independent ownership and targets of at least 44 CSS px. Cycling covers all owned weapons rather than a fixed subset of number keys.
- Pause releases every control and requests a local engine pause. Blur/backgrounding also releases input and requests pause; resuming requires a fresh gesture. The UI changes only after the synchronous command bridge accepts the request. A missing, throwing or explicitly rejecting bridge leaves the previous pause state/UI intact and logs the failure; a failed resume keeps the pause dialog open. This confirms command queue submission, not a later engine execution acknowledgement. Resize, orientation, fullscreen, visual viewport resize, pagehide and cancellation release held input.
- Mobile resize follows the actual `100dvh` surface, including container size changes observed without a window resize. It uses the engine's command queue to restart only the renderer at the safe rectangle's aspect ratio and dimensions. Game/player state survives. The engine's 320 x 240 minimum is handled with proportional scaling below that size. This can cause a visible pause while the renderer rebuilds resources; phone latency is unmeasured.

## Engine integration

`mobile-runtime.js` reads structure-relative offsets in the public wasm32 Quake II **game API v3**, not guessed absolute addresses. `game_export_t.edicts` and `edict_size` locate player edict 1; its `client` starts with `player_state_t`. The adapter reads the live health/ammo/armor stats, checks the API version and pointer bounds, and reacquires the heap after memory growth. This page runs a local single-player server; this adapter is not a remote multiplayer HUD implementation.

The native HUD is disabled only after a valid live player is observed. On incompatible ABI initialization, the original HUD remains available and the error is logged. During updates, null/malformed stats, a missing reader/bridge, or a thrown read error clear all mobile values and accessibility labels, cancel pending resizing, and restore native automatic HUD scaling (`r_hudscale -1`) and crosshair (`crosshair 1`) if previously disabled. The original command transport is retained independently of the current stats bridge. Valid stats can reactivate the mobile HUD. A failed disable command also attempts restoration; if restoration itself throws or rejects, the existing reload/error screen replaces gameplay, avoiding play without indicators. Recheck the adapter when replacing the engine or game binary. Sources: [Qwasm2 game API](https://github.com/GMH-Code/Qwasm2/blob/main/src/game/header/game.h), [shared player state](https://github.com/GMH-Code/Qwasm2/blob/main/src/common/header/shared.h), [native HUD scaling](https://github.com/GMH-Code/Qwasm2/blob/main/src/client/cl_screen.c).

There are exactly two small hooks in the generated `index.js` runtime:

1. Wrap the side module's `GetGameAPI` export before linking to call optional `Module.attachGameAPI(imports, exports)`. It leaves the native return value unchanged. Desktop does not set this hook.
2. Allow `Module.touchRelativeMouse` to supply the canvas in the **engine's** pointer-lock event data. Starting a mobile look gesture notifies SDL to read `movementX/Y`. It never requests browser pointer lock. Without this, SDL reads absolute target coordinates and the existing synthetic mouse events do not turn the camera. Desktop still reads `document.pointerLockElement`. See [SDL's Emscripten input handler](https://github.com/libsdl-org/SDL/blob/SDL2/src/video/emscripten/SDL_emscriptenevents.c).

Keep both hooks when regenerating `index.js`; the real-browser test detects lost HUD or relative-look integration. Engine, renderer and game WASM files remain unchanged. Bundled SHA-256:

```
index.wasm       bc27be1b379f9a45650dfa0dd1c1c99df852561a3ed0b842ab369f1547dc644c
game_baseq2.wasm 8fdf02778bf426d1b973f456bf91f9e63d88b6f51f734231a728d5ada971ab4c
ref_gles3.wasm   00f4087106c1a47509273033606e40f824bf92de7eef3f50cc21d0a5f9e7d345
```

## Reproduce

Offline tests (Node 18+):

```sh
node --test tests/*.test.cjs
```

For per-case output on Node 24:

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.cjs
```

Real browser tests need Node 22+ (native WebSocket), Chromium, network access to the existing PAK CDN, and an isolated browser profile. Start the repository HTTP server and a dedicated browser, using an available Chromium path:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
chromium --headless --remote-debugging-port=9366 --user-data-dir=/tmp/quake2-mobile-review --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader about:blank
```

Then:

```sh
CDP_PORT=9366 GAME_URL=http://127.0.0.1:8766/ node tests/mobile-browser.cjs
```

The runner uses the first page in that dedicated browser. It navigates away from the game at the end, writes `evidence/mobile-ux/results.json`, native input observations and PNG screenshots, and returns a nonzero exit status on failure. This environment also required Chromium's `--no-sandbox --disable-dev-shm-usage` container flags. No npm packages, model settings or global configuration were installed or changed.

The native `give all` and `give health` commands are **test-only fixtures** for finite ammo, equipped armor and low health. They exercise the actual engine and HUD rather than substituting display values. Production startup has no `give`, aim-assist or attack commands. The desktop run installs a read-only test observer through the same optional game API hook to measure keyboard/mouse effects; it does not enable mobile UI.

## Evidence and limits

Verification before the final director fixes on Node 24.15.0 and Chromium 151.0.7922.34: **107/107 offline tests, 17/17 real-game CDP checks, and 8/8 supplementary browser layout cases passed** (the CDP runner reports 18 checks because the layout harness is one aggregate check). That run and all 13 real-game PNGs are under `evidence/mobile-ux`. [Offline log](../evidence/mobile-ux/unit-tests.txt), [browser log](../evidence/mobile-ux/browser-tests.txt), [source hashes for that earlier run](../evidence/mobile-ux/source-state.json).

The final director fixes cover only HUD failure recovery and pause command acceptance. Targeted verification: **55/55 tests passed**, including 15 new fallback/pause regressions plus the existing runtime and touch suites. Run `node --test --test-isolation=none --test-reporter=spec tests/mobile-fallback.test.cjs tests/mobile-runtime.test.cjs tests/touch.test.cjs`; [targeted log](../evidence/mobile-ux/director-fixes-tests.txt). These tests execute the page's actual HUD animation callback and control handlers with injected bridge failures. They do not execute WASM. The browser matrix was not rerun for these fixes, and the screenshots/source hashes above describe the earlier browser run, not a new visual verification of the failure paths.

Selected screenshots: [320 px portrait](../evidence/mobile-ux/game-320x568.png), [DPR 3 portrait with safe insets](../evidence/mobile-ux/game-390x664.png), [landscape with safe insets](../evidence/mobile-ux/game-844x390.png), [three simultaneous fingers](../evidence/mobile-ux/three-fingers-844x390.png), [low health and equipped armor](../evidence/mobile-ux/live-low-health-844x390.png), [desktop](../evidence/mobile-ux/desktop-1440x900.png).

See [machine-readable results](../evidence/mobile-ux/results.json) and the screenshots in [evidence/mobile-ux](../evidence/mobile-ux). The matrix uses the real map and renderer at 320×568, 390×664 (DPR 3), 430×932, 568×320, 667×375, 844×390, 932×430, 768×1024, and a 1440×900 desktop viewport. Phone/tablet safe insets are listed in the JSON. Desktop retains the headless SDL auto mode (800×600 drawing buffer) and aspect-preserving CSS fit. Separate iframe layout tests deliberately block the engine; they are supplemental geometry checks.

CDP touch contacts are browser-dispatched `isTrusted` TouchEvents and exercise actual hit testing and simultaneous ownership. Native `viewpos` output demonstrates translation and turning; live ammo decreases during held fire and stops after release. Blur is injected as a browser event, not a physical OS app switch. Fixed-size runs reject fullscreen to avoid headless display dimensions replacing the requested viewport. The existing fallback tests also cover fullscreen/orientation rejection.

This is desktop Chromium with SwiftShader, not Android hardware or Safari/iOS. CSS safe insets are injected fixtures, not measurements from a notch or home indicator. No claims are made about physical comfort, OS edge gestures, browser toolbar behavior, GPU FPS, thermal behavior, audio, battery or actual phone memory. Physical Android and iOS testing remains necessary before release.

## Changed files

| File | Change |
| --- | --- |
| [`index.html`](../index.html) | Live mobile HUD/crosshair, safe layout, explicit fire, secondary controls, pause/cleanup, renderer resizing. Existing download/start functions are unchanged from d944fa2. |
| [`mobile-runtime.js`](../mobile-runtime.js) | Public game API v3 adapter for live stats and queued native commands. |
| [`index.js`](../index.js) | Two documented integration hooks; otherwise byte-identical to d944fa2. |
| [`tests/touch.test.cjs`](../tests/touch.test.cjs) | Explicit-fire, ownership, secondary actions, inactive/paused state, cancellation and joystick-edge regressions. |
| [`tests/mobile-runtime.test.cjs`](../tests/mobile-runtime.test.cjs) | Heap/ABI/live-value, generated SDL hook, resize and dynamic-height regressions. |
| [`tests/mobile-fallback.test.cjs`](../tests/mobile-fallback.test.cjs) | Read failures, missing/invalid stats, native restoration and restoration failure, recovery, and pause/resume command acceptance. |
| [`tests/helpers/browser.cjs`](../tests/helpers/browser.cjs) | Load the adapter and supply geometry for offline tests. |
| [`tests/responsive.html`](../tests/responsive.html) | HUD legibility, safe bounds and action-overlap checks in real browser layout. |
| [`tests/helpers/cdp.cjs`](../tests/helpers/cdp.cjs), [`tests/mobile-browser.cjs`](../tests/mobile-browser.cjs) | Dependency-free real-game CDP runner, native observations and screenshots. |
| [`README.md`](../README.md), this file | Controls, reproduction instructions, evidence, integration details and limitations. |
| [`evidence/mobile-ux`](../evidence/mobile-ux) | Final results, native input observations, test logs and real-game screenshots. |
