# Canvas image-adapter evaluation

- Corpus: `canvas-image-corpus-v6`
- Corpus SHA-256: `9e5ffe88678811432d297bf4b7181146af2543251978628c111121e7d8f3ee91`
- Same-context cases: 50
- Attempted cases: 50
- Evaluated pairs: 50
- Candidate: `fal-ideogram-v4@v10`
- Prompt adapter: `ideogram-context-v2`
- Result: **REVIEW REQUIRED**

## Outcome

This run is not eligible for adapter approval. 50/50 OpenAI requests and 50/50 candidate requests completed. The evaluator preferred OpenAI in 44 pairs, the candidate in 6, and recorded 0 ties.

## Provider results

| Adapter | Completed | Failed | Usable | Mean instruction | Mean composition | Mean craft | Mean prompt | Mean latency | Recorded successful provider cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI `openai-image@v5` | 50/50 | 0 | 42/50 | 4.46 | 4.76 | 4.86 | 7515 chars | 58.2s | $3.8487 |
| Fal Ideogram 4 `fal-ideogram-v4@v10` | 50/50 | 0 | 26/50 | 2.98 | 3 | 3.86 | 1748 chars | 16.6s | $2.3441 |

Recorded successful image-provider cost: **$6.1928**. Evaluator, moderation, and failed-attempt charges are not included.

## Capability coverage

| Capability | Evaluated | OpenAI usable | Candidate usable | OpenAI instruction | Candidate instruction | Preferred O / C / tie |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| composition | 10/10 | 8/10 | 8/10 | 4.3 | 3.9 | 6 / 4 / 0 |
| typography | 10/10 | 10/10 | 5/10 | 4.9 | 3.5 | 9 / 1 / 0 |
| spatial | 10/10 | 9/10 | 5/10 | 4.4 | 3 | 10 / 0 / 0 |
| material | 10/10 | 8/10 | 8/10 | 4.5 | 3.4 | 9 / 1 / 0 |
| reference | 10/10 | 7/10 | 0/10 | 4.2 | 1.1 | 10 / 0 / 0 |

## Provider failures

| Case | Provider | Category | Code | Request ID | Provider message |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | No provider failures |

## Acceptance criteria

- PASS — All 50 provider-native request shapes passed the no-cost preflight
- PASS — Both adapters completed all 50 cases
- PASS — Every pair retained one canonical semantic-context hash, auditable provider prompts, and a square provider-native output
- PASS — At least 90% of pairs received a current, image-fingerprinted rubric evaluation
- FAIL — At least 80% of evaluated candidate images were usable
- FAIL — At least 70% of evaluated candidate reference images were usable
- FAIL — Candidate mean instruction adherence was no more than 0.75 points below OpenAI
- FAIL — Every capability family retained at least 70% candidate usability
- FAIL — Every canonical prompt-technique family retained at least 70% candidate usability

## Review finding

The registered Fal-hosted Ideogram 4 adapter did not satisfy every frozen acceptance criterion. Preserve this report and correct the named failures in a new adapter version before another paid run.

The frozen corpus source is versioned in `evals/image-adapters/canvas-image-corpus-v6.ts`. Private generated pixels, canonical hashes, provider-native prompt receipts, and per-case evaluator fingerprints remain in the ignored evaluation output directory. Governance approval remains a separate administrator action.
