# Tap-to-fire release

A release in the right look area fires one 50 ms attack pulse only when duration is at most 220 ms and maximum excursion at most 8 CSS pixels. Dragging, out-and-back movement and coalesced excursions reject the tap. Left joystick and UI do not request tap shots. DISPARAR retains held fire; a tap during held fire neither interrupts nor extends it.

Pointer capture owns contacts; capture failure rejects the contact. Pointer cancellation, lost capture, pause and lifecycle resets discard candidates and clear pulses. Touch-only fallback retains original Touch.target ownership. Event timestamps preserve actual gesture duration under queued delivery. Desktop mouse behavior is unchanged.

## Evidence and limits

* Astra xhigh code review fixed fallback multi-contact ownership and queued timestamp handling; 11 regressions failed before fixes. No remaining actionable issue found (evidence/tap-release/worker-review.txt).
* 232/232 deterministic unit tests pass, including tap thresholds, drag/out-back, pointercancel/lost capture, pause/blur/background, concurrent joystick/held fire, duplicate streams, desktop and live HUD. These use simulated DOM, not a real phone.
* Native Chromium/SwiftShader Quake II gameplay: trusted 80 ms tap consumed exactly one Machinegun round (200 to 199). Trusted overlapping joystick+tap also passed movement, one-round and release assertions. Preserved raw positive traces in evidence/tap-release.
* Full native browser suite is NOT green: CDP intermittently delivered no trusted contacts on subsequent drag/cancel cases. Alternative harness attempts also failed setup or capture acquisition. These failures were not converted to passing assertions and do not establish product defects. Native drag/cancel validation remains incomplete; release relies on deterministic handler coverage plus code review for those paths.
* No physical Android/iOS/Safari or hardware capture, ergonomics, audio/performance validation. No claim of comprehensive native mobile QA.

Run: `node --test --test-isolation=none tests/*.test.cjs` (Node 24).
