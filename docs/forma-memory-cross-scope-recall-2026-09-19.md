# Native consent-gated cross-scope Memory recall

Status: implemented locally on the Memory feature branch. Not merged, migrated,
deployed, activated, or qualified on hosted infrastructure. This checkpoint does
not complete the full Memory plan.

## Delivered

- Source-side recall consent defaults to **document only**. A fresh native control
  can explicitly permit the source within its project, connected project tree,
  or same-owner/same-organization partition. Existing enrollment and derivation
  grants are never silently broadened. Broader recall is private to the actor;
  it is not permission to share with coworkers, learn new sources, call a provider,
  spend allowance, schedule processing, or enroll another document.
- `GET/PUT/DELETE /api/memory/recall-boundary` implements exact enrollment/revision
  binding, explicit confirmation, stale-write rejection, source-free withdrawal,
  bounded bodies, closed-schema checks and uncertain-acknowledgement handling.
  The additive `0059_memory_recall_boundaries.sql` migration clears wider consent
  when enrollment identity, custody, revision, policy, recall/learning, retention
  deadline or terminal privacy status changes. Ordinary cursor movement keeps it.
  Native enrollment deletion cascades; financial accounting is untouched.
- `GET /api/memory/recall-scopes` discovers at most 32 broader-consented sources in
  the native bounded project forest. Both source and target require independent
  current authorization and recall consent. An inaccessible intermediate project
  cannot establish a common ancestor. Organization and owner boundaries are never
  crossed implicitly. Scope weights are document `1`, project `0.7`, connected
  tree `0.5/(1+distance)`, and partition `0.01`; these are deterministic relevance
  weights, not confidence, semantic similarity or permission.
- The source/purpose read uses the existing native derivation-result verifier.
  Target authority, complete source-side consent inventory, hierarchy snapshot,
  selected context, source enrollment, newest-result identity and deadline are
  replayed in the same final database batch as all original source/privacy proofs.
  Only presentation data escapes; the cross-scope API never returns an answer-
  publication capability or mutable user-control revisions. It does not create
  a new cross-scope result, so there is no new persisted ancestry-derived output
  to erase. Reparenting changes subsequent ranking and rejects stale in-flight
  reads without erasing otherwise valid document-local results.
- A withdrawn/expired/unavailable newest result cannot revive an older result.
  The native first-page latest-purpose listing now follows the same rule while
  leaving explicit historical browsing intact. Corrections remain displayable
  when no current model result is available.
- The actual Memory panel has localized English/French/Arabic/Japanese controls,
  explicit source/purpose previews, uncertainty recovery, source/evidence labels
  and no implicit mutations. Wall and monotonic lifetimes are at most 30 seconds;
  route, authorization, source ownership, enrollment, locale, visibility, blur and
  disconnect clear private content. Expiry returns in-control focus to Refresh
  only while the same visible owner remains.
- Automatic document briefs retain local notes/corrections first and may append
  one nearest explicitly permitted source, separately labeled by scope. They do
  not fan out across the account, use an older-source fallback, mutate documents,
  put text into assistant prompts, save a cache or call a model. Optional schema
  absence or unavailable broader sources does not hide a valid local brief.

## Request qualification

The implementation batches independent hierarchy reads, reuses the authenticated
principal with its original native assertions, skips an unused target-side recall
range read, and reads source grant/enrollment metadata in one native snapshot.
All exact row and source guards still replay; no source window is dropped to make
room for the new consumer.

Synthetic personal/shared simple-result requests use 28/26 D1 calls. The tested
resource-rich cases use 49/47 calls for two already-admitted windows and 37/35 for
one already-admitted paid window. Those cases requested three processing windows
but the existing producer had already disclosed narrower capacity coverage;
this is **not** three-window qualification for those resource-heavy histories.
A separate original-only case retains all three admitted windows. D1 calls are
not SQL statement counts: the resource-rich examples execute 332/354 statements
across their calls, with a maximum batch of 74 statements. Hosted quotas/SLA are
not inferred from these local results.

Local SQLite compilation exercises expression depth 100, compound SELECT limit
5, 32 function arguments, 100 parameters and 100,000 SQL bytes. Tests cover native
source/target consent races, changed originals, real nested-project reparenting,
unknown schema, source custody/index changes, target removal, lost acknowledgements,
newest-result withdrawal, independent accounting and exact optional guest inventory.
Browser fixtures intercept all traffic with synthetic responses; no real user or
provider is used. Typecheck, scoped lint, production build and client/component
regressions are required for this checkpoint.

## Still planned implementation

This delivers bounded cross-scope **recall/presentation of native model-derived
results**, not vector search, lifetime semantic reconciliation, cross-owner
hierarchy, Library/Canvas/page-native learning, automatic assistant prompt
publication, autocomplete, or durable accept/reject/undo answer/edit provenance.
Those native implementation areas remain in the [current continuation plan](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope).
Remote PostgreSQL/pgvector indexing and acknowledgements, hosted scheduling,
qualification, production rollout and explicit enrollment remain separately
tracked in the [capability To Do](forma-memory-sites-capability-todo-2026-09-18.md).
