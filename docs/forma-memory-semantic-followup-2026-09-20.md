# Memory-assisted follow-up conversations

Implemented and locally verified on the Memory branch. Not deployed or enrolled.

## Actual consumer behavior

An explicitly requested saved-Memory specialist quote can include the canonical
Memory-assisted answers from the two prior turns in its existing three-turn
window. The real model prompt labels these as derived context, not independent
support. Original conversation bytes remain separately retained and validated;
generated text is not relabelled as original authorship. The quote exposes the
actual input and still requires explicit spending approval. Ordinary paid
requests retain their Memory exclusions; there is no silent fallback or purchase.

Each parent requires the same actor, selected scope and accepted context, current
source/target authority, verified original conversation, canonical consent/hash,
private content custody, and settled matching token/cost receipts. The native
snapshot and transitive source closure replay at dispatch and publication.
In-flight source loss preserves verified provider usage but prevents disclosure.

Immutable, prose-free parent/content references connect descendants to their
parents. Withdrawal, original-source changes, context removal, erasure and expiry
retire dependent answers and redact their registered private copies. Restoring a
body or omitting an edge from a restored database cannot restore authority.
The closure is bounded to 17 origins including the current answer; a further
purchase fails closed without pruning dependencies or implying complete history.

## Migration and rollout review

`0063_memory_derivation_consumer_parents` adds the dependency table, index and
lifecycle triggers. It also contains a **hash-pinned replacement** of
`memory_derivation_consumer_update`; it is **not purely additive**. The replacement
allows only an exact no-op on an already-retired immutable row, necessary when a
bulk withdrawal and a dependency cascade encounter the same row. It still forbids
revival, identity changes and changes to the retirement timestamp. Existing SQL
files and data are unchanged.

The local migrator qualifies exact old/new trigger shapes and SQL bytes, applies
the replacement atomically and rejects altered or reverted schemas. Runtime
catalog profiles accept only the qualified upgrade with its complete dependency
schema. This is local migration qualification, not permission to apply an
unreviewed trigger upgrade to production. Include the exact upgrade in owner and
hosted migration review; the earlier additive-only rollout approval is not treated
as approval for this replacement.

## Verification

- 18 focused follow-up tests: actual personal/shared prompt consumption, parent
  faults, quote/provider/publication races, restore/non-resurrection, expiry,
  bulk retirement, exact retired-row immutability and the full lineage bound.
- Six isolated D1 three-answer journeys: personal/shared result, context and
  original-input withdrawal. Full native guards remain inside atomic batches;
  large ancestry predicates are kept separate to respect expression-depth limits.
- 133 affected consent, source lifecycle, recovery and semantic consumer checks.
- 99 migration tests, including four altered/reverted trigger-upgrade cases and
  installed-generator snapshot agreement. TypeScript, changed-file ESLint and
  production build pass; existing bundle-size warnings remain.

Tests use synthetic data and mocked providers. No real provider spend, production
migration, deployment or enrollment occurred. Whole-invocation capacity and hosted
limits are not qualified by these tests.

## Continuing implementation

This closes bounded semantic follow-up consumption for the specialist, not Chat
Studio, exact-field autocomplete, long-term profile consolidation, broader native
resource coverage or integrated capacity qualification. Continue the
[implementation matrix](forma-memory-completion-matrix-2026-09-20.md); external
rollout work remains in the [Sites capability checklist](forma-memory-sites-capability-todo-2026-09-18.md).
