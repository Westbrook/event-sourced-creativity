# Canvas image-adapter evaluation

- Corpus: `canvas-image-corpus-v1`
- Corpus SHA-256: `e8cc43af938404306a69eb4d11a0ad42255cbeccea36156dd853ce0a0151c27f`
- Same-context cases: 50
- Evaluated pairs: 46
- Result: **REVIEW REQUIRED**

## Outcome

This run is not eligible for adapter approval. 50/50 OpenAI requests and 46/50 Fal requests completed. The evaluator preferred OpenAI in 43 pairs, Fal in 3, and recorded 0 ties.

## Provider results

| Adapter | Completed | Failed | Usable | Mean instruction | Mean composition | Mean craft | Mean latency | Recorded successful provider cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI `openai-image@v5` | 50/50 | 0 | 46/46 | 4.891 | 4.848 | 4.717 | 63.4s | $3.3943 |
| Fal `fal-ideogram-v4@v2` | 46/50 | 4 | 38/46 | 3.587 | 3.63 | 3.739 | 20.8s | $2.2442 |

Recorded successful image-provider cost: **$5.6384**. Evaluator, moderation, and failed-attempt charges are not included.

## Capability coverage

| Capability | Evaluated | OpenAI usable | Fal usable | OpenAI instruction | Fal instruction | Preferred O / F / tie |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| composition | 10/10 | 10/10 | 10/10 | 5 | 4.3 | 9 / 1 / 0 |
| typography | 9/10 | 9/9 | 9/9 | 4.889 | 3.889 | 8 / 1 / 0 |
| spatial | 8/10 | 8/8 | 7/8 | 4.75 | 3.625 | 7 / 1 / 0 |
| material | 9/10 | 9/9 | 9/9 | 4.889 | 4.111 | 9 / 0 / 0 |
| reference | 10/10 | 10/10 | 3/10 | 4.9 | 2.1 | 10 / 0 / 0 |

## Provider failures

| Case | Provider | Category | Code | Provider message |
| --- | --- | --- | --- | --- |
| `08-signal-kitchen-material` | fal | safety | `fal_safety_rejected` | body.prompt: The generated image was blocked by the safety filter. |
| `09-desert-printshop-spatial` | fal | safety | `fal_safety_rejected` | body.prompt: The generated image was blocked by the safety filter. |
| `10-harbor-workshop-typography` | fal | safety | `fal_safety_rejected` | body.prompt: The generated image was blocked by the safety filter. |
| `10-harbor-workshop-spatial` | fal | safety | `fal_safety_rejected` | body.prompt: The generated image was blocked by the safety filter. |

## Acceptance criteria

- FAIL — Both adapters completed all 50 cases
- FAIL — Every pair retained the same prompt and requested output dimensions
- PASS — At least 90% of pairs received a rubric evaluation
- PASS — At least 80% of evaluated Fal images were usable
- FAIL — At least 70% of evaluated Fal reference images were usable
- FAIL — Fal mean instruction adherence was no more than 0.75 points below OpenAI

## Review finding

The adapter is not ready for approval on this evidence. Four Fal requests were rejected by the provider's generated-image safety filter after otherwise benign prompts. Reference-image interpretation is the larger quality gap: low transform strengths used for `preserve_composition` kept the source subject instead of carrying its composition into the named subject, and several higher-strength inspiration cases still imported unwanted source content. The frozen v2 receipts must remain immutable; tuning belongs in a new adapter version and requires a new paid evaluation.

The frozen corpus source is versioned in `evals/image-adapters/canvas-image-corpus-v1.ts`. Private generated pixels and per-case receipts remain in the ignored evaluation output directory. This report records completion and model-assisted rubric evidence; governance approval remains an explicit administrator action.
