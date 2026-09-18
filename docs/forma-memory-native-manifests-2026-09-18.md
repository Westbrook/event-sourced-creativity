# Native Memory manifests and publication receipts

Status: implemented on the Memory feature branch; not deployed or activated.
This is a prerequisite to durable semantic storage, **not that storage itself**.

## Implemented

- Canonical, bounded manifests include every original supplied to the model,
  including uncited originals, and all separately typed observations. Source
  event/turn fingerprints, exact private-content references, accepted purpose
  and consent identity, original queue interval, and paid consent/result/ancestry
  references are retained as private provenance.
- Manifests exclude original text, prompt bodies and executable SQL. Their hashes,
  identifiers and activity metadata nevertheless remain private user data; they
  must not enter analytics or the independent retained financial ledger.
- Original retention ceilings are distinct from the short-lived access proof.
  A new authenticated read can revalidate the exact saved manifest after an
  execution lease expires, without extending retention or granting another
  provider call. Altered, incomplete, noncanonical or oversized bytes fail closed.
- The provider adapter constructs this manifest before reserving or dispatching.
  Only a verified, source-bound response with accounted usage issues an opaque
  publication receipt. Parsed JSON, copied handles, another environment/database
  and a same-job but different capture cannot substitute for that receipt.
- Publication preparation supplies complete source replay plus current private
  job/financial linkage and settled-usage checks. A future result writer must run
  them **in the same atomic transaction** as its writes, then verify the receipt.
  A successful separate read is not permission to publish.

No database migration, public endpoint, enrollment, provider credential, hosted
schedule, production setting or visible UI changed. Tests use synthetic data and
mocked transport; no real provider request or spending occurred.

## Verification

The native derivation/tenant privacy regression passes **221/221** checks, with
**15/15** provider checks rerun after tightening the final accounting guard. These
counts overlap and must not be summed. Coverage includes personal/shared free and
paid originals, uncited inputs, observations, 64-pair manifests, copied/foreign
handles, altered retention/ancestry, source changes, withdrawal, closed finance,
expired execution and isolated D1. Typecheck and the production build pass; the
existing build chunk-size warnings remain. Exact final counts and logs are in the
Memory task handoff. This is not hosted qualification or a clean full-suite claim.

## Next implementation

1. Add durable private result rows and normalized dependency indexes, with
   immediate targeted body erasure, grant/job cascades, expiry, idempotent lost-ACK
   recovery, and exact native privacy deletion receipts. Saved manifests are data,
   not an alternative to current native authority.
2. Add retained user corrections and suppression, processing windows and completed
   cursors, then connect the paid worker and guarded summary/profile/suggestion
   readers. The new provider receipt still represents an unverified model proposal.
3. Complete the wider scopes, producers, rolling-history rebase, index lifecycle
   and observability described in the [continuation record](forma-memory-native-continuation-2026-09-18.md).

`processingImplemented:false` must remain until those integration/privacy paths
are implemented and qualified. Eight previously reproduced Output whole-request
budget failures remain open; this slice does not change or waive them.
