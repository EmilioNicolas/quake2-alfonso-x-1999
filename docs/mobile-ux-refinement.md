# Compact mobile HUD and controls — 8397b51 refinement

Implemented in `/tmp/quake-mobile-20260910-1110`, starting from a clean `8397b51dcb434f4c6e39a421864b56f294050dc6`. HEAD is preserved; no commit, push or publication. No other repository or global configuration was changed. Repository instructions, README, previous review, tests, deployment workflow, page, adapter and relevant generated-runtime/package metadata were inspected first; no AGENTS.md was present in the repository or its ancestors.

The supplied `input-46587dff-7f69-465f-acfe-3af7237341da.jpg` was available and visually inspected at the requested inbound path. It shows the broad HUD, duplicate fire targets, unlabeled arrows and JUMP described in the request.

## Result

- Only the right fire button remains, labeled **DISPARAR** with a small reticle icon. Its visible circle is 72 px across inside an 88 × 88 px rectangular touch target. All action targets are at least 48 × 48 px; their smaller inset faces have subdued dark metal/brass colors and explicit pressed feedback. The transparent padding belongs to the button.
- Three separated, angular HUD instruments replace the large shared rectangle: maximum 240 × 44 px instead of 348 × 55 px, approximately 45% less bounding area at the maximum width. Numbers remain 24 px, labels 10 px, with tabular figures and a distinct low-health background/accent. Live values, infinite blaster ammo, native HUD fallback and crosshair behavior are preserved.
- The weapon controls now have a visible **ARMAS** group label and **ANT. / SIG.** buttons, with full Spanish accessible names. **AGACHAR**, **USAR** and **SALTAR** explain the remaining actions. Landing and pause instructions match those names.
- The left floating joystick, right relative aiming, per-finger ownership, five simultaneous actions, cancellation and pause handling remain. A single held-fire boolean now supplies the mouse-move button mask; the existing per-button finger set releases attack only when its final finger ends/cancels. Touch zones begin at 60 px to reclaim space below the smaller HUD. Safe-area positioning and native desktop input/rendering are retained.

These dimensions were subsequently verified in the supervisor browser run described below.

## What the arrows actually did

The previous arrows were weapon cycling, not turning, strafing or inventory navigation. The complete local code path is:

1. [`index.html`](../index.html) binds `weaponPrev` to `KeyR` and `weaponNext` to `KeyF`, and `sendKey` dispatches those keyboard events to the canvas.
2. The generated [`index.js`](../index.js) package manifest places `/baseq2/config.cfg` at bytes `[0, 1181)` of [`index.data`](../index.data).
3. That actual packaged configuration contains:

   ```cfg
   bind r "weapprev"
   bind f "weapnext"
   bind e "invuse"
   ```

Both weapon directions still use those exact bindings, covering all owned weapons. USAR still activates the selected inventory item. [`tests/touch.test.cjs`](../tests/touch.test.cjs) now extracts the config using the generated manifest offsets and verifies the packaged commands together with the actual button keydown/keyup events. The extracted local evidence is in [controls-bindings.txt](../evidence/mobile-ux-refinement/controls-bindings.txt).

## Verification performed

Node.js **24.15.0**. The untouched baseline passed **122/122** tests before editing. The final implementation passes **125/125**:

```sh
node --test --test-isolation=none --test-reporter=spec tests/*.test.cjs
```

The complete [test log](../evidence/mobile-ux-refinement/unit-tests.txt) covers every suite: `desktop`, `loading`, `loading-feedback`, `loading-memory`, `loading-robustness`, `mobile-fallback`, `mobile-runtime`, `responsive`, and `touch`. Added regressions cover removal of the left fire target, packaged weapon/inventory bindings, and the relative mouse button mask while multiple fingers hold/release the right fire button. Existing tests cover five simultaneous actions, stale contacts, no fire from aiming, resize/orientation/background cleanup, pause failures, HUD fallback, live-stat ABI, dynamic viewport, loading and desktop pointer capture.

JavaScript syntax checks cover the browser runner, both HTML inline scripts, and the runtime/adapter. `git diff --check` passes. Generated runtime, data and all WASM binaries remain byte-identical to HEAD. See [source-state.json](../evidence/mobile-ux-refinement/source-state.json) and [static-checks.txt](../evidence/mobile-ux-refinement/static-checks.txt).

## Worker browser limitation (resolved by supervisor)

