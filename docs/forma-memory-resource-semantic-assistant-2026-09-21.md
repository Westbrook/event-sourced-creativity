# Independently approved resource guidance — 2026-09-21

Local implementation, not production activation. This continues
[explicit resource selection](forma-memory-resource-assistant-context-2026-09-21.md)
and the [full completion matrix](forma-memory-completion-matrix-2026-09-20.md).

## Actual consumer

Library and Canvas now offer localized private guidance from the last explicitly
selected resource activity snapshot. Selection does not authorize a purchase.
The user supplies a question, inspects the exact provider input and maximum AI
allowance charge, and separately approves the immutable request hash. The
read-only answer cannot apply edits, create outputs, enroll a document or access
linked documents. Later activity is not silently included. Surface-open counts
are explicitly not evidence of reading, comprehension or preferences.

The native endpoint uses existing consequential consent and paired token/cost
accounting, with the existing specialist model policy. It has no fabricated
document identity or background grant. Pilot purchasing remains in its separate
qualified workflow; this route cannot bypass it. All provider interactions in
the evidence below are synthetic mocks, not paid calls or provider qualification.

## Privacy and recovery

Additive migration0071 registers exact resource-context ancestry for private
consent, provider response and review content. It does not mark authored content.
Context/source/enrollment withdrawal retires descendants and clears their bytes.
Negative ancestry rejects restoration after retirement; deliberate authored work
and financial receipts remain. Fresh per-request authority and original source
leases are independently replayed at protected transactions and final disclosure.
Request-local reuse preserves exact consent bytes and custody; it does not cache
positive authorization or renew retention. Expiry during serialization withholds
both quote and answer, and cannot dispatch a late provider request.

The UI clears drafts, approvals, quotes and answers on blur, pagehide, expiry,
privacy mutation, locale, route, source or account changes. Focus does not resume
work. Retained request controls let the owner recover without reading source
content first. Viewing still requires current source rights. Recovery uses a
retained response only; accounting reconciliation works with Memory disabled or
source consent withdrawn. Neither path calls the provider again. Unknown usage
remains held. Verified usage is settled even when source withdrawal prevents
publication. The scheduled maintenance hook handles retained accounting only;
already settled/released work does not consume its bounded inventory.

## Verification

- 148 integrated native resource checks pass, including actual local D1,
  explicit scope/approval, withdrawal during provider completion, immutable
  ancestry, restore rejection, final serialization, exact late consent changes,
  ambiguous model output, interrupted finance and no duplicate purchases.
- 3 final accounting-maintenance checks pass after the inventory refinement.
- 224 client/component-documentation checks pass, including malformed scopes,
  changed costs, expired views, non-private responses and no automatic retry.
- 102 migration/schema/history checks pass;0071 is additive and not deployed.
- 10 built-app browser journeys pass. English/Arabic Library/Canvas journeys
  exercise explicit quote/approval, literal answer rendering, visibility/privacy
  clearing, retained-request discovery and read-only recovery. Arabic320px
  rendering was visually inspected and has no horizontal panel overflow.
- Typecheck, changed-source lint and build pass; existing large-chunk warnings
  remain. These checks do not qualify real browsers/devices or a hosted runtime.

Whole local D1 requests (mock provider, one retained resource snapshot):

| Request | Personal calls | Shared calls |
| --- | ---: | ---: |
| Quote | 34 | 38 |
| Execute | 38 | 42 |
| Retrieve | 18 | 19 |

The existing conservative50-call local target is enforced by tests. The preceding
unoptimized execution used101/105 calls; that failing capacity measurement was
not treated as completion. Local wall timings in the final run were about
0.69/0.68s for quotes and0.66/0.81s for execution, not a hosted latency SLA.

Evidence: `continuation-20260918/evidence/20260921-resource-semantic` in the
independent Memory report workspace. The earlier full2,701-test pass is at
7a3573d0 and does not cover this implementation; current focused evidence is
separate. No production migration, provider call, spending, enrollment,
scheduling registration, push or deployment occurred.

## Continuing work

This closes the standalone resource semantic-guidance consumer, not automatic
unified-profile evolution, wider resource/autocomplete integration, direct private
image/Output/live-preview or the remaining integrated lifecycle qualification.
Those are native implementation and remain assigned in the completion matrix.
Host scheduling, provider/embedding/index qualification, owner review and real
enrollment remain in the separate operational checklist.
