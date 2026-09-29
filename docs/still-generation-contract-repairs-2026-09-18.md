# Local generation contract repairs

Baseline: published `2face013e96a9796302ba9a5f44bef16706a1f79` (v419).
Scope: local source and synthetic tests only. No real provider requests, financial
operations, historic receipt changes, or deployment.

## Exact moderation

`moderateExactImagePrompt` now submits the supplied prompt verbatim. Software
keywords no longer replace words or assert that content is fictional/non-graphic.
Independent reference-image checks and provider flags remain unchanged. The
optional historical `promptNormalization` receipt field remains readable; new
receipts do not emit it.

A regression covers all ten formerly recognized software keywords alongside
literal violent subject matter. The intercepted moderation request must equal the
original prompt exactly, and a flagged response must stop before image dispatch.
This is a contract test, not a measurement of real moderation model behavior.

## Review the original generation

Still's failed-job **Review generation** action navigates to the original job ID.
It does not choose a format, create a draft or enter the direct-generation path.
Viewing does not require permission to generate another image. Existing safety
failures continue to offer context review; unsupported job kinds fall back to
Results. A separate explicit generation action is still required for new work.

The regression invokes the actual notification rendering method and its action
callback for image and video jobs, with and without generation permission. It
rejects any call to the new-generation handlers.

## Sunburst: qualified rates, unqualified output-token estimate

The requested `gpt-image-2.5-sunburst` default and verified token rates are retained.
The [official model documentation](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
confirms uncached rates of $5/text input, $8/image input and $30/image output per
million tokens, but distinguishes its token consumption from GPT Image 2's
calculator. The [image-generation guide](https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency)
provides a model-aware calculator; equal token rates do not imply equal image cost.

`outputImageBudget` therefore returns `null` for Sunburst instead of supplying the
GPT Image 2 formula and its verified-contract label. The previously qualified
GPT Image 2 calculation remains unchanged. Bounded native Output preflight uses
its existing `output_native_image_price_unknown` refusal, supplies no image-budget
settings and rejects authorization. The provider-adapter dispatch guard also
rejects absent budget contracts when that bounded execution contract is required.
No automatic fallback model/provider is introduced.

This refusal is scoped to the bounded native Output route. It is not a claim that
all image-generation routes are disabled, and it does not revise previous grants,
provider usage, charges, or retained receipts. Unrelated legacy route budgeting is
outside this narrow repair.

Synthetic real-handler tests cover both an omitted model (the Sunburst default)
and an explicitly selected Sunburst model. They verify no provider fetches and no
new jobs, grants, provider-call records or budget reservations, including after an
explicit authorization attempt. They also verify default selection and token
rates remain unchanged.

## Replay model agreement

Replay estimates now read the shared generation contract's default model instead
of independently defaulting to GPT Image 2. A regression compares an unset model
and explicit Image 2/Sunburst overrides against actual adapter selection. This
fixes the model identity mismatch; it does not qualify replay's historical Image 2
token assumptions for Sunburst.

An additive repair after `00e9366473495a11433f679554a281b106d356e1` shares
`hasQualifiedReplayImageEstimate` across Replay preflight, approval and session
creation. Only the explicit, previously qualified Image 2 model passes. Unset or
explicit Sunburst and unknown models return `replay_image_estimate_unqualified`;
preflight disables both run flags, approval refuses before inserts, and creation
refuses before consuming even a retained approval. Budget preflight reads no
longer initialize counters. Historical approvals, receipts and templates remain
unchanged, and the requested Sunburst default/rates remain in place.

Real-handler synthetic tests prove unqualified requests perform no writes or
fetches and retain old approvals byte-for-byte after default migration. An
explicit Image 2 control can still approve and start against an in-memory database
and mocked provider that definitively rejects planning. It confirms existing
admission without a real provider request or financial hold. This does not enable
Sunburst Replay; a model-specific estimator must be qualified first.

Replay validation: all 16 focused cost/admission tests pass. The broader run
passes 31 of 32 tests; the remaining historical source assertion in
`tests/live-replay.test.mjs:203` expects `x-forma-impersonation-confirmation` in
`worker/pilot-policy.ts`. That file is byte-identical to `00e9366` and lacks the
string in both versions. The failed broader run and baseline comparison are kept
in the independent report's evidence directory, without relabeling that suite as
passing or changing unrelated historical tests.

The Still image-policy integration test now captures the outgoing image request
and asserts its Sunburst model outside the intercepted fetch callback, then checks
the persisted definitive provider rejection. Previously a stale Image 2 assertion
inside that callback could be swallowed by production error handling. Historical
closure-pinned mini-app tests are not treated as qualification for this migration;
Sponsor/Guest templates and their explicit Image 2 contracts remain untouched.

## Remaining activation requirement

A separately reviewed Sunburst-specific output-token estimator must establish
quality/size semantics, model/snapshot scope, boundary cases, estimate version and
allowance wording before bounded native Output admission is enabled for Sunburst.
Do not reuse Image 2's formula or mark a copied estimate verified. This repair
neither establishes actual overbilling nor authorizes paid probes, retrospective
receipt rewrites or publication of the separate mini-app candidate.
