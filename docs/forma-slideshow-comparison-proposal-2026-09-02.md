# First Forma slideshow comparison — proposal only

Prepared 2026-09-02. No paid runs, source edits, output rewrites, or deployments are authorized or performed by this research note. The broader 23-call/$14.18 study is deferred: it would leave only $4.414557 for native completion after the last $11.405443 recorded-plus-held exposure, which is too little contingency while that native delivery remains blocked.

## Bounded first stage

Use the exact retained six-slide source “One document. More ways to use it.” as frozen input. Run one first-pass composition per arm: Terra medium, Terra high, Sol medium, Sol high. The baseline is the previously recorded Terra-low behavior plus current offline fixtures, not a fresh extra paid call. This stage compares model and effort at an unchanged output cap; it cannot establish stable quality superiority from one sample.

All four arms receive identical instructions, source/options/schema bytes, authored opening and closing wording, validators, rendering rules, standard service tier, and **6,500 output tokens**. Preserve the actual current manual cap, including reasoning and formatting tokens; no automatic second attempt or validation repair is allowed in this four-call evaluation. Do not substitute the managed 7,200-token cap into a manual comparison. If a managed comparison is separately selected, all four arms must instead share its current 7,200-token cap and a new predeclared ceiling.

The complete wire request has an upper input allowance of 64,000 tokens, including instructions/schema/envelope; construct and check it before dispatch. Do not clip source evidence to fit. Bind `service_tier: "default"` and `prompt_cache_options: { "mode": "explicit" }`, with no cache breakpoints, to every arm. Freeze and compare request digests after excluding only the deliberately varied model and effort. Store the full per-arm digest as well. The official cache guide documents that explicit-only mode without breakpoints does not cache or create writes. [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

| Arm | Calls | Input cap | Output cap | Conservative maximum |
| --- | ---: | ---: | ---: | ---: |
| Terra medium | 1 | 64,000 | 6,500 | $0.238 |
| Terra high | 1 | 64,000 | 6,500 | $0.238 |
| Sol medium | 1 | 64,000 | 6,500 | $0.450 |
| Sol high | 1 | 64,000 | 6,500 | $0.450 |
| Total | 4 | — | — | **$1.376** |

These bounds deliberately retain the helper's more conservative all-input-cache-write tariff, even though the request disables caching. With full ordinary-input charging under that policy, the bound is lower ($1.184), but do not rely on that saving to admit more calls. The numbers include every output token, not only visible JSON. [Current pricing](https://developers.openai.com/api/docs/pricing).

A rounded **$1.50 first-stage ceiling** plus the last $11.405443 recorded/held exposure totals $12.905443, leaving **$17.094557** of the original $30 for native completion and contingency. Refresh the ledger before admitting this stage; the two existing $1 uncertain reservations remain held. Do not treat this calculation as proof they were reconciled or that no other charges occurred meanwhile. If the application route enforces a larger reservation floor, use that actual admitted amount in the budget check instead of the mathematical helper bound.

## Stop rules

Run serially with a durable pending identity and allowance before each dispatch. Stop the entire stage on ambiguous submission, request/response identity mismatch, unavailable/malformed core usage, contradictory cache/tier evidence, unrecoverable response persistence, or deadline/permission failure. Retain unresolved allowance; do not resend. An ordinary definitive model/output failure still consumes that arm's cost and does not grant a retry. Never exceed four submitted calls or the refreshed first-stage budget.

If the first completed arm is `incomplete` because its output limit was exhausted, retain usage and visible output, and pause the sweep to review whether the cap is the dominant problem. A 25,000-output-token follow-up would be a separate controlled cap experiment, not part of this approval or proof of a model-only improvement. If no arm passes source/quality requirements, stop and report that outcome rather than buying repairs automatically.

## Evidence and native delivery

Record each arm's requested/returned model and effort when disclosed, frozen policy/tariff versions, request/source/schema hashes, output cap, cache counter derivations, provider IDs, complete normalized usage, raw response reference/hash, status, incomplete reason, and independently priced cost. Report first-pass validity and exact validation codes; score source fidelity and visible duplication before blind native-viewer readability/overflow checks. Private provider reasoning text is not needed and must not be copied.

Measure dispatch-to-response and response-to-durable-checkpoint duration separately from local validation/rendering time. Report four raw durations, not a synthetic p95. No paid judges. A valid contender may inform a separately admitted native completion using the same frozen settings and existing workflow; an evaluation artifact is not the native slideshow and does not authorize overwriting the source or already completed podcast/video.

Do not deploy a Sol default from this single comparison. Keep Terra-low production defaults unless a scoped decision is supported by complete cost and quality evidence. Rollback changes only future slideshow configuration; frozen in-flight calls and settled historical receipts retain their original settings.
