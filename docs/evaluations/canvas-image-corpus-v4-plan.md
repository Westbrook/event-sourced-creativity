# Ideogram 4 adapter v8 qualification plan

Candidate: `fal-ideogram-v4@v8`  
Prompt adapter: `ideogram-context-v2`  
Frozen corpus: `canvas-image-corpus-v4`  
Status: **PAID QUALIFICATION STOPPED; V8 IS NOT APPROVABLE**

## Decision

V8 is a new qualification candidate, not a continuation of the stopped v7 run. The v1, v2, and v3 reports, pixels, request IDs, and retry attempts remain immutable evidence. V4 preserves all 50 v3 semantic contexts and evaluation rubrics under new case IDs so changed prompt behavior cannot reuse earlier provider pixels or evaluator judgments.

No acceptance threshold has been reduced. No paid provider request is authorized by preparing or preflighting this candidate.

The complete no-cost preflight passed on 2026-08-20: 50/50 request contracts, zero failures, and zero provider operations. All 50 prompts retained and repeated one mandatory subject/action; all 10 typography prompts added benign story context. The longest canonical prompt was 9,671 characters, the longest provider prompt was 2,094 characters, and the mean provider prompt was 1,748.2 characters.

## Paid evaluation outcome

The explicitly authorized v8 evaluation stopped after its first two cases. Both exact provider prompts passed input moderation, both Fal requests entered rendering and reached the private-result download stage, and both were then rejected by Fal output safety with distinct request IDs. This affected the non-typography composition control as well as the safety-framed typography request, so the problem is not isolated to the phrase `THE LAST LIGHT`.

No candidate pixels were returned and no pair could be evaluated. The two OpenAI baselines completed; recorded successful provider cost was $0.278935, excluding moderation, failed Fal attempts, and any unreported provider charge. The remaining 48 cases were not started because v8 could no longer satisfy the all-cases completion gate.

Retained Fal request IDs:

- `01a020b5-f759-77f3-a764-5887abce2155` — observatory composition
- `01a020b5-f758-7412-9bb7-4423cbc17785` — observatory typography

Do not retry or continue v8. Escalate both receipts to Fal, then create a separately versioned candidate. A future version should test benign scene framing across typography and non-typography work and include an early neutral provider-health control, without disabling the safety checker.

## What v7 taught us

| V7 evidence | Consequence | V8 correction |
| --- | --- | --- |
| The first candidate rendered the telescope and observatory but omitted the required astronomer. Instruction adherence was 2/5 against the baseline's 5/5. | A subject line placed alongside palette, setting, and composition was not strong enough to preserve the human action. | Every authored subject/action is now a `MANDATORY PRIMARY SUBJECT AND ACTION` near the start of the prompt and is repeated as a `FINAL VISUAL CHECK`. Both occurrences and their source block IDs are recorded in the prompt-adaptation receipt. |
| The benign observatory typography prompt passed exact-prompt moderation, then two distinct Fal renders were rejected by provider output safety. | Input moderation alone cannot predict a render-time safety false positive, especially when short display copy is semantically ambiguous without story context. | Exact-typography requests now receive a benign story-context line: people are safe adults performing the named professional or creative work, and the requested words are the fictional artwork's title. The exact phrase still appears only in the required text instruction. |
| V7 failed after two cases and could no longer meet the all-cases completion gate. | Continuing would have spent money without any path to approval. | The stop-on-impossible gate remains. V8 must begin with a new 50-case checkpoint and requires new explicit paid-run authorization. |

## Safety contract

V8 does not weaken or disable safety:

- OpenAI moderation still reviews the exact provider-native prompt and authorized reference pixels before submission.
- Ideogram's `enable_safety_checker` remains `true`.
- Benign framing is applied only when exact display text is required. It supplies scene meaning; it does not hide or euphemize authored content.
- Provider output-safety failures remain terminal, normalized failure receipts with request IDs and preserved attempts.
- A repeated benign rejection stops qualification for review rather than creating an unbounded rerender loop.

## Preserved provider contract

- Magic Prompt remains disabled with `expansion_model: None`; the application is the only semantic expansion layer.
- Fast drafts remain `BALANCED`; full renders remain `QUALITY`.
- The provider-native prompt remains bounded to 4,000 characters while the full canonical prompt and both hashes remain auditable.
- Reference modes retain the corrected v7 strength mapping and one-reference limit.
- Multi-reference or unsupported-format work keeps the existing OpenAI fallback.

## V4 frozen coverage

- 50 same-context comparisons: 10 composition, 10 typography, 10 spatial, 10 material, and 10 reference cases.
- 10 real reference-pixel cases across preserve-composition and inspiration behavior.
- Prose, bullets, structured JSON, and XML canonical prompt preparation.
- Low, medium, and high-quality requests on the common 1024 × 1024 comparison contract.
- Exact typography, mandatory subjects/actions, negative constraints, local spatial scopes, materials, palettes, lighting, and composition requirements.

## No-cost preflight gate

`pnpm eval:image-adapters:preflight` must validate all 50 cases without provider credentials or provider calls:

1. every size satisfies the Ideogram request contract;
2. every provider-native prompt is at most 4,000 characters;
3. every receipt has unique included block IDs;
4. every case identifies at least one mandatory subject block;
5. the mandatory subject/action appears both near the start and in the final visual check;
6. all 10 typography cases retain exact typography and benign story context;
7. all 40 non-typography cases omit optional copy and prohibit rendered text;
8. every reference case carries source pixels and a mode-specific directive;
9. rendering speed, reference strength, expansion settings, and prompt-adaptation flags are recorded.

The private receipt is written to `outputs/image-adapter-eval/canvas-image-corpus-v4/preflight.json` and excluded from source control.

## Paid evaluation gate

A complete paid run must satisfy every condition:

- all 50 baseline and all 50 candidate requests complete;
- every pair retains one canonical semantic-context hash and valid provider-native output contract;
- at least 90% of pairs receive a current blinded evaluator result;
- at least 80% of evaluated candidate images are usable;
- at least 70% of evaluated reference images are usable;
- candidate mean instruction adherence is no more than 0.75 points below the baseline;
- every capability family is at least 70% usable;
- every prompt-technique family is at least 70% usable.

The evaluator receives anonymized A/B images, shared canonical requirements, authorized reference pixels when applicable, and the task rubric. It does not receive provider identity. Passing evidence permits administrator review; it never approves the adapter automatically.

## Review sequence

1. Retain the passed complete no-cost v4 preflight receipt.
2. Retain the inspected provider prompts for `v4-01-observatory-composition` and `v4-01-observatory-typography`; both contain the repeated mandatory astronomer/action, and the typography case alone contains benign story context.
3. Preserve the stopped v8 checkpoint, report, prompts, baseline pixels, and Fal request IDs unchanged.
4. Escalate the two output-safety receipts to the provider.
5. Version the next adapter and corpus independently; do not reuse v4 provider results.
6. Run a fresh no-cost preflight and obtain new explicit approval before any further paid evaluation.
7. Keep administrative approval unavailable until a future exact adapter/corpus pair has a retained passing report.

## Command

```sh
pnpm eval:image-adapters:preflight
```

The paid runner retains its exact, deliberately awkward approval phrase. Do not automate, agent-run, or schedule that command without the active user's approval for that specific billable run.
