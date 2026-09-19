# Mixed original-backed history: whole-request qualification

Feature branch only, 2026-09-19. No schema, production, enrollment, scheduler,
provider, credential or spending changes.

Combining artifact views with genuine approved-copy outcomes across three original
conversation windows previously required 51/54 free/paid D1 calls. That exceeded
the conservative native request gate despite each isolated workload passing.

## Implementation

Creator source admission now executes all original native assertion statements at
the start of the existing descriptor/size transaction. Every assertion receipt is
verified before a source capability is issued. Final source replay still includes
all admission guards; this removes a round trip, not an authorization check.

Paid consent measurement and hydration share one transaction with the original
message proof. The body SELECT itself checks the actor/scope/turn-bound aggregate
512-KiB limit. Over-cap prose is never hydrated; original cardinality, exact body,
redaction, ancestry and final replay checks remain. Empty-body reads also retain
an absence witness. Neither path grants execution or renews retention.

## Verification

- Sixteen complete authenticated request cases cover three windows, one or four
  artifacts per window, artifact-only or mixed approved-copy histories, personal
  or shared scopes, and free or paid originals. All pass: **43 D1 calls** for
  artifact-only histories and **48** for mixed histories, retaining every original,
  view and approved-copy outcome.
- The largest shared/paid mixed case also passes in isolated local D1. Erasing an
  old artifact body withdraws the complete result, clears private body/manifest,
  and emits deletion intent without altering retained usage. Native tests also
  exercise erasure of an old copy-approval receipt. No outbound service is used.
- Admission revocation, missing/truncated/false receipts and database replacement
  issue no capability. Over-cap paid consent is rejected before body hydration;
  existing between-read growth inverses remain passing.
- 423 native regressions and 173 artifact regressions pass; the final expanded
  16-case matrix and focused faults pass. Typecheck and build pass. Worker lint
  passes; runtime-test lint has the same 15 pre-existing findings and none new.

This qualifies the listed bounded mixtures, not unlimited history, hosted quotas,
remote indexes, production scheduling or user enrollment. Remaining native scope
identities, longer-term reconciliation and automatic consumers stay in the
[continuation plan](forma-memory-native-continuation-2026-09-18.md).
