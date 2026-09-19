# Independent Chat Studio Memory derivation

Implemented on the Memory feature branch, **not deployed or enabled**. This closes
independent Chat Studio delivery; it does not complete the full Memory plan.

## Native behavior

- Completed native Chat Studio conversations have a separate, consent-bound
  registration/completion frontier. An advanced Creator frontier never implies
  that Chat Studio was processed. Previously completed post-consent conversations
  catch up without resetting either frontier or needing another user interaction.
- Each job references one whole original pair. Native envelope, cause event,
  private-body, retention, custody, negative-ancestry, actor and access proofs are
  replayed before use. A pointer or copied receipt is not processing authority.
- Both producers share the existing purpose grants, pending-work bound, qualified
  provider contract, payer-month allowance, financial recovery and no-repurchase
  rules. No additional user is enrolled and no provider or scheduling flag changes.
- Creator source delivery excludes Chat Studio pointers. Maintenance preserves the
  independent channel; grant revocation, source erasure and expiry remove its
  links too. Accounting survives privacy erasure without retaining source prose.
- Chat Studio rolling results reread up to three original windows in one native
  source capture. They do not ingest old model claims. This is bounded history,
  **not** lifetime completeness or cross-producer semantic reconciliation.
- Original message bodies, answer bodies and native cause events are dependencies,
  including historical inputs. Redaction, source/cause withdrawal and explicit
  correction retire downstream results immediately. Original expiry ceilings are
  never renewed by delayed registration, rereading or rebuilding.
- Authenticated status supplies separate Creator/Chat Studio frontiers. The combined
  frontier is their conservative intersection, not the maximum. Counts remain
  counts of eligible jobs, not semantic truth or reading comprehension.

## Migration and failure recovery

`0053_memory_derivation_producers.sql` adds two empty metadata tables and their
closed lifecycle guards. It also performs three **hash-pinned schema replacements**:
job insertion, the job interval index, and Creator completion advancement. It is
schema-only, but is not described as a purely additive migration.

The producer link's exact deferred FK permits link-before-job registration in one
atomic transaction. An orphan cannot commit. The local migration reconciler accepts
only this exact deferred declaration and the named, hash-pinned replacement chain;
it does not authorize arbitrary rebuilds or deferrable schemas. Dry run, rerun,
modified/reverted objects and guest schema isolation are covered by tests.

Registration replays the genuine source certificate around writes. A lost receipt
is not retried within that invocation; the next invocation uses the committed
producer frontier. Out-of-order completion cannot jump earlier pending work.
A source that no longer qualifies cannot be promoted using an old receipt.

## Verification

- 380 affected native runtime tests passed, including the existing free/paid source,
  privacy, history, recovery, scheduled processing and request-depth cases.
- Additional final focused checks passed for counted withdrawal/erasure and
  out-of-order completion.
- Both isolated real-D1 checks passed: atomic registration/source capture/revoke;
  three-window rolling read/counted organization erasure with accounting retained.
- Complete authenticated three-window Chat Studio inspection uses **36 D1 calls**
  for tested personal and shared scopes. The existing tested Creator free/paid
  paths remain at 45/48 calls. These are local fixture measurements, not hosted
  capacity qualification.
- 553 client/component checks and 221 migration/guest-schema checks passed.
  Final typecheck, changed-file lint and production build passed. The Sites build
  wrapper attempted an unavailable registry refresh; the existing dependency-based
  `npm run build` completed without changing dependencies or tracked configuration.
  Receipts are recorded in the continuation handoff.

Tests use genuine native producers in isolated synthetic accounts and mocked
provider transport. There was no real provider traffic, spending, enrollment,
scheduler registration, production migration, merge or deployment.

## Still open

Longer-term and cross-producer/cross-scope reconciliation; nested project/page/block
identities; governed/historical artifact and genuine block/reuse observations;
automatic summary/profile/suggestion/autocomplete consumers with durable provenance;
native index outbox/deletion acknowledgements; and full integration qualification.
External service and rollout gates remain in the [capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
