# Ideogram 4 adapter cycle plan

## Objective

Find the first adapter version that satisfies the frozen 50-case image-adapter gate without repeatedly paying for, waiting on, or changing the OpenAI baseline. A search may evaluate at most ten immutable candidates and stops immediately on the first qualifying result.

## Funnel

1. **No-cost preflight** compiles the selected cohort, validates sizes, prompt bounds, structured-caption receipts, reference semantics, and adapter identity.
2. **Micro screen** generates seven deliberately difficult cases. It includes every capability, all four canonical prompt representations, and both reference modes. A failure rejects the candidate; it cannot approve one.
3. **Sentinel screen** generates fifteen balanced cases spanning three creative contexts and all five capabilities. It uses the frozen evaluator and the same predictive thresholds. A failure rejects the candidate; it cannot approve one.
4. **Full qualification** generates the candidate side of all fifty cases and compares it with the immutable v10 OpenAI baseline. Only this stage may produce a passing governance artifact.

## Cost and evidence controls

- Candidate stages reuse all fifty previously generated OpenAI images and receipts after verifying the corpus hash and canonical prompt hash. New OpenAI image cost is zero.
- Every candidate and stage has its own checkpoint, images, exact provider prompt, provider-revised prompt, reference strength, request ID, latency, and cost receipt under `outputs/image-adapter-cycles/<version>/<stage>/`.
- Completed work is resumable. Matching image and evaluator fingerprints are reused instead of paid for again.
- The coordinator requires the user's exact bounded-search approval and clamps the search to ten cycles.
- Provider failures stop the affected stage early. The next candidate is not relabeled and prior evidence is never overwritten.
- Micro and sentinel results are explicitly non-qualifying. A candidate is not made available to production or governance until the full gate passes.

## Candidate order

The bounded profiles vary one documented provider behavior at a time: expanded visual prose versus native structured captions, provider expansion level, and image-to-image transformation strength. The early candidates prioritize the two findings from v10: use the strongest expansion consistently and stop source-reference subjects from overpowering authored content. Expansion is resolved against the selected endpoint before submission: the fast text-to-image endpoint is limited to `None` or `Medium`, while supported standard and image-to-image requests may use `Large`.

## Command

```sh
pnpm eval:image-adapters:cycle -- --max-cycles=10 --approve-paid-eval="I explicitly approve up to ten paid image-adapter candidate cycles"
```

The search stops at the first full pass. Its durable search receipt points to every stage report and records the successful version, or the best available evidence when all bounded candidates are rejected.
