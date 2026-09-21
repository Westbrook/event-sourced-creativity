# Independently enrolled duplicate-source recall — 2026-09-21

Implemented locally through the actual native document-duplication writer,
explicit Memory enrollment and purpose consent, block-inspection capture,
retained derivation and existing original-source-discovery consumer. No migration,
real provider, deployment, enrollment or production data changes.

## Native behavior

A copied document receives a real new identity and **no inherited Memory consent**.
After it is separately enrolled, a genuine inspection can certify its previously
committed copy history. This does not treat that inspection as a newly performed
copy, count copied words as original human preference, or permit original-source
recall without independent original enrollment, current access and recall range.

Reuse provenance version2 verifies the exact retained approval hash, verified
native receipt, actor/stream/project/target, source declaration and complete
consecutive committed footprint. It handles copied blocks and relations, restored
locks and explicit folder placement. Historical copies are discovered from the
already qualified block-history event IDs, not untrusted copied_from pointers.
Repeated inspections do not duplicate copy entries or independent evidence.

The existing bounds remain: at most eight retained approval receipts,128 events
per footprint,196,608 footprint bytes per receipt,786,432 combined receipt/footprint
bytes,65,536 preview bytes and1,024 candidate event IDs. Oversized or unsupported
approvals cannot certify ancestry. No copied prose is sent to the derivation
provider as an original human source.

Version1 retained results explicitly replay the old contract; they are not silently
upgraded to version2. Unknown versions fail closed. Source observations remain
inspection events when the committed duplication predates enrollment.

Current exact event/body/custody and receipt witnesses are replayed before native
publication or recall. Approval erasure retires the private inference; restoring
its body cannot restore withdrawn certification. Withdrawal preserves authored
copy blocks. Disabling the *original* enrollment removes original discovery but
does not erase the duplicate or invalidate a distinct human request in it.

## Verification

-137/137 native duplicate/reuse, rolling-history and cross-producer checks.
-62/62 existing document-duplication model and native authoring API checks.
- Actual local workerd/D1 personal/shared folder-and-lock copies, independent
  source recall and erasure/body-restoration non-resurrection.
- Positive retained contracts1/2, malformed target/source/operation/stream/
  footprint/folder references, separate consent and original withdrawal.
- Typecheck and changed-worker lint pass. Runtime test lint remains at its
  unchanged16 pre-existing findings.

The full2,399-test suite at763e91c2 is an earlier source checkpoint, not a full
run for this change. Cross-owner copy authoring/provenance, distinct Library/Canvas
resource enrollment, direct private Output consumers and aggregate semantic
profile consumers remain assigned native work in the completion matrix.
