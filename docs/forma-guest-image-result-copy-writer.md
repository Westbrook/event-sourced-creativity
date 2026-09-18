# Guest Image result copy writer

Dormant source integration. There is no route, schema installer, activation, final custody publication, provider call or financial change in this slice. Runtime qualification and supplier acceptance are recorded separately; this document is not a passing test receipt.

## Fixed handoff and lifetime

`copyGuestImageResultMedia(request, env, reservation)` accepts only the exact reservation produced by the composed inventory → original lease → inspected original bytes → reserved-v0 bridge. Its private `CopyUse` authenticates the same retained upload array by identity. It consumes the reserved association before any await and passes that array's existing `ArrayBuffer` to the one native PUT. Public scalar reviews are not authority or byte accessors. There is no callback supplied by a caller, raw-byte getter or arbitrary SQL interface.

The claim owner retains the original Request, env, DB, MEDIA, accounting identity, source/lease expiry and monotonic deadline. Source read, consume, GET, HEAD, hash, inspection and proof entitlements remain spent. The fixed writer adds finite phase allowances once; no source counter is reset and no financial allowance changes.

The media consumer awaits the actual native PUT promise. Foreground abort/timeout refuses the request without treating the storage operation as cancelled. The active consumer retains the exact upload buffer until actual settlement, including settlement after foreground expiry. Ordinary buffer retirement does not retire a successfully returned ready capability: its local informational review remains bound to the original claim lifetime. A later canonical claim must add its own fixed fresh-ready/full-graph transition and finite accounting; it cannot poll a retired media observation or reuse this writer's spent proof lanes.

## Journal and physical write

The immutable thirty-field attempt row contains twenty-one immutable columns and nine transition columns. Full-tuple guarded D1 batches preserve the immutable descriptor, lease, key, nonce, source digest and destination metadata. A known reserved → writing winner alone receives a private one-use dispatch capability. Ambiguous writing ACK/readback produces nondispatching recovery, including when the writing row can be read back.

The sole physical write is:

```typescript
bucket.put(descriptor.destinationKey, existingUpload.buffer, {
  onlyIf: { etagDoesNotMatch: "*" },
  customMetadata: descriptor.destinationMetadata,
  httpMetadata: { contentType: "image/png" },
})
```

A native success is recorded separately from readiness. Native conditional null records that this attempt wrote nothing; it does not own the colliding object. Throw, malformed ACK or a lost ACK records unknown. No branch retries PUT, allocates another key/attempt, concludes settlement from HEAD absence, or claims D1/R2 atomicity. A pre-dispatch failure after the writing transaction is conservatively unresolved; it is never fabricated as conditional null.

The original actual promise may consume one prepaid settlement lane: one exact-row guarded CAS batch plus one bounded exact-row readback, against the captured original DB. It can record success, conditional null or unknown only for its original attempt. It cannot renew a deadline, authenticate again, read destination bytes, delete, publish or revive another token. A concurrent row change, budget exhaustion or invalid result envelope remains unresolved. There is no durable worker-delivery guarantee after process loss.

## Readiness and cleanup

After recorded native success, a fixed fresh full source/authority/lease/journal proof precedes one destination GET. A streaming comparison checks every fresh byte against the retained, already inspected original copy, with exact terminal length; it does not allocate another media copy, rehash or reinflate. One fresh destination HEAD must match the GET and native success identities and metadata. The destination validator requires exactly the twelve descriptor fields, including `outputId`; the original guest-object validator deliberately rejects that field.

An opaque destination proof, a fresh full tuple CAS and final fresh full proof produce `ready`. Readiness does not transfer custody, expose public reads or revoke the guest. The returned scalar review states those exclusions.

A failed destination proof may first irreversibly fence the attempt as `cleanup_pending`, with exact row, fresh authenticated authority and absence of result custody. Known-success cleanup checks fresh exact key, version, etag and descriptor metadata, performs at most one DELETE, then proves native absence. A genuine private cleanup proof is required before `deleted`. A conditional-null attempt can become deleted without touching the foreign object. Pending/unknown writes never become deleted from a HEAD observation. Replacement metadata/identity refuses deletion. Cleanup uses only its original finite lifetime; a later authenticated cleanup-only operation is a separate dependency.

R2 DELETE is not version conditional. The protection here relies on the closed one-writer reserved key and irreversible D1 publication fence; it is not protection against arbitrary external overwrites between HEAD and DELETE. Published/deleted rows are terminal. The final claim owner must exclude cleanup/deleted attempts in its complete canonical transaction.

## Finite writer accounting

Let `M` be the exact admitted number of common/native, authority, lease and attempt proof parts (`1 ≤ M ≤ 255`). The private writer grammar admits only fixed proof batches, thirty-field attempt CAS/readback, native clock and the three exact existing principal-read query forms. It accepts no externally supplied SQL or bindings.

| Lane | Maximum statements | Batches | Large result envelopes |
| --- | ---: | ---: | ---: |
| Writing CAS, readback and fresh proof | `3M + 2` | 2 | 1 |
| Destination prerequisite proof | `M` | 1 | 0 |
| Ready CAS, readback and fresh proof | `3M + 2` | 2 | 1 |
| Actual-promise settlement | 4 | 1 | 1 |
| Cleanup fence | 4 | 1 | 1 |
| Cleanup completion | 4 | 1 | 1 |
| Principal reads (at most seven invocations) | 21 | 0 | 21 |
| Native clock | 3 | 0 | 0 |

