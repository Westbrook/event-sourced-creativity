# Durable generation foundation verification — September 17, 2026

Candidate branch: `codex/durable-generation-foundations`.
Base: `f539d35a9d1e5a7402c1f81ae83a4169c9dcd950` (production 378).
Workspace: `/Users/westbrook/Documents/repos/codex/.wrangler/durable-generation-foundations`.
The sole publisher subsequently released unrelated sponsor intake as production 379, `ba3c10ce034bf33383c90f24e9840ad838afcc6d`. Its changed paths do not overlap this candidate; integration/release checks still belong to the publisher.

## Results

- **219 selected test executions passed; zero failures, skips or cancellations.** Real local SQLite transactions and actual native admission/runner/recovery code use synthetic provider transports only.
- TypeScript `--noEmit` passed.
- Existing production build passed, including custom-element manifest generation and localization audit (6,311 system phrases, 4,515 English messages, 1,957 referenced message IDs, 25 block types, three translated locales and three marketing audiences). Existing large-bundle advisory remains.
- ESLint passed for the 18 other changed TypeScript/test files. `worker/output-requirements-api.ts` retains exactly six unused-symbol findings reproduced from the unchanged `f539d35a` version: `OutputRequirementsSnapshot`, `hasCapability`, `streamHead`, `readOutputSlots`, `readAssets`, `readGrants`. Whole-project lint is not claimed clean.
- Source/document whitespace checks passed. The final committed diff also contains two whitespace warnings in preserved raw evidence: a blank final line in `verification/durable-foundations-2026-09-17/baseline-lint.txt` and Vite trailing whitespace in `build.txt`. Historical evidence bytes are retained; the full committed diff is not whitespace-clean.
- Independent read-only backend/client reviews found and verified fixes for stale worker fencing, native correlation/slot identity, cold schema readiness, exact Run anchoring, retention races, malformed marker privacy, accepted-ID retry classification, duplicate publication, lost acknowledgement/timeout reattachment, and notification routing. Final review reported no blocking findings. Independent elapsed-time tests cover a 350-second Image host timeout and 1,010-second 3D timeout followed by fresh bounded GET observation.
- No non-test caller constructs a runtime or installs the dormant schema. No production entrypoint, hosting manifest, environment, migration journal, audience, provider credential or live financial hold was changed.

## Selected test command

```sh
node --experimental-transform-types \
  --import ./tests/helpers/register-output-source-imports.mjs --test \
  tests/output-durable-generation.test.mjs \
  tests/output-durable-client.test.mjs \
  tests/native-image-store-policy.test.mjs \
  tests/experience-output-binding-client.test.ts \
  tests/experience-story-host.test.mjs \
  tests/output-native-execution.test.mjs \
  tests/output-native-retention-boundaries.test.mjs \
  tests/experience-output-dispatch.test.mjs \
  tests/experience-host-recovery.test.ts \
  tests/experience-result-lifetime-host.test.mjs \
  tests/output-requirements-ledger.test.mjs
node_modules/.bin/tsc --noEmit
npm run build
```

The Store fixture imports TypeScript with parameter properties and requires transform-types. The original-owner qualification suite `experience-output-originals.test.mjs` requires a separately reviewed explicit source manifest; it was not included or represented as passing. Initial exploratory runs exposed that prerequisite and three stale Story host source-extraction boundaries. The latter were repaired to exercise the actual current branches/selectors without weakening assertions; their tests now pass.

## New boundaries exercised

- Authorization creates no outbox. Explicit Run records outbox/marker/command atomically; an insertion failure rolls back the Run event and queued slot.
- Lost delivery hint is swept; a native slideshow runs once without a browser runner. Duplicate delivery does not add calls or settlement.
- A current lease excludes a second consumer. An obsolete lease cannot mutate job state. A faulty execution port cannot claim ready for an uncompleted job.
- Unknown paid acknowledgement retains exposure and never redispatches the planner. Source change after Run produces zero provider transmissions.
- Genuine FAL Image admission persists the accepted request, tolerates a transient original-ID GET error, observes pending, retrieves and validates PNG bytes, publishes once and settles once. Only one planner request and one FAL POST occur; duplicate completion delivery performs no network work.
- A committed completion with unfinished job bookkeeping produces explicit uncertainty without duplicate usage/media/publication.
- Erasure injected immediately before stale-attempt closure is not overwritten. Malformed legacy ownership markers become a source-free integer marker. Public generic admission cannot forge the reserved field even without a durable runtime/schema.
- Ordinary browser Run/recovery refuses enrolled jobs after runtime removal. Notification ACK remains available. Drain-only enrollment policy refuses new Run atomically, without falling back to legacy execution.
- Store excludes durable jobs before selecting a legacy runner, blocks ordinary Stop/recovery/retry, and rejects a stale unmarked argument when the current cache knows ownership.
- Actual host methods schedule GET after an unavailable Run acknowledgment and an expired original wait, survive a pre-commit authorized read or transient unavailable read, pin exact identity, and stop on true retirement. Known retaining/uncertain phases are displayed. Decoder rejects unknown phases/fields and any ordinary paid permission on a durable original.

## Evidence limits and next action

These controls are not real browser BFCache/physical-device tests, hosted D1/R2 concurrency, live provider/invoice evidence or a durable platform certification. No new playback/download journey or production deployment was performed. The whole feature remains unactivated.

Use `durable-generation-activation-2026-09-17.md` and the exact candidate SQL under `activation-candidates/` for the runtime, migration, route qualification, fault matrix, service authentication, operational alerts and rollback checklist. In particular, committed-completion reconciliation and other output-specific crash adoption remain explicit implementation/qualification work; they are not hidden behind a passing build.

## Final release follow-up

The final backend audit found an unbounded sequential advisory wake in `sweep()`. Run and sweep now share a one-second delivery-hint bound, and sweep hints run concurrently. A two-job genuine Image-admission fixture verifies that hung Run notifications return, a healthy later sweep notification proceeds while the first hangs, the sweep reports only timely successes, due rows stay unchanged, late failures are handled, and a later sweep can hint both jobs. No provider transport is invoked by this regression.

The focused core/client command above, restricted to `output-durable-generation.test.mjs` and `output-durable-client.test.mjs`, passed **26 tests** after this fix. TypeScript and lint on all three changed code/test files passed. The prior 219-test evidence and source hash manifest describe the original candidate, not this successor. Independent final client and backend reviews approve dormant deployment with no remaining scoped findings; the backend reviewer separately reran the hanging-hint regression successfully. The publisher separately reruns canonical integration checks before releasing the exact successor. Runtime activation and the documented qualification gates remain outside this disabled release.
