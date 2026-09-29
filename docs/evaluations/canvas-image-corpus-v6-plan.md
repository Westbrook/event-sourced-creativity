# Canvas image-adapter v10 evaluation plan

Candidate: `fal-ideogram-v4@v10`  
Provider prompt adapter: `ideogram-context-v2`  
Frozen corpus: `canvas-image-corpus-v6` (50 same-context cases)

## Decision from the v9 diagnostic

The same observatory composition was sent through three Ideogram strategies. Native JSON with expansion disabled failed provider output safety. Concise visual direction with Medium and Large expansion both returned coherent images. Medium took 12.4 seconds; Large took 17.6 seconds. Both successful receipts recorded $0.056215.

V10 makes the proven processing explicit:

- draft and balanced work: `expansion_model: Medium`;
- full-quality work: `expansion_model: Large`;
- native caption: retained as a diagnostic strategy, not the default;
- canonical prose/bullets/JSON/XML fan: unchanged and recorded independently from provider strategy.

## No-cost preflight

All 50 cases passed before a provider call:

- 50/50 bounded provider inputs
- 50/50 mandatory subjects repeated
- 10/10 typography cases retain exact copy and benign story context
- 40 Medium and 10 Large expansion contracts
- maximum provider input: 2,094 characters
- paid operations: 0

Receipt: `outputs/image-adapter-eval/canvas-image-corpus-v6/preflight.json`

## Qualification outcome

The explicitly authorized 50-case OpenAI-vs-Ideogram paired evaluation completed on 2026-08-20. All 50 requests completed for both providers, and all 50 pairs received a current rubric evaluation. The candidate had no provider failures, completing in a mean 16.6 seconds versus 58.2 seconds for the OpenAI baseline.

V10 did not pass the frozen creative gate:

- candidate usability: 26/50 (52%; required 80%);
- reference usability: 0/10 (required 70%);
- mean instruction adherence: 2.98 versus OpenAI's 4.46, a −1.48 delta (minimum −0.75);
- composition and material reached 8/10 usable, while typography and spatial reached 5/10 and reference reached 0/10;
- no canonical prompt-technique family reached its 70% floor;
- OpenAI was preferred in 44 pairs and Ideogram in 6.

Recorded successful image-provider cost was $6.192819; evaluator, moderation, and any failed-attempt charges are outside that receipt. The completed report is retained at `docs/evaluations/canvas-image-corpus-v6.md`. V10 must not be approved or rerun. A subsequent adapter version should isolate reference-edit behavior and improve semantic retention across typography, spatial placement, and structured prompt translations before freezing a new corpus.
