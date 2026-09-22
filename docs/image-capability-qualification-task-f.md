# Task F — image capability, reference and financial qualification

Local implementation, reviewed against `1587f9067162e38ce437d9cf443faf5620b388ae`, 2026-09-22. No provider requests, secret reads, deployment, environment writes or production routing changes. The historical Image 2 incident and its original prompt remain outside these synthetic fixtures. Original prompt SHA-256 remains `a121553479bb542c2618a51b374e32d1ad88c24a2a316f9580f4b43a72d23953`.

## Integration contract

`worker/image-operation-capabilities.ts` exports `resolveProductionImageOperation(config, options)`. Supply only nonsecret model/provider settings and `falConfigured: boolean`; do not pass WorkerEnv or credentials. It delegates selection to `image-adapter-selection.ts`, which uses `image-generation-policy.ts`. Low resolves Flare even with a legacy Image 2 final override; medium/high OpenAI follows the configured final model. High-quality Fal, native Output storyboard, accepted historical purchases and private Memory keep their separate boundaries. The resolver is specifically for new shared-adapter operations; native `outputFalImage` input is rejected. Labels such as “preview” are not inputs to routing.

Every setting separates caller `requested`, actual `sent`, `effective`, and its `source`. Application defaults sent on the wire differ from omitted provider defaults. Provider-returned model identity remains absent until a real receipt exists. Dated IDs record a requested pin; undated aliases never imply a snapshot. This is observation, not access/budget qualification.

For Task A's `forma-operation-evidence-v1`, map `model` to effectiveModel, endpoint to endpoint, routingPolicyVersion/capability version to their matching fields, and caller quality to requestedQuality. Preserve returnedModel=null before response. Populate wire settings only from `sent.state === 'explicit'`; retain the richer configuration in the private envelope. Entry path and deployment/compiler provenance must come from the caller rather than this resolver. Reference evidence belongs in private retention, never public errors or billing allowlists. A owns central integration; no shared adapter files changed here.

`resolveExperimentImageOperation({...cell, enabled:true})` creates an offline fixed-model plan. Default is disabled. It never writes shared configuration or authorizes dispatch. `validateImageExperimentCell` rejects unknown models/settings, mismatched generations/edits references, unsupported format/alpha/compression combinations and malformed partial counts. Baseline: direct API, low/medium/high or omitted/auto quality, standard sizes, PNG/JPEG/WebP, non-streaming. Both Sunburst/Flare aliases and their `2026-09-08` pins are recognized. B must compare actual requested model against the plan, freeze byte/role/order evidence, and label reference presence as a route factor. K owns cache/recovery edits and must retain original purchase identity.

Task D is not active in the current task inventory. Its handoff requirement: version exact Responses mainline/tool schema and action, prompt revision, no-tool outcomes, usage and orchestration before lifting `responses_runtime_unqualified`. Documented quality/size support does not qualify runtime budgets. `xhigh`, `max`, custom sizes and streaming remain unavailable to new experiment submission until separate opt-in schema and exact-endpoint evidence exist. Existing production streaming is unchanged.

## Primary documentation reviewed

