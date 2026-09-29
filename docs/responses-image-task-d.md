# D: disabled Responses image experiment

Local implementation on `codex/responses-image-disabled`, based on current main `2a0caa914a0c57002f9b69ff3b60cb3d6d8a687f`. The verified release baseline `faa8fb42` is an ancestor, not a frozen claim about main. A (Production 503), B/F (504), and K (509) are reused. This task does not republish them or repeat either image-model migration.

The module is **disabled and offline only**. `worker/responses-image-experiment.ts` has no transport, SDK, credential access, private-source retrieval, persistence, runtime registration or enabled override. Its dispatch entry always throws `responses_runtime_unqualified`. Financial status is unavailable; maximum and settled cost remain null. F2's direct-image allowance cannot transfer. Existing production streaming and private Memory activation/custody are untouched. Implementation completion is not runtime qualification, user acceptance or permission to spend.

## Files and interface

- `validateResponsesImageCell`: strict exact-cell validator; rejects extra history, references, models, settings, authorization booleans and credential fields.
- `prepareResponsesImageExperiment`: snapshots the explicit brief, produces exact request JSON and SHA-256 identities, and records selected context and F's unchanged runtime block.
- `inspectResponsesImageObservation`: pure held-envelope parser; accepts mocked HTTP, stream-event and cancellation/transport observations. Its entire output is private evidence.
- `responsesImageOperationEvidence`: maps separate mainline/image identities into A's existing `forma-operation-evidence-v1` without modifying the shared schema.
- `responsesImageStageAccounting`: non-additive stage rows; response/tool usage may overlap and cannot be summed into settlement.
- `responsesImageRecovery`: preserves original IDs and zero automatic replacement purchases; grants no retrieval/cancellation authorization and performs neither action.
- `prepareDirectVersusResponsesRecipe`: produces two exact payloads from the same validated cell. The checked-in [synthetic recipe](fixtures/responses-image-two-arm-recipe.json) is reproducible, not a live manifest.
- `tests/fixtures/responses-image/observations.json`: success, error, no-tool, refusal, incomplete and stream observations; all IDs/content are synthetic. The PNG signature-only result tests envelope/base64 handling, not image decoding, dimensions, fidelity or successful generation.

## Official sources, fetched 22 September 2026

