# Ideogram 4 bounded adapter search outcome

- Frozen corpus: `canvas-image-corpus-v6`
- Candidates attempted: `v11` through `v20` (10 maximum)
- Result: **no qualifying candidate**
- Highest stage reached: micro screen
- New successful Fal image cost recorded: **$1.940838**
- Cost caveat: failed attempts, OpenAI rubric evaluations, and moderation probes are not included in that figure.

## Outcome

No candidate was promoted. Production remains on the non-approved `fal-ideogram-v4@v10` adapter, and the Canvas release gate remains closed.

`v20` was the strongest complete screen: all 7 provider requests completed, both reference cases were usable, 5 of 7 candidate images were usable, and mean instruction adherence was 3.714/5. It missed the 80% screen because the spatial and material cases were not usable. No candidate advanced to the 15-case sentinel or 50-case qualification stage.

`v11` showed the most useful early signal: 5 of 6 evaluated images and both reference cases were usable. Its seventh request exposed an endpoint-contract bug because `ideogram/v4/fast` accepts only `None` or `Medium` expansion. That capability is now resolved before submission and covered by preflight. `v13` was interrupted after its no-cost preflight and before a durable candidate receipt was written; it still counts toward the authorized ten-cycle ceiling.

## What the search established

1. Raising image-to-image transformation strength corrected the v10 source-copying failure. At `0.92–1.0`, composition and inspiration references can replace source subjects while retaining the requested structural influence.
2. `Medium` expansion completed reliably but produced weaker instruction adherence than `Large` in this corpus.
3. The existing native-caption compiler was rejected by provider output safety across multiple benign controls. Its top-level schema differs from Ideogram's current documented structured-caption contract and must be replaced before another native-caption evaluation.
4. Large-expanded prose still under-specifies local spatial constraints and some material/compositional relationships. Those are compiler problems, not parameters that a blind strength sweep is likely to solve.
5. Pairwise rubric scores varied for the same frozen OpenAI pixels across candidate runs. Future screening should keep a fixed single-image baseline score or use a small consensus before rejecting a near-threshold candidate.

## Next bounded search

Prepare a new compiler version before spending again:

- emit Ideogram's exact documented top-level structured JSON contract;
- translate AABB and fuzzy scope into explicit bounded elements and repeat the local-only constraint in the affected element;
- separate material facts into subject/object elements instead of flattening them into global prose;
- retain `Large` expansion where supported and `Medium` on the fast endpoint;
- retain reference replacement strength near `1.0`, with a slightly lower value only for preserve-composition;
- make screening decisions from stable baseline scoring and recorded provider revisions;
- request fresh user authorization for a new cycle campaign. The completed ten-cycle campaign must not be silently continued.

Private pixels, prompts, revised prompts, request IDs, evaluator receipts, and per-version reports remain under `outputs/image-adapter-cycles/`.

