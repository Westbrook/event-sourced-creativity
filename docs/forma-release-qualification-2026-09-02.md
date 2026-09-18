# Combined Forma release qualification — 2026-09-02

## Scope and provenance

This release joins the preserved E5, inactive-memory and 3D source with the output-reliability handoff. It does not start E6 or enable live memory. The existing workspace-wide access policy remains revision 7; runtime environment revision 6 is unchanged. Production publication and postflight are recorded separately after deployment succeeds.

- Preserved 3D source: `e5da34bb1ccf8121233855de8803300501222786`.
- Restored release parent: `bb1992d2e82f683af118da4929d786563e5e7503`.
- Reliability handoff parent: `9bf86ffda4b5aeba8ff89993fb05283d892941fd`.
- Production before this combined release: version 178, `8b56301fd0f64b7359c00d0659a8715f35b17b89`.

The integration adds capability-scoped Engineering schema diagnostics and corrects three revision-editor button classes to reuse the existing design system. The reliability handoff's implementation, limitations and independent verification remain in `forma-reliability-repair-2026-09-02.md` and `forma-reliability-verification-2026-09-02.json`; their earlier production observations are historical, not the current release state.

## Hosted migration qualification

An isolated, owner-only Sites rehearsal reused the pre-3D production schema and a synthetic 17-table Output graph. It retained integer rowids beyond JavaScript's safe-integer range and a BLOB in a TEXT-affinity column. No production content was copied.

| Gate | Observed result |
| --- | --- |
| Deliberate final-statement failure after the complete 33-statement migration | Expected CHECK failure; all schema, typed rows and 23 migration receipts exactly unchanged; old Worker stayed live. |
| Original migration without the deliberate failure | Succeeded; all typed rows retained; exactly three intended table declarations changed; one migration receipt appended; no foreign-key failures or reserved staging objects. |
| Signed-in production preflight at 2026-09-02T23:59:01.657Z | Complete metadata report; exact 22-object catalog match to rehearsal baseline; all seven guarded tables empty; approved 11 incoming FK-column rows; no FK, reserved-reference or legacy-token failures. |

Exact original `drizzle/0022_output_model3d.sql` SHA-256: `393bf222f1aa1210d679af3d588ffdf0e989cc6b9bd4db02eeef78cfb9907206`.

Production/rehearsal baseline catalog SHA-256: `d743f0e13534fafadcff705ccae302d9da903f3ca79d3c433c960ec59f4f7e4e` (binary-sorted catalog JSON; no DDL normalization). The production receipt is a transcript-derived metadata census, not a backup. This qualifies the observed volume and exact migration, not arbitrary future volume. The migration repeats its guards transactionally at execution.

The diagnostics endpoint is fixed-query, explicit-read, private/no-store and bounded. It requires both existing identity-management and Engineering-diagnostics authority. It rejects impersonation/project context, does not provision identity, and bypasses unrelated retention processing. Its UI clears metadata on denied access and identity/view changes. No new authority is granted.

## Current integrated checks

All three gates ran against unchanged source aggregate `0f78a9b1852be83381e75964e408729a85989679956035cab56ab967c7cf338e`, before this documentation-only addition. They used the existing no-provider guard and explicit whole-file lists.

| Current gate | Result | Receipt SHA-256 |
| --- | --- | --- |
| Core: diagnostics, session/host, component contracts, 3D lifecycle/UI | 298/298 passed | `00b31f5b74251511c7476182ca89f7370c55795639e02ffd399a9c3bf52cdace` |
| Reviewed permitted 40-file replay: presentation, source/asset, 3D and Output contracts | 482/482 passed | `6ad6bf830408449c58692a81ae2e0e0f9bbc1f08692b794ee2c1acddf4f0b5ac` |
| Actual local D1 migration and rollback | 1/1 passed | `1d33aeed7dbac1bea7a5308de25069a3e8bf2b031d97ae8dee3ad6ba4d8f134f` |

Every gate had zero failures, cancellations, skips and late errors. Counts are per gate, not a deduplicated test total. The production build, TypeScript, all 81 changed executable files under ESLint, generated component/localization checks and diff checks passed. The independent handoff's 1,993-test result is retained as distinct prior evidence, not relabeled as execution against this integrated tree.

Root did not replay the full 84-file handoff list. Forty were permitted, four were covered by the core gate (one transitively), and forty were conservatively deferred. Pending-checkpoint mutation, retry and monetary-settlement equivalents are not authorized by renaming a test. No paid generation or protected retry/Dismiss/checkpoint action was used for this release qualification.

## Preserved limits and follow-up

- E6 and live memory remain paused. Native Canvas 3D is not claimed; 3D remains available through its existing Document/Library/Output surfaces.
- The protected historical video and unresolved accounting are not settled, repriced or retried by this work. No budget reset or paid generation was performed.
- Live six-slide revision/export acceptance, the reliability task's two unknown reservations, and longer two-call slideshow runtime headroom remain explicit follow-up gates. Publication does not complete those tasks.
- Production postflight should use the explicit Engineering metadata read, then passive document navigation. Do not use reconciliation, retry, generation or admission POSTs as smoke tests.
- Applied migration history is immutable. A later failure requires inspection of the applied boundary; rollback must not overwrite data, discard receipts or release unknown holds.

Both independent reviewers concurred within the migration/diagnostic and integration scopes. Deployment success is established only by the saved-version deployment result and subsequent postflight, not by this pre-publication document.
