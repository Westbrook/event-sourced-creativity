# Ideogram 4 adapter campaign 4 outcome

Campaign 4 exhausted its authorized ten-candidate ceiling without producing a passing governance artifact. It did, however, produce the first candidate to clear both screens and complete the full frozen 50-case qualification.

The frozen `canvas-image-corpus-v6` source, semantic contexts, reference pixels, rubrics, evaluator, score definitions, subgroup floors, and acceptance thresholds were not changed.

## Result

| Candidate | Highest stage | Result |
| --- | --- | --- |
| `v41` | Micro | 6/7 usable; rejected on instruction delta and subgroup floors. |
| `v42` | Micro | 5/7 usable; rejected. |
| `v43` | Micro | 5/7 usable; rejected. |
| `v44` | Sentinel | 9/15 usable and 2/3 references; rejected. |
| `v45` | Micro | 4/7 usable; rejected. |
| `v46` | Full | 41/50 usable and 9/10 references; rejected on material and JSON subgroup floors. |
| `v47` | Micro | 5/7 usable; rejected. |
| `v48` | Micro | 5/7 usable; rejected. |
| `v49` | Micro | 4/7 usable; rejected. |
| `v50` | Micro | 5/7 usable; rejected. |

## Full finalist: v46

`v46` completed all 50 provider requests after one auditable retry of a benign output-safety rejection. The original failed attempt and Fal request ID remain in the checkpoint; the successful retry did not erase the failure history.

- Overall usability: 41/50, or 82% — pass.
- Reference usability: 9/10, or 90% — pass.
- Mean instruction score: 3.68 versus 4.16 for the paired OpenAI baseline, a -0.48 delta — pass.
- Composition: 10/10 usable — pass.
- Typography: 9/10 usable — pass.
- Spatial: 8/10 usable — pass.
- Material: 5/10 usable — fail.
- Reference: 9/10 usable — pass.
- Prose: 12/13 usable — pass.
- Bullets: 11/13 usable — pass.
- JSON: 8/12 usable — fail.
- XML: 10/12 usable — pass.
- Recorded successful Fal image cost for the full run: $2.344130. Evaluator, moderation, and failed-attempt charges are not included.

Because every capability and prompt-technique family must retain at least 70% usability, `v46` is not eligible for approval.

## What the evidence exposed

The misses were not another generic prompt-ordering problem.

1. Composition cases include the phrase “material specificity.” The adapter searched for material words before composition words, causing composition requests to receive a material-study primary success test.
2. All true material cases use the frozen low-quality contract. The adapter therefore routed every material study to `ideogram/v4/fast`, even though those cases require a named professional, an active process, counted or spatial composition, and several distinct surfaces. The resulting images often rendered materials well but omitted the person or action.
3. Several recurring compositions needed operational geometry: exactly two interview participants, one displaced plate in an otherwise regular overhead grid, concentric frames, print-to-landscape scale, and close-focus repair work.
4. One benign ceramic-material image was rejected by Fal output safety. The bounded retry succeeded, demonstrating why attempt history and a single auditable provider-safety retry are both required.

## Correction prepared after the run

`ideogram-context-v6` corrects the adapter without changing the evaluation:

- capability classification now resolves the requested operation before supporting attributes;
- material-study success requires the named actor/action and named surfaces together;
- edge-limited compositions preserve active hands as action evidence without introducing a forbidden full figure;
- common count and framing relationships compile into explicit shot geometry;
- semantically complex low-quality material studies use the standard Ideogram endpoint, while genuinely lightweight drafts retain the fast endpoint;
- campaign 5 preflight fails any case whose compiled primary success test does not match its frozen capability;
- campaign 5 preflight also requires the material action/surface co-presence contract.

All ten prepared campaign 5 candidates pass the stricter 50-case no-cost preflight. A new explicit paid authorization is required before any of them can be evaluated.

## Retained evidence

- Search manifest: `outputs/image-adapter-cycles/search-2026-08-20T23-34-55-692Z.json`
- Full finalist: `outputs/image-adapter-cycles/v46/full/report.json`
- Full checkpoint and private per-case receipts: `outputs/image-adapter-cycles/v46/full/checkpoint.json`
- Next preflight: `outputs/image-adapter-cycles/v51/full/preflight.json`

