# Release, run, stop, cleanup and recovery — later authority required

Nothing in this runbook grants hosted authority. Current authorization ends at local preparation. Do not push/save/deploy, provision R2, install schema, write fixtures, change access, send a request or use a real provider without applicable later authority. P5 remains the owner; no new task or N10H authorization inheritance.

## Exact later decision

The reviewable request is: publish the sealed P5 successor to **existing owner-private** `appgprj_6ab5929a74288191bf37ed429f7a7e20`; retain its audience and original disabled state; append only `0001_p5_minimum.sql` (144 CREATE statements) after the unchanged original migration; provision one R2 resource as MEDIA; use only DB/MEDIA/ASSETS and no environment credentials; then run this one finite synthetic importer/case/stop/cleanup sequence and retain the disclosed 64-row/172-object/source/empty-resource footprint. Approve a cost/retention basis explicitly; the proposed $1 is neither accepted nor a guaranteed hosting cap. Actual Forma and paid provider execution are excluded from this request.

The exact source-tree, Worker, dataset, migration and native-format archive hashes are in release-envelope.json and resource-inventory.json. Source tar is a complete standalone build input. P5's local commit records the dossier; a later private-Site source push will produce its own native source commit receipt, bound back to these exact staged file hashes. No future commit ID is invented here.

## Release after the decision

1. Read fresh native Site/version/environment/access/migration receipts for the private target. Confirm same original v1 lineage, owner-only audience, no real secrets, retained disabled N10H row and no intervening authority/content. Verify the existing original migration/snapshot and journal entry byte-for-byte. If drift exists, stop for reconciliation; do not silently rebase the proposal.
2. Open a **separate private-target checkout** through the installed Sites workflow using that target's native source credentials only after authorization. Do not push the current Forma/P5 repository or its remote as a substitute. Preserve old migration, historical source/receipts and disabled tombstone. Overlay the sealed standalone source; old historical files may remain but the sole build entry is new `src/worker.mjs`, never old N10H code. Review the concrete changed-file set against the source manifest.
3. Use the supported workflow for source push, build and archive validation. Commands run from the standalone project root: install the pinned lockfile dependencies if needed, then `node build.mjs`. The build uses fixed working-directory-relative inputs and must reproduce the reviewed Worker hash. Current manifest must select private target / DB / MEDIA only. Package must contain exactly the nine reviewed files, including exactly two migration files and both snapshots. Never overlay root Forma's full migration directory.
4. Preserve the returned native pushed source commit. Validate the newly produced archive's unpacked file hashes against the reviewed archive; timestamps may change compressed bytes. Native save must use the **exact reviewed prebuilt archive** (or an explicitly resealed byte-identical-content successor) with that same verified pushed source commit. Do not substitute a source-only remote build, bypass native archive validation, or write credentials to a file/argument/log.
5. Use native private save/deploy calls and preserve owner-only access. Capture source/version/deployment/environment, migration and new R2 binding receipts. A deployment failure may already have installed some/all schema or created the bucket; do not rerun migrations or revert to old N10H proof. Determine the exact applied boundary before any correction. No underlying Cloudflare physical ID is invented or inherently required.
6. Normal signed-in owner navigation must reach the new fixed P5 page and artifact/dataset status. Do not use an access-bypass token or forged hosted identity headers. Check the compiled identity, private audience and zero environment entries before start. Local native-header tests are not this observation.

## Finite run

Save receipts privately as each request completes; the Worker only retains the most recent result hash and removes its report at cleanup. No private synthetic payload needs a public report.

- POST `/p5` JSON `{ "action": "status" }` to inspect identity/steps. Status is read-only and is allowed after disablement.
- POST `{ "action": "start" }` once. Verify 26 imported rows, exact schema and original tombstone hashes, dataset and pinned owner. Never rerun the old importer.
- For indices 0 through 9 send `{ "action": "step", "index": N }` in order. Index 1's two concurrent requests are the single prescribed concurrency case: one winner, one refusal. Index 2's successful response is deliberately treated as lost; inspect status, attempt one prescribed duplicate index 2 (must refuse), then index 3 recovers the original operation/bytes. No automatic browser retry.
- Synthetic steps 4 and 7 enter only compiled original charge/reconciliation evidence. Step 5 is a synthetic human-observation simulation; it supplies no real comparison review or financial authority.
- At any unexpected result, send `{ "action": "stop" }`, preserve evidence and proceed to cleanup when safe. Do not edit the run cursor, rearm, renew dates or dispatch replacement operations.
- After step 9, POST `{ "action": "cleanup" }`. Verify both compiled keys deleted/read-null, zero private bodies, unchanged old tombstone/catalog, residue inventory and P5 phase `disabled` with report null. Verify status in a separate invocation. No new generation is possible from that record.

