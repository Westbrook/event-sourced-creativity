# Ideogram 4 adapter campaign 4

## Objective

Find the first adapter that passes the unchanged `canvas-image-corpus-v6` qualification. Run no more than ten immutable candidates (`v41`–`v50`) and stop immediately after the first complete 50-case pass.

The frozen 50 contexts, canonical prompt variants, source references, rubrics, evaluator, and acceptance thresholds are unchanged. A screen cannot qualify an adapter. Only the full 50-case stage may produce a passing governance artifact.

## Evidence from campaign 3

The best complete finalist, `v33`, reached 11/15 usable images and 2/3 usable references. Its four misses define the fourth campaign:

| Failure class | Retained evidence | Correction |
| --- | --- | --- |
| Ambiguous directed geometry | The observatory telescope did not visibly point at the celestial event. | Translate directional composition into an explicit origin, axis, and target relationship. |
| Incidental signature-like marks | Exact title was correct, but a lower-corner mark violated the clean-frame contract. | Express the constraint positively as clean, unmarked, unsigned artwork with quiet lower corners. |
| Weak layout-reference retention | The tidal-library reference output replaced the layout and accumulated book clutter. | Sweep composition-reference transformation strength while retaining a strict layout-only directive. |
| Distant material-study subject | The night-market interview became a dark establishing shot. | Require a medium or medium-wide judging view, explicit subject occupancy, and visually provable setting state. |

Campaign 3 also produced three Fal output-safety rejections on benign prompts. A generated-output rejection is now allowed one auditable rerun with the same immutable adapter candidate. The original failure, request ID, and second attempt stay in the checkpoint. Input moderation and Fal's safety checker remain enabled; no safety threshold is weakened.

## Candidate controls

Every candidate uses the deterministic `ideogram-context-v5` compiler, a recorded seed, provider-expanded plain text, and a single explicit semantic priority. The bounded variants change only documented adapter controls:

- `v41`: production-director baseline;
- `v42`: stronger composition-reference retention;
- `v43`: geometry-first shot plan;
- `v44`: constraints-first clean editorial frame;
- `v45`: slightly stronger inspiration retention;
- `v46`: shot plan plus stronger composition-reference retention;
- `v47`: stronger authored replacement for references;
- `v48`: clean editorial frame plus stronger layout retention;
- `v49`: production director with Medium expansion;
- `v50`: final geometry-first candidate with aggressive authored replacement.

## Funnel and stopping rules

1. Run the complete 50-case no-cost request-contract preflight.
2. Run the unchanged seven-case micro cohort.
3. Advance only candidates that pass the existing micro screen.
4. Run the unchanged fifteen-case sentinel cohort.
5. Advance only candidates that pass the existing sentinel screen.
6. Run all 50 frozen cases. Only this stage may pass.
7. Stop on the first genuine pass or after ten candidates.

The paired OpenAI baseline is reused. New OpenAI image cost is zero. All Fal requests, generated pixels, provider-expanded prompts, seeds, request IDs, latency, cost, evaluator responses, and recovery attempts are retained beneath `outputs/image-adapter-cycles/<version>/<stage>/`.
