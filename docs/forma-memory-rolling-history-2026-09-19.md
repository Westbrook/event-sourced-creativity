# Native rolling Memory history and current-purpose review

Branch implementation only. No production deployment, enrollment, provider call,
new budget, hosted schedule or external service is authorized by this checkpoint.

## Implemented

- Each eligible summary, profile or suggestion job rebuilds from its complete
  current original window plus at most two prior completed windows under the
  same consent, scope and purpose. Prior model prose is never used as evidence.
- Native original/body/custody/paid-ancestry and user-control proofs are replayed
  for every included window. Historical read capabilities cannot spend money.
- Full input provenance is merged into the retained manifest and dependency
  index, including uncited historical originals. Lifetimes use the earliest
  original ceiling; neither processing nor rereading renews retention.
- Count and qualified request-byte bounds omit whole historical windows, never
  pieces of an original. The manifest and private UI distinguish consent-window,
  bounded-lookback and capacity-limited coverage. Completion covers only the
  current queued job, not the entire historical range.
- Migration0052 adds three reference-lifecycle privacy triggers. Deleting,
  changing or replacing a remembered original reference immediately erases every
  dependent result body/manifest, while financial usage remains independently
  retained. Native/guest schema fingerprints reject partial or unknown variants.
- Old single-window results replay their original manifest contract. New results
  list newest-first, with actor/enrollment-bound pagination. An optional purpose
  filter isolates summary, profile or suggestion retrieval and pagination.
- The private review UI has localized “read latest” actions for each purpose.
  They discover then freshly inspect the result, preserve correction/suppression,
  and retire private display on expiry, scope change, closure or page hiding.
  Reading never enrolls a user, changes authored content or dispatches a model.

## Deliberate limits

This is a bounded original-backed rolling refresh, not lifetime semantic coverage,
a cross-project profile, an automatic assistant prompt consumer or autocomplete.
The unchanged original plan still requires those integrations, independent Chat
Studio delivery, native nested scope graph, block/reuse evidence and native index
outbox/deletion acknowledgement work. External vector search remains PostgreSQL/
pgvector; no D1/hash-vector fallback has been added.

A lost or unavailable historical window produces an explicit bounded boundary;
current queued references still require complete proof. A withdrawn model result
is not itself suppression of its original sources. Explicit user corrections and
suppression remain source-lineage controls and invalidate downstream results.

## Verification

Evidence is isolated local synthetic data with mocked model transport. Native
SQLite/D1 tests cover personal/shared scopes, original-only rebase, profile and
suggestion purposes, capacity boundaries, authenticated newest-first pagination,
reference replacement with recursion on/off, transaction rollback and downstream
erasure. Component/browser tests cover localized disclosure and purpose-specific
fresh reads. Final run counts are recorded in the owned continuation handoff.
Existing unrelated Output HTTP request-budget failures remain tracked and are not
waived. No hosted qualification or whole-project completion is claimed.
