# Independently authorized profile context — 2026-09-21

Local implementation, not deployment or enrollment.

## Implemented

A saved assistant context can retain its selected note plus at most two profile
results from distinct independently enrolled documents. Each source is freshly
checked for the same actor, compatible custody, its own recall range, current
hierarchy, exact result/hash, original evidence, controls and retention. A source
pointer grants no access. The shortest source lifetime bounds the whole context.

The actual specialist and embedded guidance prompts receive the additional
profile interpretations with their native scope/relevance weights. They remain
unverified interpretations, not independent observations or new proof of a
preference. Current instructions/document facts win; repeated/copied citations
must not count as corroboration. This is bounded multi-source consumption, not
a fabricated semantic-equivalence score or automatic overwrite of corrections.

The existing localized profile controls offer an explicit **Add to current
assistant context** action. The assistant displays each additional source and
allows removal. Replacing the main note clears the extra selections. Selection
sends identifiers only; it does not invoke a provider or spend allowance.
Concurrent/stale changes use the same native compare-and-swap revision. An
uncertain acknowledgement is not retried automatically.

## Durable privacy and schema

Additive migration `0068_memory_derivation_profile_contexts.sql` stores references,
not private prose. It enforces distinct/bounded sources and source/target tuples.
Source retirement, correction, expiry, scope changes, forgetting, dismissal or
replacement retire the entire private context and downstream private copies.
Existing negative consumer ancestry survives body restoration. Authored accepted
work is not erased by withdrawal. Approved execution bindings retain the exact
profile job set; dropping the optional extension cannot reinterpret an old
approval as a single-source request.

Source-free control metadata remains available without Memory being enabled.
Both positive derivation reads and the ordinary negative-content boundary
qualify the complete extension fingerprint. No runtime DDL, backfill, provider
work, scheduler registration or real-user enrollment was added.

Missing Drizzle snapshots at journal positions63–65 were also restored, followed
by position66 for0068. They come from the installed Drizzle generator and the
actual journaled table sets; the published SQL, timestamps and snapshots through
position62 are unchanged. Snapshots are source metadata, not migration receipts.

## Local verification

- 30 new native aggregate checks; the adjacent integrated run passes96 checks.
- Personal/shared isolated D1: actual quote, approved one-call synthetic provider
  execution, retrieval, withdrawal and restored-body denial. Two-source quote
  calls59/60, execution68/69 and retrieval52/50. Three-source quote calls68/69.
- 90 strict client/component checks, including explicit identifier-only selection,
  bounds, malformed authority, immediate removal, blur, expiry and late results.
- Four real whole-app browser journeys pass in English and Arabic (320px), with
  escaped source text, no horizontal overflow and no unconfirmed-write retries.
- 102 migration-history checks pass after snapshot restoration. Production build,
  typecheck and changed-source lint are checked in the continuation evidence.

These synthetic measurements are not hosted capacity, provider or pricing
qualification. Aggregate execution still exceeds the earlier conservative
50-binding-call target; reducing this while preserving independent proofs stays
assigned. Full regression for preceding commit `b2c72f14` passes2564/2564 and does
not include this extension.

## Remaining native and operational work

The [completion matrix](forma-memory-completion-matrix-2026-09-20.md) still owns
aggregate capacity/freshness, broader semantic consolidation/resource consumers,
and direct private creative Output/live-preview integration. This checkpoint
closes the bounded multi-source assistant integration, not the whole plan.

Production-owner review must include0068 and the recovered snapshot chain.
Qualified hosted scheduling, supported remote embedding/index transport, real
recipe/pricing/retention checks, deployment and affirmative enrollment remain in
the [separate capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

## Request-local read multiplexing

Aggregate source capture now coalesces independent native reads without caching
rows, permissions, schema qualification or positive source decisions. Every
original query still executes; every source's native predicates still replay
atomically at writes and disclosure. Caller batches remain indivisible, with
256-statement and 100-binding limits. Partial, failed, malformed, expired,
database-replaced or throwing-authority responses fail the whole capture. Each
caller owns its returned rows. No single-source behavior changes.

28 unit and98 integrated native checks pass, including real local D1 maximum
three-source execution and non-resurrection. TypeScript, scoped lint and the
Sites production build pass (existing chunk-size warnings only). These are
synthetic/local measurements, not hosted qualification:

| Sources | Partition | Quote calls | Execution calls | Retrieve calls | Execution elapsed |
| --- | --- | ---: | ---: | ---: | ---: |
| 2 | personal | 54 | 63 | 47 | 2.08 s |
| 2 | shared | 55 | 64 | 45 | 2.07 s |
| 3 | personal | 56 | 65 | 50 | 2.50 s |
| 3 | shared | 57 | 66 | 48 | 2.56 s |

The aggregate execution still exceeds the previous conservative50-call local
target. That target is not silently waived or described as a verified Sites
limit. The separate full run of preceding commit a2523f8b does not qualify this
subsequent batching change. No deployment, migration, enrollment or provider call.

### Final full-suite receipt and stalled-read deadline

The immutable a2523f8b native runtime snapshot passes2,594/2,594 tests with
zero failures in1,495,773.923417ms. It precedes read multiplexing and Output
requirement proposals; those changes have separate focused evidence.

Read multiplexing also rejects in-flight callers at the remainder of the
original30-second wall/monotonic lease, even if a binding never acknowledges.
Closing a capture immediately rejects queued and in-flight groups; an eventual
read result is discarded. No database cancellation is claimed.34 unit and36
aggregate/Output native cases pass with this deadline in place.

### Coordinated independent source reads

Native source stages now register at most three independent branches. A read
wave starts after each active branch has queued its current reads or finished;
asynchronous source processing cannot unpredictably split that wave. Each
branch retains its own environment-bound native authority. Original queries and
final current-source proofs are unchanged, atomic caller groups stay whole, and
the original deadline interrupts stalled branches as well as queued reads.

41 unit and32 integrated native checks pass, with an additional four-case real
local D1 capacity run. TypeScript, scoped lint and the unchanged repository
production build pass. The installed Sites build helper is no longer present,
so the repository build script was used without modifying build configuration.

Both two- and three-source executions now use63 personal/64 shared binding
calls; quote54/55 and retrieval47/45. Binding calls are not SQL statement counts:
the maximum-three-source shared case runs528 quote,408 execution and284
retrieval statements. These are local synthetic measurements, not a hosted SLA.
The conservative50-binding-call execution target remains unmet and assigned.
No positive-access cache, native proof removal, enrollment or deployment.
