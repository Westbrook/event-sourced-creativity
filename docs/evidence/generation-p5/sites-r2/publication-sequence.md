# Independent disabled publication decision

**Eligible for a publication decision, not yet authorized or published.** No live-run or study-schema gate is needed merely to publish the empty configuration. The study remains disabled/unconfigured before DB/provider I/O. Current read-only receipts still show Forma v550 / source `c28af5fea0fc3ec2b37b878a544ec59c52a64daf` / environment revision 16, and local main is that same source. It is an ancestor of the intended disabled-release source `38062b07d3456979885a373eef9970d1c2a78a9b`. No newer saved deployment was identified; unsaved source-branch changes must still be checked by the normal workflow before push.

R2 assessment independently matched all 2,193 source hashes to that exact commit and all 622 unpacked archive files. The existing gzip archive remains:

- `/private/tmp/forma-p5-sites-disabled-r1.tar.gz`
- SHA256 `0ab8425b3a81dca051e2cc3cc07891a1dc9eac52228b8fe84728288889275969`
- 23,347,082 bytes; held 41 migrations; no study schema.

The source contains 72 migration SQL files. The installed official workflow calls `saveSource()` and **then** the normal packager, whose final copy overlays the full source `drizzle` directory. Passing that resulting archive directly would expand the reviewed release from 41 to 72. Do not do so. Do not delete or rewrite migration history or make a different commit appear to be38062b07.

## Supported contract sequence after specific publication approval

The native `save_site_version` contract accepts an existing local build archive whose exact source commit has been pushed and is current on the configured remote branch. It does not require that the archive argument be the last pathname emitted by the shell workflow. This provides the following narrow handoff, with native validation retained:

1. Use a clean isolated publish checkout pinned to **38062b07**, with its verified R1 `dist` build. Keep this assessment's later documentation commit separate from the source being proposed for publication. The source contains the exact built policy that emits41 migrations; the archive is derived from it.
2. Obtain the normal native write credential for **the existing Forma project**, without opting into publish-on-push. Reconcile any existing automatic publication window first; a null opt-in does not revoke a previous window. No credential was requested in this continuation.
3. Run the official `site-workflow.mjs` open step, with the credential on hidden stdin, to check/reconcile its configured source branch. Stop if the checked-out source changes from38062b07; inspect/rebuild/reseal rather than substitute an unrelated commit or force push.
4. Run the normal official publish-preparation workflow, with its opening `source` receipt, a **different quarantine archive path**, and a pre-push read-only gate. The gate is this successor's `assess-generation-p5-sites.mjs --release-gate` invoked by absolute path from the pinned checkout. It requires clean HEAD38062b07, exact source hashes, exact R1 archive hash and all 622 matching built files. The workflow performs its normal commit/push checks and packaging. Keep the returned commit; require it to equal38062b07. Its automatically overlaid archive is quarantined and **must never be saved or deployed**.
5. Recheck the sealed R1 archive and source gate immediately before native save. Call native `save_site_version` with **the workflow's exact pushed commit38062b07** and **the existing verified R1 archive**, not the quarantine archive. Native source/current-HEAD/archive validation remains in force; any rejection stops the release. The selected archive is not being relabeled from another source tree.
6. Inspect the saved source/archive receipt, then call native `deploy_site_version` preserving workspace-wide access. Poll the returned deployment to terminal success. Record the deployment/environment/version/source receipts. Native storage may normalize gzip to tar; its content hash is representation-specific, as N10H v37 demonstrated. Do not compare unlike archive representations or treat a server receipt as a runtime byte download.

This is an explicit native prebuilt-archive handoff after the supported source workflow, rather than blindly using its overlaid output. No plugin file is patched, no validation is bypassed, and there is no remote-build fallback. If a future plugin adds an archive-preservation option, inspect that contract before using it. If native validation disallows this exact source/build policy, retain the stopped source and ask the platform to support the held-migration archive; never widen migrations to get past the failure.

No new study table is installed, no flag/environment/audience change is proposed, and no provider or credential setup is required for this disabled publication. The already-reviewed migration history must remain byte-identical. Native deployment failure can still leave migration bookkeeping/state applied before Worker upload; preserve its receipt instead of assuming automatic schema rollback.

This continuation grants no source push, save, publish, or paid operation. Publication approval can be considered independently, but is not recommended as a way to resolve the managed rehearsal isolation gap. The live-study deadline is unrelated to whether inert code can be published.
