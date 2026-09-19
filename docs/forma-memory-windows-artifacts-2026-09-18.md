# Memory processing windows, artifact observations and immediate retirement

Branch implementation, not a production release, activation or completion of the
[full Memory plan](forma-scope-aware-memory-plan-2026-09-02.md).

## Implemented

**Byte-aware new-job registration.** With completion migration0049 installed,
registration now selects an ordered prefix bounded by 64 references, the exact
qualified request envelope and a conservative double-JSON expansion bound. It
also bounds aggregate source payload size and admits at most four artifact-view
references per window. Selection runs inside the same native publication batch;
no source body is returned to the registrar or copied into the queue. Entire
conversation pairs remain together. Registration stops at the last selected
reference and catch-up resumes without dropping the overflow. Original retention
and the independent completed-work watermark are unchanged.

The shared request formatter supplies both the registrar's envelope bound and
the provider's final exact byte check. This is not a token-price estimate or a
replacement for model qualification. An individually oversized/missing source
is isolated, not truncated or falsely completed. A capacity refusal before any
financial reservation lets the bounded worker scan another due job; uncertain
submission still cannot be retried.

**Certified personal/current artifact observations.** Derivation capture now
recognizes the genuine artifact-view references already published by native
Memory. It reuses exact current artifact revision/body/custody/compensation
proofs and includes their original retention, private content/event inverses and
canonical actor-private artifact identity in the manifest. The provider receives
only the typed action and timestamp, never the certified artifact body. A view
means only that the viewer opened: no reading, attention, comprehension,
preference, human quotation or independent evidence is inferred.

A window containing only observations completes as `no-eligible-originals`
without a provider request. This does **not** claim semantic summarization of
those observations. When genuine conversation originals are present, artifact
observations can accompany them; all artifact dependencies remain attached even
if the model cites none of them. Governed and historical artifact consumption
remain excluded until their separate native proof paths exist.

**Immediate lifecycle privacy inverses.** Additive migration0050 contains four
schema-only triggers and an unchanged ORM schema snapshot generated through
Drizzle. Compensating events, document lifecycle changes, relevant block/artifact
lifecycle changes and document/block/artifact custody-sidecar changes immediately
withdraw affected retained results and erase their bodies/manifests/dependencies.
The event path is owner-stream bound: a foreign-stream compensation cannot erase
another owner's result. Unrelated events do not retire results. Accounting and
completed historical processing records are not refunds or freshness guarantees.

Artifact derivation requires the exact lifecycle profile. Missing or altered
protection cannot silently fall back to an unguarded artifact path. The guest
inventory admits only the exact new schema profile and continues to reject
missing guards and unqualified inbound schema objects.

## Verification

Tests cover new-window continuation, whole original pairs, personal/shared
custody, escaped Unicode framing, irreversible capacity boundaries, actual D1
registration/catch-up, artifact-only and mixed-original capture, source replay,
body/source erasure, artifact edits, custody changes, compensation, migration
preservation/rerun and guest isolation. Provider responses are mocked and all
records are isolated synthetic fixtures. The consolidated runs passed 305 native/privacy/worker tests, 213 artifact/model/
migration tests and 50 guest-isolation checks. A final overlapping nine-test
window/completion pass covers the last expiry-sizing adjustment. Typecheck,
changed-source lint and the production build pass (existing large-chunk warnings
remain). These are local checks, not hosted or real-provider qualification.

## Still native implementation, not external blockers

- Splitting/rebasing already registered legacy oversize jobs and rolling semantic
  history. New smaller windows are not a rolling summary across earlier windows.
- Independent Chat Studio derivation-job delivery, genuine block/reuse producers,
  governed/historical artifact evidence, and remaining page/block identities.
- Real nested-project containment, cycle checks and reparent invalidation; a
  canonical artifact/document key does not invent project ancestry or access.
- Guarded rolling summary/profile/suggestion/autocomplete consumers with explicit
  correction priority and independently proven access at each recalled scope.
- Native index outbox/deletion acknowledgements and minimized index observability.
- Remaining end-to-end privacy/request-budget qualification. Eight previously
  recorded Output HTTP request-budget failures are not waived by these tests.

PostgreSQL/pgvector, hosted scheduling/execution, provider/model/pricing/retention
qualification, the measured benchmark cap and affirmative individual enrollment
remain separately tracked in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
No external service, credential, production flag, audience or schedule changed.
