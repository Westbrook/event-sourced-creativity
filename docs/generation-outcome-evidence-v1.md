# Generation outcome evidence v1

Task A schema published independently of runtime integration. Types: `src/model/generation-outcome-evidence.ts`; synthetic examples: `docs/fixtures/generation-outcome-v1.json`. This publication changes no request, routing, dispatch, classification or settlement defaults.

`pipelineStage`, `providerModerationStage`, `failureKind`, `correctiveActionScope`, `contentOutcome`, `dispatchState` and `accountingState` are independent. Request scope is corrective scope, never evidence of an application origin. A usable artifact can have unknown accounting. Storage failure cannot retroactively make generation a refusal. A moderation pass describes that check only.

Operation identity records entry path, selected provider/model, requested alias/quality, endpoint, routing/capability versions, override provenance and returned identity separately. Null means unavailable; absent settings remain omitted, not provider defaults. No alias resolution, model snapshot, hidden provider moderation stage or revised prompt may be invented. Preserve original Fal/Image 2 receipts. Flare is selected by shared low-quality policy; high-quality Memory preview, native Output storyboard and high-quality Fal remain distinct.

Private evidence observers are awaited checkpoints. Raw envelopes, prompts, moderation details and revised prompts belong in existing actor-authorized private custody with its retention deadline. Billing projections use an explicit allowlist and never acquire private bodies. Request/response hashes are observations, not idempotency or authorization. Existing paid-call checkpoints, unresolved original-request guards and financial settlement remain authoritative.

Safety consumers J/L distinguish local policy, standalone omni flags, attached text scores and downstream media moderation. Unknown/invalid is never a pass. Batch diagnostics have an explicit expected cardinality; they do not share single-result assumptions. No attached text score preapproves generated media.

E0a integrates evidence and classification; E0b separately changes malformed moderation handling to stop before media dispatch. E0b must not be described as dispatch-neutral.

## E0a adoption and compatibility

Ordinary final/Draft image jobs retain request/response references through existing private content custody before downstream work. Planner and image financial completion checkpoints precede any fallible response-evidence write. The private observer does not write prompt bodies into job results or paid submissions. Each moderation probe is independently checkpointed, so its successful result survives a later render error. Job lists redact private evidence references; raw structured errors stay out of `publicFailureDetail`.

Native Output and private Memory retain their specialized custody, deadline, bounded-body and usage contracts. They can consume the optional observer only through their own retention binding. E0a does not retrofit those stores. Deployment version is null where runtime provides no deployment identifier. Compiler provenance names the unchanged reviewed source; unknown provider-returned models stay null. Multipart request hashes remain null because the runtime creates the wire boundary; retained ordered fields/reference hashes are explicitly labelled `multipart-fields`. SSE response hashes describe the received event data, not the entire transport stream. Image response envelopes omit pixel payloads while retaining a hash of the original response data.

No request fields, field order, model defaults, provider selection or paid retry loop were changed. Planner refusal/error/incomplete responses are classified before format parsing; incomplete responses with partial text now stop downstream work. Missing usage retains unknown accounting and the existing hold, including when usable pixels were returned. E0a is an evidence/classification repair, not measured refusal-rate improvement.

## Modality adoption checklist

- Image: use the actual per-operation selection; test text generation, reference edits, low-quality Flare, configured high-quality OpenAI/Fal, streaming errors, usage absence and storage failure independently.
- Stories/scenes/slides: await planner request and response checkpoints before schema validation/repair; retain refusals, incomplete output and actual usage without another purchase.
- Storyboard: maintain one operation identity per frame; native high-quality Ideogram differs from shared low-quality Flare. Recover accepted historical Fal requests by original identity.
- Audio/video/3D: add queue acceptance, status, result retrieval and storage observations under their own capability/usage contracts. Image checks do not certify speech, temporal frames or geometry.
- J/L: consume `SafetyEvidence.source` and explicit validity/cardinality. Local policy assessment, omni flags, attached text scores and downstream media moderation are different evidence sources.
- All routes: preserve authorization/expiry checks at every private write/read; financial records remain source-free; stop on ambiguous paid submissions; never use hashes or schema presence as authorization, idempotency or settlement proof.

## E0b behavior change

The formerly permissive moderation paths now use the bounded UTF-8 reader and unique-key guard already used by private Memory. Every HTTP-success body must contain the exact expected number of results, boolean flags, an object of boolean category flags and, if supplied, finite scores in [0,1]. A false aggregate with a true category is invalid. Missing scores are not manufactured; missing required flags/categories or missing/excess results never pass. Exact text/image probes require one result; snapshot and technique diagnostics require one result per text input.

Malformed JSON, duplicate keys, oversized bodies and invalid shapes return unknown/invalid evidence and stop before image submission. This intentionally changes dispatch. Private Memory still requires its signal, bounded body, unique keys, one result and complete private usage receipt. One existing streaming fixture incorrectly returned SSE to the moderation endpoint; the fixture now supplies a valid moderation response and keeps its original streaming image assertions.

## Verification and integration handoff

Base: `1587f9067162e38ce437d9cf443faf5620b388ae`. The request-parity test imports that exact committed adapter and compares planner/image JSON bytes, reference field order and pixels against the current adapter under mocked fetch. The retry function is byte-identical. Multipart wire boundaries are generated by the runtime and are not claimed identical. Dispatch is per operation: a moderation response does not mean the later image request was sent. Network exceptions retain unknown dispatch and the original pending purchase. Private response-retention failure cannot erase already checkpointed planner usage.

Run the focused suite with `node --import tsx --test tests/moderation-response-validation.test.mjs tests/generation-outcome-evidence.test.mjs tests/generation-request-parity.test.mjs tests/provider-errors.test.mjs tests/generation-execution-evidence.test.mjs tests/generation-safety-diagnostic.test.mjs tests/image-generation.test.mjs tests/flare-draft-generation.test.mjs tests/still-image-policy.test.mjs tests/native-image-generation.test.mjs tests/image-operation-capabilities.test.mjs`. Also run `node node_modules/typescript/bin/tsc --noEmit` and changed-file ESLint.

The broader `output-final-dispatch-deadline.test.mjs` currently has 78 fixture-admission failures (`output_requirements_failed`) before provider work; its representative lost-response case reproduces on untouched main. This is not counted as passing coverage. The targeted native image/routing tests and separate private Memory receipt checks pass. No paid calls, production changes, deployment, support messages, historical receipt rewrite or repeated model migration occurred.

H should integrate A's complete local series, including the schema-only commit and E0a/E0b follow-ups, and deduplicate F capability commit `938e1f03` (equivalent to F `57ded238`). F's reference admission and financial qualification changes remain separately selectable. B/D/E/G/J/L can consume the schema without activating adapters. Cross-media adoption and new native custody bindings require their own route fixtures; this image evidence work is not a parity claim for those routes.
