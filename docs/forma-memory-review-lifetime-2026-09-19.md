# Manual private Memory review lifetimes

Implemented locally; no production activation or enrollment.

Manual derived-result review and correction/control pages now use the existing
monotonic-plus-wall-clock lifetime primitive, bounded by their original native
read deadline and at most 60 seconds. Clock rollback, invalid clocks, elapsed
monotonic time or wall-time expiry permanently retire that presentation. Moving
the clock back to its prior value does not restore it.

The deadline timer also owns in-flight metadata/result/control GETs, so a stalled
body is cancelled within the bounded read lifetime. Timed-out reads are not
reported as uncertain writes. Correct/suppress/export actions require the exact
current presentation. Control release also retains the exact current control
page during dispatch; stale release callbacks cannot act after retirement.
Clearing control pages clears private correction text and pagination together.

This is a client privacy boundary, not a revocation guarantee while disconnected.
Every native read and mutation still requires its existing server proof. An
already dispatched mutation that loses its presentation authority remains an
uncertain outcome; it is not retried automatically. No source lifetime or consent
is renewed.

## Verification

636 selected client/component checks pass, including new irreversible rollback,
monotonic-only expiry, wall-only expiry, invalid-clock, private-correction removal,
stale release and stalled-body cancellation cases. All 8 synthetic whole-app
browser regressions pass, including real local result downloads. Full TypeScript,
changed-file lint, production build and whitespace checks pass; existing bundle
size warnings remain. No provider, live data, hosted scheduling or deployment was
used. This closes the privacy follow-up in the result-export slice, not the
remaining broader native Memory plan.
