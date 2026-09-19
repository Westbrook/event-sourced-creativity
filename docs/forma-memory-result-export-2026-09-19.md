# Private semantic-result export

Implemented on the isolated Memory branch; not deployed or activated.

The private result inspector now offers **Export this result** in English,
French, Arabic and Japanese. Every click performs a fresh native result GET:
current authentication, custody, consent, source/control revisions and retention
must still pass the existing final read proof. A displayed result is not download
authority. Failed or cancelled checks never fall back to cached prose.

The bounded JSON snapshot contains only that result's tentative text, categories,
separate original quotations and observed actions, disclosed history bounds and
original retention upper bound. It excludes native source bindings, private
scope keys, control history, embeddings and complete source bodies. It explicitly
states that it is unverified, incomplete, a snapshot and not an access grant.
Source ordinals refer only to the selected result's evidence, not global records.
Forma cannot withdraw or erase an already downloaded copy; the UI says so before
the action. This is not a complete account-data or all-memory export.

No provider, mutation, background export, persistence, enrollment, migration or
external service is introduced. Private bytes and temporary object URLs never
enter component state or persistent storage; URLs and detached anchors are
cleaned up even when download dispatch fails. Scope, visibility, expiry, stale
callback and wall/monotonic-clock changes prevent late downloads.

## Verification

- 628 selected actual-client/component tests pass, including fresh-read-only,
  v1/v2 evidence separation, changed actor/route/source, abort, clock rollback,
  expiry, native denials, failed download cleanup and four locale checks.
- All 8 selected whole-app synthetic browser tests pass. The two private-review
  journeys download and read the actual JSON in English desktop and Arabic
  320px layouts. Their download permission is restricted to these exact synthetic
  test cases; other browser fixtures retain their existing download gate.
- Both export screenshots were visually reviewed. TypeScript, changed-production
  file lint, production build and whitespace checks pass. Existing bundle-size
  warnings remain. No live data, provider or hosted qualification is claimed.

## Follow-up

Manual derived-result/control review still needs monotonic display-retirement
qualification; this is native privacy implementation, not an external blocker.
Long-term/cross-scope reconciliation, nested/resource identity, independent
cross-document recall and automatic assistant/autocomplete origins remain in
[the native continuation](forma-memory-native-continuation-2026-09-18.md).
