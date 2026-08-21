# Ideogram 4 adapter v7 qualification plan

Candidate: `fal-ideogram-v4@v7`  
Prompt adapter: `ideogram-context-v1`  
Frozen corpus: `canvas-image-corpus-v3`  
Status: **PAID QUALIFICATION STOPPED; V7 IS NOT APPROVABLE**

## Decision

The v1 and v2 reports remain immutable non-passing evidence. They do not justify releasing the second image adapter. V7 is a new candidate that incorporates those reports without lowering the acceptance bar, and v3 gives it new case identities while preserving all 50 semantic contexts.

The no-cost preflight passed all 50 cases on 2026-08-20. It made zero provider calls. The longest canonical prompt was 9,671 characters; deterministic provider-native translation reduced the longest submitted prompt to 1,590 characters and the mean to 1,264.3 characters. All capability families and all four canonical prompt techniques produced valid request contracts.

The paid v7 run stopped after two cases, as the budget-protection gate requires. Fal successfully completed the composition request, but its output omitted the mandatory astronomer and scored 2/5 for instruction adherence against 5/5 for the baseline. The following benign typography request passed exact-prompt moderation but was rejected by Fal's generated-image safety filter twice, with distinct provider request IDs. Continuing the remaining 48 cases could not make v7 satisfy the all-cases gate, so no further paid images were requested.

## What the previous evidence taught us

| Finding | Prior evidence | Adapter/process correction |
| --- | --- | --- |
| Long event-oriented prompts were sent directly to a model that benefits from concise visual direction. | V2 candidate instruction adherence was 3.469/5 versus 4.592/5 for the baseline. Spatial and reference studies were 3.2/5. | Retain the canonical prompt as the auditable document representation, then deterministically translate it into an ordered, bounded Ideogram prompt. Store both prompt hashes and lengths. |
| A second provider-side expansion could invent typography, UI chrome, additional subjects, or presentation framing. | Review notes repeatedly identified tiny copy, labels, footers, insets, or unrelated subjects in non-typography cases. | Set `expansion_model` to `None`. The application compiler is the only semantic expansion layer. |
| Mentioning optional typography caused it to appear even when type was not the task. | Composition, spatial, material, and reference outputs sometimes gained unwanted copy. | Omit optional typography outside explicit typography work and prohibit all rendered words, labels, signatures, borders, footers, and interface chrome. Explicit typography requires one exact phrase once and prohibits other copy. |
| Raw event metadata and numeric scopes did not reliably communicate local visual intent. | Spatial usable rate was 8/10 and several outputs ignored the named subject or applied direction globally. | Translate scopes into named visual regions, normalized bounds, and explicit “apply only here; leave the rest unaffected” language. |
| Reference strength semantics were not aligned with the provider contract. | Reference usability improved from 3/10 in v1 to 6/10 in v2, but preserve-composition remained 3/5 and source content still leaked into outputs. | Use provider-documented strength semantics: lower values stay closer to input. V7 maps subject `0.30`, composition `0.55`, style `0.65`, and inspiration `0.82`, with mode-specific instructions. |
| Changed images could inherit an old evaluator judgment. | The previous cache key was evaluator-version-only. | Fingerprint both image hashes, canonical context, reference pixels, rubric, evaluator model, and evaluator version. |
| Exact provider prompt equality prevented legitimate provider-native adaptation. | The old gate treated wording equality as semantic parity. | Require one shared canonical-context hash while retaining separate provider-prompt hashes. Evaluate visible results against the shared authored context. |
| Aggregate success could hide a weak family. | V2 composition was 10/10 usable while reference was 6/10. | Add 70% usability floors for every capability family and every canonical prompt-technique family. |

### Case-level failure patterns reviewed

