# Still generation recovery implementation — 22 September 2026

Implemented in `codex/still-generation-recovery`, based on `fd714354d3b2f5a963ca6e104bc3ea0d69a7176d`. The concurrent main checkout was preserved. This implements the approved R1–R5 work locally; it does not deploy or purchase a live generation.

## What changed

- **R1 — Ordinary content works with certified Memory isolation.** An exact, request-local compatibility witness verifies the isolation receipt, retained catalog, all 40 barriers, empty Memory tables and database settings. Every consuming SQL statement rechecks its witnesses. Memory capabilities remain disabled. No blanket schema-error bypass or cleanup-only workaround was added. D1’s compound-SELECT limit required balanced emptiness predicates; actual D1 preparation and hydration now pass.
- **R2 — Service failure has a stable identity.** `generation_preparation_unavailable` identifies a local storage-preparation failure, with a bounded private diagnostic that distinguishes malformed responses, unexpected objects, missing families, digest mismatch, missing dependencies and uncertified isolation. Content-free failure logs include correlation, phase, operator ownership and the observed profile fingerprint; deployment version remains explicitly unknown because this environment provides no deployment-version binding. Exact historical diagnostics are interpreted at presentation time without rewriting receipts. Provider errors remain distinct. Missing dispatch or accounting evidence remains unknown.
- **R3 — Explain the outcome and the next step.** Generation status, inspection, notices, Results and decision context share an outcome presenter. The inspection page starts with the explanation and independently recorded submission, transmission and usage facts. A support summary excludes prompt/source content; detailed private evidence is disclosed separately. Safety advice appears only for safety/request issues. Small nonzero recorded charges retain their precision. Unavailable evidence is explained without inventing its retention history.
- **R4 — Readiness and recovery are explicit.** An authenticated read-only storage check creates no reservation or provider request. Readiness is scoped to the current workspace/document/attempt and expires after a minute; admission checks again. “Review new paid request” opens a review without sending. The readiness message shows its check time. Unknown submission cannot offer a replacement purchase. Existing presentation and single-provider result recovery use original receipts; stale attempts and managed scene continuations are rejected by the retrieval-only contract. Refresh reads the original attempt observationally.
- **R5 — History and delivery remain continuous.** Dismissing a notice preserves its attempt in Results. Saved results reload through existing authorized content routes; recovery returns to the generation/result flow. Inspection updates with changed job status. A new paid request retains a server-validated link to the earlier failed attempt in its immutable request; the review discloses whether the current source revision differs and never reconstructs missing original evidence. No migrations, Memory activation, production repair, or unrelated project changes are part of this branch.

## Verification

- **428/428 relevant regression tests pass:** Still, provider failure guidance/classification, private-content identity and Memory schema-repair suites.
- **42/42 final focused tests pass:** exact failure classification, source-free outcomes, readiness fencing, retrieval-only guards, exact isolation, local D1 and full delivery with attempt lineage.
- **Browser checks pass:** desktop and 390px mobile views, readable educational failure summary, explicit review without submission, readiness expiry, keyboard disclosure/comparison, navigation races and authorization revocation. All browser/provider fixtures are synthetic.
- **Actual local D1 passes:** the installed isolation profile supports ordinary preparation, private output storage and authorized reload. Removing a barrier blocks readiness and hydration.
- **Full mocked image delivery passes:** admission → retained input/evidence → one planner and one image response → media persistence → settlement → authorized reload. Re-running the completed job makes no additional provider calls. All 40 isolated Memory tables remain empty.
- **Build and TypeScript pass.** Build includes custom-element generation, system localization and immutable Memory-manifest checks. No migration/release-enablement files changed.

## Broader-suite limitations

The broader generation/accounting/privacy run has **241 passes and seven failures out of 248 tests**. All seven reproduce on the unchanged base commit in a separately built disposable checkout:

1. Preview and generation foreground-planning tests omit a newly required advisory-preflight acknowledgement (two failures).
2. Missing planner/image usage fixture hits the same acknowledgement requirement (one failure).
3. Long presentation and bounded-repair scenarios exceed the repository’s conservative subrequest assertion (three failures).
4. A stale shared presentation fixture expects a recovering display but receives failed (one failure).

These were not silently weakened or patched as part of this remediation. Production release still needs a current deployment/schema compatibility check and an explicit decision about those existing release concerns. No paid production probe was run.

## Review and release

Review the screenshot-backed local evidence at http://127.0.0.1:4217/implementation.html and record feedback in the canonical Progress Report at http://127.0.0.1:4187. The original investigation/plan remains intact. New implementation cards are unreviewed; agent verification does not imply user acceptance.

Implementation choice: the certified isolation profile supports both cleanup and hydration. Unsupported profiles remain fail-closed in ordinary hydration and admission; the existing narrow optional-cleanup omissions are unchanged. Moving cleanup off the insertion critical path remains the separate bounded follow-up described in the plan.

Before release: reconcile this isolated branch with the current integration head, rerun affected checks if concurrent work changes its dependencies, verify the deployment profile is still the certified isolation profile, preserve the Memory disablement, and release through the project’s normal process. A live paid test needs its own explicit bounded authorization.
