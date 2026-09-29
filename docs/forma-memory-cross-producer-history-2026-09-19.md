# Original-backed cross-producer Memory history

Local feature-branch continuation of MEM-003. Not deployed or activated; no new
migration, provider call, enrollment, budget change or scheduler registration.

## Implemented contract

A new native scheduled derivation can reconcile Creator and Chat Studio originals
in the **same exact consent, purpose, enrollment and native document scope**.
It never reads a previous model summary as evidence. Separate registration and
completion cursors remain independent: completing one producer does not complete
the other producer's work.

The other producer's registration interval may overlap the anchor interval, but
its completed window must end strictly before the anchor. Same-producer lookback
retains the existing non-overlap rule. Only completed, retained native jobs in
the bounded current inventory can participate. Each selected job gets fresh
read-only admission, original-content/cause/custody proof and full privacy replay.

New mixed manifests use history version 2. Historical v1 and single-window
manifests retain their original recapture rules; they are not silently widened.
A v2 result read recertifies its exact selected whole windows against the current
native bounded inventory. A saved selection is not an access capability. Original
retention ceilings, lineage controls and complete dependencies still apply.

## Explicit capacity bounds

- Original-only mixed history: at most three whole windows.
- Mixed history containing non-conversation references: at most two whole windows,
  selected before source hydration. This accommodates artifact, block, relationship
  and approval proofs inside native limits.
- Qualified request size and original/observation byte/count limits can narrow
  history further; no original pair is truncated to fit.
- Every mixed result reports `bounded` or `capacity`, never consent-wide coverage.
  These windows are not lifetime memory or cross-document semantic recall.

Chat originals are certified in one bounded native union. The explicit historical
reader tolerates a project index trailing unrelated appends only while all exact
selected event/content/document custody, retention and active projection proofs
exist. It does not repair the index, reconstruct missing sidecars or bypass
current access. Its issued private capability cannot derive own-send authority.
The ordinary strict conversation reader remains unchanged.

## Verification

Synthetic native tests cover both directions, overlapping registration intervals,
independent completion cursors, original-only and resource-rich personal/shared
free/paid combinations, correction and erasure, producer/schema changes, revoked
recall/grants, document removal, missing custody/retention and inactive projection.
Whole authenticated result reads measure 42/47 D1 calls for original-only histories
and 47 for the tested rich two-window histories (four artifacts plus approved-copy
evidence per Creator window), below the conservative 50-call gate.

Verification passed: 513 native derivation/completed-conversation/reuse regressions,
40 focused mixed-producer checks (including two isolated D1 cases), and nine final
historical-custody/D1 checks. Typecheck and production build passed; the build retains
existing chunk-size warnings. Changed production files have no lint errors; the
runtime test file retains its 15 unchanged baseline findings. Large-original capacity
reads measured 40/47 D1 calls. Evidence is retained in the owned independent
progress-report checkpoint.
No production or hosted qualification is implied by these local checks.

## Still open

Longer-term and cross-scope semantic reconciliation, nested scope identities,
genuine block inspection/library/canvas coverage, independent cross-document
original access, and durable assistant/autocomplete publication remain in the
[current native implementation list](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope).
External indexing/acknowledgements, hosted scheduling/execution, provider/cap and
user enrollment gates remain in the [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