Driver ceiling: 80 total HTTP requests including negative probes/status/recovery, at most five cleanup attempts, no provider/approval/generation retry. Normal new-step window is one hour and ends no later than proposal expiry **2026-10-01T00:00:00.000Z**. A request already admitted has a 120-second observation deadline; expiry is not an automatic storage deletion scheduler. Do not call this a forced-runtime-restart test: that capability is not exposed.

## Failure recovery

| Failure | Required continuation |
| --- | --- |
| Lost start acknowledgement | Read status; an existing importing/ready/busy/stopped/disabled record consumes the only run. The import and claim are one transaction. Do not create a second run. |
| Lost step acknowledgement | Read cursor/report hash and original durable state. Advanced cursor means completed; busy/stopped means consumed/uncertain. Never repeat purchase or clear intent. |
| Mid-step SQL/quota/guard failure | Stop is best effort; busy/stopped durable phase still blocks replay. Wait for the one-hour window before cleanup if busy remains. Account for failed-query usage as unknown, not zero. |
| Concurrent stop | No new step can claim; every application DB operation and intercepted transport checks active phase. Already-completed effects may remain and require cleanup. |
| Lost R2 put acknowledgement | Stop; cleanup checks both exact compiled original keys even if operation artifact_ref was never stored. Hash-check any found bytes, delete and read-null. Local fault harness verifies this case. |
| Lost deletion acknowledgement | Retain cleaning state and retry only the same idempotent two-key cleanup, within the five-attempt driver limit. Do not retry any provider stage. |
| Corrupt/mismatched bytes | Cleanup refuses hash mismatch. Preserve private custody and identify the original object through a separately reviewed recovery; do not bless it, repurchase, overwrite or delete unrelated data. |
| Cleanup failure / platform unavailable | Keep P5 open, private access and the pending cleanup obligation. Do not report deletion or lifecycle settlement. Continue only the original cleanup after service/access recovery under applicable authority. |
| Applied migration / upload split | Record exact migration boundary and new resource state. The old Worker is not a P5 recovery interface. Publish only a separately reviewed correction of failed unapplied code/schema; never mutate applied migration history or reactivate N10H. |

After success, keep the disabled Worker and both tombstones; do not roll back to a runnable importer. Empty-resource/allocated-schema/source retention remains disclosed and requires an accepted ongoing duration/cost basis. Physical deletion of the database/bucket is not part of this proposal. Actual original accounting remains immutable; there is no claim of real settlement or account eligibility.

## Local reproduction

In `/private/tmp/forma-p5-live-comparison`, Node 24 with the existing pinned dependencies:

```
node --import tsx scripts/prepare-generation-p5-rehearsal.mjs
node scripts/metadata-generation-p5-rehearsal.mjs
node scripts/freeze-generation-p5-application.mjs
node rehearsal/p5-sites/build.mjs
node scripts/check-generation-p5-rehearsal.mjs
node scripts/check-generation-p5-rehearsal-failures.mjs
```

The test harness reads the previously established local owner-email test input without printing it. It does not authenticate to the hosted Site. The new candidate's exact expiry is intentional: after expiry, do not renew the fixture or reinterpret failure as permission for a real run. Tests and generators mutate only their local databases/files. Do not regenerate or overwrite sealed R1/R2 evidence. The installed Sites packager established the exact native-format nine-file archive layout with AppleDouble metadata disabled. Its cache disappeared before final byte-bound hardening; package-generation-p5-rehearsal-local.mjs replaces only the tested Worker in that verified layout and refuses any other content delta. packaging-validation.json records this limit. Discover/restore the supported Sites workflow and require native archive admission before any later hosted action. No source credential/native call was used for local packaging.
