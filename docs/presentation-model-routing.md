# Slideshow model routing and accounting

The local repair integrates routing with the adapter, admission, durable call receipts, and settlement paths. It has not been deployed, and no production overrides have been set. Deploy only the complete tested integration after live-verification approval.

## Configuration

Only slideshow composition and editorial repair use these server-owned settings. Chat, suggestions, image direction, audio preparation, and specialist speech/video providers retain their existing routing.

| Setting | Supported values | Omitted value |
| --- | --- | --- |
| `OPENAI_SLIDES_COMPOSITION_MODEL` | `gpt-5.6-terra`, `gpt-5.6-sol` | `OPENAI_MODEL`, then `gpt-5.6-terra` |
| `OPENAI_SLIDES_REPAIR_MODEL` | `gpt-5.6-terra`, `gpt-5.6-sol` | `OPENAI_MODEL`, then `gpt-5.6-terra` |
| `OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `low` |
| `OPENAI_SLIDES_REPAIR_REASONING_EFFORT` | `none`, `low`, `medium`, `high`, `xhigh`, `max` | `low` |

Blank or unsupported settings fail before admission; omit a setting instead of supplying a blank. Both workflows must validate before the first paid call. Repair does not implicitly inherit a composition override. Deployments using a different global `OPENAI_MODEL` must set both slideshow models explicitly. The module makes no claim that an account can access a model simply because its ID is supported.

Resolve both routes once and freeze them with the accepted request. Capture the requested model and the provider-returned model when disclosed, effort, standard service tier, cache policy, phase, output cap, routing version, and pricing version on every call. An omitted returned model stays undisclosed; `model` and the frozen pricing receipt identify the requested tariff, not invented response evidence. Admission and dispatch must agree on these exact settings. A later environment change must not silently alter an already approved repair. Client payloads cannot select or overwrite the frozen routes.

`editorial-rewrite` includes managed whole-work repair even when the adapter internally labels it an initial pass. Manual and managed modes otherwise share the same defaults. Manual generation makes one initial call and at most one validation repair. A managed page may additionally be rewritten after whole-work review, with one validation repair of that rewrite: at most four calls per page. If the original page remains invalid after two calls, it fails before whole-work review and does not consume the other two possible calls.

## Cost evidence

The new helper prices standard direct-API usage separately from the existing historical replay-pricing helper. Do not rewrite settled ledger records when a tariff changes. Persist the new helper's tariff snapshot and breakdown with each immutable provider-call identity; sum per-call costs rather than pricing mixed-model aggregate tokens under the final model.

On 2026-09-02, short-context ordinary/cache-read/cache-write/output rates per million tokens are Terra $2/$0.20/$2.50/$12 and Sol $4/$0.40/$5/$20. Input beyond 272,000 tokens uses the published long-context rates. Sol's current promotion is documented as lasting at least through November 21, 2026; verify it before later new authorizations. [Official pricing](https://developers.openai.com/api/docs/pricing).

Measured ordinary input equals input tokens minus cache-read tokens minus cache-write tokens. The current [Responses usage schema](https://developers.openai.com/api/reference/typescript/resources/responses) declares both cache counters as numbers; it does not promise that absent counters mean zero. Default decoding stays strict. The receipt records usage priced at a published tariff, not an invoice; round input and output subtotals up once to the micro-USD ledger unit.

New slideshow requests bind `cachePolicy: "disabled-explicit"` to the frozen quote and send `prompt_cache_options: { "mode": "explicit" }` with **no** `prompt_cache_breakpoint` content blocks. The official guide states: “When no explicit breakpoints are placed, the request does not use prompt caching or create cache writes.” [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Only after verifying that wire policy may the adapter call `readOpenAITextUsage(rawUsage, { cachePolicy: "disabled-explicit" })`. Absent cache counters are then derived as zero; present malformed or nonzero counters fail closed. The resulting receipt stores `requestPolicy` and `derivedUsageFields` separately from normalized usage, and uses `costBasis: "measured_usage_request_policy_published_tariff"` when derivation occurred. All core input/output/total counts remain required; missing reasoning detail stays null. Standard service tier alone does not disable caching. Non-slideshow requests and historical receipts are unchanged.

Reasoning tokens are already included in output tokens and must never be charged twice. The output cap bounds reasoning, visible output, and non-visible formatting tokens together. Preserve the current 6,500-token manual and 7,200-token managed six-slide caps unless a separately admitted evaluation or configuration explicitly changes them; increasing effort alone does not increase those caps. [Reasoning budgets](https://developers.openai.com/api/docs/guides/reasoning).

A reservation assumes every potential input token is charged as a cache write, plus the complete output cap. Reserve composition and repair separately with their own model rates. Before each next call, require prior received cost plus unresolved held allowance plus this call's maximum to fit the approved ceiling. Missing usage, contradictory receipts, or uncertain submission must stop new paid work and preserve the relevant hold. A provider failure never authorizes model escalation or blind resubmission.

## Rollout and rollback

Verify the integrated route/receipt/settlement paths before enabling an override. Keep defaults unchanged, use a small separately approved frozen-input pilot, and promote only a measured quality improvement within the approved aggregate cost and latency bounds. Remove only the slideshow override settings to roll back future requests; frozen in-flight calls and historical receipts retain their original settings. No database deletion, source rewrite, audio/video rerender, or reservation release is part of rollback.
