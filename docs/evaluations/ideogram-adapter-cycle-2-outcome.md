# Ideogram 4 adapter campaign 2 outcome

## Decision

Campaign 2 exhausted its authorized ten-cycle ceiling without producing a passing adapter. Production selection and governance approval remain unchanged.

The campaign was still a meaningful improvement. `v30` returned seven of seven images, made six usable, and made both reference-image studies usable. It is the retained best diagnostic candidate, not an approved production candidate.

## What ran

- Corpus: frozen `canvas-image-corpus-v6` semantics.
- Candidates: immutable `v21` through `v30`.
- Funnel: 50-case no-cost preflight, 7-case micro screen, 15-case sentinel, then 50-case qualification.
- Fresh OpenAI baseline images: zero; existing baseline pixels were reused after corpus-hash verification.
- Recorded successful candidate-image cost: `$1.092959`. This excludes failed provider attempts, moderation, and evaluator charges.
- Highest stage reached: micro. No candidate was allowed to advance on a failed screen.

`v27` was stopped after two successful native images when the repeated provider behavior made the native route's failure mode clear. Its partial checkpoint remains immutable and counts as the seventh authorized cycle. The final three cycles were reassigned, before execution, to the provider-expanded route.

## What we learned

### Native structured JSON is not currently a reliable Fal contract

`v21`–`v26` repeatedly produced provider output-safety rejections for benign frozen contexts. `v27` returned two images, but the campaign stopped that route rather than spending the remaining authorization on the same systemic failure.

The native compiler still implements Ideogram's documented ordered JSON shape and remains useful for diagnostics. It should not become the production default on this provider path without new evidence.

### Expansion reliably returns pixels

Every request in `v28`–`v30` completed. The corrected expanded compiler preserves scoped palettes locally, renders AABB decisions as local instructions, repeats literal composition requirements, and makes material distinctions explicit.

| Candidate | Usable | Reference usable | Mean instruction | Result |
| --- | ---: | ---: | ---: | --- |
| `v28` | 4/7 | 2/2 | 3.571/5 | Rejected at micro |
| `v29` | 4/7 | 1/2 | 3.286/5 | Rejected at micro |
| `v30` | 6/7 | 2/2 | 3.286/5 | Rejected at micro |

### The remaining problem is semantic precision, not delivery reliability

`v30` cleared the overall 80% usability and 70% reference-usability gates. It did not clear three independent criteria:

1. Instruction adherence trailed the frozen OpenAI baseline by `1.143` points; the allowed delta is `0.75`.
2. Composition was usable in only one of two micro cases, below the 70% capability floor.
3. The sole XML case was the failed composition case, so XML remained below the 70% prompt-technique floor.

The concrete failed image was the ceramic-lab composition: the requested ceramicist and hands-only lower-edge framing were omitted. The strongest next correction is therefore not a more permissive gate or another broad parameter sweep. It is a targeted compiler/eval change that turns exact counts, required human/action elements, and edge-only framing into independently checkable visual facts, while normalizing XML into the same internal representation used by the stronger prompt techniques.

## Guardrails retained

- A micro or sentinel result cannot approve an adapter.
- A failed request does not count as a usable output.
- Every paid campaign needs a fresh, campaign-specific user approval and a hard cycle ceiling.
- Prompts, revisions, request IDs, checkpoints, evaluator fingerprints, pixels, cost estimates, and reports are retained per immutable adapter version.
- The best non-passing candidate is visible in the Image-adapter laboratory, but it is not silently promoted.

## Evidence

- Search coordinator: `outputs/image-adapter-cycles/search-2026-08-20T22-21-36-115Z.json`
- Best candidate report: `outputs/image-adapter-cycles/v30/micro/report.json`
- Best candidate checkpoint: `outputs/image-adapter-cycles/v30/micro/checkpoint.json`
- Full no-cost preflight: `outputs/image-adapter-cycles/v30/full/preflight.json`