**The worker could not produce gameplay screenshots in its sandbox. The supervisor subsequently completed the full matrix successfully, as recorded below.** The local server failed when creating its socket (`PermissionError: [Errno 1] Operation not permitted`). Installed Chrome for Testing **151.0.7922.34**, launched with a fresh temporary profile, failed at `setsockopt: Operation not permitted`. Running the CDP test runner also failed connecting to `127.0.0.1:9476` with `EPERM`. The managed environment does not permit requesting elevated execution, so no permission prompt or configuration change was made.

The [setup log](../evidence/mobile-ux-refinement/browser-setup.txt), [runner log](../evidence/mobile-ux-refinement/browser-tests.txt) and [machine-readable result](../evidence/mobile-ux-refinement/results.json) record that setup failure; it is not a gameplay-test failure or a successful browser run. Existing PNGs under `evidence/mobile-ux` are unchanged historical evidence of the older interface. They are not screenshots of this implementation.

The updated runner is prepared to verify real WASM/WebGL gameplay at **320×568, 390×664 (DPR 3), 430×932, 568×320, 667×375, 844×390, 932×430, 768×1024 and desktop 1440×900**, including simulated safe insets, spawn/low-health/pause/multitouch screenshots. It now resolves button positions from the DOM and checks the single fire action, Spanish labels, compact HUD, transparent touch margins, former left-fire movement area and the existing engine/input assertions. The supplemental iframe runner checks eight browser layouts with the engine blocked. These additions were subsequently executed successfully by the supervisor.

On an environment that permits local sockets, start an isolated server and browser in separate terminals:

```sh
python3 -m http.server 8876 --bind 127.0.0.1
chromium --headless --remote-debugging-port=9476 --user-data-dir=/tmp/quake-mobile-refinement-review --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader about:blank
```

Then run, writing browser evidence to a new directory:

```sh
CDP_PORT=9476 GAME_URL=http://127.0.0.1:8876/ EVIDENCE_DIR=evidence/mobile-ux-refinement-browser node tests/mobile-browser.cjs
```

The CDN download is approximately 188 MB. The previous container run required Chrome's `--no-sandbox --disable-dev-shm-usage` flags. Even a successful CDP run would still be desktop Chromium touch emulation with software WebGL and injected safe insets; physical Android/Safari, notch handling, comfort, audio and phone performance remain unmeasured.

## Changed files

| File | Change |
| --- | --- |
| [`index.html`](../index.html) | Compact HUD/control styling, Spanish labels, single right fire input and matching help. |
| [`tests/touch.test.cjs`](../tests/touch.test.cjs) | Adapted single-fire tests and three additional behavioral regressions. |
| [`tests/mobile-browser.cjs`](../tests/mobile-browser.cjs) | DOM-based button contacts, new hit-target/label/left-area regressions; original gameplay matrix retained. |
| [`tests/responsive.html`](../tests/responsive.html) | Compact geometry, minimum 48 px targets, transparent margins and Spanish-label checks. |
| [`README.md`](../README.md) | Current controls, dimensions and honest validation status. |
| [`docs/mobile-ux-review.md`](mobile-ux-review.md) | Marks the prior review/screenshots as historical. |
| This report | Implementation, arrow evidence, complete validation and limits. |
| [`evidence/mobile-ux-refinement`](../evidence/mobile-ux-refinement) | Test/setup logs, failed browser setup result, bindings and source hashes; no PNGs. |

## Final supervisor verification, 10 September 2026

The supervisor ran the unchanged final implementation and browser runner in an isolated Chromium process with local networking. **19/19 checks passed**, including eight mobile gameplay viewports, simultaneous movement/look/fire, native weapon cycling, jump/crouch, transparent fire target padding, cancellation, rotation, resizing, desktop pointer capture/keyboard/mouse and the aggregate **8/8 layout matrix**. Offline tests were independently rerun: **125/125 passed**.

Evidence: [results](../evidence/mobile-ux-director/results.json), [browser log](../evidence/mobile-ux-director/browser-tests.txt), [unit log](../evidence/mobile-ux-director/unit-tests.txt). New real-game screenshots: [landscape](../evidence/mobile-ux-director/game-844x390.png), [narrow portrait](../evidence/mobile-ux-director/game-320x568.png), [desktop](../evidence/mobile-ux-director/desktop-1440x900.png). The supervisor visually inspected landscape and narrow portrait captures; no overlapping actions or clipped labels were observed.

Physical Android/iOS, Safari, actual safe-area hardware reports, comfort and mobile GPU performance remain unverified. The worker exited; no global model configuration or other repository was changed.
