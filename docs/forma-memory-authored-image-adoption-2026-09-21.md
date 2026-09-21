# Explicit Memory-assisted image adoption

Implemented locally; no deployment, provider charge or enrollment.

## Actual consumer

Document Assistant and embedded Chat show a separately approved private image,
then a second unchecked, destination-specific acceptance control. Acceptance
copies the exact inspected JPEG into authored work and records a native
`GenerationCompleted` event. It does not copy the private prompt or profile prose,
publish externally, or authorize another generation. EN/FR/AR/JA controls explain
that the accepted image remains after Memory withdrawal. The actual Output fold
and subsequent context-reference creation retain non-independent provenance.

## Transaction and recovery

The event, owner-qualified collaborative sidecars, accepted byte copy, retention
classification and idempotent receipt commit atomically under fresh native source,
permission, document-head and exact-preview proofs. Only then may the existing
media store receive the accepted bytes. Shared retention records use the policy
version read within that transaction, not a fabricated default version.

Lost database acknowledgements recover the same acceptance. Failed media writes
recover the same approved byte copy; neither path reads withdrawn private Memory
or repeats a provider purchase. Two concurrent projectors retain the same object.
Bounded scheduled maintenance retries up to four active unprojected acceptances;
retired receipts cannot starve that queue. No external scheduler is registered.

Additive migration **0073_memory_authored_images** preserves a minimal negative
receipt after accepted-body or native-event erasure. Body modification, retyping,
restoration, receipt deletion and resurrection are rejected. Memory withdrawal
is deliberately not an authored-work erasure trigger. Private pixels are excluded
from ordinary prompt-text hydration. Media, generated-image references, derived
references, package publication, document duplication and share readers verify
surviving accepted custody, including a final check after image-byte reads.

## Delayed responses

A dispatched paid image may outlive the browser's 30-second private view. The
server retains a verified response only after fresh native Memory authorization;
it does not extend the expired presentation lease. Disconnects after dispatch do
not discard verified usage. Original-source withdrawal still denies private
retention/publication while settling verified usage. The server operation remains
bounded at 120 seconds; hosted `waitUntil` and provider-latency qualification are
external rollout gates, not claimed here.

Normal three-source native D1 requests meet the existing 50-call local target:
quote45/46, execution48/50 (personal/shared). Exact original document/source
predicates are replayed rather than rehydrated after a long response. The delayed
path remains a separate native capacity assignment; its current measurement is
60/61 calls and is not represented as a 50-call pass.

## Verification checkpoint

- Prior committed full runtime (`1370bbd0`): **2,895/2,895**; excludes this adoption.
- Final native preview/adoption integration:51/51. Accepted-custody subset:16/16 (body/event erasure, permanent restoration
  denial, concurrent projection, late read erasure and no-repurchase recovery).
- Actual maximum-three-source D1 requests:2/2 at48/50 execution calls.
- Migration replay/schema agreement:102/102, with generated snapshot and journal.
- Downstream reference/context/share regression:90/90.
- Client/model/component regression:281/281.
- Actual local synthetic browser:12/12, Document/Chat × EN/AR × blur/expiry/adopt.
  Type checking, changed-source lint and build pass (existing chunk warnings).
  Arabic narrow layout inspected. No production browser content was used.

Final integrated current-tree regression, delayed-response capacity and completion
matrix reconciliation remain assigned in this same implementation task. Earlier
slice receipts do not substitute for those checks. See the [completion matrix](forma-memory-completion-matrix-2026-09-20.md)
and [separate operational gates](forma-memory-sites-capability-todo-2026-09-18.md).