- `v2-04-ceramic-lab-spatial` omitted the ceramicist and lower-edge hands, placed the triptych outside the requested lower-right region, and added faint peripheral text. V7 now makes the subject/action and local region separate imperative lines, and optional type is absent.
- `v2-05-rail-garden-reference` reduced the requested garden and architect to a small inset, then added garbled copy and UI-like annotations. V7 prohibits insets, annotations, presentation chrome, and non-required text after applying a mode-specific pixel-reference instruction.
- `v2-07-winter-greenhouse-spatial` placed the bloom outside its local region and introduced a black footer with garbled text. V7 states the named region, its normalized bounds, what applies only there, and what must remain unchanged elsewhere.
- `v2-09-desert-printshop-reference` preserved a print-dominant composition but lost the printmaker’s action and introduced edition/signature marks. V7 gives authored subject/action priority over source narrative and prohibits signatures and incidental copy.
- `v2-10-harbor-workshop-material` failed at the candidate safety filter even after otherwise benign context. V7 moderates the exact shorter provider prompt and retains the normalized provider failure; the next paid run still requires all 50 candidate requests to complete.

Provider retries retain prior attempt receipts and request identifiers rather than overwriting them. The final report distinguishes unresolved failures from cases that recovered after a controlled rerender.

## V3 frozen coverage

- 50 same-context comparisons: 10 composition, 10 typography, 10 spatial, 10 material, and 10 reference cases.
- 10 real reference-pixel cases, including preserve-subject, preserve-composition, preserve-style, and inspiration behavior.
- Prose, bullets, structured JSON, and XML canonical prompt preparation.
- Low, medium, and high-quality requests on a common square comparison contract.
- Exact typography, negative constraints, local spatial scopes, materials, palettes, lighting, and composition requirements.

## Preflight gate

The paid runner refuses to start without explicit approval. Before that approval, `pnpm eval:image-adapters:preflight` validates every frozen case without provider credentials or provider calls:

1. the requested size satisfies the Ideogram contract;
2. provider-native prompts stay at or below 4,000 characters;
3. prompt receipts do not duplicate block identifiers;
4. explicit typography survives exactly where required;
5. optional typography is removed everywhere else;
6. reference cases carry both reference pixels and a mode-specific directive;
7. draft/full rendering speed, reference strength, and expansion settings are recorded.

The generated private receipt is `outputs/image-adapter-eval/canvas-image-corpus-v3/preflight.json` and is intentionally excluded from source control.

## Paid evaluation gate

A complete paid run must satisfy every condition:

- all 50 baseline and all 50 candidate requests complete;
- every pair retains one canonical semantic-context hash and valid provider-native output contract;
- at least 90% of pairs receive a valid blinded evaluator result;
- at least 80% of evaluated candidate images are usable;
- at least 70% of evaluated reference images are usable;
- candidate mean instruction adherence is no more than 0.75 points below the baseline;
- every capability family is at least 70% usable;
- every prompt-technique family is at least 70% usable.

The evaluator sees anonymized A/B images, the shared canonical requirements, the authorized reference pixels when applicable, and a task-specific rubric. It does not see provider identity. A provider failure stops qualification and remains a retained failure receipt; it is never silently skipped.

## Review sequence

1. Preserve the v1 and v2 reports and pixels unchanged.
2. Confirm the v3 preflight receipt still passes after any adapter, compiler, corpus, or rubric change.
3. Obtain explicit approval for the exact paid 50-case run.
4. Run the pair generation and evaluator with private checkpointing enabled.
5. Inspect all failed requests, every unusable candidate, all reference cases, the worst instruction deltas, and each capability/prompt-technique floor.
6. Publish the generated v3 report only if its data and hashes match the retained checkpoint.
7. Permit administrative adapter approval only when the server registers a passing `fal-ideogram-v4@v7` / `canvas-image-corpus-v3` report. Passing evidence does not approve itself.

## Command

```sh
pnpm eval:image-adapters:preflight
```

The paid runner additionally requires its exact, deliberately awkward approval phrase. Do not automate, agent-run, or schedule that command without the active user's approval for that specific billable run.
