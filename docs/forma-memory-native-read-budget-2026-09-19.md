# Native Memory inspection request budgets

Continuation of [rolling history](forma-memory-rolling-history-2026-09-19.md).
This is a local implementation/qualification record, not hosted quota approval.

## Measured issue and implementation

Whole authenticated inspection of three retained original windows initially
needed 68 D1 binding calls. The repository's conservative per-request gate is
strictly below 50, so passing per-function checks was insufficient.

The native reader now:

- Issues read-only same-consent lookback from a genuine existing native handle.
  It retains that handle's exact authority, schema, enrollment, grant and
  qualification assertions, adds the earlier job/reference assertions, and uses
  the earlier deadline. It cannot read a different consent, future window or
  organization, manufacture execution authority, or renew a clock.
- Reuses already proven schema feature flags only with their original native
  schema assertion. No process-global schema or principal cache is introduced.
- Batches independent reference/size and message/paid-size reads. Every original
  snapshot is retained; body-size validation still precedes body hydration.
- Qualifies the three closed turn-exclusion aliases from one native schema
  snapshot. A process-local opaque handle allows source and paid-ancestry checks
  to reuse it; copied/cross-environment handles fail. SQL still checks the exact
  schema and all current negative-origin markers at every consuming boundary.

## Results and limits

Synthetic whole-handler measurements, including authentication and final native
proof replay, are **45 D1 binding calls for free originals** and **48 for paid
originals**, in both personal and shared scopes, for the tested three-window
history. No provider call is made by inspection. These are tested cases, not a
claim about every artifact-heavy path or hosted platform limits.

SQLite privacy/race tests and local D1 cover original replacement between
measurement and hydration, current source erasure, schema changes, recalled
access loss, forged snapshots and read-to-spend refusal. Local D1 also exercises
three-window paid ancestry and downstream erasure. Typecheck/lint/build and the
expanded affected regression are recorded in the continuation handoff.

The existing Output whole-HTTP suite still has eight unrelated baseline failures
at its strict <50 gate; they were rerun, not waived. Hosted qualification,
external index/scheduling services, individual enrollment and the broader native
scope/producer/automatic-consumer/index work remain separately tracked.
