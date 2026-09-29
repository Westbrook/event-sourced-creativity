# Memory control uploads and recovery — 2026-09-20

## Delivered scope

All inspected Memory mutation-body readers now share the dependency-free native
control parser. This covers live enrollment/Forget, derivation grants/results/user
controls, saved Assistant context, recall boundaries, document-profile controls,
and project containment; specialist controls retain their existing wrapper.

- A 30-second upload deadline and request abort both stop reading; an uncooperative
  stream cancellation promise cannot keep the handler pending.
- Existing 2/4/16 KiB endpoint bounds remain unchanged. Declared oversized bodies
  are rejected without reading; a declared/actual byte-count mismatch is invalid.
- Fatal UTF-8 decoding, BOM rejection, duplicate/escaped-key rejection, a five-level
  nesting bound and object-only commands prevent ambiguous request interpretation.
- Document-profile and live-Memory routes preserve their existing oversized-body
  error contracts. No enrollment, permissions, background behavior or UI is added.

Consequential financial recovery now selects stopped/verified work using one
actor-bound metadata query instead of three no-op calls on reserved/settled
executions. Selection is bounded to 64 work rows and rejects malformed or
inconsistent receipts before mutation. Existing owner/state/usage-checked ledger
settlement and uncertain-submission holds remain in force. Recovery does not
retry providers, invent usage or change budget caps.

## Verification

Synthetic fixtures only; no real users, provider calls, charges or scheduling.

- 94 recovery, consent-race, semantic-consumer, edit-review and upload tests,
  including isolated D1 privacy/recovery journeys.
- 41 final-source recovery/consent-race checks after the explicit non-null step-index
  type narrowing (overlaps the 94-test run).
- 51 original-backed history/profile and automatic-brief tests.
- 59 native Memory and reconciliation regressions (overlaps the above).
- 1,170 client/host/control and containment tests, including all 26 containment
  tests. Counts are suite counts, not a deduplicated grand total.
- TypeScript, changed-source/test lint and production build pass. Existing build
  chunk-size warnings remain. No new browser test is claimed for this backend-only
  change. The runtime test file's existing whole-file lint baseline is not waived.

Measured synthetic personal/shared database binding calls:

| Operation | Before | After |
| --- | --- | --- |
| Quote | 50 / 54 | 50 / 54 |
| Combined approved execution, including waitUntil | 132 / 142 | 126 / 136 |
| Retrieve | 39 / 39 | 37 / 37 |

These are regression measurements, not hosted capacity qualification. The complete
execution **still exceeds the conservative 50-call target**. It is not acceptable
to describe this improvement as satisfying the capacity gate.

An initial non-escalated local-D1 run stalled at the loopback boundary and was
stopped. The equivalent permitted isolated-D1 run passed; the stalled log is not
passing evidence. The first new upload test run exposed a test-only SQLite row
prototype comparison mismatch; normalizing the comparison fixed it and the final
run passed without changing production behavior.

## Still required

The [completion matrix](forma-memory-completion-matrix-2026-09-20.md) remains the
scope of this task. No end-to-end native workstream is closed by these fixes.
Accepted creative edits/output ancestry, exact-field autocomplete, semantic
profile consolidation/supersession, Library/Canvas/cross-owner coverage and their
remaining lifecycle/capacity qualification remain implementation tasks.

The profile audit confirms that the native provider and retained-result reader
still pass an empty prior-item list: parser support alone is not connected
consolidation. This turn did not change that behavior or add a new recipe.
External service qualification, owner integration, deployment and affirmative
user enrollment remain separate in the existing Sites capability To Do. No
migration, main merge, push or production deployment occurred.
