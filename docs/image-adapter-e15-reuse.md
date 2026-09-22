# E15: retained image evaluation reuse

E15 was implemented offline at reviewed base `1587f9067162e38ce437d9cf443faf5620b388ae` and committed as `2cf112a4` on `codex/forma-e15-eval-reuse`. The user subsequently authorized integration with current main and Production publication. E15 changes no production routing, provider requests, Replay admission or incident evidence; publication does not authorize a live evaluation or purchase.

The old evaluation runner is now a **read-only inspector**. Its blanket paid flag and `--retry-failed` flag are not manifest authorization. It contains no image generation or evaluator fetch path. An intentional new request belongs in B's new frozen trial harness, after its independent authorization and F's financial qualification; neither this change nor B's initial offline harness grants live dispatch.

## Operation identity

Before creating the review directory or manifest, the runner resolves each case's operation. The OpenAI comparison arm uses F's `resolveProductionImageOperation` with an explicit OpenAI route: current low quality selects Flare; other quality uses the configured final. The explicit Fal comparison arm uses its existing model resolver. It does not represent today's shared Draft route.

Identity contains provider, endpoint, model, evidenced snapshot or unresolved alias, adapter and prompt-adapter versions, routing/capability/source versions, quality, size, format, compression, streaming/partial-image settings, moderation settings, exact canonical/provider prompt SHA-256 values and ordered reference-byte hashes and roles. Source hashes intentionally invalidate equivalence conservatively when adapter implementations change. F distinguishes omission, wire settings and effective values. An unchanged unresolved alias proves only the recorded request configuration, not an unchanged backend snapshot. A feature called “preview” supplies no model evidence.

The manifest lists both arms per case; its digest names a separate `outputs/image-adapter-reuse-reviews/` directory. Historical model-named directories are source lookup locations only: a directory called Sunburst can contain an accurately labeled old Flare receipt. Source directory names never relabel bytes.

## Reuse and migration rules

| Retained evidence | Result | Provider calls |
| --- | --- | --- |
| Completed, exact identity and verified content hash | `reused`, `exact` coverage | 0 |
| Completed older receipt with matching recorded fields and verified hash | `reused`, `historical_partial_only` coverage | 0 |
| Changed model/configuration/prompt/reference/version | `new_trial_needed` | 0 |
| Missing or corrupt bytes, absent receipt, terminal failure | `new_trial_needed` | 0 |
| Submitted, accepted, uncertain, pending or unresolved network purchase | `reconciliation_required` with original receipt retained | 0 |

Older receipts do not gain missing provenance through migration. They remain historical evidence, not proof of full current-request equivalence. The inspector never rewrites source checkpoints, copies replacement pixels into historical locations, overwrites historical reports or starts an evaluator. Missing evaluator evidence also needs its own new authorized trial. Read-only reports cannot issue a new adapter qualification.

`retainedCandidateBaseline` continues to require the exact historical Image 2 model, adapter, prompts and bytes. Historical candidate campaigns remain read-only. Image 2/Fal pixels never become Sunburst/Flare evidence. A mismatch is reported separately, retaining the original receipt and model; mixed-model reports list actual retained models without a configured-model fallback. Every read-only run records zero new image cost; historical successful-image totals keep their existing limited coverage label.

Original-request reconciliation happens in the owning recovery flow with its original provider/model/request ID and current authorization. This inspector deliberately stops at retained uncertainty. New trial IDs alone must not clear unresolved exposure. `imageAdapterFailureReceipt` names the attempted identity and preserves dispatch/submission uncertainty instead of guessing the configured final model.

## Offline usage

From this worktree:

```sh
node --experimental-strip-types scripts/run-image-adapter-eval.mjs --preflight-only=true
node --experimental-strip-types scripts/run-image-adapter-eval.mjs --reuse-only=true --retained-dir=/absolute/path/to/retained-evaluation
```

`--report-only=true` uses the same zero-call validation. Optional `--review-dir=/absolute/path/to/separate-review` must not point inside retained evidence. Private review directories/files use restrictive creation modes. Original artifact paths stay bound to the source directory; no new public media or evidence endpoint is introduced. Canonical app authorization, source retention and deletion rules are unchanged.

## Verification and legacy recovery

