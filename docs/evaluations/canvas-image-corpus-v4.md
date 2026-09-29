# Canvas image-adapter evaluation

- Corpus: `canvas-image-corpus-v4`
- Corpus SHA-256: `2bb29d7f54dec27898cf4a01a6777b6d99201fdf37fc51f4d398597884341f24`
- Same-context cases: 50
- Attempted cases: 2
- Evaluated pairs: 0
- Candidate: `fal-ideogram-v4@v8`
- Prompt adapter: `ideogram-context-v2`
- Result: **REVIEW REQUIRED**

## Outcome

This run is not eligible for adapter approval. 2/50 OpenAI requests and 0/50 candidate requests completed. The evaluator preferred OpenAI in 0 pairs, the candidate in 0, and recorded 0 ties. The budget-protection gate stopped after 2 attempted cases because a provider failure made the all-cases qualification criterion impossible.

## Provider results

| Adapter | Completed | Failed | Usable | Mean instruction | Mean composition | Mean craft | Mean prompt | Mean latency | Recorded successful provider cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI `openai-image@v5` | 2/50 | 0 | 0/0 | 0 | 0 | 0 | 7010 chars | 98.8s | $0.2789 |
| Fal Ideogram 4 `fal-ideogram-v4@v8` | 0/50 | 2 | 0/0 | 0 | 0 | 0 | 1644 chars | 0.0s | $0.0000 |

Recorded successful image-provider cost: **$0.2789**. Evaluator, moderation, and failed-attempt charges are not included.

## Capability coverage

| Capability | Evaluated | OpenAI usable | Candidate usable | OpenAI instruction | Candidate instruction | Preferred O / C / tie |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| composition | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| typography | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| spatial | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| material | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |
| reference | 0/10 | 0/0 | 0/0 | 0 | 0 | 0 / 0 / 0 |

## Provider failures

| Case | Provider | Category | Code | Request ID | Provider message |
| --- | --- | --- | --- | --- | --- |
| `v4-01-observatory-composition` | fal | safety | `fal_safety_rejected` | `01a020b5-f759-77f3-a764-5887abce2155` | body.prompt: The generated image was blocked by the safety filter. |
| `v4-01-observatory-typography` | fal | safety | `fal_safety_rejected` | `01a020b5-f758-7412-9bb7-4423cbc17785` | body.prompt: The generated image was blocked by the safety filter. |

## Acceptance criteria

- PASS — All 50 provider-native request shapes passed the no-cost preflight
- FAIL — Both adapters completed all 50 cases
- FAIL — Every pair retained one canonical semantic-context hash, auditable provider prompts, and a square provider-native output
- FAIL — At least 90% of pairs received a current, image-fingerprinted rubric evaluation
- FAIL — At least 80% of evaluated candidate images were usable
- FAIL — At least 70% of evaluated candidate reference images were usable
- PASS — Candidate mean instruction adherence was no more than 0.75 points below OpenAI
- FAIL — Every capability family retained at least 70% candidate usability
- FAIL — Every canonical prompt-technique family retained at least 70% candidate usability

## Review finding

The registered Fal-hosted Ideogram 4 adapter did not satisfy every frozen acceptance criterion. Preserve this report and correct the named failures in a new adapter version before another paid run.

The frozen corpus source is versioned in `evals/image-adapters/canvas-image-corpus-v4.ts`. Private generated pixels, canonical hashes, provider-native prompt receipts, and per-case evaluator fingerprints remain in the ignored evaluation output directory. Governance approval remains a separate administrator action.
