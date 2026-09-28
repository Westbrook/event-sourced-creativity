# P5 R13 — corrected release ready locally; full lifecycle passed

The exact R12 metadata-definition pin is now a rebuilt, supported-package release candidate: `p5-sites-remedy-release:77eb7d7fd34290dd1ca5cea36de3c5f39427d5e6ed30e4fa78f958cfe4baebcc`. No hosted request was sent. Native admission and execution remain pending one final decision.

The compiled workerd/D1/R2 lifecycle passed **28 checks**, plus **10 failure scenarios**. The full run exercised one atomic26-row import, concurrent Start with one winner, all ten fixed cases, concurrent approval claim, lost baseline acknowledgement/status recovery, duplicate dispatch refusal, original two-key/private-body cleanup, and permanent disablement after a fresh runtime restart. The failure suite tested original Stop/orphaned-put recovery, one-hour expiry, identity/credential-shaped-binding rejection, wrong dataset, missing/extra/changed schema, import-batch rollback and metadata drift during cleanup. Real outbound/provider requests: **zero**; six canned synthetic provider responses remain part of the original finite fixture.

## Exact source and package

[Source manifest](source-manifest.json) and [packaging evidence](packaging-validation.json) pin all230source files and nine archive payloads. [Source archive](source.tar.gz) and [deployment archive](sites-archive.tar.gz) are retained here. Tested and packaged Worker SHA256: `b32ebed95d493d5f645f60869ec31e99b62f0e8272da55789345968585ab68f5`.

The corrected tree is based on served version2 but must become a normal successor of native source head530960b85f85756b0eee97746090d690fd00aa95. Relative to that diagnostic parent: change `src/worker.mjs` and `artifact.json`, delete `src/catalog.mjs`; remove the diagnostic route/button. Relative to v2: only the exact metadata pin and regenerated artifact differ; all228other source files remain identical. Both migrations and their journal/snapshots, dataset, schema source, authentication, audience, bindings and expiry are preserved. No additional source defect was found in these cases. No force-push, source synchronization or credential request occurred.

[Worker diff from v2](worker.diff) · [reconciliation diff from diagnostic parent](native-parent-worker.diff) · [release envelope](release-envelope.json).

## Test setup and limits

The lifecycle/failure scripts now accept explicit candidate and evidence paths. They were run with sites-r13 destinations; [historical integrity](historical-integrity.json) verifies all161previous evidence files unchanged. Initial setup failures produced no passing receipts: the sandbox prevented loopback listeners; explicit Miniflare roots resolved the staged-module path; workerd's D1 authorizer rejects creation of `_cf_KV`. The final harness seeds the exact observed platform DDL in a **closed disposable local SQLite fixture**, then runs unmodified workerd/D1/R2 against it. No plugin/internal/native validator was patched or bypassed, and no metadata DDL enters shipped migrations. This models observed catalog state, not the undocumented native migration runner.

The local emulator also creates `_cf_METADATA`; it remains one of the original exclusions. Local explicit object count175 therefore equals172application/control + two observed hosted metadata objects + one emulator-only object. Both observed metadata definitions and original N10H tombstone remain exact through the complete run. The corrected guard compares173definitions after original exclusions. This target-specific pin is not applied to other media routes or production Forma.

[Full compiled lifecycle receipts](local-validation.json) · [failure receipts](failure-validation.json) · [retained state](retained-state.json). Peak per-request842binding calls and3276SQL statements remain distinct units; local success does not establish managed quota fit, pricing or actual financial authority. No unrelated broad test suite was repeated; the relevant lifecycle was intentionally rerun for the rebuilt Worker.

## Cleanup protection and residue

The drift test executes compiled Start and baseline, stops, changes only the local metadata definition, then calls original cleanup. Cleanup removes the two known keys/private bodies but fails shared schema equality, leaving `cleaning`, not `disabled`. The fixture-only restoration of exact metadata followed by original cleanup completes disablement; this is a demonstration, not authority for a hosted metadata repair. A live occurrence requires explicit recovery review and keeps the cleanup obligation open. Redeploying old version2 cannot clean imported state and would restore the original mismatch.

Successful cleanup leaves62synthetic application rows plus two disabled tombstones, all172application/control objects and platform metadata, an empty MEDIA resource, and synthetic bytes in source/version history. Local physical DB file allocation:1081344bytes (~1.08MB); final D1 metric843776bytes is a different measure. Nothing is represented as automatically deleted or cost-free.

## One pending decision

[Read the complete changed-hosted-action decision](decision.md). It covers exact private publication, successful native admission, full finite rehearsal, Stop/original cleanup and verified permanent disablement. It proposes28normal +12recovery reservations (40further), reusing the remaining six and adding34: cumulative ceiling71, normalStop59, at most five cleanup attempts. The actual ledger remains31charged/6unused under37, with normalStop30exhausted. It has not been amended by this proposal.

Keep accepted OptionB unknown-price exposure and indefinite retention since2026-09-25T21:04Z owned by westbrook.johnson@reve.art. Keep October1 2026 00UTC expiry without renewal; proposed latest Start is September30 22UTC to leave recovery time. No Start if the readiness window cannot fit. All P2 gates,847/six exclusions, original N10H state, cross-media limits and separate actual-Forma identity/schema/holds/custody/financial qualification remain. This explains rehearsal preflight, not the original image-provider rejection. **P5 remains open.**
