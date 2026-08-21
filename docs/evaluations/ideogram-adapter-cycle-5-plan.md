# Ideogram 4 adapter campaign 5

## Objective

Qualify the first Ideogram 4 adapter against the unchanged 50-case `canvas-image-corpus-v6` gate. Stop immediately on the first full pass. Never execute more than ten candidates.

## Frozen evaluation contract

Campaign 5 does not change:

- the 50 semantic contexts;
- case IDs, reference pixels, or canonical prompt techniques;
- the evaluator model or image-fingerprinted cache behavior;
- any rubric or usable-image definition;
- the 80% overall usability floor;
- the 70% reference usability floor;
- the -0.75 instruction-adherence delta;
- the 70% floor for every capability and prompt-technique family;
- the requirement that all 50 paired requests complete.

Only a completed 50-case report may pass. Micro and sentinel runs can only reject or advance candidates.

## Structural changes under test

1. `ideogram-context-v6` classifies the requested operation before supporting scene attributes.
2. Material studies require the person/action and physical surfaces together.
3. Low-quality material studies use the standard endpoint because their semantic load exceeds a lightweight preview.
4. Directed geometry covers counts, grids, converging frames, relative scale, and close-focus action.
5. The primary success mode must match the frozen capability at no-cost preflight.
6. Exact canonical hashes, provider prompts, revised prompts, seeds, model choice, reference strength, cost, latency, attempts, and provider request IDs remain in the receipt.

## Candidates

Candidates `v51`–`v60` vary only the retained production-director, shot-plan, or clean-editorial strategy and documented reference transformation strengths. All use Large provider expansion because the material cases now use the standard endpoint and the low-quality reference cases use image-to-image. Their seeds are deterministic and recorded. A genuinely lightweight fast-endpoint draft would still be constrained to Medium expansion.

The highest-confidence starting candidate is `v51`: shot-plan delivery, 0.99 inspiration transformation, and 0.88 preserve-composition transformation.

## Funnel

1. Run the 50-case no-cost preflight. Any structural mismatch rejects the candidate before provider work.
2. Run the fixed seven-case micro cohort.
3. Advance only a micro pass to the fixed 15-case sentinel.
4. Advance only a sentinel pass to the full 50-case qualification.
5. On a Fal output-safety rejection, retain the failed attempt and permit one auditable retry of that same stage.
6. Stop on the first passing full report.

The OpenAI image baseline is reused. New paid work consists of Fal candidate images, exact prompt/reference moderation, and evaluator calls. Running this campaign requires a new explicit user authorization.
