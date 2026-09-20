# Native saved-context source evidence — 2026-09-20

Status: implemented on the Memory feature branch; no deployment, provider call,
user enrollment, or generated answer is claimed.

## Native integration

The authenticated saved-context read now uses a shared, opaque native source
handle. The future answer/edit consumer can prepare that same handle directly;
it cannot reconstruct one from a displayed JSON response, a saved job ID, a copy
of a handle, or a different request environment.

The handle owns the exact accepted-reference revision, independently authorized
source and target, result output digest, source/target enrollment revisions,
recall boundary, project hierarchy revision, original retention ceiling and
short wall/monotonic deadline. Returned inputs are owned copies. Reading them
neither renews their lifetime nor grants execution consent.

The existing HTTP display path uses this same source adapter and its final
native replay. Public response shape, consent and database query counts remain
unchanged. A consumer must carry its replay statements into the same atomic
publication transaction; reading a source once is not publication authority.
The adapter rejects retained handles after environment/configuration changes
or clock expiry, and transactional replay rejects late source, target,
boundary, dismissal and replacement changes.

## Scheduled integration recovery

The merged scheduled handler now attempts Still expiry, ordinary retention,
Memory privacy maintenance and accounting recovery independently. A failure in
Still or general retention no longer skips Memory cleanup; any failed cleanup
still prevents new learning. Benchmark expiry and existing review reminders
remain in the unconditional finalization path. This changes the native handler,
not hosted schedule registration.

Seven focused scheduled-entry tests pass, including simultaneous early failures,
accounting recovery without learning, original checkpoint/result-expiry failures,
exact scheduling admission, physical privileged-history erasure and actual
Still session/command expiry. Test fixtures apply the real upstream Still
migration; no production schema or service has been changed.

## What this does not finish

This is **source preparation**, not automatic prompt/answer publication.
Generated-answer provenance, its complete source-withdrawal/retention path,
exact-field reversible autocomplete provenance and their end-to-end UI callers
still require implementation. Do not promote this source handle into a provider
consent, financial reservation, output receipt or durable edit capability.

In particular, the current resource-rich read can already consume the native
50-operation request allowance. Answer/edit integration must qualify the whole
request, not add this read on top of an existing request and report the two
parts' budgets separately. No limit was increased or privacy check removed.

## Verification

44 focused existing/new native saved-context tests pass for personal and
organization scopes, local and cross-document references, owned-copy isolation,
forged handles, schema/foreign-key failures, source and consent changes,
dismiss/reaccept races, original deadlines and native request budgets.
TypeScript, changed-worker ESLint and the production build pass (existing
large-chunk warnings remain). Expanded verification exercised 556 native cases. The merged Still fixture
exposed the snapshot helper's lack of SQLite AUTOINCREMENT support: 515 passed
and 41 failed at fixture export, before their native assertions. The helper now
preserves the exact sequence table and deleted high-water marks. All 41 affected
cases pass after repair (59-case recheck plus the separate semantic-retirement
D1 case); the recheck also covers the new source/scheduler tests and a dedicated
sequence-preservation test. Two additional new cases pass. This is evidence
across the broad run and targeted rechecks, not a claimed fresh single-run pass.
The original failure logs and passing rechecks remain in the independent lane
handoff. No native assertion was skipped, relaxed, or replaced with a mock.

The [completion matrix](forma-memory-completion-matrix-2026-09-20.md) and
[original remaining native scope](forma-memory-native-continuation-2026-09-18.md#remaining-native-implementation--still-in-scope)
remain authoritative about unfinished implementation.
