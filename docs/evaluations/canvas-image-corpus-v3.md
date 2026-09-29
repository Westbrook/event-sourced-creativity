# Canvas image-adapter evaluation

- Corpus: `canvas-image-corpus-v3`
- Corpus SHA-256: `976222b4da32240e36009121828deacc72e357f4c7431d94cd9da85d5d57f7c8`
- Same-context cases: 50
- Evaluated pairs: 1
- Candidate: `fal-ideogram-v4@v7`
- Prompt adapter: `ideogram-context-v1`
- Result: **REVIEW REQUIRED**

## Outcome

This run is not eligible for adapter approval. 2/50 OpenAI requests and 1/50 candidate requests completed. The evaluator preferred OpenAI in 1 pairs, the candidate in 0, and recorded 0 ties.

The budget-protection gate stopped the run after two cases. The first candidate completed but omitted the mandatory astronomer and scored 2/5 for instruction adherence. The next benign typography prompt passed exact-prompt moderation but Fal rejected the generated output twice with distinct provider request IDs. Continuing the remaining corpus could not make v7 pass the all-cases criterion.

## Provider results

| Adapter | Completed | Failed | Usable | Mean instruction | Mean composition | Mean craft | Mean prompt | Mean latency | Recorded successful provider cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI `openai-image@v5` | 2/50 | 0 | 1/1 | 5 | 5 | 5 | 7010 chars | 104.9s | $0.2789 |
| Fal Ideogram 4 `fal-ideogram-v4@v7` | 1/50 | 1 | 0/1 | 2 | 3 | 4 | 1093 chars | 13.7s | $0.0262 |

Recorded successful image-provider cost: **$0.3051**. Evaluator, moderation, and failed-attempt charges are not included.

## Capability coverage

| Capability | Evaluated | OpenAI usable | Candidate usable | OpenAI instruction | Candidate instruction | Preferred O / C / tie |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| composition | 1/10 | 1/1 | 0/1 | 5 | 2 | 1 / 0 / 0 |
| typography | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| spatial | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| material | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| reference | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |

## Provider failures

| Case | Provider | Category | Code | Provider message |
| --- | --- | --- | --- | --- |
| `v3-01-observatory-typography` | fal | safety | `fal_safety_rejected` | body.prompt: The generated image was blocked by the safety filter. |

The retained checkpoint contains both rejected attempts: `01a02078-4318-75c1-bbf0-e2dcd6f4b5a6` and `01a0207b-d8b0-74d1-9602-a3e2f60d2fb1`. The second attempt did not overwrite the first receipt.

## Acceptance criteria

- PASS — All 50 provider-native request shapes passed the no-cost preflight
- FAIL — Both adapters completed all 50 cases
- FAIL — Every pair retained one canonical semantic-context hash, auditable provider prompts, and a square provider-native output
- FAIL — At least 90% of pairs received a current, image-fingerprinted rubric evaluation
- FAIL — At least 80% of evaluated candidate images were usable
- FAIL — At least 70% of evaluated candidate reference images were usable
- FAIL — Candidate mean instruction adherence was no more than 0.75 points below OpenAI
- FAIL — Every capability family retained at least 70% candidate usability
- FAIL — Every canonical prompt-technique family retained at least 70% candidate usability

## Review finding

The registered Fal-hosted Ideogram 4 adapter did not satisfy every frozen acceptance criterion. Preserve this report and correct the named failures in a new adapter version before another paid run.

The frozen corpus source is versioned in `evals/image-adapters/canvas-image-corpus-v3.ts`. Private generated pixels, canonical hashes, provider-native prompt receipts, and per-case evaluator fingerprints remain in the ignored evaluation output directory. Governance approval remains a separate administrator action.