Total maximum is `7M + 40 ≤ 1,825` statements. Before dispatch, the operation reserves/debits these fixed maxima once, including settlement and cleanup slots. Each admitted statement has at most 100,000 UTF-8 SQL bytes, 100 bindings and a 1 MiB complete binding envelope. The request reservation is `(7M + 40) × (100,000 + 1,048,576)` bytes. This is a new finite phase allocation, not a claim that the source-byte-only allowance had an existing whole-claim total cap.

Returned data is measured only after it arrives, across the complete own-data envelope, including ACK metadata and errors. Twenty-six possible large envelopes are bounded at 1 MiB; all remaining statement envelopes are bounded at 16 KiB, with eight batch wrappers of at most 512 bytes. The maximum returned reservation is 56,741,888 bytes. Accessors, symbols, nonfinite numbers, cycles/aliases, unfamiliar prototypes, malformed arrays, excessive depth/nodes and over-budget data fail closed. `undefined` has an explicit thirteen-byte accounting marker. This is an accounting convention, not a claim about transport wire bytes. Unused allowance is never refunded or made reusable. An invalid retained-settlement envelope cannot become readiness authority through readback.

Storage bounds are one PUT; one destination GET; one destination HEAD; at most 65,536 destination stream reads; three destination/PUT metadata captures totaling at most 98,304 bytes; and separate cleanup bounds of two HEADs, one DELETE, two metadata captures/65,536 bytes. Each metadata capture is individually at most 32,768 bytes. These are private fixed phases within the original owner/lifetime. They are neither generic ledger extensibility nor financial budgets.

## Recovery dependencies and verification

Cross-request original-result recovery remains required follow-on work. This slice does not revive a reservation, media token or dispatch permission. Fresh authenticated native-history and immutable-journal reconciliation may observe durable unknown nondispatchingly; it must not issue a new GET/PUT based on HEAD absence or manufacture the missing original promise. Expired immutable leases cannot be silently replaced on an existing attempt. The broader server-owned generation architecture remains deferred and is not made a release prerequisite here.

Focused tests use the genuine synthetic bridge to exercise readiness, foreign/forged/replayed capabilities, source-counter preservation, actual-buffer ownership, metadata/bytes/HEAD refusal, conditional-null foreign collision, unknown ACK, late abort/expiry settlement, changed env bindings and cleanup replacement. The direct-dispatch local workerd fixture runs the production closure against native local D1 and R2, with local-only host/Worker transport guards, pinned unmodified bundle inputs, actual transaction rollback and no binding-object rehydration. Node fixtures and local workerd are not provider, physical-device or production evidence. All failed qualification attempts must remain in the evidence directory.

## Local qualification, 18 September 2026

Twenty distinct native synthetic cases have passing evidence across attributed sources in runs20/21/24. Run20 passed nineteen and exposed one fixture timing assumption: buffer zeroing formerly implied outcome-journal completion. With those lifetimes correctly separated, the test now independently waits for the original attempt's persisted outcome after asserting byte retirement; three affected late-PUT controls pass in run21. The other seventeen cases are reused from run20. Earlier seventeen-case qualification and every preceding failure remain separately attributed and preserved.

Independent review identified post-PUT buffer retention when the prepaid outcome batch or readback stalls. Two genuine controls reproduced it. The repair ends the active byte-use promise when PUT settles and observes the outcome continuation independently; abort can then retire bytes while the journal remains pending. Both regressions pass. An adjacent reservation-ACK control passed before repair, so reservation production behavior remains unchanged. Pending-PUT retention, exact late outcome recording, foreign-database refusal, destination mismatch, cleanup and replay protections retain their meaningful controls.

The actual local Worker/D1/native R2 qualification covers five distinct cases. Run23 repeats the positive after the lifetime split and before the final one-line stream-continuation guard: one PUT, fresh destination GET/HEAD, verified original bytes and preserved source records. Four fault controls remain attributed to predecessor production in run14: foreign-object preservation after conditional null; lost PUT ACK remaining unknown without deletion; lost writing ACK retaining writing/pending and zero PUT; and native writing rollback retaining the reserved row with zero PUT. The workerd lost-writing-ACK case returns operation-unavailable, while the native Node case returns nondispatching pending; acceptance concerns conservative refusal and zero dispatch, not identical return DTOs.

The selected Worker originally failed module initialization because three schema arrays captured imports during a cycle. Separately accepted supplier059 defers those captures to their existing call sites. Composed TypeScript18 and scoped lint19 pass for the lifetime split; final test-only lint22 and final writer lint25 pass. The Worker run23 uses529 pinned source files, ten host-guard selfchecks, zero unexpected host/Worker outbound operations, confirmed native disposal and owned process cleanup. Strict SQL checks retain expression depth100, function arguments32, bindings100, SQL bytes100,000 and compound selects5.

Full logs, exact source bookends, historical failures, review and supplier acceptance are retained in the independent report workspace's `guest-image-result-copy-writer-evidence-20260918` directory. Earlier bundling, fixture and startup failures are preserved, including startup12 whose runtime disposal could not be confirmed; later cleanup success is not retroactive proof. No provider, production, full canonical-claim or physical-device acceptance follows from this local qualification.

A final source review found that the stream helper's currentness check precedes a separate caller continuation. One direct `current(run)` now follows the awaited chunk before the three synchronous upload reads. Four affected native cases pass in run24, including the genuine positive, late-body refusal and both journal-stall controls. The actual Worker positive23 precedes only this one-line guard; no exact microtask-gap runtime reproduction or further full Worker rerun is claimed. The unaccepted pre-guard commit53e70d0e and its exact patch remain historical evidence.
