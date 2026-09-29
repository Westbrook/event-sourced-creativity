# Memory consumer conversation lifecycle

Implemented on the Memory branch; not deployed or enrolled.

## Behavior

Additive migration `0062_memory_derivation_consumer_sources` records immutable
references to every original turn included in a Memory-assisted specialist
request. It stores no copied conversation prose. Native quote publication seeds
and checks this inventory in the same transaction as the private approval and
consumer origin.

Changing, deleting, or expiring a referenced private input, deleting/rebinding a
referenced turn, or changing/deleting a registered generated copy retires the
consumer and redacts its remaining private copies. Original identities and
negative ancestry remain immutable; accounting is not erased, refunded, or reset.
Unchanged input writes and unrelated erasure do not retire a consumer. An input
erased during provider dispatch still permits recording actual verified usage,
but does not permit retaining the provider response.

Readers check the complete registered conversation against its retained consent,
current turn pointers and private content. The bounded source-free sweeper also
retires origins whose inputs/copies expire naturally or become unavailable.
Pre-upgrade consumer origins have no new source registration: they fail closed
and are retired by the sweeper. The migration does not invent/backfill authority,
rewrite billing, or modify existing rows. Qualify that transition before rollout.

## Native request limits

Shared multi-turn journeys exposed real D1 limits: 100 bindings per statement and
100 levels of SQL expression depth. Quote, reservation, dispatch readiness and
result publication now keep the complete assertions in the same atomic
transaction while separating oversized statements. Budget admission uses its
existing native assertion facility. This does not cache an authorization result
or relax source, custody, accounting, consent, or once-only dispatch checks.

## Verification

- 94 migration tests: installed migrator, snapshot/ORM agreement, additive replay,
  unchanged earlier SQL/history and preservation of existing data.
- 22 original-conversation lifecycle tests, including six isolated D1 cases with
  the full three-turn conversation window in personal/shared scopes.
- 23 semantic-consumer/D1 regression cases and 255 affected finance, specialist,
  saved-context and semantic runtime checks during integration.
- TypeScript, changed production-file lint and production build pass. Existing
  bundle-size warnings remain. Tests use synthetic data and mocked provider
  responses; no API expenditure, enrollment or production mutation occurred.

## Still on the implementation plan

This closes original-conversation erasure for this consumer, not downstream
semantic follow-up history, autocomplete edits, generated artifacts/indexes or
all resource coverage. Whole-invocation capacity qualification also remains
separate from the per-statement limits fixed here. Continue using the
[complete implementation matrix](forma-memory-completion-matrix-2026-09-20.md).
External/operational work stays in the [Sites capability checklist](forma-memory-sites-capability-todo-2026-09-18.md).

## Request-local continuation and exact receipt recovery

Post-provider publication can reuse compiled native source predicates only inside
the original wall/monotonic lease and on the same DB/actor. Every disclosure and
write still replays the complete native SQL assertions. Expired leases independently
rehydrate; clock rollback/nonfinite time denies publication without discarding
verified provider usage. Budget counter initialization now shares the existing
atomic reservation path.

Receipt recovery requires the same durable provider receipt ID as well as exact
token/cost totals. Equal-cost conflicting receipts cannot become canonical results
in specialist, adaptive, or context-intelligence recovery.

Measured personal/shared synthetic binding calls: quote 52/58; execution HTTP
58/62; background 95/108 (previously 132/150); retrieval 40/40. These measurements
do **not** pass the conservative under-50 whole-invocation capacity gate and do
not qualify hosted limits.

Verification: 262 affected finance/specialist/semantic/lifecycle checks; 49 targeted
receipt/consent/lease checks; all five clock/lease fault cases; the conflicting
receipt integration case; and 219 adaptive runtime checks pass. TypeScript,
changed-production-file lint, and the production build pass. Synthetic data only.
