# Canvas image-adapter evaluation

- Corpus: `canvas-image-corpus-v2`
- Corpus SHA-256: `c1b85881f7ef57b724dc09198d9c57b7b1c392b970bff31cbefdb39af57d3528`
- Same-context cases: 50
- Evaluated pairs: 49
- Candidate: `fal-ideogram-v4@v6`
- Result: **REVIEW REQUIRED**

## Outcome

This run is not eligible for adapter approval. 50/50 OpenAI requests and 49/50 candidate requests completed. The evaluator preferred OpenAI in 46 pairs, the candidate in 3, and recorded 0 ties.

## Provider results

| Adapter | Completed | Failed | Usable | Mean instruction | Mean composition | Mean craft | Mean latency | Recorded successful provider cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI `openai-image@v5` | 50/50 | 0 | 47/49 | 4.592 | 4.878 | 4.878 | 66.2s | $3.8487 |
| Fal Ideogram 4 `fal-ideogram-v4@v6` | 49/50 | 1 | 39/49 | 3.469 | 3.449 | 3.918 | 17.7s | $2.1749 |

Recorded successful image-provider cost: **$6.0236**. Evaluator, moderation, and failed-attempt charges are not included.

## Capability coverage

| Capability | Evaluated | OpenAI usable | Candidate usable | OpenAI instruction | Candidate instruction | Preferred O / C / tie |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| composition | 10/10 | 10/10 | 10/10 | 4.8 | 3.6 | 10 / 0 / 0 |
| typography | 10/10 | 9/10 | 8/10 | 4.6 | 3.9 | 8 / 2 / 0 |
| spatial | 10/10 | 10/10 | 8/10 | 4.8 | 3.2 | 10 / 0 / 0 |
| material | 9/10 | 9/9 | 7/9 | 4.667 | 3.444 | 8 / 1 / 0 |
| reference | 10/10 | 9/10 | 6/10 | 4.1 | 3.2 | 10 / 0 / 0 |

## Provider failures

| Case | Provider | Category | Code | Provider message |
| --- | --- | --- | --- | --- |
| `v2-10-harbor-workshop-material` | fal | safety | `fal_safety_rejected` | body.prompt: The generated image was blocked by the safety filter. |

## Acceptance criteria

- FAIL — Both adapters completed all 50 cases
- FAIL — Every pair retained the exact bounded prompt and a square provider-native output
- PASS — At least 90% of pairs received a rubric evaluation
- FAIL — At least 80% of evaluated candidate images were usable
- FAIL — At least 70% of evaluated candidate reference images were usable
- FAIL — Candidate mean instruction adherence was no more than 0.75 points below OpenAI

## Review finding

The registered Fal-hosted Ideogram 4 adapter did not satisfy every frozen acceptance criterion. Preserve this report and correct the named failures in a new adapter version before another paid run.

The frozen corpus source is versioned in `evals/image-adapters/canvas-image-corpus-v2.ts`. Private generated pixels and per-case receipts remain in the ignored evaluation output directory. Governance approval remains a separate administrator action.