| Source, fetched 2026-09-22 | Decision |
| --- | --- |
| [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) | Both aliases and September 8 snapshots documented. Model cards mark streaming unsupported; do not infer alias resolution. |
| [Generate](https://developers.openai.com/api/reference/resources/images/methods/generate), [Edit](https://developers.openai.com/api/reference/resources/images/methods/edit) | Direct endpoints list qualities, formats, moderation, streaming and reference count. Conflict with model-card streaming remains unresolved. No live runtime qualification claimed. |
| [Responses image tool](https://developers.openai.com/api/docs/guides/tools-image-generation) | Separate mainline model and image tool; action and revised prompt are treatment factors. |
| [Moderation](https://developers.openai.com/api/docs/guides/moderation) | Image input limit 20 MB; audio unsupported. Standalone checks do not preapprove generated media. |
| [Image generation](https://developers.openai.com/api/docs/guides/image-generation) | Existing edit limit of under 50 MB does not supersede moderation. Calculator excludes input/partials; each delivered partial adds 100 output tokens. Aggregate usage inclusion is unverified. |
| [Pricing](https://developers.openai.com/api/docs/pricing) | Each 2.5 model: text $5 / cached $1.25, image input $8 / cached $2, image output $30 per million tokens. Rates do not bound consumption. |
| [chatgpt-image-latest](https://developers.openai.com/api/docs/models/chatgpt-image-latest) | Deprecated; excluded as a parity shortcut. |

## References and optional policy experiment

`validateImageReferenceStageLimits` rejects an entire selection over 16 references, empty/unsupported inputs, or any reference above **20,000,000 bytes**. Decimal MB is conservative because the docs do not define units. Boundary is inclusive; tests cover below/equal/above and formerly allowed near-50-MB files. Integrate this gate before the first moderation call as a separate reviewable behavior change; Task A requested separation from E0a observation and E0b malformed-result validation.

`captureImageReferenceEvidence` snapshots all bytes before asynchronous hashing and records SHA-256, zero-based order, MIME, container-header dimensions, semantic role, source and reference ID. Headers are not proof of successful decoding or content/consent. No byte rewriting, automatic derivatives, reference omission, URLs or prompts are returned. Callers must retain and dispatch the same immutable bytes, with existing private authorization/retention checks.

If an oversized reference is required, propose a separate derivative: original and derivative hashes, dimensions, MIME, order/role, exact transformation, required-content comparison, explicit consent, and retention scope. Do not crop or remove detail merely to pass moderation. Both moderation and rendering must use the approved derivative; identify E9b separately.

`moderation: low` requires an explicit named benign-corpus policy experiment, with automatic-refusal-fallback false. E8 measures auto versus low independently; it never retries rejected content with weaker filtering.

## E16: separate financial admission

`qualifyImageExperimentFinancials` keeps every end-to-end candidate unavailable with `maximumCostMicrousd:null`. It exposes the existing narrow Sunburst alias/high/no-reference/non-streaming Output allowance as an estimate component; no allowance transfers to Flare, dated snapshots, edits, other qualities or Replay. Image 2 historical arithmetic and saved-session readers are unchanged.

Components remain distinct: output, reference input, cached splits, delivered partials, and planner/mainline/check/evaluator overhead. `priceQualifiedImageUsage` prices evidenced split usage only. It rejects missing/invalid cached subsets and unknown partial inclusion, and adds a partial fee only when it is explicitly evidenced as excluded from output tokens. It does not replace existing settlement.

`checkImageExperimentExposure` requires maximum concurrent in-flight operations, maximum total unreconciled exposure, allowance and settlement totals. In-flight operations count as unreconciled exposure. Unknown bounds, duplicate outstanding identities, unsafe arithmetic, concurrency or allowance overruns stop new dispatch. A future dispatcher must atomically check and reserve against a durable ledger; this pure helper is not a scheduler or purchase authority.

Separate empirical qualification proposal, **not authorized or runnable**: qualify one exact model/snapshot/endpoint/quality/size/corpus cell at a time; initial concurrency 1, automatic retries 0, stop on first unknown exposure or missing authoritative usage. Inventory planner/check/evaluator calls separately; gather uncached/cached, references and delivered partials in separate phases. Before any paid phase, record an explicit allowance and numeric maximum unreconciled exposure plus defensible per-operation dollar bounds, or a separately authorized finite-loss arrangement. Until those values and enforcement assumptions exist, phase status is unavailable. A finite attempt count or application reservation cannot prove a provider-enforced dollar cap. Reconcile actual charges and preserve overruns; never manufacture bounds from equal rates.

## Transfer to other media

Reuse versioned operation identity, omission evidence, reference hashes/roles, per-stage admission and separate content/accounting outcomes. Reuse no image-specific parameters.

- Audio: existing `src/model/output-audio-contract.ts` requests one instrumental 20-second track; measure actual duration, codec/sample rate/channels and validate voice/rights policy. Standalone omni cannot classify audio. Qualify audio pricing units and provider duration limits separately.
- Video: `src/model/output-video-contract.ts` is one owned-still four-second clip, 1280×720 or 720×1280. Preserve reference custody, audio policy, frame/continuity requirements and original async purchase recovery. Flare anchors are separate image operations; they do not qualify the video purchase.
- 3D: `src/model/output-model3d-contract.ts` specifies one static GLB and at most one reference; `model3d-assets.ts` limits uploads to 64 MiB and GLB JSON to 2 MiB. Mesh/material/texture/decoder constraints require their own validator, pricing and visual acceptance. These local profile limits are not universal provider capabilities.

## Verification and handoff

52 focused/new and existing routing/budget/replay tests passed with `node --import tsx --test`; full TypeScript check and focused lint passed. Early strip-only runs failed to load existing extensionless imports/parameter properties; the repository's tsx runner resolves them. No live provider calls. New reference fixtures deliberately test headers, metadata and stage boundaries, not full image decoding.

H should select reference admission separately and retain current paid guards. A integrates observation fields. B consumes fixed-model plans and unavailable financial cells. K consumes effective identity while preserving cached original purchases. Financial empirical qualification, D route qualification and production activation remain future work requiring their own review/evidence.
