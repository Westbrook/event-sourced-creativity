# Private profile facets across scopes — 2026-09-21

Implemented locally in the actual Document Memory brief. This is a private,
read-side inference projection, not shared policy, a new processing grant or a
provider-prompt capability. No migration, deployment, enrollment or external call.

## Behavior

- Group exact matching current profile interpretations at project, connected
  project-tree, same-owner partition and explicitly opted-in organization scopes.
- Require at least three distinct original human source identities across two
  independently authorized documents. Broader facets also require two qualified
  projects. Owner-qualified identifiers prevent cross-owner ID collisions.
- The strict native presentation parser certifies original-human quotation
  origins. Model repetition, copied prose, observation counts, historical
  interpretations, revision proposals and counterevidence cannot add support.
- Native source recall proves each peer's permitted range. A fresh, matching local
  enrollment/revision and local recall boundary independently authorize the wider
  interpretation. Organization consent is not inferred from old partition consent;
  cross-owner project-tree facets also require explicit organization opt-in.
- Current corrections, suppression, contradictory evidence and earlier-only
  interpretations prevent promotion. Exact matching is not semantic equivalence:
  differently worded claims are not silently merged.
- At most one source per existing recall band is loaded; no alternate source
  fallback or extra peer fan-out. All facets inherit the earliest original read
  lease and disappear on blur, expiry, cancellation or privacy invalidation.
- Localized collapsed review shows scope, original/document counts and quoted
  support. Nothing automatically becomes authored instructions or organization
  knowledge. Existing separately approved source context remains the assistant
  route; this UI projection is not an aggregate assistant-prompt capability.

## Verification

- 256/256 model, strict-client and Document brief component checks.
- 67/67 adjacent native history/worker/organization/recall checks, including genuine
  personal/shared project facets and organization facets with separate owners.
- Actual local workerd/D1 verifies organization consent and withdrawal.
- Six actual Chromium journeys: project/tree/partition, English and Arabic at
  320px; evidence, literal markup, no horizontal overflow, blur and corrections.
  The Arabic tree-scope frame was visually reviewed.
- Typecheck, changed-file lint and build pass; existing chunk-size warnings remain.
- Runtime-test lint retains the same 16 pre-existing findings.

The 2,399-test full pass is at preceding `763e91c2`, not this newer source.
Broader resource identity, semantic scope consolidation/aggregate consumers and
whole-system qualification remain in the completion matrix.