The [image-tool guide](https://developers.openai.com/api/docs/guides/tools-image-generation) lists `gpt-5.5` as supported; this task deliberately selects it separately from `gpt-image-2.5-sunburst`. Documentation examples use other mainline names; those examples did not substitute our choice. The successful chat's composer is not an image-model receipt.

The [Responses request/result reference](https://developers.openai.com/api/reference/resources/responses/methods/create) documents explicit image-tool model/action, tool selection, result items, optional revised prompt and response usage. The [direct generation reference](https://developers.openai.com/api/reference/resources/images/methods/generate) supplies the other arm's request shape. `image_generation_call.revised_prompt` is retained only when returned; response-level `model` identifies the mainline, not the image model. Optional image-call model/usage extensions are preserved if present, not required or promised by the result schema.

The [image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and F's dated contract identify streaming/billing questions requiring endpoint-specific evidence. A schema or model listing establishes no account access, runtime behavior or dollar bound. Source review used the actual official Markdown schema as well as opened guide/reference pages.

## Capability and coverage matrix

| Cell or behavior | Documentation/schema | Offline coverage | Runtime/financial status |
| --- | --- | --- | --- |
| `gpt-5.5` → `gpt-image-2.5-sunburst`; action generate; one user brief; zero assets | Explicit supported selections | Exact JSON/hash/context validation | Unqualified / unavailable |
| High, 1536×1024, PNG, opaque, moderation auto, non-streaming | Compatible shared settings | Exact two-arm payload equality | Unqualified / unavailable |
| Tool success, absent revised prompt, optional returned identity | Parsed without invented fields | Mocked; pixel usability unjudged | Unqualified / unavailable |
| No-tool or text-only answer | Distinct outcome even with forced tool choice | Mainline usage retained; no replacement | Charge/consumption unknown |
| Refusal, incomplete, HTTP error, missing/invalid usage | Independent content/dispatch/accounting axes | Mocked terminal precedence; all held evidence retained | No automatic retry |
| More than one image call, unknown tool, action/model/settings drift | Outside frozen single-cell contract | Rejected; returned usage/calls preserved | Unknown exposure, stop |
| Streaming/SSE, partial images, stream error/truncation | Requires exact route/model verification | Retained/rejected, never promoted to qualified final | `stream_unsupported`; unavailable |
| WebSocket, background or multi-turn transport | Outside this interface | No dispatcher | Unqualified / unavailable |
| Reference/edit/mask/history, Flare, pins, other mainline, xhigh/max/custom sizes | Broader options need new cells | Inputs rejected before plan | Unqualified / unavailable |
| Production direct streaming, shared low Flare, configured high Sunburst | Existing production contracts | Existing routing/image regression suites, unchanged source | No new qualification claimed |
| Native high Fal/storyboard, strict high Memory | Separate contracts | No integration change; native regression suite | Existing activation unchanged |

Absent settings are not provider-confirmed defaults. The prototype requires every shared setting explicitly. Compression and partial count are omitted, not invented; zero assets is an exact empty inventory. No system/developer message, history, conversation ID, previous response, attached moderation or silent context truncation is added. `store:false` is a request property, not a claim of zero provider retention or an access control.

## Evidence and stage accounting

A request record retains the brief/context, empty ordered asset list, selected mainline and image model, exact body/hash, and orchestration fields. Response evidence retains HTTP request ID, Responses ID, each image-call ID, actual returned identity/action/settings, and optional revised prompt. No alias is resolved from a model label. Unknown returned settings remain unknown. Hashes are observations, not idempotency keys or access authority.

| Stage | Retain and count | Current accounting interpretation |
| --- | --- | --- |
| Source/planner preparation before either arm | Frozen source/direction identity and any original preparation receipt | Outside this parser; no invented historical planner envelope |
| Existing standalone moderation | Independent request/verdict/usage/timing receipt for each actual probe | No fabricated pass or downstream-image preapproval |
| Responses mainline orchestration | Response usage, cached/reasoning breakdown when valid, request/response IDs, terminal state | Tokens observed; mainline allocation and overlap with image usage unqualified |
| Image tool | Every returned call ID/action/result and optional tool usage | Tool rows are non-additive; missing usage is unknown, not zero |
| No-tool | Terminal response, text/refusal as private content, actual response usage | No image output call observed, but mainline charges may exist |
| Transport/abort | Original IDs, dispatch not-started versus uncertain | Before dispatch can be not-incurred; after submission remains unknown |
| Retrieval/storage/evaluator | Separate original operation checkpoints and qualified receipts | Not implemented here, never inferred from received base64 |

`image_returned` means one structurally matching completed call with valid nonempty base64. Content remains `unknown` until decoding, intended dimensions, custody and fidelity are independently checked. Refusal or incomplete response wins over any partial image. Receiving HTTP success never settles money. Aggregate response usage and optional tool usage are never added together without authoritative inclusion evidence. Partial stream events cannot establish final usage or output. Duplicate done events do not multiply observed call count.

**H's required future checkpoint ordering (proposal, not implemented here):** persist original attempt/admission before dispatch; preserve existing paid-call/financial completion checkpoint before fallible private response storage; then await private evidence, decode/custody and result projection. A private evidence/storage failure must not erase usage or turn a generated artifact into a safety refusal. Missing usage retains the original hold. No tool or transport failure starts a replacement purchase. An uncertain request must reconcile only its original identity, if a separately authorized transport/storage mode actually supports retrieval. `store:false` does not promise recoverability; no blind retrieval or background cancellation is added.

Private retrieval and every write must use the existing authenticated owner and unexpired retention binding, including shared-membership/current-authorization checks. The pure module does not implement a new authority surface. A caller-supplied `authorized:true` is rejected as a cell field and never authorizes an access. Do not pass the private result or its raw response into public errors, job lists or billing metadata. H must use A's allowlisted projections and existing private stores. No historical incident/source retrieval or rewriting was performed for this task.

## Route-specific qualification checklist

All empirical items below remain **missing evidence**; keep `responses_runtime_unqualified`, financial unavailable and maximum cost null until independently reviewed evidence exists.

- **Schema/version:** freeze the exact request JSON, source/adapter/capability revisions, chosen mainline alias or separately qualified pin, image alias/pin, tool action, selected context, complete ordered assets, output settings, forced tool choice and orchestration flags. Reject unsupported shared cells before dispatch. Account/project access must be verified only under later authorization.
- **Runtime:** qualify non-streaming on this exact model pair and account. Observe successful tool, no-tool, refusal, incomplete, tool failure/multiplicity, unexpected tool, setting drift, missing/corrupt result and usage. Pin bounded response/JSON parsing and duplicate-key rules before accepting actual network data; the held-object parser is not a network reader.
- **Mainline tokens:** verify input/output, cached input, reasoning, actual model/pricing identity, output-token limits and their semantics. Bound mainline consumption conservatively. A no-tool answer can still incur tokens. A token limit is not a complete image-call dollar cap.
- **Image call:** verify actual call count, image usage availability, text/image input/output split, cached subsets and aggregate inclusion. Requested tool choice/action does not prove exactly one billed image call. Preserve unexpected calls and reconcile their exposure rather than dropping them.
- **Action and orchestration:** generate only in this cell; edit/auto/multi-turn each require independent cells. Account for automatic revision and mainline reasoning, hidden/unknown internal work, no-tool failures and any application repair/evaluator calls. Application automatic retries remain zero.
- **Transport:** JSON first. Streaming requires separate delivered-partial billing, completion/error/abort/truncation, duplicate/out-of-order event and body-size evidence. WebSocket/background requires separate lifecycle/recovery/retention/cancellation qualification. Existing production streaming is not proof for this route.
- **Costs/admission:** use current official model rates only with qualified consumption assumptions and reconciled receipt allocation. Include planner/moderation/mainline/image/retrieval/storage/evaluator overhead, failed calls, cached splits and delivered partials without double counting. F2's allowance is scoped to direct Images and must not satisfy any Responses row.
- **Exposure/settlement:** reviewed numeric per-operation limits or a separately authorized finite-loss arrangement, total maximum unreconciled exposure, atomic reservation, concurrency one initially, account/time block and stop on unknown exposure, systematic access errors, unexpected unsafe output or critical intent loss. Reservations and request counts are not provider-enforced caps. Preserve charge overruns and original purchases.
- **Authorization:** a later empirical qualification has its own immutable reviewed manifest, exact preparation/trial inventory, number of cases/repeats, all stages, numeric financial terms and explicit live authorization. Nothing in this implementation or synthetic recipe grants that authorization.

## Exact later two-arm recipe

[The checked-in JSON](fixtures/responses-image-two-arm-recipe.json) gives exact synthetic bytes and hashes for local review. To create an actual study, H must replace the synthetic cell with legitimately retained complete input through existing owner/retention authorization, then freeze a new immutable recipe/manifest. No historical missing source or planner result can be reconstructed. Missing source is a preparation decision, not permission for a planner call.

1. Freeze one byte-identical input brief for both arms, its source/planner/compiler identities, and empty assets. If the brief is an existing compiled render prompt, use that exact text twice; do not rerun the planner for only one arm. Any separately authorized new preparation happens once before freezing and is accounted for separately.
2. Direct: `/v1/images/generations`, `model:gpt-image-2.5-sunburst`, `prompt:the frozen brief`, `n:1`, high/1536×1024/PNG/opaque/auto, `stream:false`. No reference or compression fields.
3. Responses: `/v1/responses`, `model:gpt-5.5`, exactly one user `input_text` containing the same brief. One `image_generation` tool with explicit `model:gpt-image-2.5-sunburst`, `action:generate`, identical shared output settings. Force image tool choice, `parallel_tool_calls:false`, `stream:false`, `store:false`; no prior response/conversation/history/instructions. No invented `n` tool field or silent mainline substitution.
4. Keep the same authorized account/project and time block; prespecify paired arm order, case IDs, repetitions and initiated-trial denominator. Hold any existing standalone input checks constant with their own receipts; preflight blocks remain observed initiated outcomes and do not get replacement cases.
5. Record request/response/tool identities, selected context, returned revision only if present, all outcomes, actual usage/unknown cost and separate stage timings. Blind human fidelity review against original requirements; no inference from similarity to the successful ChatGPT artifact. Unexecuted rows remain unexecuted after stops.
6. Treat this as **route plus mainline orchestration and automatic prompt revision**, not a pure endpoint effect or proof of ChatGPT internals. If a required image model/setting is not shared, reject the isolated recipe. A deliberate composite comparison needs a new manifest naming every changed factor; never silently replace a model from an example.

This route is optional for the first C direct-image comparison. Model-by-route and clean-prompt-by-route interactions require isolated results first, then all supported factorial cells or explicit missing-cell limitations. One success cannot establish refusal-rate improvement.

## Cross-media applicability

Reusable proposals are separate operation identity, all-exit usage preservation, non-additive accounting, no-tool/refusal/incomplete separation, original-request recovery and private evidence before public projection. Images alone have this mocked tool envelope. Stories/slides need exact text/schema/factual tests; audio requires speech/voice/codec/duration tests; video requires queue/frame/temporal continuity and per-child original purchases; 3D requires geometry/material/scale and asset validation. No `image_generation`, `revised_prompt`, image moderation setting or image cost rule is invented for those media. Native storyboard and private Memory need their existing specialized authorization/moderation/usage stores; this module cannot activate them.

## Verification and H handoff

Verification commands and final counts are recorded in `docs/responses-image-task-d-handoff.json`. Initial module/capability/financial suite passed 32 tests, full TypeScript and changed-file lint passed. Further regression results are recorded separately in the handoff. All fixtures are synthetic; provider requests, new purchases, actual spend and deployments are zero. No success-rate, real image fidelity, transport, cancellation-at-provider or empirical cost claim is made.

H confirmed ownership of central hooks. No changes to `worker/openai-adapter.ts`, `worker/document-jobs-api.ts`, shared schemas/F qualification, K's runner, routing, production configuration or private Memory are bundled. H may review the additive module and link this evidence without making D a gate for C. A later activation must be a separate change after the checklist; do not cherry-pick A/B/F/K again. Current review state remains unacknowledged; task-specific report updates preserve all other work and feedback.
