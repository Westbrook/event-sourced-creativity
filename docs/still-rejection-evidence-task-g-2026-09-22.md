# G: retained generation evidence and comparison

Local implementation on `codex/rejection-evidence-ui`, based on current main `2a0caa914a0c57002f9b69ff3b60cb3d6d8a687f`. `faa8fb42` remains the verified foundation release baseline, already an ancestor. A (503), B/F (504), and K (509) were consumed in place. No foundation cherry-picks, model migrations, provider calls, deployment, production settings, credentials, infrastructure or historical source retrieval occurred.

## Delivered

`src/still/rejection-page.ts` consumes A's outcome/operation/private evidence schema through `src/still/rejection-evidence.ts`. It calls the existing `generationOutcomeSummary`; it does not classify raw messages again. Pipeline origin, corrective scope, input/output/unknown provider moderation and content/dispatch/accounting outcomes are separate. Historical stage fields remain explicitly legacy and verbatim. Access, rate-limit, incomplete planner and storage failures receive distinct explanatory copy. A stored usable outcome survives a storage failure. Document names, generic messages and local moderation passes do not establish a provider cause or approval.

Each captured operation shows its provider, selected/requested/returned model, endpoint, quality, routing policy/override, exact recorded settings, request/response IDs, and immutable observation. Missing envelopes remain missing per operation. Flare/Sunburst/Fal labels come only from receipts; no inference from Draft, preview or final. The fixture includes mixed original Fal retrieval and OpenAI operations.

Prompt, frozen source, private receipt and each stage observation have independent availability and expiry. A retained prompt, expired source and absent response are an explicit fixture. Missing deadlines remain unknown; the API remains authoritative. No cached client event history is used to reconstruct private frozen inputs. Expired bytes are discarded after parallel reads, mounted known deadlines trigger a fresh owner read, and view changes clear private state. Revoked authorization clears both sides of comparison. Stage metadata and schema presence confer no authority.

Comparison accepts an original attempt ID in the same document, uses only the existing owner-scoped read endpoints, and displays exact before/after prompt, source/reference descriptors, private configuration, per-operation route/model/quality/settings and retained request envelopes. Immutable source links include the selected comparison ID and source anchor; reopening performs only the same authorized reads. Missing reference bytes are never downloaded or reconstructed. Simultaneous route/model/quality changes are disclosed and cannot be presented as a model-only causal study. Comparison values remain page-local, with no persistent private cache.

The toolbar now says **New paid attempt**, and the inspection action **Inspect failure** covers other failed/partial jobs without relabeling them safety refusals. Original-request recovery remains the existing separate output-page action; this page introduces no recovery endpoint or mutation. Its description distinguishes existing bounded original status/result reads from a fresh purchase. Local preflight acknowledgement retains its exact existing prompt/reference scope and remains on the output page; provider refusals cannot be acknowledged away.

## Boundaries and H coordination

H confirmed G ownership of the page, focused helpers, narrow `StillClient.inspectGeneration` hydration/comparison, and action copy. No shared contracts, `worker/openai-adapter.ts`, `worker/document-jobs-api.ts`, recovery, financial, provider routing, or Memory activation logic changed. H owns continuation integration and the global report handoff.

Personal stage hydration uses A's returned `generationEvidenceRefs` and the existing authorized `/api/events?...contentId=...` read. Shared/project scope continues through the existing `/private-receipt` route only. Where that route does not expose stage bytes, G shows unavailable and never falls back to a broader content read. An explicit forbidden response retains the client's existing session-invalidating behavior. A future shared private-stage route needs a separate owner/custody/retention binding coordinated by H; this UI does not invent one.

The local source comparison is independently useful. It does not block C/F2's first study, qualify cost, prove better acceptance, or authorize live testing.

## Verification and review

Synthetic review: `http://127.0.0.1:4211/tests/still-rejection-browser/index.html?progress-report`. Select a fixture; enter `comparison` to inspect differences, or `denied` to exercise revoked access. This is the actual component and Still client against in-memory GET-only fixtures, with no Worker/backend. The fixture has its own existing-token styling. The canonical Progress Report remains `http://127.0.0.1:4187`; G updates only its task records and `handoff.generationTaskG` through `update.mjs`.

83 focused offline tests passed across rejection evidence, Still client/navigation/action semantics, generation input receipts, A outcomes, route and title regression. Full TypeScript, changed-file ESLint, localization checks, and application production build passed. The build reported its existing large-chunk warning. Browser verification covers 12 scenarios, desktop 1360×1000, mobile viewport 390×844, keyboard comparison submit/disclosure, exact comparison, read-only links, stale navigation responses and authorization revocation; final evidence is recorded below. This is emulated browser layout, not physical-device or screen-reader certification.

Run from this worktree:

```sh
node --import tsx --test tests/still-rejection.test.mjs tests/still-rejection-evidence.test.mjs tests/still-generation-decision.test.mjs tests/generation-input-receipts.test.mjs tests/generation-outcome-evidence.test.mjs tests/still-page-title.test.mjs tests/still-routes.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js --config tests/still-rejection-browser/vite.config.mjs
node tests/still-rejection-browser/run.mjs
```

Restart the static Vite fixture after source edits: tooling/HMR is deliberately disconnected. Browser runs create unique `/private/tmp/forma-g-browser-*` directories containing screenshots and result/source hashes. No historical run is overwritten. `node_modules` in this isolated checkout links the existing repository dependencies; no installation was needed.

## Cross-media applicability

| Route | Tested here | Remaining qualification |
| --- | --- | --- |
| Shared image/Still | Current A-schema synthetic planner, moderation, media, storage; Flare/Sunburst and mixed Fal identity | No live effectiveness, acceptance, latency or cost claim |
| Storyboard | Synthetic distinct per-operation original Fal identity | Real native/Fal per-frame custody and recovery remain their existing contracts; no native dispatch change |
| Stories/scenes/slides | Planner refusal/incomplete presentation and IDs | Actual route-specific E adoption and private envelope availability need each adapter's tests |
| Audio/video/3D | Generic stage/source/unknown semantics can present the same schema | No modality-specific output quality, temporal fidelity, voice, geometry or private endpoint qualification claimed |
| Private Memory | No route or activation changes | Strict dedicated custody/moderation/usage and current disabled activation preserved; no UI badge certifies Memory |

User review remains unacknowledged. H may integrate this additive UI commit after checking current main and the narrow client/decisions/title overlaps. Any further route/custody work, deployment or live study requires its own scope and authorization.

Final browser evidence: `/private/tmp/forma-g-browser-1790097904716/result.json` and adjacent desktop/mobile screenshots. That run pins the component/client/fixture source hashes, covers comparison source permalinks across reload, and records zero non-GET or provider calls. The fixture config uses its current checkout root for portable H integration.

## Authorized Production continuation

The user subsequently explicitly requested merging G to main and publishing Production. This supersedes only the original local-only publication restriction; it does not authorize live generation, provider studies, changed defaults, Memory activation, or broader evidence access. Release order was coordinated with E and D. G reconciled with E's published Production 512 source `deb96fa50fb5ebcc94c560b34656a2b28418ae16`, retaining F2 Production 511 and all earlier published foundations; merge `7efd3a936970293944d837e545d6246d9d59e487` was clean. The 83 focused tests pass on that combined source. Production packaging retains the existing 41-migration disabled-Memory hold, runtime environment and workspace audience. Exact final source/version/deployment results are appended to G's canonical Progress Report handoff through its atomic helper; original offline evidence remains immutable. User review remains unacknowledged.
