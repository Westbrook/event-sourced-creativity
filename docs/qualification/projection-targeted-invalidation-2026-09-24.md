# Targeted private-source invalidation

Measured healthy-edit work exposed a separate pre-existing cause of repeated backfill: inserting a private event sidecar invalidated every Project in the owner's stream, even when its Project identity was explicit. The regression reproduces against baseline `c28af5fea0fc3ec2b37b878a544ec59c52a64daf`: editing `project-atmosphere` also changes the generations of `second` and `unaffected`.

The sidecar triggers now invalidate every known nonempty text Project claim from sidecar metadata, private JSON and the public event. This union remains conservative when metadata disagrees. UPDATE uses both OLD and NEW, so a scope move invalidates both Projects. Redaction/deletion retain available routing evidence. If no valid claim is known, invalidation remains broad. The exact shared `project_event_scopes` branch is preserved. These are invalidation hints, not read or provider authority.

Five workflow/schema-parity tests pass in `tests/creation-index-targeted-invalidation.test.mjs`: canonical private append through rebuild, OLD/NEW scope moves, redaction/deletion, public fallback versus genuinely unknown scope, exact candidate parity, and shared withdrawal without unrelated personal-Project invalidation. The baseline canonical-append case fails with all three Projects invalidated. All 26 existing lifecycle tests and TypeScript check pass after the repair.

Executable schema hash: `9d491ea644dcbd0b21a757727ea19a36d21fa88e8b26b4643796838246aa2e71` (`worker/creation-search-index.ts`). Candidate 0075, generated exactly from `CREATION_SEARCH_SCHEMA`: `6613cf61079892e2916c5cd2bc45fd8eaf02b64fae8985e9a2e24fb77cb71755`. These source candidates are not evidence of deployed schema application. Earlier performance receipts must keep their pre-repair module hash `b46babd31a610fe778d92b5fbd17348838a9263d24f38ff03627bf6d30e0fb96`.

## Bounded routing follow-up implemented

The subsequent candidate adds `worker/creation-index-routing.ts`: a bounded metadata prepass at the frozen canonical head, followed by keyed routing lookups. It preserves all Project/Document/relation and ambiguous legacy history, skipping only complete Block histories proven foreign. Differential and interruption tests verify canonical target state across moves, duplicate identities, missing scope and relation dependencies. Partial routing never permits filtering; canonical changes invalidate its generation before publication.

See `projection-repair-2026-09-24.md` for the integrated routing, withdrawal skeleton, fanout staging and renewal repairs. The measured five-minute update criterion remains unchanged and requires a final candidate receipt. Earlier source hashes in this document identify the targeted-invalidation checkpoint; later immediate-withdrawal trigger changes have their own candidate hashes in the current schema manifest.
