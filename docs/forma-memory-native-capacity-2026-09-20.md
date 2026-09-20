# Native Memory capacity and response bounds — 2026-09-20

Status: implemented and locally verified on the Memory branch. No production changes, real provider calls or enrollment.

## Implementation

- Approved specialist execution continues the same process-local source compilation into its deferred driver only within the original monotonic lease. It rereads retained consent and validates the actor and exact binding. Every dispatch/publication still runs current SQL source, target, hierarchy, permission and negative-ancestry assertions. Expiry independently reconstructs evidence; rollback, withdrawal and drift fail closed. No access decision or serialized capability is cached.
- Native derivation read admission batches job, reference and actor-specific grant/parent/qualification metadata in one database snapshot. It explicitly checks the grant identity against the captured job and retains all final exact-row predicates. Missing, malformed or changed acknowledgements deny issuance before loading original bodies.
- Shared-project synchronization executes its four existing catalog, negative-provenance and manifest queries in two read-only snapshots. The independent integrity query still runs when no migration row exists. Malformed acknowledgements, schema drift and restored derived bodies cannot trigger an unqualified rebuild or scope write. Existing write-transaction bookends remain unchanged.
- Specialist provider response reading is bounded incrementally at 256 KiB with strict UTF-8 decoding and explicit cancellation. It no longer buffers an arbitrary response before checking its size. Provider fetch and response reading have a deadline of at most 60 seconds, shortened to the existing execution/access deadline. An interrupted response remains an uncertain paid operation: no invented usage, automatic retry or private result publication.

## Measured limits

These are synthetic native binding round trips, **not a hosted D1 quota or SQL-statement-count certificate**. The deferred driver begins before the HTTP response finishes, so execution and background phase counts must be added for the stable invocation interval.

| Journey | Earlier personal/shared | Current personal/shared |
| --- | --- | --- |
| Quote | 51 / 57 | 50 / 54 |
| Approved execution including deferred work | 153 / 170 | 132 / 142 |
| Retrieve | 40 / 40 | 39 / 39 |

Regression ceilings now protect these improvements. The conservative 50-call target is **not satisfied** by shared quotes or approved execution. This checkpoint does not close native request-capacity work or substitute for hosted capacity, latency and failure-recovery qualification.

## Verification

- Broad native Memory regression run: 626/626 pass across derivation, consent, privacy, original histories, finance, semantic recall and follow-up. This run preceded the final response-stream bounds; those changes have separate targeted evidence below.
- Final shared-project/output and actual isolated workerd/D1 tests: 45/45 pass, including partial acknowledgements, database substitution, schema races, rollback and negative-provenance restoration.
- Final combined semantic D1, handoff, original/follow-up retirement, metadata and Chat guidance tests: 51/51 pass.
- Provider-reader tests: 15/15 pass, including exact byte ceiling, overflow without draining, split multibyte text, malformed/truncated UTF-8, abort and BOM preservation.
- Runtime response-bound failures: 4/4 pass, including stalled headers and body; one dispatch, no private derived output and no retry or accounting rewrite.
- Quote/execution/retrieval regression ceilings: 4/4 pass. Personal/shared delayed dispatch has 16/16 additional source/consent/permission/schema/clock tests.
- TypeScript, changed-worker/test lint and production build pass; existing large-chunk build warnings remain. The large existing runtime test file still has pre-existing lint findings outside these changes.

Actual providers are mocked, D1 data is isolated and synthetic, and no hosted scheduling, deployment, budget changes or service provisioning took place. The [full native completion matrix](forma-memory-completion-matrix-2026-09-20.md) and [external capability To Do](forma-memory-sites-capability-todo-2026-09-18.md) remain authoritative.

## Incoming control-message bounds

Specialist quote/execute/retrieve/resume now use the same strict native Memory
control parser before any approval or purchase work. It caps bytes while reading,
rejects duplicate/escaped keys, invalid UTF-8, BOMs and non-object JSON, and never
accepts drafts through this control route. The shared parser also cancels on
request abort or its 30-second upload deadline. Cancellation is not awaited, so a
stalled producer cancellation hook cannot keep the handler open. Declared excess
length is rejected before pulling body bytes.

Nineteen focused native/parser/structured-history checks pass, including two
actual specialist upload-abort/deadline cases with unchanged financial state and
zero new executions or provider calls. The earlier 27-case quote/dispatch/control
regression also passes. TypeScript, changed source/host-test lint and the
production build pass; existing chunk-size warnings remain. No runtime deadline
is a substitute for separate hosted qualification.
