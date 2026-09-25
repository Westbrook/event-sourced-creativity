# Sites R4 release readiness — unchanged R3 candidate

Checked September 25, 2026. This is local readiness work, not a release receipt or hosted authority. R3's source, package, 29 lifecycle checks and historical evidence remain sealed at `9b83437c2590322cf3cc4340f5939a398494d1c7`.

## Supported workflow

The current callable Sites connector explicitly supports `save_site_version(project_id, commit_sha, archive)` for a locally packaged deployment archive. It requires the exact source to have been pushed first; `commit_sha` must match the configured remote branch HEAD and the archive's source. Saving returns native source/version/archive-storage receipts. `deploy_private_site_version` then accepts the saved version ID and enforces the existing owner-only audience. These operations were inspected as tool contracts, **not invoked**.

The old `sites/0.1.71` skill/packager cache is absent. A current plugin-directory search for Sites returned unrelated providers, with no installable Sites result. Plugin-management guidance says to prefer native Sites functionality. Do not install a substitute provider, patch plugin internals, fabricate a reinstall command, or treat this as service unavailability.

**The supported path for this already-built candidate is its existing archive plus native push → save/admission → private deploy. No local plugin restoration is required to request this authority.** The missing helper cannot be rerun here, and successful native admission is still unobserved. The local check is evidence of compatibility with the exposed contract, not a substitute for admission.

If the platform later requires a workflow refresh, the documented user action is to mention **@Sites in this existing P5 task** to invoke Sites explicitly, or open **Sites in the desktop app / More → Sites on ChatGPT web** and select the existing target. These are supported entry points, not a claim that they reinstall the removed 0.1.71 helper. No current supported reinstall action for that obsolete cache was discovered, and none is a release prerequisite for the prebuilt-archive route. Keep P5 and local-only scope when requesting a refresh. [Official Sites workflow](https://learn.chatgpt.com/docs/sites).

After authority, use ordinary source credentials without requesting publish-on-push. Reconcile any pre-existing automatic publication window before pushing; if one would bypass the reviewed explicit archive save, stop. Do not fall back to a source-only remote build or a non-private deployment. A native refusal stops release and preserves its exact receipt. Never push merely to check availability.

## Local result

[local-readiness.json](local-readiness.json) records 110 read-only assertions: 23 sealed evidence hashes; 19 source files against the manifest and original commit; both archive hashes; safe, unique regular-file archive paths; exact nine deployment payloads; Worker/manifest/binding/asset resolution; migration metadata matching source; eight unchanged non-Worker payloads against the historical supported-packager archive; existing Worker syntax; packaged migration parsing to 28 unchanged plus 144 new explicit schema objects. The earlier Worker-only delta remains exactly as disclosed in R3.

No build, fixture execution, source edit, recompression, plugin modification, credential acquisition, source push, save, deployment, provisioning or provider call occurred. The prior 29 lifecycle checks and 266 historical tests were not rerun. All 172 objects are a local catalog result; managed fit remains unqualified. The local maxima of 842 D1 binding calls and 3,276 SQL statements per request measure different units.

Any source, Worker, schema or content change requires a new seal and scope review. Equivalent archive compression alone does not change source: record its archive digest and prove all nine unpacked paths/bytes identical. Do not invent a future native source commit or saved-version ID.

## Accessible economic terms

Official documentation currently says Sites is included with eligible ChatGPT plans during public beta, subject to availability and usage limits. This is relevant managed-service guidance; retail Cloudflare rates are not the user's Sites contract. It does not establish this target's accepted incremental monetary ceiling, applicable account allocation, overage controls or retained-resource price. [Official pricing](https://learn.chatgpt.com/docs/pricing).

No target-specific invoice, plan acceptance, resource rate or enforceable spend cutoff was available in the inspected connector contracts/local evidence. The R3 $1/seven-day proposal remains **unaccepted, unpriced and unenforced**. A finite run at unknown hosting prices is an explicit alternative economic choice. It is not a $1 guarantee, a cost-free claim, or a bound on persistent storage/ingress liability. No unidentified external operator or contact is a prerequisite; the user can identify the responsible existing account owner in the decision.

Cleanup is the original two-key/private-body cleanup and permanent run disablement. It does not delete the database, bucket, source/version history or backups. A requested hard erasure deadline cannot be accepted as executable under this package. That would require separately reviewed capability/scope before release, not an invented scheduler or teardown.

This readiness clarification supersedes R3 wording that accidentally placed native admission before the authorized push/save needed to obtain it. R3's sealed files remain unchanged.
