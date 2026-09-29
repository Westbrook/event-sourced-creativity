# Historical personal artifact consumption

Native delivery and derivation can now recertify the exact personal artifact
revision referenced by an earlier, genuine `DocumentArtifactViewed` event after a
later edit or render. This is branch implementation, not a production release.

The selector comes from the retained native event, not caller-supplied revision or
expiry claims. Capture folds the source state before that observation and proves
its render, complete edit count, private envelopes, retained body hash, original
source keys and current document/custody/access. Its native proof includes the
view event itself. A partial history page cannot override the independently
queried native selection. Body bytes must still exist and match; no historical
body is reconstructed from a receipt or a later revision.

Retention remains bounded by the original view deadline even when the retained
artifact body's retention is subsequently extended. Both preparation and final
SQLite/D1-time proof enforce that deadline. Document replacement/removal, privacy
erasure, compensation, source changes and custody changes remain fail-closed.
The resulting observations are descriptive; viewing is not reading, preference,
understanding, an independent human quotation, or a new enrollment grant.

## Compatibility and limits

- The browser's current-view writer is unchanged: a stale revision cannot be
  submitted as a new view. There is no browser-controlled historical-write path.
- The negotiated v2 consumption inspector remains current-only and reports an
  unavailable artifact source rather than silently displaying historical content.
  The private UI now explicitly requests v3 historical-view evidence. Older v1/v2
  requests keep their original behavior; cross-version responses fail closed.
  V3 retains the same parent display lease and descriptive-only source map.
- Native reference delivery and original-backed derivation use the historical
  certificate. Existing whole-reference capacity/continuation limits remain;
  repeated views of one exact source version can share a source proof without
  multiplying independent evidence.
- Governed artifacts remain excluded from this personal-source contract. Shared
  project authorization cannot be replaced by a personal receipt.
- There is no new schema migration, provider call, spend, activation or schedule.

## Verification

73 artifact tests pass, including genuine delayed delivery/derivation after edits
and renders, unchanged current-view writing/inspection, source and view erasure,
body changes, document lifecycle/custody changes, original-expiry enforcement after
retention extension, and isolated real D1 delivery/final erasure. Existing rollback,
acknowledgement, source-completeness and privacy cases remain green. Another 57
source/worker/Chat Studio/scheduling regression tests, typecheck, changed-file lint
and the production build passed. Receipts are in the continuation handoff.

Broader work stays in the [native continuation](forma-memory-native-continuation-2026-09-18.md)
and [Sites capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).

## Historical inspector continuation

The existing “include recorded visits” action now requests v3, with updated
English/French/Arabic/Japanese disclosure of verified earlier views. Mounting and
ordinary inspection still do not request the optional projection. Navigation,
hiding, superseded requests and lease expiry retain their existing retirement
behavior; the new request cannot turn viewing into preference or comprehension.

622 client/component checks and all 73 native artifact checks pass. The two
read-only synthetic whole-app browser cases pass in English at 1280px and Arabic
at 320px, including visible scrollable historical detail and no enrollment,
mutation or provider request. Typecheck, changed-file lint, localization and build
pass. Screenshots and transport receipts are retained in the continuation lane;
this is not production/browser-access qualification with real user data.