Focused tests exercise the real runner with a fetch tripwire and synthetic local files. The full 50-case corpus resolves to 20 Flare and 30 Sunburst OpenAI operations. Repeated completed Flare, current Sunburst, historical Image 2 and snapshot cases make zero provider calls. Corrupt bytes, changed configuration, legacy migrations, failures, accepted purchases and attempted old paid flags cannot purchase replacement pixels. Mocked adapter rejection records the model actually sent. Source checkpoints remain byte-identical across read-only reruns.

The two legacy storyboard HTTP suites now seed owner-private historical Fal prompts, paid plans, accepted/uncertain submissions and original token/cost reservations directly in disposable SQLite. They never manufacture those purchases through today's Draft route. Resume polls the original Fal request and settles its original reservations once. A two-frame case recovers the first Fal frame, then sends exactly one mocked new low-quality Flare frame, with distinct model/request metadata in private storage and no second planner or Fal purchase.

Run focused tests:

```sh
node --import tsx --test tests/image-adapter-eval-cache.test.mjs tests/image-adapter-eval-reuse.test.mjs tests/image-adapter-evaluation.test.mjs tests/storyboard-recovery-route.test.mjs tests/storyboard-reconcile-provider-route.test.mjs tests/flare-draft-generation.test.mjs tests/image-operation-capabilities.test.mjs
node --import tsx --test --test-name-pattern='unqualified Replay' tests/replay-model-admission.test.mjs
```

The old pure-preflight fixture closure adds only `worker/output-fal-image-contract.ts`, `src/model/output-fal-image-contract.ts` and `src/model/fal-image-identity.ts`. Its relevant actual-selector test now expects the delivered Sunburst fallback and Flare low-quality route. Run with a freshly hash-pinned manifest and `--test-name-pattern='actual selector'`. The broader historical preflight suite has separate stale expectations (default Image 2 and refusal of the now-supported native Fal Image path); this task does not change that native preflight behavior. The separate Replay compatibility test that still expects an explicit Image 2 final override to qualify the low-quality path also fails on the unchanged reviewed base: Flare estimates correctly remain unqualified. The three current unqualified Replay refusal tests pass. No repository-wide lint repair was attempted.

## B / H handoff

- Dependency: F capability commit `57ded238` (local equivalent `9b6ed8f7`). Integration with main `571026a9` retains F's complete final contracts, including effective JPEG compression and unsupported native-route guards, plus A's evidence and B's frozen harness. The two duplicate-cherry-pick merge conflicts retained main's F files unchanged.
- B owns the new manifests and harness. E15 exports `imageAdapterRequestIdentity`, `imageAdapterIdentityHash`, `imageAdapterReuseDecision` and `imageAdapterFailureReceipt` from `scripts/image-adapter-eval-cache.mjs`. `imageAdapterReuseDecision(receipt, expectedIdentity, { readArtifact })` intentionally has no dispatch callback. It returns the original receipt separately from its decision.
- No shared `worker/openai-adapter.ts` or `worker/document-jobs-api.ts` edits. A retains central integration and global report ownership until H takes over.
- H must retain B's frozen-trial authorization, immutable dispatch journal, unknown-exposure stops and F's unqualified financial cells. This runner's review manifest is not an execution manifest or authorization token.
- Keep native Output storyboard high-quality Ideogram, configured high-quality Forma Fal, private Memory high-quality strict receipts/moderation, and shared low-quality Flare boundaries intact. Replay remains blocked where `replay_image_estimate_unqualified` applies.
- Cross-media: apply identity and no-repurchase decisions per paid child operation, not per parent title. Audio segments, video scenes, 3D assets and mixed storyboard frames can retain different providers/models. Reconcile each original purchase; validate retained byte digests and settings independently; never clear uncertain spend because a new cache key or parent manifest exists. Preserve authorization and retention before serving private evidence.

The original Image 2 incident and investigation remain read-only. No success-rate, latency, cost-consumption or moderation improvement is claimed from these mocked tests.

## Main integration verification

At merge `a83373db`, 65 focused E15/recovery/save-repair tests, 67 shared evidence and frozen-harness tests, three Replay refusal checks and the one hash-pinned selector check pass offline. Full TypeScript and focused E15 lint pass. The release must also include the coordinated save-form recovery commit before final build. Preserve the existing disabled-Memory release policy and its 41 verified migrations: the generic Sites packager copies the full source migration directory and must not be uploaded. Use the repository's verified `scripts/package-disabled-memory-release.mjs` artifact from the same committed build for publication. No live generation is part of verification.
