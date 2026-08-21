# Canvas image-adapter v9 evaluation plan

Candidate: `fal-ideogram-v4@v9`  
Provider prompt adapter: `ideogram-caption-v1`  
Frozen corpus: `canvas-image-corpus-v5` (50 same-context cases)

## Why this version exists

The v8 requests passed input moderation and rendered, but Ideogram returned output-safety failures for both initial cases. Manual testing and the official Ideogram 4 prompting guide identified a contract mismatch: Ideogram 4 is trained on structured JSON captions, while v8 sent concise prose with expansion disabled.

V9 compiles the same durable document context into Ideogram's native caption structure. It does not loosen safety behavior, change the canonical four-way prompt fan, or inherit a prior evaluation judgment.

## No-cost preflight

All 50 cases passed before a provider call:

- 50/50 valid native JSON captions
- 50/50 subject object elements
- 10/10 exact typography text elements
- 10/10 spatial bounding-box elements
- 0 secondary-expansion requests
- maximum provider caption: 1,865 characters
- paid operations: 0

Receipt: `outputs/image-adapter-eval/canvas-image-corpus-v5/preflight.json`

## Bounded provider diagnostic

Before a full paid qualification, run exactly three requests for the observatory composition context:

1. native JSON caption with `expansion_model: None`;
2. concise plain text with `expansion_model: Medium`;
3. concise plain text with `expansion_model: Large`.

Retain exact prompts, prompt hashes, provider request IDs, provider revisions, cost, latency, safety outcome, and returned pixels. The retired v8 plain-text/None failure is the historical control and must not be re-run.

If the native caption fails, stop. If only an expanded strategy succeeds, treat expansion as an explicit provider strategy with a visible cost and receipt rather than silently enabling it. A successful diagnostic permits review for a separately authorized 50-case evaluation; it does not approve the adapter.
