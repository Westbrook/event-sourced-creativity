# Native Memory admission and budget primitives

Branch-only continuation of [reference delivery](forma-memory-reference-delivery-2026-09-18.md).
This is not deployment, activation or completion of the wider Memory plan.

## Implemented

- Native reference jobs can be claimed by one worker under exact current purpose
  consent, qualification, parent enrollment, document/identity/custody, schema,
  complete reference inventory and database-constraint proofs. The issued handle
  is process-local; copied JSON cannot authorize a subsequent operation.
- Claims and their final assertions execute atomically. Simultaneous readers of
  one waiting job produce one lease. An error after mutation rolls back the claim.
  Lost or malformed acknowledgements leave the existing lease held and never
  authorize a second claim. Expired leases are not automatically reclaimed.
- Proof freshness is at most 60 seconds; the reference lease is at most five
  minutes and is further bounded by original job, enrollment, consent and
  qualification expiry. Neither clock extends source retention.
- Replay includes Memory configuration plus pilot-cohort/admin-bypass settings,
  current source references and the original database binding. Native source
  deletion, consent/access withdrawal or incompatible schema invalidates it.
- A closed-operation paired-budget guard supports the three Memory purposes
  using the existing token/money ledgers. Its SQL checks the original UTC month
  at execution time. The existing Scene wrapper keeps its prior behavior.
- A no-release cost-claim helper preserves exposure after a failed claim.
  Generic correlation and orphan cleanup exclude Memory holds, while ordinary
  cleanup still works. These helpers are not a Memory accounting implementation.

## Still required — native implementation

The reference lease is **not full source-body proof or permission to send data to
a model**. Full original hydration, paid-input ancestry, explicit mixed-source
coverage, approved payer-wide cap accounting, atomic paired reservation/dispatch,
verified usage receipts, financial recovery, derived persistence and guarded
consumers remain required. The five-minute lease must not be used as an automatic
provider retry timer. Unknown financial outcomes require separate accounting proof.

The ledger guard alone does not prove source access, purpose consent or the
Memory-specific cap. Shared billing still uses native owner/editor restrictions;
read-only project access is not permission to omit project financial custody.

No scheduler/worker loop calls this new admission yet. `processingImplemented`
remains false. No provider request, real enrollment, allowance reservation,
production SQL, hosting configuration or deployment was performed.

## Local verification

- 73 cost-ledger and final-SQL checks passed, including delayed UTC month rollover.
- 23 focused native admission/budget checks passed, including personal/shared
  custody, late withdrawal, simultaneous claimants, rollback and lost ACKs.
- The real isolated workerd/D1 fixture passed registration, claim, replay and
  privacy cascade, with outbound service calls forbidden.
- Typecheck, changed production-source lint and production build passed. Existing
  build chunk-size warnings and unrelated assistant-runtime test-file lint
  findings remain; this is not a whole-repository clean-check claim.

See the [native continuation](forma-memory-native-continuation-2026-09-18.md) for
the complete remaining scope and the [Sites To Do](forma-memory-sites-capability-todo-2026-09-18.md)
for external qualification work.
