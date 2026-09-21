# Source-backed profile relationship consolidation — 2026-09-20

## Implemented

The native qualified derivation pipeline now supports a separately qualified
`memory-profile-consolidation-v1` recipe for the profile purpose. Its provider
input contains retained, currently authorized original evidence, not prior model
summaries. In addition to supported tentative claims it can propose that a claim
**revises** or **contradicts** an earlier interpretation, identified by the earlier
category and exact original supporting quotation identity.

The parser verifies original human quotations and rejects invented, suppressed,
self-referential, duplicate, oversized and same-response circular relationships.
All supporting anchors join the new claim's source bindings and inverse
lineages. The existing native manifest, finance, publication, source replay,
retention and privacy machinery applies to the entire result. Both user controls
and lifecycle schema are mandatory before the new recipe is offered or admitted.
Existing qualifications and enrollments are not silently upgraded.

The real Document profile consumer presents both interpretations, original
quotation anchors and localized tentative-relationship disclosures. Links are
resolved only within the independently authorized returned collection. An
unmatched claim ID never triggers another resource read. User corrections are
not overwritten; releasing a correction does not resurrect retired results.
Exports include the proposed relationship and evidence, not internal claim IDs.

## Verification

- 285 model/client/context tests passed.
- 57 native provider/result/consent regressions passed before the final control
  additions; 8 final profile native cases passed, including personal/shared
  publication, before/after source mutation, correction/release and missing-schema
  qualification/enrollment rejection. These counts overlap.
- 4 synthetic whole-app profile browser journeys passed: English and 320px Arabic,
  both original-backed and existing behavioral profiles. Relationship review,
  exact quotes, retained paging, blur and denied fresh reads are exercised.
- Arabic relationship-review screenshot inspected: readable wrapping/RTL layout,
  literal script-like text, no horizontal overflow.
- TypeScript, changed-source/test lint and production build passed. Existing
  runtime/API whole-file lint baselines remain separately recorded.

## Boundaries

These are **unverified semantic hypotheses** with structurally verified evidence,
not proof that a quoted original entails the model's interpretation. No claim is
silently deleted, published as policy, promoted to another scope or counted as an
independent observation merely because the model repeats it. This recipe uses
bounded original-backed windows; it is not unlimited history or recursive
summarization of old generated text.

Continue scope-specific promotion, remaining native consumers and resource
coverage in the [completion matrix](forma-memory-completion-matrix-2026-09-20.md).
No provider calls, migration, new service, automatic real-user enrollment or
production deployment was performed during synthetic qualification.
