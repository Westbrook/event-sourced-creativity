# Guest context lease and first-SAVE retirement

This dormant increment closes two concrete consequences of the first native guest Image SAVE: a stale context-claim lease could persist after SAVE won the race, and the original source-retirement helper did not erase the additional SAVE private body. It does not activate guest entry, policies, accounts, claims, providers or financial operations.

## Context lease follows the actual source inventory

`acquireGuestContextClaimLease(request, env, {proof, requestId, inventory})` accepts the real opaque original-context inventory. It derives the manifest from that inventory and obtains the destination from the current existing canonical personal principal. The caller cannot supply a destination, manifest substitute, arbitrary assertion or trusted-header identity. Both guest credential purposes and actual native destination authority remain required.

The actual `claimGuestContext` coordinator uses this guarded entry. Its completed canonical receipt recovery still runs first. The abstract, unregistered `acquireGuestClaimLease` remains available for its original intent-lease contract; it is not source-completeness or custody authority.

For a new lease or expired-lease acquisition, one native transaction checks the complete original inventory and current authority before and after the existing lease mutation. A final single-snapshot read repeats the inventory, authority and exact requested lease association before returning. This preserves the original lease ID, destination, manifest, creation time, acquisition cap, append-only request history and expired-lease compare-and-swap. Exact replay does not refresh expiry or consume an acquisition. A failed or uncertain acknowledgement permits only the final read; it never causes another mutation.

If SAVE commits first, the original inventory assertion fails and no context lease is written. If the context lease commits first, the existing SAVE no-lease proof rejects SAVE. Captured Request, headers, origin, DB, cancellation and relevant authority configuration must remain current through the final return. The guarded path never changes canonical account ownership or the original guest event actor.

## Retirement follows the original retention deadline

`retireExpiredGuestImageOutput(env, {sessionId})` retires only the exact first-SAVE private event body. It uses the original source expiry and database time. It requires no live bearer credentials, payer consent or enabled campaign; revocation does not extend the retention term. It does not modify the original source-retirement helper.

The historical proof binds the committed original source, deterministic guest/project/Document/requirement identities, native event prefix, exact N+1 SAVE event and command, and original text-intake resource receipt. Historical approval terms and policy digests remain qualified, while mutable enabled configuration and current spending are not new conditions for erasing due data. Native and sponsor footprint exclusions, qualified schema state, typed block associations, Memory, custody and later-output exclusions remain checked. A claim lease alone does not postpone expiry.

The original draft and prefix may already have been erased by their existing retirement helper. Retained source bytes receive full native validation. Canonical existing tombstones receive exact association and historical metadata validation; this does not claim to reconstruct erased source hashes, recipe inputs or text-byte evidence. An existing SAVE tombstone replays without changing its redaction timestamp.

One atomic batch checks the complete historical before-state and due deadline, empties only the proven SAVE private body with a database timestamp, and checks the complete after-state. Public events, original actors and IDs, commands, resource accounting, financial records and original source history remain unchanged. Final return and uncertain-ack recovery require the exact tombstone read. There is no automatic mutation retry.

This closed retirement contract supports the one unconfirmed N+1 requirement. Further confirmation, preflight, jobs, generated results, media, adoption or conflicting custody state is unavailable and requires its own explicit successor. The result identifies only the proven source and retired body; it does not claim whole-document deletion or generated-media cleanup.

## Verification and delivery boundary

Focused tests use native synthetic guest source, actual payer approval and first-SAVE producers. The preserved pre-fix coordinator race is distinct from candidate verification. Strict SQLite qualification enforces function arguments, variables, SQL bytes and expression depth on complete wrapped queries; actual local workerd/D1 runs verify the composed transaction, concurrency, rollback, replay and cleanup ordering. Test failures, intermediate source hashes and independent review are retained in the evidence packet.

These are local native-engine checks, not live guest activation, provider journeys, deployed endpoint or physical-device evidence. Independent approval and isolated integration precede handoff to the established deployment owner for canonical main/publication. Full generated-result custody and public verified-identity entry remain separate original-scope work; the deferred broader generation architecture is not made a prerequisite.
