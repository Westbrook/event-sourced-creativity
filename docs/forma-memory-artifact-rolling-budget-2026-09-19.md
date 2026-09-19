# Original-backed artifact history: complete-request qualification

Feature branch only, 2026-09-19. No schema, production, enrollment, scheduler,
provider, credential or spending changes.

The three-window native derivation inspection exposed 52/55 D1 calls for personal
free/paid originals and 61 calls for shared free originals. Shared paid completion
also legitimately left an unrelated project index behind, preventing historical
artifact recertification. The prior single-inspector qualification did not cover
these paths.

## Implementation

Historical consumption now builds up to four opaque source frames in one native
D1 batch per window. Each frame is an exact original view plus the relevant native
project/document/artifact event history, retained body and current custody. The
same certifier reconstructs the source/revision/hash, native envelopes, authority,
original deadline and all supporting-event dependencies. No browser projection,
body or caller-created handle is accepted as a source certificate.

Hydration itself checks a 512-row / 1.5-MB relevant-event bound, and each serialized
proof stays within the existing native binding limit. Body limits remain unchanged.
A complete ordered native-row witness rejects omitted, replaced or added rows at
final replay. Missing/oversized evidence is unavailable, not a partial projection
or a successfully processed derivation job. Existing four-source/32-observation
caps and original retention ceilings remain in place.

Explicit native event/resource custody proves historical eligibility without
repairing the project index. A still-active index may trail unrelated assistant
appends; relevant source rows must still have exact current project custody, and
current declarations/lifecycle/compensations are independently proved. Paused or
inconsistent projection state fails. The current-view writer retains its stricter
fresh-index requirement. No project synchronization is hidden in a memory read.

## Verification

- Three-window whole authenticated result reads retain every original/view at
  **46 free / 49 paid D1 calls** in both personal and shared scopes (<50 gate).
- 189 artifact/actual-viewer checks pass, including isolated D1, historical body
  erasure, complete-row replay, authority changes, custody, bounded hydration,
  copied/foreign handles and unindexed unrelated events without index mutation.
- Permission-race fixtures now change the real `users.updated_at` authorization
  epoch input, not a nonexistent physical `permission_epoch` column.
- 413 native derivation/reuse regressions pass, including isolated D1.
- Typecheck and build pass. Changed production/test files pass lint; the large
  native runtime suite has 15 pre-existing lint findings identical to its parent
  commit, with no new lint findings.

The full native regression result is recorded in the continuation handoff. This
qualifies the tested bounded path locally, not arbitrary mixed-resource workloads,
hosted quotas, external providers/indexes, production schedules or user enrollment.
Longer-term reconciliation, remaining source identities and automatic consumers
remain explicit implementation work.
