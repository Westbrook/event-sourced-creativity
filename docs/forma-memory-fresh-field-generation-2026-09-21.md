# Fresh exact-field Memory suggestions — 2026-09-21

Local implementation on the Memory branch. No deployment, credential change,
real provider call, automatic enrollment or scheduler registration.

## Actual editor-to-provider-to-authoring path

The ordinary Document text editor now offers **Review new suggestion** beside
saved-result lookup. It constructs a localized request for the exact saved field,
not the unsent draft, and opens the existing Assistant cost review with approved
saved Memory selected. Generation still requires explicit cost approval. The
result is private; applying its exact replacement is a second, independent action.
The selected block and revision are shown in the cost review.

The native request stores a closed field binding: block ID, text field, revision
and SHA-256 of the exact saved Unicode text. It validates current author access,
Memory availability, field eligibility and the saved bytes before creating the
zero-cost turn. It suppresses ordinary action proposals. A field request cannot
be purchased through a non-Memory quote. The binding is retained in the signed
consent and revalidated from canonical source at quote, admission and dispatch.
The model receives only a request-local block alias, not that native identity/hash.

Private review construction and later canonical reads restrict edits to that one
field even when the provider proposes unrelated edits. Only supported editable
text of at most 1,200 characters is admitted; locked, governed, immutable, restricted
and prohibited sources do not become editable. The existing exact apply transaction
rechecks the original source and replacement hash. Accepted work survives Memory
withdrawal; its supporting private result does not.

The editor disables requests for dirty drafts, composition, unavailable current
fields or privacy transitions. A changed initiating editor cannot buy its pending
request. No keystroke capture, automatic purchase, speculative background request,
auto-acceptance, or substitution of a different field is introduced. Closing a
review still allows a later deliberate historical review with native revalidation.

## Native database compatibility

The full shared workflow reproduced a final feed proof exceeding D1's 100-bound-
parameter limit. Actual isolated D1 additionally exposed its 100-expression-depth
limit for a multi-turn result. The final SELECT-only transaction now evaluates
longer-conversation authority, canonical-result, completion and retirement proofs
separately, and requires every positive proof. All original predicates remain in
the same atomic transaction; there is no positive permission cache or retry.

## Verification

- 14 focused native checks pass, including four personal/shared SQLite/actual D1
  generation, saved-field retrieval, explicit apply and withdrawal journeys;
  malformed/disabled/locked inputs; and source-byte changes before quote or Run.
- 339 host/model checks pass, including editor handoff, localized cost review,
  rejected scopes and cancellation of a purchase after draft change.
- Two actual built-app browser journeys pass in English and Arabic at 320px:
  dirty draft and IME protection, exact saved-field request, explicit cost review,
  no automatic execution, dismissal, unchanged text and no horizontal overflow.
  Arabic review layout inspected. Final broader regression receipts are recorded
  below when completed; these focused counts overlap those broader runs.

## Remaining planned scope

This implements new field-specific generation with explicit approval, rather than
only reusing a previously generated answer. Continuous or nightly pre-authorized
completion production, broader fields/resources, independent source reuse and
whole-system capacity/freshness qualification remain assigned in the
[completion matrix](forma-memory-completion-matrix-2026-09-20.md). The separate
operational gates are not waived and this is not a full-plan completion claim.

Final qualification: the broader native specialist/semantic run passes **304/304**;
the final built-app Memory browser suite passes **20/20**. TypeScript, changed
source lint, localization/CEM audits and the production build pass (existing
chunk warnings). The API retains 28 unchanged baseline lint findings. These are
synthetic local checks, not production deployment or provider qualification.

## Full native checkpoint

All **2,016 native runtime tests pass at `e7d79ce2`** (895.9 seconds), including
fresh field generation, prior original/derived source retirement and recovery.
This exact-commit result does not certify subsequent accounting changes or close
the remaining native completion-matrix work.
